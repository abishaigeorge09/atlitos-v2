// ATLITOS v2 — supabase/functions/_shared/extract-product.ts
//
// Phase S2 Track C (PRD-07 FR-44, FR-47; ADR-011 D3). Turns a fetched page's
// HTML into a reviewable draft. First hit wins, in this order:
//   1. JSON-LD `Product` schema (the richest, most reliable source when a
//      retailer publishes it).
//   2. Open Graph tags (`og:title`, `og:image`, `product:price:*`).
//   3. `retailer_programmes.extractor`, a small CSS-selector-like map for
//      retailers that publish neither of the above.
// No strategy producing a title is FR-47's "no recognisable product":
// `extractProduct` returns `null` and the caller (`gear-ingest`) turns that
// into a readable refusal, leaving the manual form usable underneath.
//
// Deliberately dependency-free: no DOM library, only string scanning. Every
// fixture this is proven against (`scripts/fixtures/gear/`) is static HTML
// this repo controls, so a full CSS engine buys nothing here that a small,
// auditable regex-based extractor does not already cover, and it avoids
// pulling an external module into an edge function.

export interface ProductDraft {
  title: string;
  brand: string | null;
  price: number | null;
  currency: string | null;
  inStock: boolean | null;
  imageUrl: string | null;
  canonicalUrl: string;
  description: string | null;
}

/**
 * `retailer_programmes.extractor` shape (jsonb): a map of field name to a
 * small selector string. Selector grammar (see `queryHtml` below):
 *   `tag`             - first element of that tag
 *   `.class`          - first element carrying that class (any tag)
 *   `tag.class`       - first element of that tag carrying that class
 *   `#id`             - element with that id
 *   any of the above followed by `@attr` extracts an attribute value
 *   (e.g. `img.product-photo@src`) instead of the element's inner text.
 */
export interface RetailerExtractorMap {
  title?: string;
  brand?: string;
  price?: string;
  currency?: string;
  image?: string;
  description?: string;
  inStock?: string;
}

export interface RetailerProgrammeForExtraction {
  key: string;
  extractor?: RetailerExtractorMap | null;
}

// ---------------------------------------------------------------------------
// Shared string helpers
// ---------------------------------------------------------------------------

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && raw.trim() !== "" ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strategy 1: JSON-LD Product
// ---------------------------------------------------------------------------

function firstString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s) return s;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === "string" && obj.name.trim()) return obj.name.trim();
    if (typeof obj.url === "string" && obj.url.trim()) return obj.url.trim();
  }
  return null;
}

function findProductNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6) return null; // guard against pathological @graph nesting
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
    if (isProduct) return obj;
    if (Array.isArray(obj["@graph"])) {
      const found = findProductNode(obj["@graph"], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function productFromJsonLd(obj: Record<string, unknown>): Partial<ProductDraft> {
  const offersRaw = obj.offers;
  const offer = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
  const offerObj = offer && typeof offer === "object" ? (offer as Record<string, unknown>) : null;
  const priceRaw = offerObj?.price ?? offerObj?.lowPrice;
  const availability = typeof offerObj?.availability === "string" ? offerObj.availability : null;

  return {
    title: firstString(obj.name),
    brand: firstString(obj.brand),
    price: parsePrice(priceRaw),
    currency: typeof offerObj?.priceCurrency === "string" ? offerObj.priceCurrency : null,
    inStock: availability ? /instock/i.test(availability) : null,
    imageUrl: firstString(obj.image),
    description: firstString(obj.description),
  };
}

function extractJsonLdProduct(html: string): (Partial<ProductDraft> & { title: string }) | null {
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    let data: unknown;
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const productNode = findProductNode(data);
    if (!productNode) continue;
    const draft = productFromJsonLd(productNode);
    if (draft.title) return draft as Partial<ProductDraft> & { title: string };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strategy 2: Open Graph
// ---------------------------------------------------------------------------

function metaContent(html: string, property: string): string | null {
  const propFirst = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    "i",
  );
  let m = html.match(propFirst);
  if (m) return m[1];
  const contentFirst = new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${property}["']`,
    "i",
  );
  m = html.match(contentFirst);
  return m ? m[1] : null;
}

function extractOpenGraph(html: string): (Partial<ProductDraft> & { title: string }) | null {
  const title = metaContent(html, "og:title");
  if (!title) return null;
  const image = metaContent(html, "og:image");
  const description = metaContent(html, "og:description");
  const priceAmount = metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount");
  const priceCurrency = metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency");
  const availability = metaContent(html, "product:availability");

  return {
    title,
    brand: null,
    imageUrl: image,
    description,
    price: parsePrice(priceAmount),
    currency: priceCurrency,
    inStock: availability ? /in\s*stock/i.test(availability) : null,
  };
}

// ---------------------------------------------------------------------------
// Strategy 3: retailer_programmes.extractor selector map
// ---------------------------------------------------------------------------

interface ParsedSelector {
  tag: string | null;
  className: string | null;
  id: string | null;
  attr: string | null;
}

function parseSelector(selector: string): ParsedSelector | null {
  const m = selector
    .trim()
    .match(/^([a-zA-Z][a-zA-Z0-9]*)?(?:\.([a-zA-Z0-9_-]+))?(?:#([a-zA-Z0-9_-]+))?(?:@([a-zA-Z0-9_-]+))?$/);
  if (!m) return null;
  const [, tag, className, id, attr] = m;
  if (!tag && !className && !id) return null;
  return { tag: tag ?? null, className: className ?? null, id: id ?? null, attr: attr ?? null };
}

function attrValue(openTag: string, attrName: string): string | null {
  const doubleQuoted = openTag.match(new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, "i"));
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = openTag.match(new RegExp(`\\b${attrName}\\s*=\\s*'([^']*)'`, "i"));
  return singleQuoted ? singleQuoted[1] : null;
}

function findElement(
  html: string,
  tag: string | null,
  className: string | null,
  id: string | null,
): { tagName: string; openTag: string; contentStart: number } | null {
  const tagPattern = tag ?? "[a-zA-Z][a-zA-Z0-9]*";
  const tagRegex = new RegExp(`<(${tagPattern})\\b([^>]*)>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1];
    const attrs = match[2];
    if (className) {
      const classMatch = attrs.match(/\bclass\s*=\s*"([^"]*)"/i) ?? attrs.match(/\bclass\s*=\s*'([^']*)'/i);
      const classes = classMatch ? classMatch[1].split(/\s+/) : [];
      if (!classes.includes(className)) continue;
    }
    if (id) {
      const idMatch = attrs.match(/\bid\s*=\s*"([^"]*)"/i) ?? attrs.match(/\bid\s*=\s*'([^']*)'/i);
      if (!idMatch || idMatch[1] !== id) continue;
    }
    return { tagName, openTag: match[0], contentStart: tagRegex.lastIndex };
  }
  return null;
}

/** Exported for the two verify scripts' own fixture assertions. */
export function queryHtml(html: string, selector: string): string | null {
  const parsed = parseSelector(selector);
  if (!parsed) return null;
  const el = findElement(html, parsed.tag, parsed.className, parsed.id);
  if (!el) return null;
  if (parsed.attr) {
    return attrValue(el.openTag, parsed.attr);
  }
  const closeIdx = html.toLowerCase().indexOf(`</${el.tagName.toLowerCase()}>`, el.contentStart);
  const inner = closeIdx === -1 ? html.slice(el.contentStart) : html.slice(el.contentStart, closeIdx);
  const text = stripTags(inner);
  return text || null;
}

function extractByProgramme(
  html: string,
  extractor: RetailerExtractorMap,
): (Partial<ProductDraft> & { title: string }) | null {
  const title = extractor.title ? queryHtml(html, extractor.title) : null;
  if (!title) return null;
  const brand = extractor.brand ? queryHtml(html, extractor.brand) : null;
  const priceRaw = extractor.price ? queryHtml(html, extractor.price) : null;
  const currency = extractor.currency ? queryHtml(html, extractor.currency) : null;
  const image = extractor.image ? queryHtml(html, extractor.image) : null;
  const description = extractor.description ? queryHtml(html, extractor.description) : null;
  const inStockRaw = extractor.inStock ? queryHtml(html, extractor.inStock) : null;

  return {
    title,
    brand,
    price: parsePrice(priceRaw),
    currency,
    imageUrl: image,
    description,
    inStock: inStockRaw !== null ? /in\s*stock|true|yes/i.test(inStockRaw) : null,
  };
}

// ---------------------------------------------------------------------------
// Canonical URL and the public entry point
// ---------------------------------------------------------------------------

function extractCanonical(html: string, fallback: string): string {
  const m = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : fallback;
}

function finalizeDraft(partial: Partial<ProductDraft> & { title: string }, canonicalUrl: string): ProductDraft {
  return {
    title: partial.title,
    brand: partial.brand ?? null,
    price: partial.price ?? null,
    currency: partial.currency ?? null,
    inStock: partial.inStock ?? null,
    imageUrl: partial.imageUrl ?? null,
    canonicalUrl,
    description: partial.description ?? null,
  };
}

/**
 * Extracts a `ProductDraft` from a fetched page, trying JSON-LD Product,
 * then Open Graph, then the retailer programme's own selector map. Returns
 * `null` when none of the three strategies produced even a title, which
 * `gear-ingest` turns into FR-47's readable refusal.
 */
export function extractProduct(
  html: string,
  url: string,
  programme?: RetailerProgrammeForExtraction | null,
): ProductDraft | null {
  const canonicalUrl = extractCanonical(html, url);

  const jsonLd = extractJsonLdProduct(html);
  if (jsonLd) return finalizeDraft(jsonLd, canonicalUrl);

  const og = extractOpenGraph(html);
  if (og) return finalizeDraft(og, canonicalUrl);

  if (programme?.extractor) {
    const byProgramme = extractByProgramme(html, programme.extractor);
    if (byProgramme) return finalizeDraft(byProgramme, canonicalUrl);
  }

  return null;
}
