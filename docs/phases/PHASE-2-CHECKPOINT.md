# Phase 2 Integrator Checkpoint

Crash recovery trail for the Courts vertical slice integration pass. Read this file plus `git log` before resuming: it records exactly which migrations/functions have landed remotely on project `syzzfgaudpifwvbpycyi` and what has been committed locally. If a line below exists, that step is done, do not repeat it.

## Migrations applied (remote, project syzzfgaudpifwvbpycyi)

- 0009_courts.sql applied: name=0009_courts, version=20260713144808. Tables venues/venue_photos/venue_staff/courts/court_availability_windows/court_blackouts/court_pricing_rules/court_bookings created, RLS enabled, RPCs (submit_venue_verification, accept_venue_staff_invite, get_court_busy_slots, get_court_available_slots, court_booking_check_in, court_booking_transition, rate_court_booking) and venue branch of admin verification RPCs wired.
- 0010_payments_core.sql applied: name=0010_payments_core, version=20260713144858. Tables payment_intents/ledger_entries (insert only, deferred balance-check constraint trigger)/payout_accounts/transfers/webhook_events/fee_config created, RLS enabled, deferred FK court_bookings.payment_intent_id -> payment_intents added, fee_config seeded (courts.platform_fee_flat=10.00, courts.gst_percent=0.10, sessions.platform_fee_flat=10.00).
- 0011_courts_payment_state.sql applied: name=0011_courts_payment_state, version=20260713144927. Added enum values 'pending_payment' and 'expired' to court_booking_status only (deliberately no other statements in this migration, see file header: new enum values cannot be referenced in the same transaction they were added in).
- 0012_courts_payment_state_rpcs.sql applied: name=0012_courts_payment_state_rpcs, version=20260713145005. Widened court_bookings_court_date_slot_unique to free slot on 'expired' too; added service_role-only RPCs court_booking_confirm_payment and court_booking_expire_payment.
- 0013_admin_courts_bookings.sql applied: name=0013_admin_courts_bookings, version=20260713145037. Added court_bookings_select_admin RLS policy (admin/moderator read-only support access) and admin_update_fee_config RPC (audit-logged fee edits, admin only).
- 0014_venue_media_bucket.sql applied: name=0014_venue_media_bucket, version=20260713145109. Created public storage bucket venue-media plus public read / partner-scoped insert/update/delete storage.objects policies (path convention {venue_id}/{filename}).
- 0015_court_rating_summary.sql applied: name=0015_court_rating_summary, version=20260713145135. Added get_court_rating_summary(uuid) security definer aggregate RPC, granted to anon/authenticated.

All 7 migrations (0009 through 0015) now applied remotely on syzzfgaudpifwvbpycyi. `list_migrations` confirms contiguous version chain through 20260713145135.

## Edge functions deployed (remote, project syzzfgaudpifwvbpycyi)

- book-court deployed: function id=da716abd-83d7-4723-b0bc-48dcb216b9c2, version=1, status=ACTIVE, verify_jwt=true (per supabase/functions/README.md's deploy list). Entrypoint index.ts plus _shared/{cors,http,app-error,supabase,razorpay,fee-config}.ts bundled.
- verify-payment deployed: function id=2ee29f22-e859-42a0-a642-3dda3cb2c947, version=1, status=ACTIVE, verify_jwt=true. Entrypoint index.ts plus _shared/{cors,http,app-error,supabase,razorpay,fee-config,finalize-court-booking-payment}.ts bundled.
- razorpay-webhook deployed: function id=929276a1-041a-4a67-80b8-3e8d8f963f25, version=1, status=ACTIVE, verify_jwt=false (per README: Razorpay's caller never presents a Supabase JWT, the function's own x-razorpay-signature check is the auth). Entrypoint index.ts plus _shared/{cors,app-error,supabase,razorpay,fee-config,finalize-court-booking-payment}.ts bundled.

All 3 edge functions (book-court, verify-payment, razorpay-webhook) confirmed ACTIVE via list_edge_functions with verify_jwt settings matching supabase/functions/README.md's deploy list exactly.

## Secrets note (not set by this pass)

RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET are not settable via the Supabase MCP tool surface available to this agent (no `secrets set` tool was exposed). The three functions above are deployed but will throw a 500 "Server misconfiguration" at runtime until an operator with dashboard/CLI access sets these per supabase/functions/README.md's "Required secrets" table. Flagging this explicitly so the next agent does not assume a red runtime test means the deploy failed.

## Build/typecheck/lint (step 3)

`pnpm turbo typecheck build lint` was RED on first run (the full Phase 2 builder tree, committed uncommitted on disk, had not been checked against the real remote schema before this pass). Fixed, in order:

1. `packages/types/src/db/database.types.ts` regenerated wholesale via the Supabase MCP `generate_typescript_types` tool against project syzzfgaudpifwvbpycyi (now on migration 0015). That file's own header comment explicitly called for this regeneration once 0009-0015 landed; the previous hand-authored courts/payments section (written ahead of the migrations existing remotely) is now real introspection output.
2. `apps/portal-court/src/lib/supabase/courts-database.types.ts` deleted. Its own header said to delete it at exactly this point ("every type here is written to be a structural no-op at that point"). Its 7 call sites (`client.ts`, `server.ts`, `slots-pricing/page.tsx`, `venue-scope.tsx`, `live-today/walk-in-dialog.tsx`, `venues/page.tsx`, `live-today/page.tsx`) now import `Database as AppDatabase` from `@atlitos/types` directly.
3. `packages/api/src/hooks.ts` (`transitionBooking`, `rateBooking`): the regenerated RPC arg types mark `p_reason`/`p_new_date`/`p_new_slot_start`/`p_remarks` optional (`T | undefined`, matching each SQL param's `DEFAULT NULL`), not `T | null`. The hand-authored pre-regeneration types had these as required `T | null`, so the code passed `?? null`, which no longer type-checks. Changed to `?? undefined` so an omitted arg lets Postgres apply its own default, behaviorally identical.
4. `apps/portal-court/src/app/dashboard/live-today/page.tsx`: `venue_bookings_today` is a view; `supabase gen types` marks every view column nullable because Postgres cannot prove non-null through a join, even though the inner join here guarantees every row has its court_bookings/courts columns populated. Rather than scatter non-null assertions across the JSX, typed the query's `.returns<BookingRow[]>()` explicitly with the true non-null shape, matching the pattern `packages/api/src/hooks.ts` already uses for `CourtBookingQueryRow`.

Re-ran `pnpm turbo typecheck build lint --force` after each fix. Final result: **24/24 tasks green** across all 10 packages (`@atlitos/admin`, `@atlitos/api`, `@atlitos/config`, `@atlitos/mobile`, `@atlitos/portal-court`, `@atlitos/portal-life`, `@atlitos/theme`, `@atlitos/types`, `@atlitos/ui-native`, `@atlitos/ui-web`).

Full Phase 2 builder tree (mobile courts booking flow, portal-court dashboard pages, admin venues/bookings/fee-config resources, shared `BillSummary` component, edge functions, seed data) plus the 4 fixes above committed together in one commit (`5def08c`), since none of it had been committed before this integration pass.
