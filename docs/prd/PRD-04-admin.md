# PRD 04: Admin Back Office

**App:** apps/admin (Refine.dev + Supabase, shadcn UI on Atlitos tokens)
**Status:** Draft for P0 founder review
**Depends on:** identity/roles, coaching, courts, commerce, clutch, empower, learn, payments, and moderation/audit schema domains (see docs/PLAN.md). Exact table and column names are pending docs/architecture/SCHEMA.md; this PRD uses the domain level names from PLAN.md and will be reconciled once SCHEMA.md lands (see Open Questions).

---

## 1. Purpose and stakeholder definition

Admin is the internal operations console that lets Atlitos staff run the marketplace safely: verify supply side identities (coaches, venues, UPAs), manage the commerce catalog, drive orders through fulfillment and refunds, moderate Clutch content, manage user accounts, configure platform fees and feature flags, and resolve support tickets. It is not customer facing. Every mutating action taken here is written to audit_log so any state change on the platform can be traced to a person, a time, and a reason.

**Primary stakeholder:** Platform Admin. A staff member (founder or an operator he designates) who holds the admin role in user_roles and signs in to apps/admin. V2 ships one flat admin role; there are no support only or finance only tiers yet (see Open Questions).

**Secondary stakeholders:**
- **Founder**, as the person who ultimately answers for every approve, reject, refund, suspend, and config change made through this app, and as the biased approver reviewing this surface at phase gates.
- **Athletes, coaches, venues, shoppers, creators, UPAs**: never use apps/admin directly, but every one of them is affected by decisions made in it (their verification, their order, their clip, their account status).

**Out of stakeholder scope:** anonymous or guest users (admin requires an authenticated admin session with no guest mode).

---

## 2. Jobs to be done

1. When a coach, venue, or UPA applicant submits verification evidence, I need to review it and approve or reject it, so only legitimate supply reaches the marketplace.
2. When new gear arrives or existing gear changes, I need to create and edit products, variants, and stock counts, so shoppers always see accurate inventory and pricing.
3. When an order is placed, I need to move it through its fulfillment states and issue a refund when something goes wrong, so buyers get the correct outcome and the ledger stays accurate.
4. When a clip is uploaded, I need to review it before it reaches the public feed, and act on user reports against published content, so Clutch stays safe.
5. When a user misbehaves, I need to suspend their account, so they can no longer transact or post on the platform, and reinstate them if the situation is resolved.
6. When platform economics change, I need to edit fee_config, so booking, session, and order pricing reflects current rates going forward.
7. When we want to stage or kill a feature without a deploy, I need to toggle a feature flag.
8. When a user files a support ticket, I need to read it and mark it resolved once handled.
9. When building out the Learn module, I need to create and edit drills, so athlete roadmaps have real content to draw from.
10. When anything above happens, I need a single, tamper proof audit trail I can search by actor, action, and date, so any state change is explainable after the fact.

---

## 3. Surfaces and screens

Every screen below ships four states: loading (skeleton), empty, populated, error, per house convention. Screens are Refine.dev list/show/edit/create resources on shadcn table and form primitives.

### 3.1 Auth
- **Login** — email and password sign in against Supabase Auth. No self registration, no guest mode. States: form, submitting, error (invalid credentials, not an admin).

### 3.2 Dashboard
- **Dashboard Overview** — KPI tiles (users by role, bookings this week, orders this week, GMV this week, pending verification count, pending moderation count, open ticket count) plus a recent activity feed of the latest audit_log entries.

### 3.3 Verification
- **Verification Queue** — tabbed list (Coach, Venue, UPA) of pending verification_requests.
- **Verification Detail** — single request: submitted evidence, applicant identity, approve/reject actions with required reject reason, and prior decision history if already actioned.

### 3.4 Catalog (Commerce)
- **Product List** — all products with category, variant count, total stock, active state; search and category filter.
- **Product Create** — new product form: name, description, category, base price, media.
- **Product Detail/Edit** — edit product fields; manage variants (size/color/sku, price override, stock) inline; manual stock adjustment with required reason; activate/deactivate.

### 3.5 Orders
- **Order List** — all orders with id, buyer, status, total, placed date; filter by status.
- **Order Detail** — line items, BillSummary breakdown (subtotal, GST, delivery, donation roundup, total), OrderTimeline history, advance-to-next-status action, refund action.

### 3.6 Clutch Moderation
- **Moderation Queue** — clips with status uploading, processing, or ready pending review; inline video preview; approve/reject with required reject reason.
- **Reports Queue** — user submitted reports against published clips or comments; resolve by takedown or dismissal, both with required reason.

### 3.7 Users
- **User List** — all users with name, contact, roles, join date, status; search by name/email.
- **User Detail** — roles, verification status if applicable, recent activity summary, suspend/reinstate action with required reason.

### 3.8 Payments Config
- **Fee Config Editor** — current fee_config rows (platform fee, GST rate, other configurable rates) grouped by domain (courts, sessions, commerce); edit with validation and required change note.

### 3.9 Feature Flags
- **Feature Flag List** — key, description, enabled state, last modified; toggle and create new flag.

### 3.10 Support
- **Ticket List** — subject, submitter, status, submitted date; filter by status.
- **Ticket Detail** — full description, submitter context, mark resolved with optional note.

### 3.11 Learn
- **Drill List** — name, sport, skill category, difficulty, XP value.
- **Drill Create/Edit** — full drill fields, optional media, activate/deactivate.

### 3.12 Audit Log
- **Audit Log Viewer** — searchable, filterable (actor, action type, entity type, date range) read only list of every audit_log row, each expandable to see the before/after diff.

---

## 4. Functional requirements

### Auth and access
- **FR-1**: Only a user holding the admin role in user_roles can sign in to apps/admin; any other credentials are rejected at login with a generic authentication error.
- **FR-2**: Every read and write apps/admin makes is scoped by the authenticated admin's JWT and RLS policy; no Supabase service role key is present in client side code or bundle.
- **FR-3**: If an admin's role is revoked, their next session refresh fails and they are signed out of apps/admin; no cached session grants continued access.

### Dashboard
- **FR-4**: Dashboard Overview shows KPI tiles for total users by role, bookings this week (courts plus sessions combined), orders this week, GMV this week, pending verification count, pending moderation count, and open support ticket count.
- **FR-5**: Each KPI tile loads and errors independently; a failure to compute one tile does not block the others from rendering.
- **FR-6**: Dashboard Overview lists the most recent 20 audit_log entries with actor, action, entity, and timestamp.

### Verification queues
- **FR-7**: Verification Queue lists pending verification_requests split into Coach, Venue, and UPA tabs, each row showing applicant name, submitted date, and status.
- **FR-8**: Verification Detail renders every evidence field submitted for that request type (coach: certificates, experience, sport; venue: ownership documents, address, photos; UPA: story, identity proof, guardian consent).
- **FR-9**: Approving a verification_request sets its status to approved, sets the underlying entity (coach_profile, venue, or upa) to verified, and writes one audit_log entry.
- **FR-10**: Rejecting a verification_request requires a reason, sets its status to rejected, writes one audit_log entry, and the reason is delivered to the applicant via notification.
- **FR-11**: Approve and reject actions are enabled only while a request is pending; an already actioned request renders as read only history.
- **FR-12**: Each Verification Queue tab shows a distinct empty state when it has no pending requests.

### Product catalog CRUD
- **FR-13**: Product List shows every product with name, category, variant count, aggregate stock, and active state, and supports text search and category filtering.
- **FR-14**: Creating a product requires name, description, category, base price, and at least one media image; creation writes one audit_log entry.
- **FR-15**: Editing a product writes one audit_log entry capturing the changed fields with before and after values.
- **FR-16**: Variants (size, color, sku) can be added, edited, and removed under a product, each carrying its own price override and stock count; every variant mutation writes one audit_log entry.
- **FR-17**: A manual stock adjustment on a variant requires a reason note and writes one audit_log entry recording the prior count, new count, and reason.
- **FR-18**: Deactivating a product hides it from the shopper facing catalog without deleting its data; reactivating restores visibility. Both write audit_log.
- **FR-19**: Product media supports multiple images per product with reordering and one designated primary image.

### Order lifecycle driver
- **FR-20**: Order List shows every order with id, buyer, current status, total, and placed date, filterable by status.
- **FR-21**: Order Detail shows line items, a BillSummary breakdown (subtotal, GST, delivery, donation roundup, total), current status, and the full OrderTimeline history.
- **FR-22**: An order can be advanced exactly one step forward through the fixed sequence placed, shipped, in_transit, delivered; any attempt to skip a step or move backward is rejected with an INVALID_TRANSITION error from the advancing RPC or edge function.
- **FR-23**: Advancing an order requires a location or note field and produces both a new order_timeline row and one audit_log entry.
- **FR-24**: A refund (full or partial) is issued only through an edge function that calls the Razorpay refund API and writes a corresponding ledger_entries row; the requested refund amount cannot exceed the order's remaining refundable total, enforced server side.
- **FR-25**: The refund action shows a BillSummary style confirmation (original total, previously refunded, this refund amount, remaining refundable) before the admin can submit.
- **FR-26**: No order status field or money value is ever mutated by a direct client side table update from apps/admin; every status change and every money movement is routed through an RPC or edge function.

### Clutch moderation
- **FR-27**: Moderation Queue lists clips whose status is uploading, processing, or ready, showing thumbnail, creator, caption, and upload date.
- **FR-28**: An admin can preview a clip's video inline before approving or rejecting it.
- **FR-29**: Approving a pending clip sets its status to published and writes one audit_log entry.
- **FR-30**: Rejecting a pending clip requires a reason, sets its status to rejected, writes one audit_log entry, and notifies the creator.
- **FR-31**: Reports Queue lists user submitted reports against published clips or comments, showing reporter, reason, reported entity, and date.
- **FR-32**: Resolving a report either removes the reported clip or comment (status set to rejected/removed) or dismisses the report; both paths require a reason and write one audit_log entry.
- **FR-33**: Moderation Queue and Reports Queue each show a distinct empty state when nothing is pending.

### User management
- **FR-34**: User List shows every user with name, contact, roles, join date, and status (active or suspended), searchable by name and email.
- **FR-35**: User Detail shows a user's roles, verification status where applicable, and a recent activity summary (bookings, orders, clips).
- **FR-36**: Suspending a user requires a reason, blocks that user from authenticating and from any mutating action platform wide starting from the next request, and writes one audit_log entry.
- **FR-37**: Reinstating a suspended user restores their access and writes one audit_log entry.
- **FR-38**: Suspending or reinstating a user never deletes or alters their historical bookings, orders, or ledger rows.

### Fee configuration
- **FR-39**: Fee Config Editor shows every fee_config value grouped by the domain it applies to (courts, sessions, commerce).
- **FR-40**: Editing a fee_config value applies only to bookings, sessions, and orders created after the change; bills already computed before the change are unaffected. The edit writes one audit_log entry with before and after values.
- **FR-41**: Percentage fields must be between 0 and 100 and flat fee fields must be non negative; the save action is blocked and shows a validation error otherwise.

### Feature flags
- **FR-42**: Feature Flag List shows every flag with key, description, enabled state, and last modified date.
- **FR-43**: Toggling a flag on or off writes one audit_log entry.
- **FR-44**: Creating a new flag requires a unique key, a description, and a default state.

### Support tickets
- **FR-45**: Ticket List shows every ticket with subject, submitter, status, and submitted date, filterable by status.
- **FR-46**: Ticket Detail shows the full ticket description and submitter context (name, role).
- **FR-47**: Marking a ticket resolved accepts an optional resolution note and writes one audit_log entry.
- **FR-48**: Ticket List shows an empty state when no tickets match the current filter.

### Drill CRUD (Learn)
- **FR-49**: Drill List shows every drill with name, sport, skill category, difficulty, and XP value.
- **FR-50**: Creating a drill requires name, description, sport, skill category, difficulty, and XP value, with optional media; creation writes one audit_log entry.
- **FR-51**: Editing or deactivating a drill writes one audit_log entry.

### Audit log
- **FR-52**: Audit Log Viewer lists every audit_log row with actor, action type, entity type and id, timestamp, and a before/after diff where the action produced one; filterable by actor, action type, and date range.
- **FR-53**: Every action in FR-9, FR-10, FR-14 through FR-18, FR-23, FR-24, FR-29, FR-30, FR-32, FR-36, FR-37, FR-40, FR-43, FR-47, FR-50, and FR-51 produces exactly one audit_log row capturing actor id, action, entity type, entity id, timestamp, and a payload sufficient to reconstruct the change.
- **FR-54**: Audit Log Viewer is read only; no action in apps/admin can edit or delete an existing audit_log row.

---

## 5. Data touched

Table names follow the domain vocabulary in docs/PLAN.md pending final docs/architecture/SCHEMA.md.

| Domain | Table(s) | Read | Write |
|---|---|---|---|
| identity/roles | users, user_roles | Yes (User List/Detail) | Yes (suspend/reinstate status only; roles themselves not editable here, see Open Questions) |
| moderation/audit | verification_requests | Yes | Yes (approve/reject status) |
| coaching | coach_profiles | Yes (evidence display) | Yes (status set to verified on approval only) |
| courts | venues | Yes (evidence display) | Yes (status set to verified on approval only) |
| empower | upa_applications | Yes (evidence display) | Yes (status set to verified on approval only) |
| commerce | products, product_variants, stock | Yes | Yes (full CRUD, stock adjustment) |
| commerce | orders, order_items, order_timeline | Yes | Yes (status advance, timeline append; never direct edit of totals) |
| payments | ledger_entries | Yes (refund history on Order Detail) | Written only by the refund edge function, never directly by admin UI |
| payments | fee_config | Yes | Yes |
| clutch | clips | Yes | Yes (status approve/reject/removed) |
| clutch/moderation | reports (moderation queue is a query over `clips.status`, not a separate table, per VIDEO.md) | Yes | Yes (resolve) |
| moderation/audit | feature_flags | Yes | Yes |
| moderation/audit | audit_log | Yes (Audit Log Viewer) | System writes only, one row per mutating action above; never edited or deleted from the UI |
| support | support_tickets | Yes | Yes (resolve, note) |
| learn | drills | Yes | Yes (full CRUD) |
| learn | roadmap_stages, xp_events | Not touched by admin in v2 (generated from real athlete activity per PLAN.md phase P7) | Not touched |
| courts | slots, pricing rules, checkins | Not touched by admin in v2 (owned by apps/portal-court) | Not touched |
| payments | payout_accounts, transfers | Read only if surfaced on User Detail for a coach; transfer initiation stays in the coaching/payments flow (razorpay-route-transfer), not admin | Not written by admin |
| chat | threads, messages | Not touched by this PRD | Not touched |

---

## 6. Payment touchpoints

Admin never writes a money row or a ledger entry directly. Two payment adjacent surfaces exist:

1. **Order refund (Order Detail).** The admin action calls an edge function (extends admin-order-advance or a new admin-order-refund function, see Open Questions) that: re-checks the order's remaining refundable total server side, calls the Razorpay refund API, and writes the resulting ledger_entries row. The client never computes or sends a trusted refund amount without server re-validation, matching the PRICE_MISMATCH discipline from v1. The refund confirmation dialog renders a BillSummary (original total, previously refunded, this refund, remaining refundable) before submit, satisfying the house rule that BillSummary appears on every money surface.
2. **Fee Config Editor.** Not a money movement itself, but a configuration surface that determines future money movements platform wide. Every edit is versioned via audit_log with before/after values and takes effect only for bookings, sessions, and orders created after the change, never retroactively.

No other admin screen touches payment_intents, ledger_entries, or payout_accounts directly. Coach payout transfer initiation (razorpay-route-transfer) stays outside admin, per PLAN.md's phase P3 scope.

---

## 7. Acceptance criteria per journey

**Journey A: Verify a coach**
- Given a pending coach verification_request, when the admin opens Verification Queue > Coach tab, then the request appears with applicant name and submitted date (FR-7).
- When the admin opens the request and reviews all submitted evidence fields, then every field submitted by the coach onboarding wizard is visible (FR-8).
- When the admin clicks Approve, then the request status becomes approved, the coach_profile status becomes verified, and an audit_log row is written with actor, action, entity id, timestamp (FR-9, FR-53).
- When the admin instead clicks Reject without entering a reason, then the action is blocked (FR-10).
- When the admin rejects with a reason, then the request status becomes rejected, the coach is notified with the reason, and an audit_log row is written (FR-10).
- Given a request already approved or rejected, when the admin reopens it, then Approve/Reject are disabled and only history is shown (FR-11).

**Journey B: Advance and refund an order**
- Given an order in placed status, when the admin advances it, then it becomes shipped and one order_timeline row plus one audit_log row are written (FR-22, FR-23).
- When the admin attempts to advance a placed order directly to delivered, then the action is rejected with INVALID_TRANSITION (FR-22).
- Given a delivered order, when the admin requests a refund greater than the remaining refundable total, then the action is rejected server side (FR-24).
- When the admin requests a valid partial refund, then a BillSummary confirmation shows original total, previously refunded, this refund, and remaining, and on submit a ledger_entries row and an audit_log row are written (FR-24, FR-25, FR-53).

**Journey C: Moderate a Clutch clip**
- Given a clip with status ready, when the admin opens Moderation Queue, then the clip appears with a working inline preview (FR-27, FR-28).
- When the admin approves it, then its status becomes published and an audit_log row is written (FR-29, FR-53).
- When the admin rejects it without a reason, the action is blocked; with a reason, status becomes rejected, the creator is notified, and an audit_log row is written (FR-30, FR-53).
- Given a report against a published clip, when the admin resolves it by takedown, then the clip status becomes removed and an audit_log row is written (FR-32, FR-53).

**Journey D: Suspend and reinstate a user**
- When the admin suspends a user with a reason, then that user cannot authenticate on their next request and an audit_log row is written (FR-36, FR-53).
- When the admin reinstates that user, then authentication succeeds again and an audit_log row is written (FR-37, FR-53).
- After suspension and reinstatement, the user's prior orders, bookings, and ledger rows are unchanged (FR-38).

**Journey E: Edit fee config**
- When the admin edits the courts platform fee to a value outside 0 to 100 percent, the save is blocked with a validation error (FR-41).
- When the admin saves a valid change, then an audit_log row records the before and after values, and a booking created after the change reflects the new fee while a booking created before it does not (FR-40, FR-53).

**Journey F: Product and stock management**
- When the admin creates a product without a media image, the save is blocked (FR-14).
- When the admin adds a variant with an initial stock count, then the variant appears on the shopper facing product with that stock (FR-16).
- When the admin adjusts stock without entering a reason, the save is blocked; with a reason, the stock count updates and an audit_log row records prior count, new count, and reason (FR-17, FR-53).

**Journey G: Support ticket resolution**
- Given an open ticket, when the admin marks it resolved, then its status changes to resolved and an audit_log row is written (FR-47, FR-53).

**Journey H: Drill CRUD**
- When the admin creates a drill with all required fields, then it appears in Drill List and is available to the Learn module's roadmap logic, and an audit_log row is written (FR-50, FR-53).

**Journey I: Audit trail integrity**
- After performing any action from Journeys A through H, the admin opens Audit Log Viewer, filters by their own actor id, and finds one row per action taken, each with a before/after diff where applicable (FR-52, FR-53).
- The admin attempts to edit or delete an existing audit_log row through the UI; no such action is available (FR-54).

---

## 8. Explicitly out of scope

This PRD is a ceiling. Anything not listed above, including the following, is out of scope for apps/admin in v2:

- Coach, venue, or UPA self serve onboarding and submission forms (those live in the mobile app and portal-court/portal-life, which produce the verification_requests admin only reviews).
- Court and session slot inventory, availability windows, and pricing rule management (owned by apps/portal-court).
- Coach payout Route onboarding and transfer initiation (owned by the coaching/payments flow, triggered on session completion, not by admin).
- Chat thread viewing or moderation of direct messages.
- Multiple admin permission tiers (support only, finance only, content moderator only); v2 ships one flat admin role.
- Bulk CSV or spreadsheet import/export of products, orders, or users.
- Custom analytics or report builder beyond the fixed Dashboard KPI tile set.
- Push notification composition or broadcast tooling.
- Self service admin account registration; admin accounts are provisioned outside the app.
- Editing or deleting existing audit_log rows, by anyone, from any surface.
- Direct SQL console or raw table editor access from within apps/admin.
- Editing a user's roles (granting/revoking coach, venue owner, etc.) beyond the binary suspend/reinstate action; role assignment happens through the respective onboarding and verification flows.
- Real time collaborative editing indicators (who else is viewing this ticket/order right now).

---

## 9. Open questions for the founder

1. Does suspending a user also force cancel their active bookings and sessions, or only block future actions while leaving in flight bookings to run their course?
2. Should the order refund action reuse the admin-order-advance edge function or does it need a new admin-order-refund edge function added to the PLAN.md edge function list? This PRD assumes a new function is needed since refund is not a status advance.
3. Is one flat admin role sufficient for the P0 to P8 build, or should apps/admin be built now with a permission tier column (even if only one tier is used at launch) to avoid a later migration?
4. Who provisions admin accounts, manual Supabase Auth invite by the founder, or a seed script checked into supabase/seed?
5. Does a fee_config edit need a second admin's approval (four eyes) given it changes live platform pricing, or is a single admin edit with audit_log acceptable for v2?
6. Should reject reasons (verification, clip, report) come from a fixed reason code list for consistent reporting, or is free text acceptable for v2?
7. Table and column names above are inferred from PLAN.md's domain descriptions; once docs/architecture/SCHEMA.md is written, does anything here (verification_requests shape, ledger_entries shape, moderation_queue vs reports as one table or two) need to be reconciled with actual migrations?
8. Should payout_accounts and transfers appear read only on User Detail for coaches, or should admin have zero visibility into coach payout status in v2?
