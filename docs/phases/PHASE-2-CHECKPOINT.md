# Phase 2 Integrator Checkpoint

Crash recovery trail for the Courts vertical slice integration pass. Read this file plus `git log` before resuming: it records exactly which migrations/functions have landed remotely on project `syzzfgaudpifwvbpycyi` and what has been committed locally. If a line below exists, that step is done, do not repeat it.

## Migrations applied (remote, project syzzfgaudpifwvbpycyi)

- 0009_courts.sql applied: name=0009_courts, version=20260713144808. Tables venues/venue_photos/venue_staff/courts/court_availability_windows/court_blackouts/court_pricing_rules/court_bookings created, RLS enabled, RPCs (submit_venue_verification, accept_venue_staff_invite, get_court_busy_slots, get_court_available_slots, court_booking_check_in, court_booking_transition, rate_court_booking) and venue branch of admin verification RPCs wired.
