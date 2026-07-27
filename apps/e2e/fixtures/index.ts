// Merged test object: auth (persona storage states) + seed (DB resets) +
// console guard (auto-fails tests on uncaught console errors).
//
// Specs import from here:
//   import { test, expect } from "../fixtures";

import { mergeTests } from "@playwright/test";
import { test as authTest } from "./auth";
import { test as consoleGuardTest } from "./console-guard";
import { test as seedTest } from "./seed";

export const test = mergeTests(authTest, seedTest, consoleGuardTest);
export { expect } from "@playwright/test";
