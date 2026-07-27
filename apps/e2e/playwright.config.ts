// ATLITOS v2 — E2E harness config (QA audit, B1a scaffold).
//
// Model: one 'setup' project logs in every persona programmatically and
// writes per-persona Playwright storage states to state/<persona>.json
// (gitignored). Each surface project depends on setup and runs the specs in
// specs/ against its deployed base URL. Domain specs (B1b) pick a persona via
// test.use({ persona: "player" }) from fixtures/auth.ts.
//
// The whole harness refuses to run without E2E=1 in the environment. This is
// the same posture as helpers/sql.mjs: a deliberate arming switch so nothing
// here ever runs by accident from a stray `playwright test`.

import { defineConfig, devices } from "@playwright/test";

if (process.env.E2E !== "1") {
  throw new Error(
    "[e2e] Refusing to run: set E2E=1 explicitly. " +
      "Run as: E2E=1 pnpm --filter @atlitos/e2e test",
  );
}

/** Deployed production aliases, one per web surface. */
export const SURFACES = {
  "athlete-web": "https://atlitos-app.vercel.app",
  "portal-court": "https://atlitos-portal-court.vercel.app",
  "portal-life": "https://atlitos-portal-life.vercel.app",
  admin: "https://atlitos-admin.vercel.app",
} as const;

const SPEC_MATCH = /specs\/.*\.spec\.ts$/;

export default defineConfig({
  testDir: ".",
  workers: 4,
  retries: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts$/,
    },
    {
      name: "athlete-web",
      testMatch: SPEC_MATCH,
      dependencies: ["setup"],
      use: { baseURL: SURFACES["athlete-web"] },
    },
    {
      name: "portal-court",
      testMatch: SPEC_MATCH,
      dependencies: ["setup"],
      use: { baseURL: SURFACES["portal-court"] },
    },
    {
      name: "portal-life",
      testMatch: SPEC_MATCH,
      dependencies: ["setup"],
      use: { baseURL: SURFACES["portal-life"] },
    },
    {
      name: "admin",
      testMatch: SPEC_MATCH,
      dependencies: ["setup"],
      use: { baseURL: SURFACES.admin },
    },
  ],
});
