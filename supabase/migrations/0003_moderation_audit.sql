-- ATLITOS v2 — 0003_moderation_audit.sql
-- Domain: moderation/audit (SCHEMA.md "Domain: moderation/audit").
--
-- Tables: public.verification_requests, public.audit_log,
--         public.feature_flags, public.support_tickets.
--
-- (reports is part of SCHEMA.md's moderation/audit domain too, but is out
-- of scope for this migration: it is scoped to clip/comment moderation,
-- which belongs with the clutch domain migration, not identity/AT-1.)

-- ============================================================================
-- Enums
-- ============================================================================

create type public.verification_status as enum ('pending_review', 'approved', 'rejected');

create type public.applicant_type as enum ('coach', 'venue', 'upa');

create type public.ticket_status as enum ('open', 'resolved');

-- ============================================================================
-- Tables
-- ============================================================================

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  applicant_type public.applicant_type not null,
  applicant_id uuid not null,
  status public.verification_status not null default 'pending_review',
  payload jsonb not null,
  reviewer_id uuid references public.users (id) on delete set null,
  rejection_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_verification_requests_status_type on public.verification_requests (status, applicant_type);
create index idx_verification_requests_applicant on public.verification_requests (applicant_type, applicant_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index idx_audit_log_actor_created_at on public.audit_log (actor_id, created_at desc);
create index idx_audit_log_entity on public.audit_log (entity_type, entity_id);

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  submitter_id uuid not null references public.users (id) on delete cascade,
  subject text not null,
  description text not null,
  status public.ticket_status not null default 'open',
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_support_tickets_status on public.support_tickets (status);

-- ============================================================================
-- coach_profiles.sport immutability (SCHEMA.md: "immutable after first
-- verification_requests submission (enforced by trigger, not just app
-- logic)"), added here because public.verification_requests now exists.
-- ============================================================================

create function public.lock_coach_sport_after_submission()
returns trigger
language plpgsql
as $$
begin
  if new.sport is distinct from old.sport
    and exists (
      select 1 from public.verification_requests
      where applicant_type = 'coach' and applicant_id = old.user_id
    )
  then
    raise exception 'SPORT_LOCKED: coach sport is immutable after the first verification submission';
  end if;
  return new;
end;
$$;

create trigger coach_profiles_lock_sport
  before update on public.coach_profiles
  for each row execute function public.lock_coach_sport_after_submission();

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.verification_requests enable row level security;
alter table public.audit_log enable row level security;
alter table public.feature_flags enable row level security;
alter table public.support_tickets enable row level security;

-- verification_requests: own linked applicant rows; admin/moderator reads
-- and reviews all. Only the 'coach' applicant_type is wired to an ownership
-- check here (applicant_id = coach_profiles.user_id = auth.uid()); 'venue'
-- and 'upa' ownership checks are added once public.venues and
-- public.upa_applications exist in their respective domain migrations.
create policy verification_requests_select_own_coach on public.verification_requests
  for select to authenticated
  using (applicant_type = 'coach' and applicant_id = auth.uid());

create policy verification_requests_select_admin on public.verification_requests
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

create policy verification_requests_insert_own_coach on public.verification_requests
  for insert to authenticated
  with check (applicant_type = 'coach' and applicant_id = auth.uid() and public.has_role('coach'));

create policy verification_requests_update_admin on public.verification_requests
  for update to authenticated
  using (public.has_role('admin') or public.has_role('moderator'))
  with check (public.has_role('admin') or public.has_role('moderator'));

-- audit_log: admin/moderator read only; append-only, and only service_role
-- ever inserts (bypasses RLS), so no INSERT/UPDATE/DELETE policy exists for
-- anon/authenticated at all.
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

-- feature_flags: readable by admin/moderator only (not publicly
-- discoverable per RLS.md); writable by admin only, flags are a kill switch.
create policy feature_flags_select_admin on public.feature_flags
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

create policy feature_flags_insert_admin on public.feature_flags
  for insert to authenticated
  with check (public.has_role('admin'));

create policy feature_flags_update_admin on public.feature_flags
  for update to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- support_tickets: own rows read/insert; admin/moderator reads all and
-- resolves.
create policy support_tickets_select_own on public.support_tickets
  for select to authenticated
  using (submitter_id = auth.uid());

create policy support_tickets_select_admin on public.support_tickets
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

create policy support_tickets_insert_own on public.support_tickets
  for insert to authenticated
  with check (submitter_id = auth.uid());

create policy support_tickets_update_admin on public.support_tickets
  for update to authenticated
  using (public.has_role('admin') or public.has_role('moderator'))
  with check (public.has_role('admin') or public.has_role('moderator'));
