# PRD-05: Atlitos Life (UPA Portal)

**App:** `apps/portal-life` (Next.js, shadcn/ui)
**Status:** Draft for P0 gate
**Owner:** Founder (Abishai)
**Related:** PLAN.md schema domain `empower`, TASTE.md (warm premium base, orange accent, ink-on-accent), v1 SPEC.md Journey 5, v1 `models.ts` (`UPAProfile`, `UPAWishlistItem`, `Donation`)

## 1. Purpose and stakeholder definition

Atlitos Life is the company's mission surface: a dignified, athlete-owned portal where an Underprivileged Athlete (UPA) tells their story, gets verified, lists the gear they need, tracks who is funding it, and thanks the sponsors who help. This is not a donor storefront. It is the athlete's own space, built to make a young athlete feel seen and respected, not pitied.

**Primary stakeholder: the UPA applicant/athlete.** A young athlete (or a parent/guardian applying on their behalf) who lacks the means to afford gear, coaching access, or travel and wants Atlitos's support. They arrive to apply, then return to check status, manage their wishlist, and thank sponsors.

**Secondary stakeholder: the sponsor (implicit role).** Any Atlitos user who has donated or is deciding whether to. They reach this surface indirectly, through the profile preview link shared from the consumer app's Empower Hub. They do not sign in here and do not transact here.

**Tertiary stakeholder: Atlitos verification staff.** They review applications and move status forward. Their working queue is the admin app (`apps/admin`), covered by a separate PRD. This portal only renders the status they set and the roadmap of what is still missing.

**Out of stakeholder scope:** payment processing staff, coaches, court partners. Not relevant to this surface.

## 2. Jobs to be done

- When I am an athlete without the means to afford gear, I want to tell my story and apply for support, so that Atlitos can consider me for funding.
- When I have applied, I want to see exactly where my application stands and what is still missing, so that I am not left wondering.
- When I am verified, I want to list the specific gear I need with real costs, so that sponsors know exactly what to fund.
- When a sponsor funds something, I want to see the progress update in real time, so that I feel the support landing.
- When an item is fully funded, I want to post a thank you that the sponsor can see, so that the relationship feels human, not transactional.
- When a sponsor is deciding whether to fund me, I want my public profile to represent me warmly and honestly, so that I am seen as an athlete, not a charity case.
- When I am managing my own account, I want to update my story or contact details, so that my profile stays current.

## 3. Surfaces and screens

Every screen below is built for four states: loading, empty, error, and populated (per DESIGN-LANGUAGE component discipline). Populated-state variants are noted where a screen has more than one meaningful populated layout.

1. **Sign in / Sign up** (`/login`, `/signup`)
   States: default, submitting, error (invalid credentials, network). No empty/populated distinction (form-only).

2. **Apply** (`/apply`) — multi-step wizard
   Steps: Story (headline + body), Sport and region, Certificates (file upload), Video links (external URLs, e.g. match footage).
   States: in-progress (step N of 4, draft autosaved), submitting, error (upload failure, validation), success (redirects to Status).
   Guard: only reachable by an authenticated user with no existing application, or one in `needs_info` status (resumes into the flagged step).

3. **Verification Status** (`/status`)
   The journey view: a roadmap from `submitted` through `under_review` to `verified`, with `needs_info` as a branch that flags exactly which step needs attention and why.
   States:
   - loading (fetching application)
   - `submitted` (received, queued for review)
   - `under_review` (staff actively reviewing, estimated wait shown)
   - `needs_info` (specific missing/rejected item highlighted with a fix action, links back into `/apply` at that step)
   - `verified` (success state, routes into the Dashboard)
   - `rejected` (dignified explanation, no dead end: what changed would help, how to reapply)
   - error (fetch failed)

4. **Dashboard** (`/home`) — verified UPAs only
   Overview: total raised, items funded vs open, latest gratitude post reminder if a funded item has no thank you yet.
   States: loading, empty (verified but zero wishlist items yet, prompts to add first item), error, populated.

5. **Wishlist Manager** (`/wishlist`)
   Grid of gear items: title, cost, funded amount, status (`open` / `funded` / `delivered`). Add item, edit item, remove item (only while `open`).
   States: loading, empty (no items yet, add-first-item CTA), error, populated. Item-level sub-states: `open`, partially funded (progress bar), `funded` (prompts gratitude post), `delivered` (closed, archived).

6. **Funding Progress Detail** (`/wishlist/[itemId]`)
   Single item: cost, funded amount, progress bar, list of contributing donations (amount and date, sponsor identity anonymized to "A Sponsor" unless the sponsor opted into a visible name).
   States: loading, error, populated (open/partial/funded/delivered).

7. **Gratitude Posts** (`/gratitude`)
   Compose a thank you tied to a specific funded item; list of past posts with the item they reference.
   States: loading, empty (no funded items yet, explains gratitude unlocks after funding), error, populated (composer available only for funded items without a post yet; read-only list otherwise).

8. **Profile Preview** (`/profile/preview`)
   Read-only render of exactly what a sponsor sees on the consumer app's UPA public profile: photo, story, verified badge, sport, region, wishlist with funding progress, total raised. A "view as sponsor" toggle framing.
   States: loading, error, populated. No empty state (verified UPAs always have a profile once verified).

9. **Account Settings** (`/account`)
   Edit story/headline, contact details, sport/region, sign out, delete/deactivate application (pre-verification only).
   States: default, saving, error, success (toast).

## 4. Functional requirements

**Application intake**
- FR-1: A signed-in user with no existing `upa_applications` row can start `/apply` and save a draft after each step without losing progress on reload.
- FR-2: The application requires story headline, story body, sport, region, and at least one of (certificate upload, video link) before submission is allowed.
- FR-3: Certificate uploads accept image and PDF files, stored in Supabase Storage under a per-applicant private path, never publicly listable.
- FR-4: Video links are stored as external URLs (no upload/transcode); the portal validates the URL is well-formed before accepting it.
- FR-5: Submitting the application creates a `upa_applications` row with status `submitted` and a linked `verification_requests` row for staff.
- FR-6: A user cannot submit a second application while one is `submitted`, `under_review`, or `verified`.

**Verification journey**
- FR-7: `/status` reads the applicant's own `upa_applications` and linked `verification_requests` rows and renders the current status plus a roadmap of remaining steps.
- FR-8: When status is `needs_info`, the portal surfaces the specific field or document flagged by staff and links directly into the relevant `/apply` step, pre-filled with prior answers.
- FR-9: When status transitions to `verified`, the UPA gains access to Dashboard, Wishlist Manager, Gratitude Posts, and Profile Preview; these routes redirect to `/status` for any non-verified state.
- FR-10: When status is `rejected`, the portal shows the reason (if staff provided one) and a path to reapply after a cooldown period defined by staff, never a dead end with no next action.

**Wishlist management**
- FR-11: A verified UPA can add a wishlist item with a title and a cost greater than zero; the item is created with status `open` and `fundedAmount` 0.
- FR-12: A verified UPA can edit the title and cost of a wishlist item only while its status is `open`.
- FR-13: A verified UPA can remove a wishlist item only while its status is `open` and `fundedAmount` is 0.
- FR-14: Wishlist item status transitions (`open` -> `funded` -> `delivered`) are written only by server-side logic reacting to donation and fulfillment events; the client never writes a status transition directly.
- FR-15: The Wishlist Manager reflects funding updates from donations in near real time (Supabase Realtime subscription), without requiring a manual refresh.

**Funding progress visibility**
- FR-16: `/wishlist/[itemId]` shows a read-only list of individual donations contributing to that item, each with amount and date.
- FR-17: A donation record's sponsor identity is shown as "A Sponsor" unless the donor has an explicit opt-in flag to show their display name, sourced from the donor's own account setting (read-only from this portal's perspective).
- FR-18: The Dashboard's total raised figure matches the sum of all donations attributed to the UPA across all wishlist items plus any un-itemized profile-level donations.

**Gratitude posts**
- FR-19: A gratitude post can be composed only for a wishlist item with status `funded` or `delivered` that does not already have a gratitude post.
- FR-20: A gratitude post requires body text; it may optionally include a photo.
- FR-21: Once published, a gratitude post is immutable except for a soft delete by the UPA (staff can also unpublish via moderation).
- FR-22: A published gratitude post becomes visible on the item's funding detail and on the UPA's public profile, attributed to the UPA.

**Profile preview**
- FR-23: `/profile/preview` renders using the same read query the consumer app's public UPA profile uses, so the UPA always sees exactly what sponsors see, never a diverged preview.
- FR-24: A non-verified UPA cannot access `/profile/preview`; the route redirects to `/status`.

**Account and access**
- FR-25: Sign-in supports the same Supabase Auth identity used across Atlitos (a UPA may already hold a consumer-app account); role `upa_applicant`/`upa` is additive, not a separate identity system.
- FR-26: A UPA can edit story headline, story body, sport, and region after verification without triggering a new verification cycle, unless staff flags the edit for re-review.
- FR-27: A UPA can deactivate their own application only while status is `submitted` or `under_review`; a `verified` UPA must contact support to deactivate (prevents accidental loss of an active funded wishlist).

## 5. Data touched

Schema domains per PLAN.md.

| Table (domain) | Read | Write |
|---|---|---|
| `upa_applications` (empower) | yes, own row only | yes: create on submit, update on edit (draft steps, post-verification story edits) |
| `verification_requests` (moderation/audit) | yes, own linked row(s), read-only | no (staff-only via admin app) |
| `upa_wishlist_items` (empower) | yes, own UPA's items; also the subset exposed via public profile query | yes: create/edit/delete while `open`; status transitions are server-side only (edge function or RPC), never direct client writes |
| `donations` (empower) | yes, donations attributed to own UPA/items, read-only | no (all donation writes happen from the consumer app's donate flow via edge function) |
| `gratitude_posts` (empower) | yes, own posts | yes: create, soft-delete |
| `user_roles` (identity/roles) | yes, own role row | no (role granted by verification transition, server-side) |
| `audit_log` (moderation/audit) | no | no (staff/system only) |
| `notifications` (notifications) | yes, own notifications (status changes, new donations) | write: mark-as-read only |
| Supabase Storage: certificates bucket | yes, own uploads | yes: upload during `/apply` |

## 6. Payment touchpoints

This portal has no checkout, no BillSummary, and initiates no money movement. It is receive-side only: it reads donation and funding totals that were written elsewhere (the consumer app's donate flow, via the `donate` edge function and the ledger it maintains). No client on this portal ever writes a `payment_intents`, `ledger_entries`, or `donations` row.

If a future funding-progress or dashboard tile needs to summarize amounts, it must read from the ledger via a read-only view or RPC, never recompute totals client-side from raw donation rows in a way that could drift from the ledger's source of truth.

## 7. Acceptance criteria per journey

**Journey A: Apply for support**
- Given a signed-in user with no existing application, when they complete all four steps of `/apply` with valid data and submit, then a `upa_applications` row exists with status `submitted` and they land on `/status` showing "submitted."
- Given a user mid-wizard who reloads the page, when they return to `/apply`, then their prior step answers are still present (draft persisted).
- Given a user who tries to submit without a story headline, then submission is blocked with a specific inline error, not a generic failure.

**Journey B: Track verification status**
- Given a UPA with status `under_review`, when they visit `/status`, then they see a roadmap showing "submitted" and "under review" as complete/current and "verified" as pending, with no ability to skip ahead.
- Given a UPA with status `needs_info` and a flagged missing certificate, when they click the fix action, then they land in `/apply` at the certificates step with prior answers intact.
- Given a UPA whose status changes to `verified` while they are on `/status`, then the page updates (via Realtime or on next load) and offers a link into the Dashboard.

**Journey C: Manage wishlist and see funding**
- Given a verified UPA with zero wishlist items, when they visit `/wishlist`, then they see an empty state with an add-item CTA, not a blank grid.
- Given a verified UPA who adds an item with cost 1500, when a sponsor donation of 500 lands against that item, then `/wishlist/[itemId]` reflects fundedAmount 500 of 1500 without a manual refresh.
- Given an item with fundedAmount equal to cost, then its status shows `funded` and the UPA cannot edit or delete it.

**Journey D: Give thanks**
- Given a funded item with no gratitude post, when the UPA composes and publishes one, then it appears on both `/gratitude` and the item's funding detail, attributed correctly.
- Given an item that already has a published gratitude post, then the compose action is unavailable for that item (no duplicate posts).

**Journey E: Profile preview**
- Given a verified UPA, when they open `/profile/preview`, then every field shown (photo, story, sport, region, wishlist, total raised, verified badge) matches what the consumer app's public UPA profile query returns for the same UPA.
- Given a non-verified UPA, when they attempt to open `/profile/preview` directly by URL, then they are redirected to `/status`.

## 8. Explicitly out of scope

- Any payment collection, checkout, or donation form on this portal. Donating happens in the consumer app.
- Staff-facing verification review queue and approve/reject actions. That is the admin app (`apps/admin`), separate PRD.
- The consumer app's Empower Hub (browse all UPAs, aggregate impact counter, donate flow, My Impact). Separate PRD.
- Messaging or chat between UPA and sponsors. No direct-contact channel exists in v2.
- Video upload/transcode for the UPA's own highlight footage (Clutch handles creator video separately; this portal only accepts external video links as application evidence).
- Multi-child or family-managed multiple applications under one guardian account. One application per account in v2.
- Localization/multi-language UI. English only for v2.
- Native mobile app for Atlitos Life. Web portal only, per PLAN.md decision.
- Tax receipts or donation certificates for sponsors. Out of scope for this surface (may live in consumer app My Impact).

## 9. Open questions for the founder

1. Who counts as "staff" for verification review in P0/P1: is there a dedicated Atlitos Life ops role distinct from general admin, or does the same admin role from `apps/admin` cover it?
2. Reapply cooldown after `rejected`: what is the actual waiting period, and is it configurable per rejection reason?
3. Sponsor name visibility opt-in (FR-17): does that setting already exist as a consumer-app account preference, or does it need to be added as part of this build?
4. Guardian/parent-applies-for-minor: does the applying adult need a distinct relationship field (e.g. "parent of"), or is age alone on the profile sufficient for v2?
5. Gratitude post moderation: does a published post go live immediately, or does it queue through `moderation_queue` before appearing on the public profile?
6. Item removal after partial funding: FR-13 blocks removal once `fundedAmount > 0`. If a UPA no longer needs a partially funded item, what is the resolution path (refund to sponsor, redirect funds to another item, or must staff handle it manually)?
7. Should `/status` show which staff member or team is reviewing, or stay fully anonymized on the staff side for privacy?
