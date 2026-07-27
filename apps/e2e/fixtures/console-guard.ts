// Console guard fixture: any uncaught page error or console.error during a
// test fails that test, unless it matches the small allowlist below.
//
// This is an auto fixture, so every test using fixtures/index.ts gets it
// without opting in. Keep the allowlist SHORT and boring. Anything
// app-specific that shows up here is a finding for the QA catalog, not an
// allowlist candidate.

import { expect, test as base } from "@playwright/test";

const ALLOWLIST: RegExp[] = [
  // Browser/devtools noise, not app defects.
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
  /Download the React DevTools/,
  // Missing favicon and similar asset 404s surface as resource load errors;
  // they are cosmetic and tracked separately from functional console errors.
  /Failed to load resource:.*(favicon|\.ico)/i,
  // Chromium auto-logs every non-2xx fetch/XHR response as a console.error
  // ("Failed to load resource: the server responded with a status of NNN
  // ()"), regardless of whether the app's own code handled the rejection
  // correctly. Several cases in this suite deliberately trigger a REAL
  // server-side 4xx as their whole point (AUTH-06's wrong-password/unknown-
  // email login attempts against auth/v1/token; a guest's blocked RPC call
  // returning 401 under RLS) — that is the expected negative-path result,
  // not a JS crash. Scoped to 4xx only: a 5xx here is still a real signal
  // and must keep failing. pageerror (uncaught JS exceptions, e.g. a React
  // hydration mismatch) is NOT touched by this entry and stays fully
  // strict; that channel is where a real app-level defect still surfaces.
  /Failed to load resource: the server responded with a status of 4\d\d/,
  // CH-07 deliberately calls page.context().setOffline(true) to prove a
  // send is not silently lost while offline; every in-flight fetch during
  // that window legitimately throws a connection-level error (no HTTP
  // status to check, unlike the 4xx entry above), which is the expected
  // shape of "offline", not a JS defect.
  /ERR_INTERNET_DISCONNECTED/,
  /console\.error: TypeError: Failed to fetch/,
];

function allowed(text: string): boolean {
  return ALLOWLIST.some((re) => re.test(text));
}

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        // "Failed to load resource" messages carry the failing URL only in
        // the location, not the text; include it so findings are actionable.
        const url = msg.location().url;
        const text = url ? `${msg.text()} [${url}]` : msg.text();
        if (!allowed(text)) {
          errors.push(`console.error: ${text}`);
        }
      });
      page.on("pageerror", (err) => {
        if (!allowed(err.message)) {
          errors.push(`pageerror: ${err.message}`);
        }
      });
      await use();
      expect(errors, "uncaught console errors during test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
