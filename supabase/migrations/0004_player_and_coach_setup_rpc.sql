-- ATLITOS v2 — 0004_player_and_coach_setup_rpc.sql
-- Domain: identity/roles + coaching onboarding (API-MAPPING.md "profile":
-- setupPlayer -> complete_player_setup, setupCoach -> submit_coach_verification).
--
-- Phase 1 scope note: docs/architecture/SCHEMA.md's coaching domain also
-- defines public.session_types and public.coach_availability_windows, but
-- no migration has created those tables yet (only coach_profiles and
-- coach_certificates were pulled forward into 0001_identity.sql). Until that
-- coaching-domain migration lands, submit_coach_verification below writes
-- everything it CAN write to real columns (coach_profiles, coach_certificates)
-- and preserves the full wizard payload, including sessionTypes and
-- availabilityWindows, verbatim in verification_requests.payload (already
-- jsonb, per PRD-02 FR-6 "writes the full coach profile payload ... in a
-- single transaction"). A future coaching migration should backfill
-- session_types/coach_availability_windows rows from existing
-- verification_requests.payload for coaches approved before that point.
--
-- Why these need to be RPCs, not direct client table writes: user_roles has
-- zero authenticated INSERT policy by design (RLS.md: "no authenticated
-- write at all, every role grant happens through a SECURITY DEFINER path"),
-- and coach_profiles' own insert policy requires has_role('coach') already
-- true, which is exactly the role this flow is meant to grant. Both actions
-- have to happen atomically, server side, which is what a SECURITY DEFINER
-- RPC is for.

-- ============================================================================
-- complete_player_setup: writes users fields + ensures the player role row.
-- The player role already exists from the signup trigger in the normal case;
-- this is idempotent (on conflict do nothing) so it is safe to call from
-- Profile edit later too, not just first-run setup.
-- ============================================================================

create or replace function public.complete_player_setup(
  p_sports public.sport[],
  p_avatar_url text,
  p_city text,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_sports is null or array_length(p_sports, 1) is null then
    raise exception 'VALIDATION: at least one sport is required';
  end if;

  if p_city is null or p_city = '' then
    raise exception 'VALIDATION: city is required';
  end if;

  update public.users
  set sports = p_sports,
      avatar_url = coalesce(p_avatar_url, avatar_url),
      city = p_city,
      state = p_state
  where id = auth.uid();

  insert into public.user_roles (user_id, role)
  values (auth.uid(), 'player')
  on conflict (user_id, role) do nothing;

  delete from public.athlete_sports
  where user_id = auth.uid()
    and sport <> all (p_sports);

  insert into public.athlete_sports (user_id, sport, is_primary)
  select auth.uid(), s, s = p_sports[1]
  from unnest(p_sports) as s
  on conflict (user_id, sport) do update set is_primary = excluded.is_primary;
end;
$$;

revoke all on function public.complete_player_setup(public.sport[], text, text, text) from public;
grant execute on function public.complete_player_setup(public.sport[], text, text, text) to authenticated;

-- ============================================================================
-- coach_profiles resubmission bypass: the existing 0001 trigger
-- (lock_coach_profile_admin_fields) blocks any non-admin from changing
-- `status` via UPDATE, which is correct for a coach editing their own
-- profile directly, but also blocks THIS RPC from resetting status back to
-- 'pending_review' on a resubmission after 'rejected' (PRD-02 FR-10). Patched
-- to also allow the change when a local (transaction-scoped) GUC this RPC
-- sets is present, so only this function's own resubmission path can bypass
-- the lock, never a client update statement.
-- ============================================================================

create or replace function public.lock_coach_profile_admin_fields()
returns trigger
language plpgsql
as $$
begin
  if (
    new.status is distinct from old.status
    or new.rating is distinct from old.rating
    or new.rating_count is distinct from old.rating_count
    or new.players_coached_count is distinct from old.players_coached_count
  )
    and not public.has_role('admin')
    and coalesce(current_setting('atlitos.allow_coach_resubmit', true), 'false') <> 'true'
  then
    raise exception 'FIELD_LOCKED: status, rating, rating_count, players_coached_count change only via admin or a server-side pipeline';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- submit_coach_verification: grants the coach role, upserts coach_profiles
-- (own columns only), replaces the coach's own unverified certificate rows,
-- and inserts the verification_requests row, atomically. Raises ALREADY_SETUP
-- if the coach is already verified or already has a pending_review request,
-- matching PRD-02 FR-1.
-- ============================================================================

create or replace function public.submit_coach_verification(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_status public.coach_status;
  v_pending_count int;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_payload ->> 'sport' is null or p_payload ->> 'city' is null or p_payload ->> 'state' is null then
    raise exception 'VALIDATION: sport, city, and state are required';
  end if;

  select status into v_existing_status from public.coach_profiles where user_id = auth.uid();

  if v_existing_status = 'verified' then
    raise exception 'ALREADY_SETUP: coach profile is already verified';
  end if;

  select count(*) into v_pending_count
  from public.verification_requests
  where applicant_type = 'coach' and applicant_id = auth.uid() and status = 'pending_review';

  if v_pending_count > 0 then
    raise exception 'ALREADY_SETUP: a verification request is already pending review';
  end if;

  insert into public.user_roles (user_id, role)
  values (auth.uid(), 'coach')
  on conflict (user_id, role) do nothing;

  perform set_config('atlitos.allow_coach_resubmit', 'true', true);

  insert into public.coach_profiles (
    user_id, sport, experience_years, coaching_style, specialization, bio, city, state, status
  )
  values (
    auth.uid(),
    (p_payload ->> 'sport')::public.sport,
    coalesce((p_payload ->> 'experienceYears')::int, 0),
    p_payload ->> 'coachingStyle',
    coalesce(
      (select array_agg(elem) from jsonb_array_elements_text(coalesce(p_payload -> 'specialization', '[]'::jsonb)) as elem),
      '{}'::text[]
    ),
    p_payload ->> 'bio',
    p_payload ->> 'city',
    p_payload ->> 'state',
    'pending_review'
  )
  on conflict (user_id) do update set
    sport = excluded.sport,
    experience_years = excluded.experience_years,
    coaching_style = excluded.coaching_style,
    specialization = excluded.specialization,
    bio = excluded.bio,
    city = excluded.city,
    state = excluded.state,
    status = 'pending_review';

  delete from public.coach_certificates
  where coach_id = auth.uid() and not verified;

  insert into public.coach_certificates (coach_id, name, storage_path)
  select auth.uid(), item ->> 'name', item ->> 'storagePath'
  from jsonb_array_elements(coalesce(p_payload -> 'certificates', '[]'::jsonb)) as item
  where item ->> 'storagePath' is not null;

  insert into public.verification_requests (applicant_type, applicant_id, status, payload)
  values ('coach', auth.uid(), 'pending_review', p_payload)
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.submit_coach_verification(jsonb) from public;
grant execute on function public.submit_coach_verification(jsonb) to authenticated;
