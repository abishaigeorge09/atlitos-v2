# Phase 2 Integrator Checkpoint

Crash recovery trail for the Courts vertical slice integration pass. Read this file plus `git log` before resuming: it records exactly which migrations/functions have landed remotely on project `syzzfgaudpifwvbpycyi` and what has been committed locally. If a line below exists, that step is done, do not repeat it.

## Migrations applied (remote, project syzzfgaudpifwvbpycyi)

- 0009_courts.sql applied: name=0009_courts, version=20260713144808. Tables venues/venue_photos/venue_staff/courts/court_availability_windows/court_blackouts/court_pricing_rules/court_bookings created, RLS enabled, RPCs (submit_venue_verification, accept_venue_staff_invite, get_court_busy_slots, get_court_available_slots, court_booking_check_in, court_booking_transition, rate_court_booking) and venue branch of admin verification RPCs wired.
- 0010_payments_core.sql applied: name=0010_payments_core, version=20260713144858. Tables payment_intents/ledger_entries (insert only, deferred balance-check constraint trigger)/payout_accounts/transfers/webhook_events/fee_config created, RLS enabled, deferred FK court_bookings.payment_intent_id -> payment_intents added, fee_config seeded (courts.platform_fee_flat=10.00, courts.gst_percent=0.10, sessions.platform_fee_flat=10.00).
- 0011_courts_payment_state.sql applied: name=0011_courts_payment_state, version=20260713144927. Added enum values 'pending_payment' and 'expired' to court_booking_status only (deliberately no other statements in this migration, see file header: new enum values cannot be referenced in the same transaction they were added in).
