# Manual QA pass, 2026-08-11 — items needing a founder call, not fixed autonomously

Per the autonomous test/fix loop plan: these are logged rather than changed
because the "right" fix is a product/content decision, not a code bug.

1. **Landing pricing section** (A5): shows Pro ₹199 / Elite ₹499 subscription
   tiers. The mobile app has no subscription/tier system implemented (the
   only paid recurring flow is training-group monthly subscriptions, a
   different feature). Either build the pricing tiers, or remove/rewrite the
   pricing section before real users see a price that doesn't correspond to
   anything purchasable.
2. **Landing mailto links** (A2): "Get early iOS access", "Bring to your
   academy", "Launch updates" all point to `founder@synthsports.co` — a
   different brand's domain, not atlitos.com or elsheph.com. Confirm this is
   intentional (shared founder inbox) before launch.
3. **Empower section "PHOTO SLOT" + SAMPLE stats** (BUG-017 follow-up): the
   empower flow section shows a "PHOTO SLOT / img/empower-story.jpg" debug
   label (same class of issue as the fixed video slots) and three stat tiles
   (₹48,000 spare change routed, 132 athletes funded) explicitly tagged
   "SAMPLE". The SAMPLE tag makes this honest per the house style rule
   (never present invented numbers as real), but a live marketing page
   showing tagged-fake stats is still unusual — decide whether to replace
   with real numbers once they exist, remove the stat tiles until then, or
   leave as is. The raw-filename debug label should at minimum be removed or
   replaced with real photography, same fix pattern as BUG-017.

## e2e suite triage against freshly redeployed atlitos-app.vercel.app (2026-08-11)

Stale-test cluster (product behavior changed intentionally, test assertions
did not follow): AUTH-01, AUTH-03, AUTH-04, CL-03, CL-05, FO-09 all assert
the OLD first-run flow (a splash chooser with "Continue as guest"/"Login"
buttons before landing in the app). Per `apps/mobile/src/app/(auth)/splash.tsx`'s
own docstring, this was deliberately removed: "There is no first-run choice
screen any more" — the app now silently starts a guest session and lands
directly on Home, with Login/Register only offered later via the
LoginGateModal when a gated action is tapped. These tests need their
assertions updated to match; tracked as a follow-up, not re-litigated here
to keep this pass moving.

Real, unresolved finding (AUTH-09): the LoginGateModal itself still opens
correctly and login succeeds, but the ORIGINAL gated action (liking a clip
as a guest) does not complete afterward — the clip still shows "Like" not
"Unlike" post-login. This is exactly the intent BUG-010 (login redirect)
was supposed to guarantee; either it regressed or never fully covered the
like-specific case. Needs a real fix, not a test update. Logged here rather
than the ledger since root cause isn't yet isolated.

CL-07 (comment count) and AUTH-11 (cross-portal wrong-role rejection) not
yet triaged against the fresh deploy — carry over to the next pass.
