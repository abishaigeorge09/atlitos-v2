// ATLITOS v2 — supabase/functions/_shared/fetch-page.ts
//
// Phase S2 Track C (PRD-07 FR-44, FR-47; ADR-011 D3, "the hard decision" in
// PHASE-S2-STATUS.md). THE one place in this codebase that reaches out to a
// retailer's page over the network. Owned by Track C, imported (never
// re-implemented) by Track D's `gear-recheck` nightly sweep, so both
// consumers share one UA, one timeout, one size cap and one robots.txt
// check.
//
// NEVER called from a verify script against a live retailer: every verify
// script that exercises this points it at a fixture server it starts and
// tears down itself (`scripts/fixtures/gear/`, `verify-gear-ingest.mjs`).
//
// Fetch policy (ADR-011 D3):
//   - User-Agent: "AtlitosBot/1.0 (+https://atlitos.com/bot)", named and
//     transparent, never spoofed as a browser.
//   - 10 second timeout, both for the robots.txt read and the page fetch.
//   - 5 MB response size cap, enforced by content-length when the header is
//     present and by streaming byte-count otherwise (a retailer that lies
//     about content-length does not get an unbounded read).
//   - robots.txt is fetched and checked BEFORE the product page is ever
//     requested. A disallow is FR-47's refusal outright: `blocked: true`,
//     no page fetch attempted, no bytes of the product page ever leave the
//     retailer's server to us.
//
// Failure posture: robots.txt itself failing to load (404, timeout, network
// error) is NOT a disallow. Only an explicit `Disallow` rule that matches
// the target path blocks the fetch; absence of robots.txt, or robots.txt
// unreadable, means "allowed", the common and correct default for a site
// that publishes no robots.txt at all.

const USER_AGENT = "AtlitosBot/1.0 (+https://atlitos.com/bot)";
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Target guard (red team 2026-09-18, CWE-918). Every outbound request this
// module makes, page, robots.txt, image, and every redirect hop, passes
// through `checkTarget` first. The rules:
//   * http or https only;
//   * no IP literals, no localhost, no *.local / *.internal / *.localhost,
//     no docker service names, so a pasted URL can never reach the metadata
//     service, kong, the database, or anything else inside the network;
//   * when the caller names allowed hosts (a retailer programme's
//     url_patterns), the hostname must equal one of them or be a subdomain of
//     one: `amazon.in.evil.com` and `evil.com/amazon.in` do not match;
//   * the hostname's resolved addresses must all be public; a name that
//     resolves into a private, loopback or link-local range is refused
//     (DNS rebinding is narrowed, not eliminated: the resolve and the fetch
//     are two lookups; a retailer allowlist is the real fence);
//   * redirects are followed by hand, at most MAX_REDIRECTS, and every
//     Location is re-checked with the same rules and the same allowlist.
// `FETCH_ALLOW_HOSTS` (comma separated) is an explicit local escape hatch the
// verify scripts set for their fixture host (host.docker.internal). It is
// never set on the deployed functions.
// ---------------------------------------------------------------------------
export const MAX_REDIRECTS = 5;

function explicitlyAllowedHosts(): Set<string> {
  const raw = Deno.env.get("FETCH_ALLOW_HOSTS") ?? "";
  return new Set(raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
}

/** Exact host or a subdomain of the pattern; never a substring match. */
export function hostMatchesPattern(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  const p = pattern.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return h === p || h.endsWith("." + p);
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

function isForbiddenName(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".arpa")) return true;
  if (!h.includes(".")) return true; // bare docker service names: kong, supabase_db, db
  return false;
}

async function resolvesToPublic(hostname: string): Promise<boolean> {
  const resolve = (Deno as unknown as { resolveDns?: (h: string, t: "A" | "AAAA") => Promise<string[]> }).resolveDns;
  if (!resolve) return true; // runtime without DNS access: name rules above still apply
  let addrs: string[] = [];
  try { addrs = addrs.concat(await resolve(hostname, "A")); } catch { /* no A */ }
  try { addrs = addrs.concat(await resolve(hostname, "AAAA")); } catch { /* no AAAA */ }
  if (addrs.length === 0) return false;
  return addrs.every((ip) => (IPV4.test(ip) ? !isPrivateIPv4(ip) : !isPrivateIPv6(ip)));
}

/**
 * Returns null when the URL may be fetched, otherwise the reason it may not.
 * `allowedHosts` are retailer programme url_patterns; when given, the host
 * must match one of them.
 */
export async function checkTarget(url: URL, allowedHosts?: string[]): Promise<string | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http/https URLs are supported.";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (explicitlyAllowedHosts().has(host)) return null;
  if (IPV4.test(host) || host.includes(":")) return "IP address targets are not allowed.";
  if (isForbiddenName(host)) return "Internal hostnames are not allowed.";
  if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.some((p) => hostMatchesPattern(host, p))) {
    return "This host is not a supported retailer.";
  }
  if (!(await resolvesToPublic(host))) return "This host does not resolve to a public address.";
  return null;
}

/**
 * fetch with redirects followed by hand so every hop is re-checked. Returns
 * the final Response or a reason string when a hop is refused.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit,
  allowedHosts?: string[],
): Promise<{ res: Response; finalUrl: string } | { reason: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return { reason: "Invalid URL." }; }
    const refused = await checkTarget(parsed, allowedHosts);
    if (refused) return { reason: refused };
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      try { await res.body?.cancel(); } catch { /* best effort */ }
      if (!location) return { reason: `Redirect without a location (HTTP ${res.status}).` };
      current = new URL(location, current).toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  return { reason: `Too many redirects (more than ${MAX_REDIRECTS}).` };
}

export interface FetchPageResult {
  /** HTTP status of the product page fetch. 0 when the page was never fetched (blocked, invalid URL, network error, timeout). */
  status: number;
  /** The URL actually served, after redirects. Falls back to the requested URL when unavailable. */
  finalUrl: string;
  /** Response body as text. Empty when blocked, oversized, or the fetch failed. */
  html: string;
  /** true when robots.txt disallowed the path, or the response exceeded the size cap, or the URL was malformed. */
  blocked: boolean;
  /** Present whenever `blocked` is true, or the fetch otherwise failed to produce html (timeout, network error). */
  reason?: string;
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/**
 * Best-effort robots.txt parser. Only `User-agent` and `Disallow` lines are
 * modelled, which is every retailer robots.txt shape this needs to read.
 * `Allow` lines are deliberately NOT treated as an override of a matching
 * `Disallow`: that can only make this MORE cautious than a full parser,
 * never less, which is the right direction to be wrong in here.
 *
 * Grouping follows the common convention: consecutive `User-agent` lines
 * share the `Disallow` lines that follow them, and any other directive
 * (`Sitemap`, `Crawl-delay`, a blank separator) ends the current group.
 */
export function isPathDisallowed(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let currentAgents: string[] = [];
  let sawDisallowForGroup = false;
  const disallowedByAgent = new Map<string, string[]>();

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) {
      currentAgents = [];
      sawDisallowForGroup = false;
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      if (sawDisallowForGroup) {
        // A User-agent line after this group already recorded Disallow
        // rules starts a fresh group.
        currentAgents = [];
        sawDisallowForGroup = false;
      }
      currentAgents.push(agent);
      if (!disallowedByAgent.has(agent)) disallowedByAgent.set(agent, []);
      continue;
    }
    if (key === "disallow" && currentAgents.length > 0) {
      for (const agent of currentAgents) {
        disallowedByAgent.get(agent)?.push(value);
      }
      sawDisallowForGroup = true;
      continue;
    }
    // Allow, Sitemap, Crawl-delay, or anything unrecognised: not modelled.
  }

  const specific = disallowedByAgent.get("atlitosbot") ?? [];
  const wildcard = disallowedByAgent.get("*") ?? [];
  const rules = specific.length > 0 ? specific : wildcard;

  return rules.some((rule) => {
    if (!rule) return false; // an empty Disallow value means "allow everything"
    return path.startsWith(rule);
  });
}

async function readRobotsTxt(origin: string, allowedHosts?: string[]): Promise<string> {
  try {
    const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
    const out = await guardedFetch(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal }, allowedHosts);
    cancel();
    if ("reason" in out) return "";
    if (!out.res.ok) return "";
    return await out.res.text();
  } catch {
    // Missing or unreadable robots.txt is not a disallow (see file header).
    return "";
  }
}

/**
 * Fetches one page under the fetch policy above. Never throws for an
 * ordinary network failure or a blocked fetch; both surface as a normal
 * `FetchPageResult` so callers (`gear-ingest`, `gear-recheck`) can turn
 * every outcome into their own readable refusal or health-check outcome
 * without a try/catch of their own.
 */
export async function fetchPage(url: string, allowedHosts?: string[]): Promise<FetchPageResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 0, finalUrl: url, html: "", blocked: true, reason: "Invalid URL." };
  }
  const refused = await checkTarget(parsed, allowedHosts);
  if (refused) {
    return { status: 0, finalUrl: url, html: "", blocked: true, reason: refused };
  }

  const robotsTxt = await readRobotsTxt(parsed.origin, allowedHosts);
  if (robotsTxt && isPathDisallowed(robotsTxt, parsed.pathname)) {
    return { status: 0, finalUrl: url, html: "", blocked: true, reason: "robots.txt disallows this path." };
  }

  const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
  let res: Response;
  let finalUrl = url;
  try {
    const out = await guardedFetch(url, { headers: { "User-Agent": USER_AGENT }, signal }, allowedHosts);
    if ("reason" in out) {
      cancel();
      return { status: 0, finalUrl: url, html: "", blocked: true, reason: out.reason };
    }
    res = out.res;
    finalUrl = out.finalUrl;
  } catch (err) {
    cancel();
    const timedOut = err instanceof Error && err.name === "AbortError";
    return {
      status: 0,
      finalUrl: url,
      html: "",
      blocked: false,
      reason: timedOut ? "Request timed out." : `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_RESPONSE_BYTES) {
    cancel();
    try {
      await res.body?.cancel();
    } catch {
      // best effort
    }
    return { status: res.status, finalUrl: res.url || finalUrl, html: "", blocked: true, reason: "Response exceeds the 5MB cap." };
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let totalBytes = 0;
  let oversize = false;

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        oversize = true;
        try {
          await reader.cancel();
        } catch {
          // best effort
        }
        break;
      }
      html += decoder.decode(value, { stream: true });
    }
  } else {
    html = await res.text();
  }
  cancel();

  if (oversize) {
    return { status: res.status, finalUrl: res.url || finalUrl, html: "", blocked: true, reason: "Response exceeds the 5MB cap." };
  }

  return { status: res.status, finalUrl: res.url || finalUrl, html, blocked: false };
}
