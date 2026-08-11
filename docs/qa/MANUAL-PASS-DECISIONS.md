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
