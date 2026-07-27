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
