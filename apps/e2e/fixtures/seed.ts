// Seed fixture: exposes the per-domain reset functions from seed/reset.mjs
// as a worker-scoped fixture. Each function shells out to the existing
// scripts/seed-*.mjs and is memoized per process, so parallel specs in the
// same worker share one reset instead of stampeding the DB.
//
// Usage:
//   test("...", async ({ seed }) => { await seed.resetDemoUsers(); ... });

import { test as base } from "@playwright/test";
// Plain .mjs module, no types shipped; runtime import is fine under ESM.
// @ts-ignore
import * as reset from "../seed/reset.mjs";

export type SeedApi = {
  resetDemoUsers: () => Promise<void>;
  resetEmpowerUpaUsers: () => Promise<void>;
  resetCoachingFixtures: () => Promise<void>;
  resetGroupsDemo: () => Promise<void>;
  resetOnboardingDemo: () => Promise<void>;
  resetAll: () => Promise<void>;
};

export const test = base.extend<{}, { seed: SeedApi }>({
  seed: [
    async ({}, use) => {
      await use(reset as unknown as SeedApi);
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
