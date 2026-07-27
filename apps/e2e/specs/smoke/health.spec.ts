// Smoke: each surface's base URL responds 200 and renders without uncaught
// console errors (the console guard auto-fixture enforces the latter).
//
// This spec runs once per surface project; `baseURL` is whichever surface
// the current project targets. It is the harness's proof of life, not a
// functional test. Domain specs land in B1b.

import { expect, test } from "../../fixtures";

test.describe("smoke: surface health", () => {
  test("base URL responds 200 and renders clean", async ({ page, baseURL }) => {
    expect(baseURL, "project must define a baseURL").toBeTruthy();

    const response = await page.goto("/", { waitUntil: "load" });
    expect(response, "expected a navigation response").not.toBeNull();
    expect(response!.status(), `GET ${baseURL} status`).toBe(200);

    // Give SPAs a beat to hydrate so late console errors are caught by the
    // guard; bounded so a chatty page cannot hang the smoke run.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    // The page actually painted something.
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
