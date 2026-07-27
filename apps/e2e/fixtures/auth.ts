// Auth fixture: pick a persona's storage state by name.
//
// Usage in a spec:
//   import { test, expect } from "../fixtures";
//   test.use({ persona: "player" });
//
// The named state file is written by auth.setup.ts (the 'setup' project every
// surface project depends on). If it is missing, the persona's login failed
// during setup; the error points at state/_auth-report.json instead of
// letting the spec limp along unauthenticated and fail somewhere confusing.

import { test as base } from "@playwright/test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "state");

export type AuthOptions = {
  /** Persona name matching state/<persona>.json, or null for anonymous. */
  persona: string | null;
};

export const test = base.extend<AuthOptions>({
  persona: [null, { option: true }],
  storageState: async ({ persona, storageState }, use) => {
    if (!persona) {
      await use(storageState);
      return;
    }
    const file = join(STATE_DIR, `${persona}.json`);
    if (!existsSync(file)) {
      throw new Error(
        `[e2e] No storage state for persona "${persona}" (${file}). ` +
          "Either the name is wrong, or this persona failed to log in during " +
          "the setup project. See state/_auth-report.json for the reason.",
      );
    }
    await use(file);
  },
});

export { expect } from "@playwright/test";
