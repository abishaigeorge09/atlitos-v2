// ATLITOS v2 — supabase/functions/gear-ingest/index.ts
//
// Phase S2 Track C (PRD-07 FR-44 to FR-47; ADR-011 D3, AC-11-3). Turns a
// pasted retailer product URL into a reviewable draft, then into one
// `affiliate_products` row and one `product_offers` row.
//
// Two actions, same function:
//   POST { action: "fetch", url }
//     -> 200 { draft: ProductDraft, retailer_key: string | null, warnings: string[] }
//     -> 422 { error: { code, message }, draft?, retailer_key, warnings,
//        upstream_status? } with UNSUPPORTED_RETAILER, ROBOTS_DISALLOWED,
//        BLOCKED_TARGET, RETAILER_UNAVAILABLE or NO_PRODUCT_FOUND, whatever
//        partial fields could still be read attached under `draft` (FR-47:
//        the manual form stays usable with whatever was extracted).
//        RETAILER_UNAVAILABLE (A3-T2, 2026-09-22) is the honest answer when
//        a supported retailer refuses the fetch itself: the programme is
//        marked `fetchable = false` (no round trip is made), or the page
//        answered 403, 429 or 5xx. Before this, an Amazon 503 fell through
//        to NO_PRODUCT_FOUND and read as "your link is wrong".
//     WRITES NOTHING (FR-44). Not even the image copy.
//   POST { action: "save", url, draft, productId? }
//     -> 200 { product: AffiliateProductRow, offer: ProductOfferRow }
//     Fetches the image (never the whole page a second time; the admin's
//     reviewed/edited draft is the source of truth for every other field),
//     hashes it (SHA-256, first 16 hex chars), copies it to
//     `product-images/<retailer_key>/<hash>.<ext>` under the SERVICE ROLE
//     (skip the upload if that path already exists, the dedupe), then calls
//     `admin_upsert_affiliate_product` and `admin_upsert_product_offer`
//     USING THE CALLER'S OWN FORWARDED JWT, never the service role, so
//     `has_role('admin')` inside those RPCs stays the one place deciding who
//     may write the catalogue (ADR-011 D3's component boundary). Service
//     role here is used ONLY for the outbound retailer/image fetch and the
//     Storage write.
//
// AUTH: admin JWT only, on both actions. Anon and a non-admin authenticated
// caller are both refused (401 / 403), proven by `verify-gear-ingest.mjs`
// (AC-11-6).

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import { serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";
import { captureEdgeError } from "../_shared/sentry.ts";
import { fetchPage, FETCH_TIMEOUT_MS, MAX_RESPONSE_BYTES, guardedFetch, hostMatchesPattern, checkTarget } from "../_shared/fetch-page.ts";
import { extractProduct, type ProductDraft, type RetailerExtractorMap } from "../_shared/extract-product.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

const BUCKET = "product-images";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB, distinct from fetch-page's 5MB HTML cap
const IMAGE_EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const USER_AGENT = "AtlitosBot/1.0 (+https://atlitos.com/bot)";

interface RetailerProgrammeRow {
  key: string;
  display_name: string;
  url_patterns: string[];
  affiliate_tag_template: string | null;
  extractor: RetailerExtractorMap | null;
  fetchable: boolean;
}

// ---------------------------------------------------------------------------
// Auth: admin JWT only (mirrors admin-order-advance's requireAdmin exactly:
// reads user_roles THROUGH the caller's own JWT, never app_metadata).
// ---------------------------------------------------------------------------
async function requireAdmin(req: Request): Promise<void> {
  const userClient = userScopedClient(req);
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new AppError("UNAUTHENTICATED", "Invalid or expired session.", 401);
  }
  const { data: roleRow, error: roleError } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError || !roleRow) {
    throw new AppError("FORBIDDEN", "Admin role required.", 403);
  }
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------
interface FetchBody {
  action: "fetch";
  url: string;
}
interface SaveBody {
  action: "save";
  url: string;
  draft: ProductDraft;
  productId?: string;
}

function parseBody(raw: unknown): FetchBody | SaveBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.url !== "string" || !body.url.trim()) {
    throw new AppError("VALIDATION", "url is required.", 400);
  }
  const url = body.url.trim();

  if (body.action === "fetch") {
    return { action: "fetch", url };
  }
  if (body.action === "save") {
    if (typeof body.draft !== "object" || body.draft === null) {
      throw new AppError("VALIDATION", "draft is required for action \"save\".", 400);
    }
    const draft = body.draft as Record<string, unknown>;
    if (typeof draft.title !== "string" || !draft.title.trim()) {
      throw new AppError("VALIDATION", "draft.title is required.", 400);
    }
    const productDraft: ProductDraft = {
      title: draft.title.trim(),
      brand: typeof draft.brand === "string" && draft.brand.trim() ? draft.brand.trim() : null,
      price: typeof draft.price === "number" && Number.isFinite(draft.price) ? draft.price : null,
      currency: typeof draft.currency === "string" && draft.currency.trim() ? draft.currency.trim() : null,
      inStock: typeof draft.inStock === "boolean" ? draft.inStock : null,
      imageUrl: typeof draft.imageUrl === "string" && draft.imageUrl.trim() ? draft.imageUrl.trim() : null,
      canonicalUrl: typeof draft.canonicalUrl === "string" && draft.canonicalUrl.trim() ? draft.canonicalUrl.trim() : url,
      description: typeof draft.description === "string" && draft.description.trim() ? draft.description.trim() : null,
    };
    return {
      action: "save",
      url,
      draft: productDraft,
      productId: typeof body.productId === "string" && body.productId.trim() ? body.productId.trim() : undefined,
    };
  }
  throw new AppError("VALIDATION", 'action must be "fetch" or "save".', 400);
}

// ---------------------------------------------------------------------------
// Retailer matching: which retailer_programmes row (if any) matches the
// URL's hostname. Read under the service role: an admin JWT can also read
// this table (admin-read RLS), but gear-ingest already needs a service-role
// client for the network fetch and the Storage write, so one client covers
// both rather than juggling two.
// ---------------------------------------------------------------------------
async function matchRetailer(svc: AnySupabaseClient, url: string): Promise<RetailerProgrammeRow | null> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const { data, error } = await svc
    .from("retailer_programmes")
    .select("key, display_name, url_patterns, affiliate_tag_template, extractor, fetchable")
    .eq("active", true);
  if (error) {
    throw new AppError("INTERNAL", `Failed to load retailer programmes: ${error.message}`, 500);
  }
  for (const row of (data ?? []) as RetailerProgrammeRow[]) {
    if ((row.url_patterns ?? []).some((pattern) => hostMatchesPattern(hostname, pattern))) {
      return row;
    }
  }
  return null;
}

/** A minimal, best-effort scrape for FR-47's "whatever was extracted" on a refusal. */
function partialFromHtml(html: string, fallbackUrl: string): Partial<ProductDraft> {
  const image = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  const canonical = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([^"']+)["']/i)?.[1] ?? fallbackUrl;
  const description = html.match(/<meta[^>]+property\s*=\s*["']og:description["'][^>]+content\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  return { imageUrl: image, canonicalUrl: canonical, description };
}

// ---------------------------------------------------------------------------
// action: fetch
// ---------------------------------------------------------------------------
async function handleFetch(svc: AnySupabaseClient, url: string) {
  const programme = await matchRetailer(svc, url);
  const warnings: string[] = [];
  if (!programme) {
    // Red team 2026-09-18: the programme match GATES the fetch. Without it the
    // server would fetch any host an admin pasted (CWE-918).
    throw new AppError(
      "UNSUPPORTED_RETAILER",
      "This host is not a supported retailer. Add it to retailer_programmes first, or enter the product by hand.",
      422,
    );
  }

  // The programme says, as data, that this retailer's pages cannot be read
  // from here (amazon_in answers a 503 bot wall). No round trip: the admin
  // fills the form by hand and the pasted URL stays the offer link.
  if (programme.fetchable === false) {
    return jsonResponse(
      {
        error: {
          code: "RETAILER_UNAVAILABLE",
          message: `${programme.display_name} pages cannot be fetched automatically. Fill in the details and the link is kept as the offer.`,
        },
        draft: { canonicalUrl: url },
        retailer_key: programme.key,
        warnings,
        upstream_status: null,
      },
      422,
    );
  }

  const page = await fetchPage(url, programme.url_patterns ?? []);
  if (page.blocked) {
    // robots.txt is the only "blocked" the retailer chose; every other reason
    // comes from the outbound target guard and gets its own code.
    const robots = (page.reason ?? "").includes("robots.txt");
    throw new AppError(
      robots ? "ROBOTS_DISALLOWED" : "BLOCKED_TARGET",
      page.reason ?? "Could not read a product from this page.",
      422,
    );
  }
  // A supported retailer that refused us (bot wall, rate limit, outage) is not
  // "no product on this page". Say what happened, with the upstream status,
  // and hand back whatever the error page still carried.
  if (page.status === 403 || page.status === 429 || page.status >= 500) {
    const partial = partialFromHtml(page.html, page.finalUrl);
    return jsonResponse(
      {
        error: {
          code: "RETAILER_UNAVAILABLE",
          message: `${programme.display_name} answered HTTP ${page.status} and did not serve the product page. Fill in the details and the link is kept as the offer.`,
        },
        draft: partial,
        retailer_key: programme.key,
        warnings,
        upstream_status: page.status,
      },
      422,
    );
  }
  if (page.status < 200 || page.status >= 300) {
    warnings.push(`Retailer responded with HTTP ${page.status}.`);
  }

  const draft = extractProduct(
    page.html,
    page.finalUrl,
    programme ? { key: programme.key, extractor: programme.extractor } : null,
  );

  if (!draft) {
    const partial = partialFromHtml(page.html, page.finalUrl);
    const err = new AppError("NO_PRODUCT_FOUND", "Could not read a product from this page.", 422);
    return jsonResponse(
      { error: { code: err.code, message: err.message }, draft: partial, retailer_key: programme?.key ?? null, warnings },
      422,
    );
  }

  return jsonResponse({ draft, retailer_key: programme?.key ?? null, warnings });
}

// ---------------------------------------------------------------------------
// Image copy: fetch the draft's imageUrl (never the retailer's product page
// a second time), hash it, copy into Storage. Returns null (no throw) on any
// failure or absence, so a missing/broken image never blocks the save
// (FR-46: "a product with no image shows the house placeholder").
// ---------------------------------------------------------------------------
/**
 * `serviceRoleClient()`'s `SUPABASE_URL` is the URL the edge runtime
 * reaches Storage/PostgREST THROUGH, which under `supabase functions serve`
 * locally is the docker-internal `http://kong:8000`, never something an
 * external client (the admin app, a shopper's phone) could resolve. In
 * production `SUPABASE_URL` already IS the public project URL, so this is a
 * local-only correction: when `GEAR_INGEST_PUBLIC_URL` is set (verify scripts
 * set it to the host-reachable `http://127.0.0.1:54321`), the internal base
 * in `getPublicUrl`'s result is swapped for it; otherwise the URL is
 * returned unchanged, exactly what production needs.
 */
function publicStorageUrl(svc: AnySupabaseClient, path: string): string {
  const { data } = svc.storage.from(BUCKET).getPublicUrl(path);
  const internalBase = Deno.env.get("SUPABASE_URL");
  const externalBase = Deno.env.get("GEAR_INGEST_PUBLIC_URL");
  if (internalBase && externalBase && externalBase !== internalBase) {
    return data.publicUrl.replace(internalBase, externalBase);
  }
  return data.publicUrl;
}

async function copyProductImage(
  svc: AnySupabaseClient,
  imageUrl: string | null,
  retailerKey: string,
): Promise<{ imagePath: string; publicUrl: string } | null> {
  if (!imageUrl) return null;

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      // Retailer images live on CDNs that rarely share the retailer's host, so
      // the image is not pinned to the programme's url_patterns; it still goes
      // through the full target guard (public http(s) host, no IP literals, no
      // internal names, DNS checked, redirects re-checked hop by hop).
      const out = await guardedFetch(imageUrl, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
      if ("reason" in out) {
        await captureEdgeError(new Error(`image target refused: ${out.reason}`), { fn: "gear-ingest", stage: "image-guard", imageUrl });
        return null;
      }
      res = out.res;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    await captureEdgeError(err, { fn: "gear-ingest", stage: "image-fetch", imageUrl });
    return null;
  }
  if (!res.ok) return null;

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_EXT_BY_TYPE[contentType];
  if (!ext) return null; // only jpeg/png/webp are accepted

  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_IMAGE_BYTES) {
    try {
      await res.body?.cancel();
    } catch {
      // best effort
    }
    return null;
  }

  const buffer = new Uint8Array(await res.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) return null;

  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const hashHex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const path = `${retailerKey}/${hashHex}.${ext}`;

  const { data: existing } = await svc.storage.from(BUCKET).list(retailerKey, { search: `${hashHex}.${ext}` });
  const alreadyThere = (existing ?? []).some((f: { name: string }) => f.name === `${hashHex}.${ext}`);

  if (!alreadyThere) {
    const { error: uploadError } = await svc.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: false,
    });
    if (uploadError && !/duplicate/i.test(uploadError.message ?? "")) {
      await captureEdgeError(new Error(uploadError.message), { fn: "gear-ingest", stage: "image-upload", path });
      return null;
    }
  }

  return { imagePath: path, publicUrl: publicStorageUrl(svc, path) };
}

/** ADR-011 D3/FR-45: the affiliate tag is applied here, never typed by hand. Every seeded programme's template is empty today (open question 11), so this is a no-op until one is supplied. */
function applyAffiliateTag(canonicalUrl: string, template: string | null): string {
  if (!template || !template.trim()) return canonicalUrl;
  if (template.includes("{url}")) {
    return template.replace("{url}", encodeURIComponent(canonicalUrl));
  }
  const separator = template.includes("?") ? "&" : "?";
  return `${canonicalUrl}${separator}${template.replace(/^[?&]/, "")}`;
}

// ---------------------------------------------------------------------------
// action: save
// ---------------------------------------------------------------------------
async function handleSave(req: Request, svc: AnySupabaseClient, body: SaveBody) {
  if (body.draft.price === null || body.draft.price === undefined) {
    throw new AppError("VALIDATION", "A price is required to save an offer.", 400);
  }

  const programme = await matchRetailer(svc, body.url);
  if (!programme) {
    throw new AppError("UNSUPPORTED_RETAILER", "This host is not a supported retailer.", 422);
  }
  const retailerKey = programme.key;

  // The canonical URL the offer will be re-fetched from every night must sit
  // on the same programme as the page it came from; a page can otherwise
  // point the nightly sweep anywhere through its own <link rel=canonical>.
  if (body.draft.canonicalUrl) {
    let canonicalHost = "";
    try { canonicalHost = new URL(body.draft.canonicalUrl).hostname; } catch { canonicalHost = ""; }
    if (!canonicalHost || !(programme.url_patterns ?? []).some((p) => hostMatchesPattern(canonicalHost, p))) {
      body.draft.canonicalUrl = body.url;
    }
  }

  const copied = await copyProductImage(svc, body.draft.imageUrl, retailerKey);

  const userClient = userScopedClient(req);

  const { data: product, error: productError } = await userClient.rpc("admin_upsert_affiliate_product", {
    p_id: body.productId ?? null,
    p_title: body.draft.title,
    p_brand: body.draft.brand,
    p_sport: null,
    p_category_id: null,
    p_skill_level: null,
    p_age_range: null,
    p_description: body.draft.description,
    p_image_url: copied?.publicUrl ?? null,
    p_image_path: copied?.imagePath ?? null,
    p_source_image_url: body.draft.imageUrl,
  });
  if (productError) {
    throw appErrorFromPostgrestMessage(productError.message);
  }

  const affiliateUrl = applyAffiliateTag(body.draft.canonicalUrl, programme?.affiliate_tag_template ?? null);

  const { data: offer, error: offerError } = await userClient.rpc("admin_upsert_product_offer", {
    p_affiliate_product_id: product.id,
    p_retailer: programme?.display_name ?? new URL(body.url).hostname,
    p_price: body.draft.price,
    p_affiliate_url: affiliateUrl,
    p_in_stock: body.draft.inStock ?? true,
    p_currency: body.draft.currency ?? "INR",
    p_canonical_url: body.draft.canonicalUrl,
    p_retailer_key: programme?.key ?? null,
  });
  if (offerError) {
    throw appErrorFromPostgrestMessage(offerError.message);
  }

  // The contract in docs/PLAN-SHOP-SEARCH.md names productId, offerId and
  // imagePath; the full rows ride along for the verify script and callers
  // that want them. Both shapes are stable.
  return jsonResponse({
    productId: (product as { id: string }).id,
    offerId: (offer as { id: string }).id,
    imagePath: (product as { image_path: string | null }).image_path ?? null,
    product,
    offer,
  });
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    await requireAdmin(request);

    const body = parseBody(await request.json().catch(() => null));
    const svc = serviceRoleClient();

    if (body.action === "fetch") {
      return handleFetch(svc, body.url);
    }
    return handleSave(request, svc, body);
  })
);
