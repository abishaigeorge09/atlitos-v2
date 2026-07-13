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
