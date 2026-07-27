// ATLITOS v2 — AUTH domain (auth, onboarding, session, cross-portal role
// gates). Catalog: docs/qa/test-catalog.json, IDs AUTH-01..AUTH-12.
//
// Surface: every non-cross-surface case here targets athlete-web
// (atlitos-app.vercel.app). The harness runs every specs/**/*.spec.ts file
// against all four surface projects (playwright.config.ts), so this file
// guards itself to run once, under the athlete-web project, rather than
// failing (or silently no-op-ing) against portal-court/portal-life/admin
// base URLs that do not serve these routes. AUTH-11 is Cross-surface by
// nature (it deliberately drives the OTHER three surfaces with wrong-role
// creds); it still only needs to run once, so it lives under the same guard
// and reaches the other surfaces with a hardcoded full URL, not `baseURL`.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures";
import { DEMO_PASSWORD, EMAIL } from "./support/rls.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const PORTAL_COURT_URL = "https://atlitos-portal-court.vercel.app";
const PORTAL_LIFE_URL = "https://atlitos-portal-life.vercel.app";
const ADMIN_URL = "https://atlitos-admin.vercel.app";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "athlete-web", "AUTH domain targets athlete-web only");
});

test.describe("AUTH — auth, onboarding, session, cross-portal role gates", () => {
  test("AUTH-01 guest cold start reaches Home with no forced login, no modal @smoke", async ({ page }) => {
    // No test.use({ persona }) here: the default (no storage state at all)
    // IS the cold start this case tests. Setting persona: "player" etc. is
    // what other tests do to authenticate; omitting it entirely is correct
    // here, not an oversight.
    // Cold start: cleared storage means status resolves to signed_out, and
    // splash (PRD-01 3.1) offers "Continue as guest" / "Log in" rather than
    // forcing either — that IS the "no forced login redirect, no modal"
    // contract. Guest browsing itself is a real anonymous Supabase session
    // (session-store.ts), reached by completing that one deliberate tap.
    await page.goto("/");
    await expect(page).toHaveURL(/\/splash$/);

    // Not forced to /login, and the LoginGateSheet ("Want to hit the
    // spotlight?", its verbatim SPEC.md copy) never auto-opens.
    await expect(page.getByText("Want to hit the spotlight?")).toHaveCount(0);
    const guestButton = page.getByRole("button", { name: "Continue as guest" });
    await expect(guestButton).toBeVisible();

    await guestButton.click();

    // Lands on Home (tabs root), not redirected back to any login screen.
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/");
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.getByText("Want to hit the spotlight?")).toHaveCount(0);
  });

  test.describe("AUTH-02", () => {
    // Nested describe purely so test.use({ persona: "player" }) (fixture
    // options must be set at describe/file scope, not inside a test body)
    // does not leak that persona onto every other AUTH- test in this file.
    test.use({ persona: "player" });

    test("AUTH-02 every persona logged in during setup and storage state is usable @smoke", async ({ page }) => {
      // The setup project (auth.setup.ts) is what actually performs AUTH-02's
      // "sign in via password grant, capture storage state" step for all 9
      // personas; every other spec's `test.use({ persona })` reuses its
      // output. This case is the regression guard that the report the setup
      // project writes still says so, plus a live routing spot check that a
      // captured storage state actually authenticates the app (not just that
      // login itself once succeeded).
      const report = JSON.parse(readFileSync(join(HERE, "..", "state", "_auth-report.json"), "utf8"));

      const athletePersonas = ["player", "coach1", "coach2", "partner", "p2-verify-partner", "admin"];
      for (const name of athletePersonas) {
        expect(report.report[name]?.ok, `${name} must have logged in during setup`).toBe(true);
      }

      // Routing spot check: player@'s captured storage state, replayed
      // against athlete-web, lands on the signed-in Home (splash's
      // status === 'signed_in' branch), never the signed-out splash chooser
      // that AUTH-01 exercises for a truly anonymous visitor.
      await page.goto("/");
      await expect.poll(() => page.url(), { timeout: 15_000 }).not.toMatch(/\/splash$/);
      await expect(page.getByRole("button", { name: "Continue as guest" })).toHaveCount(0);
    });
  });

  test("AUTH-03 register a new player routes to role select then the player wizard @smoke", async ({ page }) => {
    const stamp = randomUUID().slice(0, 8);
    await page.goto("/register");

    await page.getByLabel("Full name input").fill(`AT E2E Player ${stamp}`);
    await page.getByLabel("Email input").fill(`e2e.player.${stamp}@atlitos.dev`);
    await page.getByLabel("Phone input").fill(`9${stamp.replace(/\D/g, "").padEnd(9, "1").slice(0, 9)}`);
    await page.getByLabel("Date of birth input").fill("1999-05-14");
    // exact: true, because getByLabel's default substring match makes plain
    // "Password input" also match "Confirm password input" (strict-mode
    // violation observed in practice: two elements resolved).
    await page.getByLabel("Password input", { exact: true }).fill("E2ePlayerPass123!");
    await page.getByLabel("Confirm password input").fill("E2ePlayerPass123!");
    await page.getByRole("button", { name: "Create account" }).click();

    // Two legitimate outcomes depending on whether email confirmation is on
    // for this project: either straight through to role-select (the
    // catalog's literal expectation), or a "check your email" confirmation
    // gate (account still created, just not yet routable to the wizard).
    // Both are asserted explicitly rather than only accepting one, so a
    // silent regression to neither (e.g. a crash, or a field-validation
    // error some fixture is tripping) still fails the test.
    await expect(
      page.getByText("Check your email").or(page.getByText("How will you use Atlitos")),
    ).toBeVisible({ timeout: 15_000 });

    if (await page.getByText("Check your email").isVisible().catch(() => false)) {
      test.info().annotations.push({
        type: "note",
        description: "Email confirmation is enabled on this project; registration stops short of role-select until confirmed.",
      });
      return;
    }

    await expect(page).toHaveURL(/\/role-select$/);
    await page.getByRole("button", { name: /I am a player/ }).click();
    await expect(page).toHaveURL(/\/player-setup\/0$/);
  });

  test("AUTH-04 register a new coach routes to role select then the coach wizard", async ({ page }) => {
    const stamp = randomUUID().slice(0, 8);
    await page.goto("/register");

    await page.getByLabel("Full name input").fill(`AT E2E Coach ${stamp}`);
    await page.getByLabel("Email input").fill(`e2e.coach.${stamp}@atlitos.dev`);
    await page.getByLabel("Phone input").fill(`8${stamp.replace(/\D/g, "").padEnd(9, "2").slice(0, 9)}`);
    await page.getByLabel("Date of birth input").fill("1990-11-02");
    await page.getByLabel("Password input", { exact: true }).fill("E2eCoachPass123!");
    await page.getByLabel("Confirm password input").fill("E2eCoachPass123!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
      page.getByText("Check your email").or(page.getByText("How will you use Atlitos")),
    ).toBeVisible({ timeout: 15_000 });

    if (await page.getByText("Check your email").isVisible().catch(() => false)) {
      test.info().annotations.push({
        type: "note",
        description: "Email confirmation is enabled on this project; registration stops short of role-select until confirmed.",
      });
      return;
    }

    await expect(page).toHaveURL(/\/role-select$/);
    await page.getByRole("button", { name: /I am a coach/ }).click();
    await expect(page).toHaveURL(/\/coach-setup\/0$/);
  });

  test.fixme("AUTH-05 duplicate email/phone registration shows an inline field error", () => {
    // P2. Catalog: register with an already-used email or phone -> inline
    // field error, no account created, no generic crash.
  });

  test("AUTH-06 wrong password and unknown email show the identical generic error @smoke", async ({ page }) => {
    await page.goto("/login");

    // Attempt 1: a real account, wrong password.
    await page.getByLabel("Email or phone input").fill(EMAIL.player);
    await page.getByLabel("Password input").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();
    const firstError = page.getByText("That login does not match our records. Check your details and try again.");
    await expect(firstError).toBeVisible({ timeout: 10_000 });
    const firstErrorText = await firstError.textContent();

    // Attempt 2: an email that has never been registered.
    await page.getByLabel("Email or phone input").fill(`nobody.${randomUUID().slice(0, 8)}@atlitos.dev`);
    await page.getByLabel("Password input").fill("whatever-password-123");
    await page.getByRole("button", { name: "Log in" }).click();
    const secondError = page.getByText("That login does not match our records. Check your details and try again.");
    await expect(secondError).toBeVisible({ timeout: 10_000 });
    const secondErrorText = await secondError.textContent();

    // No user-enumeration signal: byte-identical copy either way.
    expect(secondErrorText).toBe(firstErrorText);
  });

  test.fixme("AUTH-07 player setup wizard resumes at the same step after a reload", () => {
    // P2. Catalog: advance 2 steps, reload -> resumes at the same step with
    // prior answers intact, not reset to step 1.
  });

  test.fixme("AUTH-08 required step blocks Continue, optional step's Skip advances without data", () => {
    // P2.
  });

  test("AUTH-09 guest like gates to login and the original like intent completes after sign in", async ({ page }) => {
    await page.goto("/clutch");

    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible({ timeout: 20_000 });
    await likeButton.click();

    // LoginGateModal opens; the tap must NOT have applied yet (guest).
    // NOTE: the gate sheet's own button is labeled "Login" (LoginGateSheet.tsx
    // accessibilityLabel), one word, unlike the login screen's "Log in"
    // submit button below (login.tsx) — a real, if minor, copy
    // inconsistency between the two, worth a follow up ticket.
    await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unlike" })).toHaveCount(0);
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email or phone input").fill(EMAIL.player);
    await page.getByLabel("Password input").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    // The intent (returning to the exact clip and completing the like) is
    // the FR-4 promise this case exists to hold the line on. Poll rather
    // than a single snapshot: splash's routing effect and the feed's own
    // reload both take a beat.
    await expect
      .poll(() => page.url(), {
        timeout: 20_000,
        message: "expected to land back on /clutch after the login-gate round trip",
      })
      .toContain("/clutch");

    // And the originally-intended like actually completed, not just the
    // navigation: the same first card now shows "Unlike".
    await expect(page.getByRole("button", { name: "Unlike" }).first()).toBeVisible({ timeout: 20_000 });
  });

  test.fixme("AUTH-10 a used password-reset OTP is rejected on a second attempt", () => {
    // P0 in the catalog, but not executable in this harness as written: the
    // OTP is delivered by email (client.auth.signInWithOtp/verifyOtp,
    // packages/api/src/hooks.ts requestOtp/verifyOtp) and GoTrue stores only
    // a hash of it (auth.users' *_token columns), never the plaintext, even
    // to a service-role reader. There is no inbox this harness can read.
    // REAL FINDING (harness gap, not a product defect): closing this needs
    // either a test-only OTP-retrieval RPC/edge function exposed under
    // E2E-guard, or an inbox fixture (e.g. a catch-all test mailbox this
    // suite can poll). Recorded for the next phase rather than faked here.
  });

  test("AUTH-11 cross-portal login with the wrong role's credentials never exposes that portal's data", async ({
    browser,
  }) => {
    // Cross-surface by nature; runs once regardless of which project
    // executes this file, driven with hardcoded full URLs rather than
    // `baseURL` so it is not tied to whichever project happened to run it.
    // Three sequential full navigations + logins against three separately
    // deployed apps do not reliably fit the default 30s test timeout
    // (observed: a 30s timeout mid cold-navigation to portal-court/admin).
    test.setTimeout(60_000);

    // player@ against portal-court (a court-partner surface): auth succeeds
    // (same Supabase Auth project), but the dashboard layout gate requires
    // an owned+verified venue, which player@ has none of, so it is routed
    // to /onboarding, never /dashboard. No partner data renders.
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${PORTAL_COURT_URL}/signin`);
      await page.getByLabel("Email").fill(EMAIL.player);
      await page.getByLabel("Password").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect
        .poll(() => page.url(), { timeout: 15_000 })
        .not.toContain("/dashboard");
      expect(page.url()).not.toContain("/dashboard");
      await context.close();
    }

    // player@ against the admin console: authProvider.ts re-checks
    // user_roles for 'admin' after a successful password sign in and
    // rejects with a distinct, generic AccessDenied message, then signs the
    // session back out immediately (no admin session is ever left behind).
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      // A direct hard navigation to /login (a real scenario: a bookmark, a
      // shared link, or a browser refresh while on that route), not `/`
      // followed by a client-side redirect. REAL FINDING, confirmed by
      // direct reproduction: this Vercel deployment (a Vite/Refine SPA) has
      // no catch-all rewrite to index.html, so EVERY direct/deep-linked
      // path (not just /login: /dashboard, /users, and any nonexistent path
      // alike) 404s at the edge before any client JS runs. Only `/`
      // (followed by the app's own client-side redirect to /login) serves
      // real content. Asserted explicitly here, with a short timeout and a
      // pointed message, rather than left to silently exhaust a long
      // fill()/expect() timeout waiting on a field that a 404 page will
      // never render.
      const response = await page.goto(`${ADMIN_URL}/login`);
      if (response && response.status() === 404) {
        throw new Error(
          "[AUTH-11] REAL FINDING: a direct hard navigation to " +
            `${ADMIN_URL}/login returned HTTP 404. The admin console has no ` +
            "SPA catch-all rewrite for direct/deep-linked routes; only `/` " +
            "(then a client-side redirect) serves real content. This blocks " +
            "bookmarks, shared links, and a browser refresh on any admin " +
            "sub-route, not just this test.",
        );
      }
      await page.getByLabel("Email").fill(EMAIL.player);
      await page.getByLabel("Password").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText("This account does not have admin access.")).toBeVisible({ timeout: 15_000 });
      expect(new URL(page.url()).pathname, "must stay on /login, never reach the admin console").toBe("/login");
      await context.close();
    }

    // partner@ against portal-life: a real account, real password, and
    // portal-life's own layout gate only requires ANY authenticated user
    // (anyone may start a UPA application there by design, PRD-05); the
    // regression this leg actually guards is that a non-UPA account never
    // renders someone ELSE's verified/UPA identity, i.e. no cross-tenant
    // leak, not a portal-wide door slam.
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${PORTAL_LIFE_URL}/signin`);
      await page.getByLabel("Email").fill(EMAIL.partner);
      await page.getByLabel("Password").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect.poll(() => page.url(), { timeout: 15_000 }).not.toBe(`${PORTAL_LIFE_URL}/signin`);
      // Never a "verified" UPA badge for an account that never applied.
      await expect(page.getByText(/verified/i)).toHaveCount(0);
      await context.close();
    }
  });

  test.fixme("AUTH-12 native login smoke completes without crash on the Expo simulator", () => {
    // P1, lane MAESTRO. Out of scope for this Playwright harness (native
    // sim, .maestro/ flows, not apps/e2e).
  });
});
