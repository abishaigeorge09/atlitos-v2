// ATLITOS v2 — AD domain (admin queues/refunds/role-gate).
//
// Mixes real UI (login gate, verification approve/reject, order advance —
// all confirmed against apps/admin/src source before writing this file) with
// direct RPC/edge-function probes for the server-side-enforcement cases,
// per the same "UI green is not proof" discipline as the other money specs.

import { callFunction } from "../../helpers/money.mjs";
import { personaSession } from "../../helpers/persona.mjs";
import { serviceClient } from "../../helpers/sql.mjs";
import { expect, test } from "../../fixtures";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "admin", "AD spec runs only under the admin project");
});

const VARIANT_GLOVES = "30000000-0000-0000-0000-000000000003";
const PLAYER_ADDRESS_ID = "c8971c75-5b0f-4a8f-824f-3b90857fdfd0";

test.describe("AD: admin UI gates @money", () => {
  test("AD-01 admin@ signs in to the verification queue; player@ is rejected with no role hint @smoke", async ({ page, consoleGuard }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@atlitos.dev");
    await page.getByLabel("Password").fill("AtlitosDemo!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/verification/, { timeout: 15_000 });

    await page.getByRole("button", { name: /sign ?out/i }).click({ trial: true }).catch(() => {});
    // Fresh context: player@ (a real, valid Supabase account, just not an
    // admin) must be denied entry with no hint that the account itself is
    // fine, only that it lacks access.
    const context2 = await page.context().browser().newContext();
    const page2 = await context2.newPage();
    await page2.goto("/login");
    await page2.getByLabel("Email").fill("player@atlitos.dev");
    await page2.getByLabel("Password").fill("AtlitosDemo!2026");
    await page2.getByRole("button", { name: "Sign in" }).click();
    await expect(page2.getByText("This account does not have admin access.")).toBeVisible({ timeout: 15_000 });
    await expect(page2).toHaveURL(/\/login/);
    await context2.close();
    void consoleGuard;
  });

  test("AD-03 verification approve flips status with exactly one audit_log row; reject blocked on a blank reason @money", async ({ page }) => {
    const [partner, admin] = await Promise.all([personaSession("partner"), personaSession("admin")]);
    const submitted = await partner.client
      .rpc("submit_upa_application", {
        p_payload: {
          storyHeadline: "E2E AD-03 approve via admin UI",
          storyBody: "Submitted by the QA harness.",
          sport: "cricket",
          region: "Hyderabad",
          state: "Telangana",
        },
      })
      .single();
    // partner@ already has an active application from other specs in this
    // suite by the time this runs repeatedly; ALREADY_APPLIED is a legitimate
    // outcome of re-running against live state, not a spec bug, so fall back
    // to a service-role-created fresh row scoped to a throwaway user id is
    // out of scope here — skip cleanly instead of failing on shared state.
    test.skip(!!submitted.error, `partner@ has no submittable state right now: ${submitted.error?.message}`);
    const upaId = submitted.data.id;

    const sql = serviceClient();
    const { data: request } = await sql.from("verification_requests").select("id").eq("applicant_type", "upa").eq("applicant_id", upaId).single();
    const { count: auditBefore } = await sql.from("audit_log").select("id", { count: "exact", head: true }).eq("entity_id", request.id);

    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@atlitos.dev");
    await page.getByLabel("Password").fill("AtlitosDemo!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/verification/, { timeout: 15_000 });

    await page.goto(`/verification/show/${request.id}`);
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("approved", { exact: false })).toBeVisible({ timeout: 15_000 });

    const { data: requestAfter } = await sql.from("verification_requests").select("status").eq("id", request.id).single();
    expect(requestAfter.status).toBe("approved");
    const { count: auditAfter } = await sql.from("audit_log").select("id", { count: "exact", head: true }).eq("entity_id", request.id);
    expect((auditAfter ?? 0) - (auditBefore ?? 0)).toBe(1);

    // Second probe, a fresh request, for the reject-blank-reason block. Uses
    // admin@ as the applicant, deliberately NOT partner@ again: partner@'s
    // one-active-application-per-user index is now occupied by the request
    // this test just approved above, so a second submit_upa_application call
    // from the same persona in the same run would itself hit ALREADY_APPLIED.
    // submit_upa_application has no role restriction (any authenticated
    // caller), so admin@ is a valid, always-available second applicant.
    const submitted2 = await admin.client
      .rpc("submit_upa_application", {
        p_payload: {
          storyHeadline: "E2E AD-03 reject via admin UI",
          storyBody: "Submitted by the QA harness.",
          sport: "badminton",
          region: "Hyderabad",
          state: "Telangana",
        },
      })
      .single();
    test.skip(!!submitted2.error, `admin@ has no second submittable state right now: ${submitted2.error?.message}`);
    const { data: request2 } = await sql.from("verification_requests").select("id").eq("applicant_type", "upa").eq("applicant_id", submitted2.data.id).single();

    await page.goto(`/verification/show/${request2.id}`);
    await page.getByRole("button", { name: "Reject" }).click();
    const confirmReject = page.getByRole("button", { name: "Confirm reject" });
    await confirmReject.click();
    await expect(page.getByText("A rejection reason is required.")).toBeVisible();

    const { data: request2Unchanged } = await sql.from("verification_requests").select("status").eq("id", request2.id).single();
    expect(request2Unchanged.status).toBe("pending_review");

    await page.getByRole("textbox").fill("e2e AD-03 rejection reason");
    await confirmReject.click();
    await expect(page.getByText("rejected", { exact: false })).toBeVisible({ timeout: 15_000 });
    const { data: request2After } = await sql.from("verification_requests").select("status,rejection_reason").eq("id", request2.id).single();
    expect(request2After.status).toBe("rejected");
    expect(request2After.rejection_reason).toBeTruthy();
  });

  test("AD-04 MISSING: no refund action exists anywhere in apps/admin (PRD-04 FR-24/25 unimplemented) @money", async ({ page }) => {
    const admin = await personaSession("admin");
    const player = await personaSession("player");
    const checkout = await callFunction("checkout", player.token, {
      items: [{ product_variant_id: VARIANT_GLOVES, qty: 1 }],
      address_id: PLAYER_ADDRESS_ID,
      donation_roundup: false,
    });
    test.skip(checkout.status !== 200, `checkout failed, cannot construct an order to view: ${JSON.stringify(checkout.json)}`);

    // Functional signal: the function is not deployed at all.
    const probe = await callFunction("admin-order-refund", admin.token, { order_id: "00000000-0000-0000-0000-000000000000", amount: 1 });
    expect(probe.status, "admin-order-refund unexpectedly responded; PRD-04 FR-24/25 may now be implemented, update this catalog gap").not.toBe(200);

    // UI signal: no refund control anywhere on the Order Detail screen.
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@atlitos.dev");
    await page.getByLabel("Password").fill("AtlitosDemo!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/verification/, { timeout: 15_000 });
    await page.goto("/orders");
    const firstOrderLink = page.locator('a[href^="/orders/show/"]').first();
    const hasOrder = await firstOrderLink.count();
    test.skip(hasOrder === 0, "No orders visible in the admin list to open Order Detail on");
    await firstOrderLink.click();
    await expect(page.getByText("Advance this order")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /refund/i })).toHaveCount(0);
  });

  test("AD-05 the order machine has no client-reachable bypass around admin-order-advance @money", async () => {
    const admin = await personaSession("admin");
    // order_transition is documented service_role-only (API-MAPPING.md:
    // "service_role only per AT-61's rule, so admin-order-advance is the
    // sole path"). An admin's own authenticated JWT must not be able to
    // call it directly.
    const { error } = await admin.client.rpc("order_transition", {
      p_order_id: "00000000-0000-0000-0000-000000000000",
      p_to_status: "shipped",
      p_actor_id: admin.userId,
      p_note: "e2e AD-05 bypass probe",
      p_location: null,
    });
    expect(error, "an admin JWT was able to call order_transition directly, bypassing admin-order-advance").toBeTruthy();
  });

  test("AD-06 MISSING: no User Detail route and no suspend/reinstate action exist @money", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@atlitos.dev");
    await page.getByLabel("Password").fill("AtlitosDemo!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/verification/, { timeout: 15_000 });

    await page.goto("/users");
    await expect(page.getByRole("button", { name: /suspend/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /reinstate/i })).toHaveCount(0);

    // No /users/show/:id route is registered in apps/admin/src/App.tsx at
    // all (confirmed by reading the route table before writing this file);
    // navigating there must NOT render a user detail screen.
    await page.goto("/users/show/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText("Suspend", { exact: false })).toHaveCount(0);
  });

  test("AD-07 every admin mutation routes through an RPC/edge function; a direct table write is refused @money", async () => {
    const admin = await personaSession("admin");
    const { data: someOrder } = await admin.client.from("orders").select("id,status").limit(1).maybeSingle();
    test.skip(!someOrder, "No order exists yet to probe a direct-write bypass against");

    const { data: updated, error } = await admin.client.from("orders").update({ status: "delivered" }).eq("id", someOrder.id).select();
    if (!error) {
      expect(updated ?? [], "admin@ wrote orders.status directly, bypassing admin-order-advance").toEqual([]);
    }

    const { error: auditErr } = await admin.client.from("audit_log").insert({
      actor_id: admin.userId,
      action: "e2e.AD-07.probe",
      entity_type: "orders",
      entity_id: someOrder.id,
    });
    expect(auditErr, "admin@ inserted an audit_log row directly; RLS.md documents no authenticated write policy at all").toBeTruthy();
  });

  // EXT-lane cases (CT-12/CT-13-shaped "findings JSON" deliverables) are not
  // deterministic pass/fail assertions; they are a human/agent capability
  // sweep against PRD-04 that produces a report, not a test result. Recorded
  // as fixme rather than faked into a pass.
  test.fixme("AD-08 findings JSON naming absent PRD-04 queues/screens (EXT lane, not a deterministic Playwright assertion)");
  test.fixme("AD-09 Dashboard Overview route is absent; ground-truth GMV/pending-count via SQL instead (P2)");
});
