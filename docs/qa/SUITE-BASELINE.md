# Maestro suite baseline, local stack

Recorded 2026-08-15. Scored by **maestro's exit code** (0 pass, 1 fail), never
by searching output for the word FAILED. That distinction is not pedantic: an
earlier run of this same suite reported "20 of 20 pass" while one flow had a
broken YAML header and executed NOTHING. A flow that never starts emits no
failure text, so absence-of-FAILED scored it green.

Run against the local Supabase stack (CLI 2.114.0 minimum) with
`./scripts/reset-local-fixtures.sh` first, per flow, pinned with `--udid`.

## 19 pass, 1 fail

    PASS  athlete-book-session-funnel      PASS  groups-join-guard
    PASS  athlete-clip-upload              PASS  integrator-coach-trainees
    PASS  auth-register-skip               PASS  profile-gate
    PASS  category-nav                     PASS  search-domains
    PASS  clutch-comments-overflow         PASS  shop-back
    PASS  clutch-like-gate                 PASS  smoke-guest-home
    PASS  coach-group-create               PASS  trainings-coach-browse
    PASS  coach-session-type-create        FAIL  trainings-shell
    PASS  courts-header
    PASS  gate-login-nav
    PASS  groups-athlete
    PASS  groups-coach

## The one failure is honest and should stay red

`trainings-shell` reaches its Payments assertion after 66 steps and fails
because `public.payment_intents` is EMPTY locally. It passes against
production, so it is a HARNESS finding, not a product one.

**Do not hand-seed money rows to close it.** They carry a double-entry ledger
with a deferred balance constraint, and inventing them by hand is the exact
shape that left 73 captured payments orphaned from their entity in production
(task #40). The legitimate fix is to let the product create them: deploy the
payment edge functions (task #43), then run one Razorpay TEST payment through
`book-session` against the local stack and snapshot that state as a fixture.

## What this baseline is worth

Four of these flows did not exist twelve hours earlier, and none of the write
paths could be tested at all, because they WRITE and production is read only by
standing rule:

- coach creates a session type   `session_types` row verified in SQL
- coach creates a group          `training_groups` row verified in SQL
- athlete books to the pay gate  CTA flips out of its refusing state
- athlete uploads a clip         `clips` row plus storage objects, correct MIME

Three failures during their development turned out to be the PRODUCT being
right: the group capacity ceiling refusing 1216, the booking funnel refusing to
double book a coach already busy at that hour, and Analytics honestly reporting
too few sessions for a trend. None had ever been demonstrated before.
