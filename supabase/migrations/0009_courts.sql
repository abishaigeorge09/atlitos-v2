-- ATLITOS v2 — 0009_courts.sql
-- Domain: courts (SCHEMA.md "Domain: courts"; PRD-03 court partner portal;
-- epic AT-4).
--
-- Tables: public.venues, public.venue_photos, public.venue_staff,
--         public.courts, public.court_availability_windows,
--         public.court_blackouts, public.court_pricing_rules,
--         public.court_bookings.
--
-- Naming/shape decisions made here that diverge from the task brief's plain
-- English description, in favor of matching SCHEMA.md / RLS.md /
-- API-MAPPING.md exactly (SCHEMA.md is the column-name source of truth per
-- CLAUDE.md, the same precedence 0001_identity.sql already established):
--
--   1. No separate `court_ratings` table. SCHEMA.md is explicit: "Rating is
--      embedded on the booking row itself (matches the v1 CourtBooking.rating
--      shape and PRD-03's "ratings" surface); there is no separate
--      court_ratings table." `court_bookings.rating`/`remarks` carry this.
--   2. No separate `checkins` table. PRD-03's own data-touched section says
--      "check in is a checked_in_at write on court_bookings, not a separate
--      checkins table." `court_bookings.checked_in_at` carries this.
--   3. No `booking_events` append-only table. Cancellation/walk-in/no-show
--      auditing is `public.audit_log` (0003_moderation_audit.sql), which
--      already is domain-generic and append-only; a second, courts-only
--      audit table would be a duplicate mechanism SCHEMA.md never asked for.
--      (This migration's RPCs below do not themselves write audit_log,
--      since they are called directly by authenticated athletes/partners,
--      not through a service-role edge function; audit_log has zero
--      authenticated/anon write grant by design, see 0003. Wiring
--      partner-cancellation/walk-in audit_log rows is edge-function/admin
--      scope, out of this migration.)
--   4. RPC is named `court_booking_transition`, not `rpc_court_booking_transition`.
--      Matches API-MAPPING.md's "courts" table and RLS.md's "State machine
--      RPCs (session_transition, court_booking_transition, ...)" verbatim,
--      so `packages/api`'s future `useCourts` hook calls the name already
--      documented elsewhere instead of a second, undocumented name.
--   5. Added beyond the brief, because the schema is otherwise non-functional
--      without them (same bootstrap problem 0004_player_and_coach_setup_rpc.sql
--      solved for coach_profiles):
--        - `submit_venue_verification(jsonb)`: the only path that creates a
--          venue + its courts + a verification_requests row. Mirrors
--          `submit_coach_verification` exactly. Without this, no venue could
--          ever be created: RLS.md's stated venues INSERT policy requires
--          `has_role('court_partner')` already true, but nothing else grants
--          that role, and JWT role claims do not update mid-session anyway
--          (RLS.md "Staleness note"), so a bootstrap RPC is the only way.
--        - `accept_venue_staff_invite(uuid)` + a trigger granting the
--          `court_staff` role on acceptance, mirroring SCHEMA.md's own
--          `venue_staff` note ("Granting venue_staff membership also grants
--          the court_staff user_roles row via trigger") combined with RLS.md's
--          "accepted_at set ... via a narrow RPC, not a direct update".
--        - `court_booking_check_in(uuid)`: PRD-03 FR-16's check-in action.
--          Not a status transition (status stays `confirmed`), so it is not
--          folded into `court_booking_transition`.
--        - `get_court_available_slots(court_id, date)`: the task brief's
--          explicit "helper function to compute available slots" ask,
--          windows minus blackouts minus booked, read only. Kept alongside
--          (not instead of) `get_court_busy_slots(court_id, from, to)`
--          because API-MAPPING.md already names the latter for the
--          `courts.get` detail-screen read (busy pairs over a date range,
--          hides whose booking it is); the former is what a single-date
--          `SlotPicker` booking flow needs (actual bookable slots + price).
--   6. `court_bookings.payment_intent_id` is a plain `uuid` column here with
--      no foreign key yet: `public.payment_intents` does not exist until
--      0010_payments_core.sql (payments is a later domain in SCHEMA.md's own
--      ordering, but court_bookings forward-references it). The FK
--      constraint is added by `alter table` at the end of 0010, once the
--      target table exists.
--   7. Ledger writes on booking completion: `docs/architecture/PAYMENTS.md`
--      ("Route: linked accounts and transfers") describes
--      `court_booking_transition(..., 'complete')` as the trigger for an
--      earnings-accrual `ledger_entries` write. CLAUDE.md's financial
--      invariant is unambiguous and takes precedence: "Ledger writes happen
--      only in edge functions running under the service role." This
--      migration's `court_booking_transition` therefore only ever moves
--      `court_bookings.status`; it does not touch `ledger_entries`. Wiring
--      the completion-triggered ledger accrual is left to whichever edge
--      function work follows (a `court-booking-complete` style function
--      calling this RPC's result, or a `notify`-adjacent hook), not to this
--      RPC. Flagging this as a genuine documentation conflict between
--      PAYMENTS.md and CLAUDE.md's house rule, resolved here in the house
--      rule's favor.

-- ============================================================================
-- Extensions
-- ============================================================================

-- Needed for the court_pricing_rules overlap-rejection EXCLUDE constraint
-- below (gist support for the uuid `=` operator, plus this is the first
-- migration in the repo that needs any gist-backed exclusion constraint;
-- coach_availability_windows's own EXCLUDE constraint, SCHEMA.md's coaching
-- domain, is not built yet as of this migration).
create extension if not exists btree_gist with schema extensions;

-- Postgres ships no built-in range type over `time`; a custom range type is
-- the standard way to get a GiST-indexable overlap operator (&&) for `time`
-- columns, needed for the pricing-rule exclusion constraint below.
create type public.timerange as range (subtype = time);

-- ============================================================================
-- Enums
-- ============================================================================

create type public.venue_status as enum ('pending', 'verified', 'rejected');

create type public.court_booking_status as enum (
  'confirmed',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show'
);

create type public.booking_source as enum ('self_service', 'walk_in');

-- ============================================================================
-- Tables
-- ============================================================================

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  partner_user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  address text not null,
  city text not null,
  pincode text not null,
  lat double precision,
  lng double precision,
  description text,
  status public.venue_status not null default 'pending',
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_venues_partner_user_id on public.venues (partner_user_id);
create index idx_venues_status_city on public.venues (status, city);

create trigger venues_set_updated_at
  before update on public.venues
  for each row execute function public.set_updated_at();

create table public.venue_photos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  storage_path text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index idx_venue_photos_venue_id on public.venue_photos (venue_id);

create table public.venue_staff (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (venue_id, user_id)
);

create index idx_venue_staff_venue_id on public.venue_staff (venue_id);
create index idx_venue_staff_user_id on public.venue_staff (user_id);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  sport public.sport not null,
  name text not null,
  capacity int,
  base_price_per_hour numeric(12, 2) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_courts_venue_id on public.courts (venue_id);
create index idx_courts_sport_active on public.courts (sport, active);

create trigger courts_set_updated_at
  before update on public.courts
  for each row execute function public.set_updated_at();

create table public.court_availability_windows (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  open_time time not null,
  close_time time not null,
  slot_duration_minutes int not null default 60,
  created_at timestamptz not null default now(),
  check (close_time > open_time)
);

create index idx_court_availability_court_id on public.court_availability_windows (court_id);

create table public.court_blackouts (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  reason text not null,
  created_at timestamptz not null default now()
);

create index idx_court_blackouts_court_id on public.court_blackouts (court_id);

create table public.court_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  day_of_week_start smallint not null check (day_of_week_start between 0 and 6),
  day_of_week_end smallint not null check (day_of_week_end between 0 and 6),
  time_start time not null,
  time_end time not null,
  multiplier numeric(4, 2),
  fixed_price numeric(12, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (multiplier is not null or fixed_price is not null),
  check (time_end > time_start)
);

create index idx_court_pricing_rules_court_id on public.court_pricing_rules (court_id);

-- Overlapping active rules on the same court, overlapping day-of-week range
-- and overlapping time window, are rejected at write time (SCHEMA.md,
-- PRD-03 FR-11). btree_gist supplies the gist opclass for the uuid `=` term;
-- the generic range gist opclass (available for any range type, custom or
-- built-in) covers int4range and public.timerange.
alter table public.court_pricing_rules
  add constraint court_pricing_rules_no_overlap
  exclude using gist (
    court_id with =,
    int4range(day_of_week_start::int, day_of_week_end::int, '[]') with &&,
    public.timerange(time_start, time_end, '[]') with &&
  )
  where (active);

create table public.court_bookings (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  booking_source public.booking_source not null default 'self_service',
  walk_in_name text,
  walk_in_phone text,
  created_by_staff_id uuid references public.users (id) on delete set null,
  date date not null,
  slot_start time not null,
  slot_end time not null,
  subtotal numeric(12, 2) not null,
  gst numeric(12, 2) not null,
  platform_fee numeric(12, 2) not null,
  total numeric(12, 2) not null,
  status public.court_booking_status not null default 'confirmed',
  checked_in_at timestamptz,
  cancellation_reason text,
  rating smallint check (rating between 1 and 5),
  remarks text,
  -- FK to public.payment_intents added by 0010_payments_core.sql, see header note 6.
  payment_intent_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_end > slot_start)
);

-- The exact concurrency guard PLAN.md/SCHEMA.md name: a cancelled booking
-- frees the row for a new booking on the same slot; every other status
-- (including no_show/rescheduled/completed) keeps the slot permanently held.
create unique index court_bookings_court_date_slot_unique
  on public.court_bookings (court_id, date, slot_start)
  where (status <> 'cancelled');

create index idx_court_bookings_court_date on public.court_bookings (court_id, date);
create index idx_court_bookings_user_id on public.court_bookings (user_id);

create trigger court_bookings_set_updated_at
  before update on public.court_bookings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- venue_bookings_today: the "idx_court_bookings_venue_date via a join view"
-- SCHEMA.md calls out (court_bookings has no venue_id column of its own,
-- only court_id; the partner Today dashboard reads by venue). Declared
-- security_invoker so the underlying court_bookings/courts RLS still applies
-- to whichever authenticated user queries it (unlike public_profiles /
-- coach_profiles_public in 0001_identity.sql, which are deliberately
-- security_invoker = false bypass views; this one is not a bypass, it is a
-- convenience join that must stay exactly as restricted as the base tables).
-- ============================================================================

create view public.venue_bookings_today
with (security_invoker = true) as
select
  cb.*,
  c.venue_id,
  c.sport as court_sport,
  c.name as court_name
from public.court_bookings cb
join public.courts c on c.id = cb.court_id;

grant select on public.venue_bookings_today to authenticated;

-- ============================================================================
-- Helper: is the caller the owning court_partner, or accepted court_staff,
-- for the venue that owns this court? Reused by RLS policies and by the
-- state-machine RPCs below. Not SECURITY DEFINER: every condition it checks
-- (partner_user_id = auth.uid(), or an accepted venue_staff row with
-- user_id = auth.uid()) is exactly the same "own row" condition the base
-- tables' own RLS policies already allow the caller to see, so a plain STABLE
-- function reads correctly under the caller's own RLS, matching is_guest()'s
-- pattern in 0001_identity.sql rather than has_role()'s SECURITY DEFINER one.
-- ============================================================================

create function public.is_court_partner_or_staff(p_court_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = p_court_id
      and (
        (public.has_role('court_partner') and v.partner_user_id = auth.uid())
        or (
          public.has_role('court_staff')
          and exists (
            select 1 from public.venue_staff vs
            where vs.venue_id = v.id
              and vs.user_id = auth.uid()
              and vs.accepted_at is not null
          )
        )
      )
  );
$$;

-- ============================================================================
-- submit_venue_verification: bootstrap RPC, mirrors submit_coach_verification
-- (0004_player_and_coach_setup_rpc.sql). Grants the court_partner role,
-- creates the venue (status='pending'), its courts, optional photos, and the
-- verification_requests row, atomically. See header note 5.
-- ============================================================================

create or replace function public.submit_venue_verification(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue_id uuid;
  v_request_id uuid;
  v_court jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_payload ->> 'name' is null
    or p_payload ->> 'address' is null
    or p_payload ->> 'city' is null
    or p_payload ->> 'pincode' is null
  then
    raise exception 'VALIDATION: name, address, city, and pincode are required';
  end if;

  if jsonb_array_length(coalesce(p_payload -> 'courts', '[]'::jsonb)) < 1 then
    raise exception 'VALIDATION: at least one court is required';
  end if;

  insert into public.user_roles (user_id, role)
  values (auth.uid(), 'court_partner')
  on conflict (user_id, role) do nothing;

  insert into public.venues (
    partner_user_id, name, address, city, pincode, lat, lng, description, status
  )
  values (
    auth.uid(),
    p_payload ->> 'name',
    p_payload ->> 'address',
    p_payload ->> 'city',
    p_payload ->> 'pincode',
    nullif(p_payload ->> 'lat', '')::double precision,
    nullif(p_payload ->> 'lng', '')::double precision,
    p_payload ->> 'description',
    'pending'
  )
  returning id into v_venue_id;

  for v_court in select * from jsonb_array_elements(p_payload -> 'courts')
  loop
    insert into public.courts (venue_id, sport, name, capacity, base_price_per_hour)
    values (
      v_venue_id,
      (v_court ->> 'sport')::public.sport,
      v_court ->> 'name',
      nullif(v_court ->> 'capacity', '')::int,
      (v_court ->> 'basePricePerHour')::numeric(12, 2)
    );
  end loop;

  insert into public.venue_photos (venue_id, storage_path, position)
  select v_venue_id, item ->> 'storagePath', coalesce((item ->> 'position')::smallint, 0)
  from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) as item
  where item ->> 'storagePath' is not null;

  insert into public.verification_requests (applicant_type, applicant_id, status, payload)
  values ('venue', v_venue_id, 'pending_review', p_payload)
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.submit_venue_verification(jsonb) from public;
revoke execute on function public.submit_venue_verification(jsonb) from anon;
grant execute on function public.submit_venue_verification(jsonb) to authenticated;

-- ============================================================================
-- venues admin-field lock: status/rejection_reason change only via the
-- verification RPCs below (real admin caller), mirrors
-- lock_coach_profile_admin_fields in 0001_identity.sql.
-- ============================================================================

create function public.lock_venue_admin_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.status is distinct from old.status
    or new.rejection_reason is distinct from old.rejection_reason
  ) and not public.has_role('admin') then
    raise exception 'FIELD_LOCKED: status and rejection_reason change only via admin verification';
  end if;
  return new;
end;
$$;

create trigger venues_lock_admin_fields
  before update on public.venues
  for each row execute function public.lock_venue_admin_fields();

-- ============================================================================
-- accept_venue_staff_invite: the invited staff member's own action
-- (RLS.md: "accepted_at set by the invited staff member accepting, via a
-- narrow RPC, not a direct update"). The role grant itself is a trigger
-- side-effect (SCHEMA.md: "Granting venue_staff membership also grants the
-- court_staff user_roles row via trigger"), not done in the RPC body, so any
-- future direct update path (there is none today) would still grant the role
-- correctly.
-- ============================================================================

create function public.grant_court_staff_role_on_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.accepted_at is not null and old.accepted_at is null then
    insert into public.user_roles (user_id, role)
    values (new.user_id, 'court_staff')
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end;
$$;

create trigger venue_staff_grant_role_on_accept
  after update on public.venue_staff
  for each row execute function public.grant_court_staff_role_on_accept();

create or replace function public.accept_venue_staff_invite(p_venue_staff_id uuid)
returns public.venue_staff
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.venue_staff;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_row from public.venue_staff where id = p_venue_staff_id for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND: venue_staff invite % does not exist', p_venue_staff_id;
  end if;

  if v_row.user_id <> auth.uid() then
    raise exception 'FORBIDDEN: not the invited staff member';
  end if;

  if v_row.accepted_at is not null then
    raise exception 'ALREADY_ACCEPTED: invite already accepted';
  end if;

  update public.venue_staff
  set accepted_at = now()
  where id = p_venue_staff_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.accept_venue_staff_invite(uuid) from public;
revoke execute on function public.accept_venue_staff_invite(uuid) from anon;
grant execute on function public.accept_venue_staff_invite(uuid) to authenticated;

-- ============================================================================
-- get_court_busy_slots: API-MAPPING.md "courts.get" — occupied (date,
-- slot_start) pairs only, never the booking rows themselves, so a browsing
-- athlete never learns who else booked a slot. Read only, SECURITY DEFINER
-- to see past what court_bookings' own RLS would let the caller see.
-- ============================================================================

create or replace function public.get_court_busy_slots(p_court_id uuid, p_from date, p_to date)
returns table (date date, slot_start time)
language sql
stable
security definer
set search_path = public
as $$
  select b.date, b.slot_start
  from public.court_bookings b
  where b.court_id = p_court_id
    and b.date between p_from and p_to
    and b.status <> 'cancelled'
  order by b.date, b.slot_start;
$$;

-- ============================================================================
-- get_court_available_slots: task brief's explicit ask, "compute available
-- slots for a court+date (windows minus blackouts minus booked)". Distinct
-- from get_court_busy_slots above: this returns the bookable slot list (with
-- a price per slot, peak rules applied) for a single date, which is what a
-- SlotPicker booking flow needs; the busy-pairs function above is what the
-- court detail/calendar read needs over a range. Read only, SECURITY
-- DEFINER for the same "hide whose booking this is" reason.
-- ============================================================================

create or replace function public.get_court_available_slots(p_court_id uuid, p_date date)
returns table (slot_start time, slot_end time, price numeric(12, 2))
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dow smallint := extract(dow from p_date)::smallint;
  v_court public.courts%rowtype;
begin
  select * into v_court from public.courts where id = p_court_id;

  if v_court.id is null or not v_court.active then
    return;
  end if;

  if exists (
    select 1 from public.court_blackouts cb
    where cb.court_id = p_court_id
      and p_date between cb.start_date and cb.end_date
  ) then
    return;
  end if;

  return query
  with windows as (
    select w.open_time, w.close_time, w.slot_duration_minutes
    from public.court_availability_windows w
    where w.court_id = p_court_id and w.day_of_week = v_dow
  ),
  generated as (
    select
      (w.open_time + (n * (w.slot_duration_minutes || ' minutes')::interval))::time as gen_start,
      (w.open_time + (n * (w.slot_duration_minutes || ' minutes')::interval)
        + (w.slot_duration_minutes || ' minutes')::interval)::time as gen_end
    from windows w
    cross join lateral generate_series(
      0,
      floor(extract(epoch from (w.close_time - w.open_time)) / (w.slot_duration_minutes * 60))::int - 1
    ) as n
  )
  select
    g.gen_start,
    g.gen_end,
    coalesce(
      (
        select case when r.fixed_price is not null then r.fixed_price
                    else v_court.base_price_per_hour * r.multiplier
               end
        from public.court_pricing_rules r
        where r.court_id = p_court_id
          and r.active
          and v_dow between r.day_of_week_start and r.day_of_week_end
          and g.gen_start >= r.time_start
          and g.gen_start < r.time_end
        order by r.created_at desc
        limit 1
      ),
      v_court.base_price_per_hour
    ) as price
  from generated g
  where not exists (
    select 1 from public.court_bookings b
    where b.court_id = p_court_id
      and b.date = p_date
      and b.slot_start = g.gen_start
      and b.status <> 'cancelled'
  )
  order by g.gen_start;
end;
$$;

-- ============================================================================
-- court_booking_check_in: PRD-03 FR-16. Not a status transition (status
-- stays 'confirmed'), so kept separate from court_booking_transition below.
-- ============================================================================

create or replace function public.court_booking_check_in(p_booking_id uuid)
returns public.court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.court_bookings;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_booking from public.court_bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'NOT_FOUND: court_booking % does not exist', p_booking_id;
  end if;

  if not public.is_court_partner_or_staff(v_booking.court_id) then
    raise exception 'FORBIDDEN: venue partner or staff role required';
  end if;

  if v_booking.status <> 'confirmed' then
    raise exception 'INVALID_TRANSITION: court_booking % is not confirmed', p_booking_id;
  end if;

  if v_booking.checked_in_at is not null then
    raise exception 'ALREADY_CHECKED_IN: court_booking % is already checked in', p_booking_id;
  end if;

  update public.court_bookings
  set checked_in_at = now()
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke all on function public.court_booking_check_in(uuid) from public;
revoke execute on function public.court_booking_check_in(uuid) from anon;
grant execute on function public.court_booking_check_in(uuid) to authenticated;

-- ============================================================================
-- court_booking_transition: the state-machine RPC named in API-MAPPING.md
-- and RLS.md. confirmed -> (completed | cancelled | rescheduled | no_show).
-- Raises INVALID_TRANSITION on any other starting state, SLOT_TAKEN on a
-- reschedule conflict (the same partial unique index above, caught as
-- Postgres 23505). See header note 7 on why this never writes ledger_entries.
--
-- Cancel/no_show permission model (PRD-03 FR-18/FR-19): the athlete
-- (user_id = auth.uid()) may cancel their own future booking; only venue
-- partner/staff may cancel/record a booking whose slot_start has already
-- passed (that becomes a no_show instead of a cancellation, per FR-18) or
-- explicitly mark no_show, or mark a booking completed.
-- ============================================================================

create or replace function public.court_booking_transition(
  p_booking_id uuid,
  p_action text,
  p_reason text default null,
  p_new_date date default null,
  p_new_slot_start time default null
)
returns public.court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.court_bookings;
  v_is_owner boolean;
  v_is_staff boolean;
  v_is_past boolean;
  v_new_slot_end time;
  v_new_booking public.court_bookings;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_booking from public.court_bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'NOT_FOUND: court_booking % does not exist', p_booking_id;
  end if;

  v_is_owner := v_booking.user_id is not null and v_booking.user_id = auth.uid();
  v_is_staff := public.is_court_partner_or_staff(v_booking.court_id);

  if not (v_is_owner or v_is_staff) then
    raise exception 'FORBIDDEN: not the booking athlete or venue partner/staff';
  end if;

  v_is_past := v_booking.date < current_date
    or (v_booking.date = current_date and v_booking.slot_start <= current_time);

  if p_action = 'cancel' then
    if v_booking.status <> 'confirmed' then
      raise exception 'INVALID_TRANSITION: court_booking % is not confirmed', p_booking_id;
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'REASON_REQUIRED: a cancellation reason is required';
    end if;

    if v_is_past then
      if not v_is_staff then
        raise exception 'FORBIDDEN: only venue partner or staff can record a past booking as no_show';
      end if;
      update public.court_bookings
      set status = 'no_show', cancellation_reason = p_reason
      where id = p_booking_id
      returning * into v_booking;
    else
      update public.court_bookings
      set status = 'cancelled', cancellation_reason = p_reason
      where id = p_booking_id
      returning * into v_booking;
    end if;

  elsif p_action = 'no_show' then
    if not v_is_staff then
      raise exception 'FORBIDDEN: venue partner or staff role required';
    end if;
    if v_booking.status <> 'confirmed' then
      raise exception 'INVALID_TRANSITION: court_booking % is not confirmed', p_booking_id;
    end if;

    update public.court_bookings
    set status = 'no_show'
    where id = p_booking_id
    returning * into v_booking;

  elsif p_action = 'complete' then
    if not v_is_staff then
      raise exception 'FORBIDDEN: venue partner or staff role required';
    end if;
    if v_booking.status <> 'confirmed' then
      raise exception 'INVALID_TRANSITION: court_booking % is not confirmed', p_booking_id;
    end if;

    update public.court_bookings
    set status = 'completed'
    where id = p_booking_id
    returning * into v_booking;

  elsif p_action = 'reschedule' then
    if v_booking.status <> 'confirmed' then
      raise exception 'INVALID_TRANSITION: court_booking % is not confirmed', p_booking_id;
    end if;
    if p_new_date is null or p_new_slot_start is null then
      raise exception 'VALIDATION: new date and slot_start are required to reschedule';
    end if;

    v_new_slot_end := p_new_slot_start + (v_booking.slot_end - v_booking.slot_start);

    begin
      insert into public.court_bookings (
        court_id, user_id, booking_source, walk_in_name, walk_in_phone, created_by_staff_id,
        date, slot_start, slot_end, subtotal, gst, platform_fee, total, status, payment_intent_id
      )
      values (
        v_booking.court_id, v_booking.user_id, v_booking.booking_source, v_booking.walk_in_name,
        v_booking.walk_in_phone, v_booking.created_by_staff_id,
        p_new_date, p_new_slot_start, v_new_slot_end,
        v_booking.subtotal, v_booking.gst, v_booking.platform_fee, v_booking.total,
        'confirmed', v_booking.payment_intent_id
      )
      returning * into v_new_booking;
    exception
      when unique_violation then
        raise exception 'SLOT_TAKEN: court % is already booked for % %', v_booking.court_id, p_new_date, p_new_slot_start;
    end;

    update public.court_bookings
    set status = 'rescheduled'
    where id = p_booking_id;

    v_booking := v_new_booking;

  else
    raise exception 'INVALID_TRANSITION: unknown action %', p_action;
  end if;

  return v_booking;
end;
$$;

revoke all on function public.court_booking_transition(uuid, text, text, date, time) from public;
revoke execute on function public.court_booking_transition(uuid, text, text, date, time) from anon;
grant execute on function public.court_booking_transition(uuid, text, text, date, time) to authenticated;

-- ============================================================================
-- rate_court_booking: API-MAPPING.md "courts.rate". Only the booking athlete,
-- only from 'completed', once (ALREADY_RATED on a second call).
-- ============================================================================

create or replace function public.rate_court_booking(
  p_booking_id uuid,
  p_rating smallint,
  p_remarks text default null
)
returns public.court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.court_bookings;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'VALIDATION: rating must be between 1 and 5';
  end if;

  select * into v_booking from public.court_bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'NOT_FOUND: court_booking % does not exist', p_booking_id;
  end if;

  if v_booking.user_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: only the booking athlete can rate this booking';
  end if;

  if v_booking.status <> 'completed' then
    raise exception 'INVALID_TRANSITION: court_booking % is not completed', p_booking_id;
  end if;

  if v_booking.rating is not null then
    raise exception 'ALREADY_RATED: court_booking % has already been rated', p_booking_id;
  end if;

  update public.court_bookings
  set rating = p_rating, remarks = p_remarks
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke all on function public.rate_court_booking(uuid, smallint, text) from public;
revoke execute on function public.rate_court_booking(uuid, smallint, text) from anon;
grant execute on function public.rate_court_booking(uuid, smallint, text) to authenticated;

-- ============================================================================
-- Wire the 'venue' branch of the two admin verification RPCs
-- (0007_admin_verification_rpcs.sql), which shipped as deliberate no-ops
-- until public.venues existed (see that migration's header note and
-- PHASE-1-STATUS.md's handoff: "whoever builds the courts ... migrations ...
-- must revisit those two no-op branches and wire the entity-status
-- mirroring"). Re-declared here with `create or replace function`, same
-- signature, coach branch unchanged, upa branch still a no-op until
-- upa_applications exists.
-- ============================================================================

create or replace function public.admin_approve_verification_request(p_request_id uuid)
returns public.verification_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.verification_requests;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  select * into v_request from public.verification_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'NOT_FOUND: verification_request % does not exist', p_request_id;
  end if;

  if v_request.status <> 'pending_review' then
    raise exception 'INVALID_TRANSITION: verification_request % is not pending_review', p_request_id;
  end if;

  update public.verification_requests
  set status = 'approved', reviewer_id = auth.uid(), reviewed_at = now()
  where id = p_request_id
  returning * into v_request;

  if v_request.applicant_type = 'coach' then
    update public.coach_profiles set status = 'verified' where user_id = v_request.applicant_id;
  elsif v_request.applicant_type = 'venue' then
    update public.venues set status = 'verified' where id = v_request.applicant_id;
  end if;
  -- 'upa': no-op until public.upa_applications exists.

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    'verification.approve',
    'verification_requests',
    v_request.id,
    jsonb_build_object('status', 'pending_review'),
    jsonb_build_object('status', 'approved')
  );

  return v_request;
end;
$$;

create or replace function public.admin_reject_verification_request(p_request_id uuid, p_reason text)
returns public.verification_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.verification_requests;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: a rejection reason is required';
  end if;

  select * into v_request from public.verification_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'NOT_FOUND: verification_request % does not exist', p_request_id;
  end if;

  if v_request.status <> 'pending_review' then
    raise exception 'INVALID_TRANSITION: verification_request % is not pending_review', p_request_id;
  end if;

  update public.verification_requests
  set status = 'rejected', reviewer_id = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_request_id
  returning * into v_request;

  if v_request.applicant_type = 'coach' then
    update public.coach_profiles set status = 'rejected' where user_id = v_request.applicant_id;
  elsif v_request.applicant_type = 'venue' then
    update public.venues set status = 'rejected', rejection_reason = p_reason where id = v_request.applicant_id;
  end if;
  -- 'upa': no-op until public.upa_applications exists.

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'verification.reject',
    'verification_requests',
    v_request.id,
    jsonb_build_object('status', 'pending_review'),
    jsonb_build_object('status', 'rejected'),
    p_reason
  );

  return v_request;
end;
$$;

-- 0007 already granted/revoked execute for these two signatures; re-running
-- the same statements here is a harmless no-op safety net in case this
-- migration is ever the first to create them in a fresh environment.
revoke execute on function public.admin_approve_verification_request(uuid) from public;
revoke execute on function public.admin_reject_verification_request(uuid, text) from public;
revoke execute on function public.admin_approve_verification_request(uuid) from anon;
revoke execute on function public.admin_reject_verification_request(uuid, text) from anon;
grant execute on function public.admin_approve_verification_request(uuid) to authenticated;
grant execute on function public.admin_reject_verification_request(uuid, text) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.venues enable row level security;
alter table public.venue_photos enable row level security;
alter table public.venue_staff enable row level security;
alter table public.courts enable row level security;
alter table public.court_availability_windows enable row level security;
alter table public.court_blackouts enable row level security;
alter table public.court_pricing_rules enable row level security;
alter table public.court_bookings enable row level security;

-- venues: verified public; own always; admin all. Insert is defense-in-depth
-- only (bootstrap goes through submit_venue_verification above, same
-- relationship coach_profiles_insert_own has to submit_coach_verification).
create policy venues_select_public on public.venues
  for select to anon, authenticated
  using (status = 'verified');

create policy venues_select_own on public.venues
  for select to authenticated
  using (partner_user_id = auth.uid());

create policy venues_select_admin on public.venues
  for select to authenticated
  using (public.has_role('admin'));

create policy venues_insert_own on public.venues
  for insert to authenticated
  with check (public.has_role('court_partner') and partner_user_id = auth.uid());

create policy venues_update_own on public.venues
  for update to authenticated
  using (public.has_role('court_partner') and partner_user_id = auth.uid())
  with check (public.has_role('court_partner') and partner_user_id = auth.uid());

-- venue_photos: same visibility as the parent venue; owning partner CRUD.
create policy venue_photos_select_public on public.venue_photos
  for select to anon, authenticated
  using (
    exists (select 1 from public.venues v where v.id = venue_photos.venue_id and v.status = 'verified')
  );

create policy venue_photos_select_own on public.venue_photos
  for select to authenticated
  using (
    exists (select 1 from public.venues v where v.id = venue_photos.venue_id and v.partner_user_id = auth.uid())
  );

create policy venue_photos_insert_own on public.venue_photos
  for insert to authenticated
  with check (
    public.has_role('court_partner')
    and exists (select 1 from public.venues v where v.id = venue_photos.venue_id and v.partner_user_id = auth.uid())
  );

create policy venue_photos_update_own on public.venue_photos
  for update to authenticated
  using (
    exists (select 1 from public.venues v where v.id = venue_photos.venue_id and v.partner_user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.venues v where v.id = venue_photos.venue_id and v.partner_user_id = auth.uid())
  );

create policy venue_photos_delete_own on public.venue_photos
  for delete to authenticated
  using (
    exists (select 1 from public.venues v where v.id = venue_photos.venue_id and v.partner_user_id = auth.uid())
  );

-- venue_staff: own venue (partner) or own membership row (staff). Insert
-- (invite) by the owning partner only. No update policy for authenticated at
-- all: accepted_at is set only via accept_venue_staff_invite above (owner
-- privilege bypass), matching RLS.md "not a direct update".
create policy venue_staff_select_partner on public.venue_staff
  for select to authenticated
  using (
    exists (select 1 from public.venues v where v.id = venue_staff.venue_id and v.partner_user_id = auth.uid())
  );

create policy venue_staff_select_own on public.venue_staff
  for select to authenticated
  using (user_id = auth.uid());

create policy venue_staff_insert_partner on public.venue_staff
  for insert to authenticated
  with check (
    public.has_role('court_partner')
    and exists (select 1 from public.venues v where v.id = venue_staff.venue_id and v.partner_user_id = auth.uid())
  );

-- courts: verified-venue public; own venue always; admin all. court_staff
-- gets none of these (RLS.md: inventory management is partner-only).
create policy courts_select_public on public.courts
  for select to anon, authenticated
  using (exists (select 1 from public.venues v where v.id = courts.venue_id and v.status = 'verified'));

create policy courts_select_own on public.courts
  for select to authenticated
  using (exists (select 1 from public.venues v where v.id = courts.venue_id and v.partner_user_id = auth.uid()));

create policy courts_select_admin on public.courts
  for select to authenticated
  using (public.has_role('admin'));

create policy courts_insert_own on public.courts
  for insert to authenticated
  with check (
    public.has_role('court_partner')
    and exists (select 1 from public.venues v where v.id = courts.venue_id and v.partner_user_id = auth.uid())
  );

create policy courts_update_own on public.courts
  for update to authenticated
  using (
    public.has_role('court_partner')
    and exists (select 1 from public.venues v where v.id = courts.venue_id and v.partner_user_id = auth.uid())
  )
  with check (
    public.has_role('court_partner')
    and exists (select 1 from public.venues v where v.id = courts.venue_id and v.partner_user_id = auth.uid())
  );

create policy courts_delete_own on public.courts
  for delete to authenticated
  using (
    public.has_role('court_partner')
    and exists (select 1 from public.venues v where v.id = courts.venue_id and v.partner_user_id = auth.uid())
  );

-- court_availability_windows / court_blackouts / court_pricing_rules: same
-- shape, ownership via courts.venue_id -> venues.partner_user_id.
create policy court_availability_windows_select_public on public.court_availability_windows
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_availability_windows.court_id and v.status = 'verified'
    )
  );

create policy court_availability_windows_select_own on public.court_availability_windows
  for select to authenticated
  using (
    exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_availability_windows.court_id and v.partner_user_id = auth.uid()
    )
  );

create policy court_availability_windows_write_own on public.court_availability_windows
  for all to authenticated
  using (
    public.has_role('court_partner')
    and exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_availability_windows.court_id and v.partner_user_id = auth.uid()
    )
  )
  with check (
    public.has_role('court_partner')
    and exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_availability_windows.court_id and v.partner_user_id = auth.uid()
    )
  );

create policy court_blackouts_select_public on public.court_blackouts
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_blackouts.court_id and v.status = 'verified'
    )
  );

create policy court_blackouts_select_own on public.court_blackouts
  for select to authenticated
  using (
    exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_blackouts.court_id and v.partner_user_id = auth.uid()
    )
  );

create policy court_blackouts_write_own on public.court_blackouts
  for all to authenticated
  using (
    public.has_role('court_partner')
    and exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_blackouts.court_id and v.partner_user_id = auth.uid()
    )
  )
  with check (
    public.has_role('court_partner')
    and exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_blackouts.court_id and v.partner_user_id = auth.uid()
    )
  );

create policy court_pricing_rules_select_public on public.court_pricing_rules
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_pricing_rules.court_id and v.status = 'verified'
    )
  );

create policy court_pricing_rules_select_own on public.court_pricing_rules
  for select to authenticated
  using (
    exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_pricing_rules.court_id and v.partner_user_id = auth.uid()
    )
  );

create policy court_pricing_rules_write_own on public.court_pricing_rules
  for all to authenticated
  using (
    public.has_role('court_partner')
    and exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_pricing_rules.court_id and v.partner_user_id = auth.uid()
    )
  )
  with check (
    public.has_role('court_partner')
    and exists (
      select 1 from public.courts c join public.venues v on v.id = c.venue_id
      where c.id = court_pricing_rules.court_id and v.partner_user_id = auth.uid()
    )
  );

-- court_bookings: partner (own venue's courts) or staff (assigned venue's
-- courts) or the athlete who booked. No INSERT/UPDATE/DELETE policy for
-- authenticated at all: book-court (edge function, service role) inserts;
-- court_booking_transition / court_booking_check_in / rate_court_booking
-- (all SECURITY DEFINER, owner-privilege) are the only writers, exactly as
-- RLS.md specifies.
create policy court_bookings_select on public.court_bookings
  for select to authenticated
  using (
    public.is_court_partner_or_staff(court_id)
    or user_id = auth.uid()
  );
