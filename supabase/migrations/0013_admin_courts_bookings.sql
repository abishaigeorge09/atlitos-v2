-- ATLITOS v2 — 0013_admin_courts_bookings.sql
-- Domain: courts (extends 0009_courts.sql) + payments (extends
-- 0010_payments_core.sql). Epic AT-4 (Courts and Partner Portal), AT-11
-- (Payments and Ledger), AT-10 (Admin). Consumed by apps/admin's Venues,
-- Fee Config, and Bookings resources (PRD-04 3.4 Fee Config Editor, FR-39
-- through FR-41; PRD-04's own read only Bookings surface for support,
-- which the admin task brief adds and which is not itself an FR-numbered
-- section since it is support tooling, not a moderation/verification
-- surface).
--
-- Two additions:
--
--   1. `court_bookings_select_admin`: 0009_courts.sql's own
--      `court_bookings_select` policy only lets a caller see their own
--      booking (`user_id = auth.uid()`) or a booking on a court they
--      partner/staff at (`is_court_partner_or_staff`). Neither covers an
--      admin looking up a booking for support purposes across every venue.
--      Read only, matching the admin Bookings resource's "read only for
--      support" scope in the task brief; no admin write policy is added,
--      matching CLAUDE.md's financial invariant (booking status transitions
--      stay behind court_booking_transition /
--      court_booking_confirm_payment / court_booking_expire_payment, all
--      already RPC gated, none of which this migration touches).
--
--   2. `admin_update_fee_config`: fee_config already has an admin UPDATE
--      RLS policy (`fee_config_update_admin`, 0010_payments_core.sql), so a
--      direct client `.update()` would in fact pass RLS. It is not used:
--      FR-40 requires the edit to write "one audit_log entry with before
--      and after values", and audit_log has zero authenticated/anon write
--      grant at all (0003_moderation_audit.sql, RLS.md), the same reason
--      0007_admin_verification_rpcs.sql had to wrap the verification
--      approve/reject actions in a SECURITY DEFINER RPC rather than a plain
--      client update. This RPC mirrors that exact pattern: re-checks
--      has_role('admin') (fee_config editing is admin only per the task
--      brief, not moderator, unlike verification review which both roles
--      can action), re-validates FR-41's range rule server side (never
--      trust client side validation alone for a value that determines
--      future money movements platform wide, same spirit as the
--      PRICE_MISMATCH re-pricing rule CLAUDE.md documents for checkout),
--      updates the row in place, and writes exactly one audit_log row
--      capturing before/after. A required change note (task brief: "Fee
--      Config Editor ... required change note") is stored as the
--      audit_log.note column, same column submit/reject already uses for
--      the rejection reason.
--
--      Editing in place (not superseding with a new effective_from row)
--      keeps this consistent with how every edge function in
--      docs/architecture/PAYMENTS.md actually reads fee_config today: by
--      key, not by "most recent effective_from row for this key" (no such
--      point-in-time query exists yet in this codebase). FR-40's "applies
--      only to bookings/sessions/orders created after the change, bills
--      already computed before the change are unaffected" is already true
--      under in-place editing, since court_bookings/sessions/orders store
--      their own computed subtotal/gst/platform_fee/total at booking time,
--      never re-derive them from fee_config after the fact.
-- ============================================================================

create policy court_bookings_select_admin on public.court_bookings
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

-- ============================================================================
-- admin_update_fee_config: see header note 2. p_value is the raw
-- fee_config.value column shape (a fraction for 'percentage' rows, e.g.
-- 0.10 for 10 percent, matching 0010_payments_core.sql's seed; a rupee
-- amount for 'flat' rows). apps/admin converts a percentage row's value
-- to/from a human percent (multiply/divide by 100) at the UI layer only,
-- for FR-41's "between 0 and 100" display and validation; this function
-- re-validates that same range server side against the raw fraction, not
-- trusting the client's arithmetic.
-- ============================================================================

create or replace function public.admin_update_fee_config(
  p_id uuid,
  p_value numeric,
  p_note text
)
returns public.fee_config
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.fee_config;
  v_after public.fee_config;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'NOTE_REQUIRED: a change note is required';
  end if;

  select * into v_before from public.fee_config where id = p_id for update;

  if v_before.id is null then
    raise exception 'NOT_FOUND: fee_config % does not exist', p_id;
  end if;

  if v_before.value_type = 'percentage' and (p_value < 0 or p_value > 1) then
    raise exception 'VALIDATION: percentage fee_config value must be between 0 and 1 (0 to 100 percent)';
  end if;

  if v_before.value_type = 'flat' and p_value < 0 then
    raise exception 'VALIDATION: flat fee_config value must be non negative';
  end if;

  update public.fee_config
  set value = p_value
  where id = p_id
  returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'fee_config.update',
    'fee_config',
    v_after.id,
    jsonb_build_object('value', v_before.value),
    jsonb_build_object('value', v_after.value),
    p_note
  );

  return v_after;
end;
$$;

revoke all on function public.admin_update_fee_config(uuid, numeric, text) from public;
revoke execute on function public.admin_update_fee_config(uuid, numeric, text) from anon;
grant execute on function public.admin_update_fee_config(uuid, numeric, text) to authenticated;
