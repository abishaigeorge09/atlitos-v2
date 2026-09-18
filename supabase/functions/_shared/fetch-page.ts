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

async function readRobotsTxt(origin: string): Promise<string> {
  try {
    const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal,
    });
    cancel();
    if (!res.ok) return "";
    return await res.text();
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
export async function fetchPage(url: string): Promise<FetchPageResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 0, finalUrl: url, html: "", blocked: true, reason: "Invalid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { status: 0, finalUrl: url, html: "", blocked: true, reason: "Only http/https URLs are supported." };
  }

  const robotsTxt = await readRobotsTxt(parsed.origin);
  if (robotsTxt && isPathDisallowed(robotsTxt, parsed.pathname)) {
    return { status: 0, finalUrl: url, html: "", blocked: true, reason: "robots.txt disallows this path." };
  }

  const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal, redirect: "follow" });
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
    return { status: res.status, finalUrl: res.url || url, html: "", blocked: true, reason: "Response exceeds the 5MB cap." };
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
    return { status: res.status, finalUrl: res.url || url, html: "", blocked: true, reason: "Response exceeds the 5MB cap." };
  }

  return { status: res.status, finalUrl: res.url || url, html, blocked: false };
}
