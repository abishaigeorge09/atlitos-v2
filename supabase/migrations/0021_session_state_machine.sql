-- ATLITOS v2 — 0021_session_state_machine.sql
-- Domain: coaching. Epic AT-5, story AT-37.
-- Requirements: PRD-02 FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19;
--               PRD-01 FR-25, FR-26.
--
-- One SECURITY DEFINER RPC owns the whole session machine, exactly as
-- court_booking_transition does for courts (0009_courts.sql), plus
-- rate_session for the player's one rating. sessions has no client write
-- policy and no client insert/update/delete grant (0019_coaching_rls.sql), so
-- these two functions plus the book-session edge function are the only things
-- in the system that can change a session row at all. That is CLAUDE.md's
-- financial invariant: sessions carries price, platform_fee, and total, and
-- its status gates an earnings ledger write.
--
-- Machine (SCHEMA.md, PRD-02 FR-19, API-MAPPING.md sessions):
--   requested -> accepted | declined
--   accepted  -> completed | cancelled | rescheduled
--   completed -> rated                      (via rate_session, not this RPC)
-- Anything else raises INVALID_TRANSITION. There is no client-side guard
-- anywhere that is load-bearing; the UI hiding a button is cosmetic.
--
-- Caller identity, checked inside the RPC, never inferred from the UI:
--   accept, decline, complete   coach only (FR-13, FR-14, FR-15)
--   cancel, reschedule          either party (FR-16, FR-17; API-MAPPING's
--                               cancel row says "coach_id or player_id", and
--                               PRD-01 FR-26 / AT-54 give the athlete both
--                               actions too)
--   rate                        player only (FR-18, the deliberate asymmetry
--                               from courts: a coach never rates)
--
-- Error vocabulary raised here, for packages/api to map:
--   UNAUTHENTICATED     no session
--   NOT_FOUND           no such session id
--   FORBIDDEN           caller is not the party this action belongs to
--   INVALID_TRANSITION  wrong starting status, or an unknown action
--   VALIDATION          missing required argument
--   REASON_REQUIRED     decline/cancel without a reason
--   TOO_EARLY           complete before the scheduled end time (FR-15)
--   SESSION_STARTED     cancel/reschedule after the scheduled start (FR-16)
--   SLOT_TAKEN          reschedule collides with the partial unique index
--   ALREADY_RATED       second rate_session call (FR-18, PRD-01 FR-26)
--
-- Decisions worth flagging:
--
--   1. NO LEDGER WRITE HERE. PRD-02 FR-15 says marking complete "triggers the
--      earnings ledger write" and FR-25 describes it. CLAUDE.md is
--      unambiguous that ledger writes happen only in edge functions under the
--      service role, and 0009_courts.sql already resolved this exact conflict
--      in the house rule's favour (its header note 7). session_transition
--      therefore only moves status; AT-41's edge function calls this RPC and
--      writes the balanced ledger group itself, keyed idempotently on the
--      session id.
--
--   2. Reschedule mirrors courts: a NEW session row is inserted at the new
--      date/slot carrying the original's money columns and payment_intent_id,
--      and the original is marked `rescheduled` as a tombstone. The
--      alternative reading of FR-17 ("updates date/slot atomically") would
--      mutate the row in place, but then `rescheduled` could never be a
--      status any row rests in, contradicting FR-19's machine, and the
--      booking history the Trainee detail screen shows (FR-21) would lose the
--      original slot. The new row starts in `accepted`, since only an
--      `accepted` session can be rescheduled. The RPC returns the NEW row.
--
--   3. Cancel is reachable only from `accepted`, per FR-19's machine. A
--      `requested` session is declined by the coach (FR-14); an athlete who
--      changes their mind before the coach responds has no cancel path in v1.
--      Flagging it as a real gap for the founder rather than inventing a
--      requested -> cancelled edge the PRD does not have.
--
--   4. Time comparisons use Asia/Kolkata. sessions stores `date` and `time`
--      separately with no timezone column, and the product is India-only with
--      rupee pricing, so "has the scheduled end time passed" is evaluated in
--      IST rather than the server's UTC. If a second region is ever added,
--      this is one of the places that must change.

-- ============================================================================
-- Allow a server-side pipeline to maintain coach_profiles' aggregate rating.
--
-- lock_coach_profile_admin_fields (0001_identity.sql) blocks any change to
-- status/rating/rating_count/players_coached_count unless has_role('admin'),
-- and its own error text already anticipates the other legitimate writer:
-- "change only via admin or a server-side pipeline". rate_session is that
-- pipeline, and it runs as its owner with no admin role in the JWT, so
-- without this it would fail with FIELD_LOCKED on every rating.
--
-- The escape is a transaction-local GUC that only a SECURITY DEFINER function
-- can meaningfully set: a client can technically call set_config over
-- PostgREST, but doing so buys it nothing, because it still has no UPDATE
-- grant or policy on coach_profiles' locked columns (the trigger is the
-- second lock, not the only one). Deliberately transaction-local (the third
-- argument to set_config is true) so it cannot leak into a later statement on
-- a pooled connection.
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
    and coalesce(current_setting('app.rating_pipeline', true), '') <> 'on'
  then
    raise exception 'FIELD_LOCKED: status, rating, rating_count, players_coached_count change only via admin or a server-side pipeline';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- session_transition
-- ============================================================================

create or replace function public.session_transition(
  p_session_id uuid,
  p_action text,
  p_reason text default null,
  p_new_date date default null,
  p_new_slot_start time default null
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
  v_new_session public.sessions;
  v_is_coach boolean;
  v_is_player boolean;
  v_now timestamp := (now() at time zone 'Asia/Kolkata');
  v_new_slot_end time;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'NOT_FOUND: session % does not exist', p_session_id;
  end if;

  v_is_coach := v_session.coach_id = auth.uid();
  v_is_player := v_session.player_id = auth.uid();

  if not (v_is_coach or v_is_player) then
    raise exception 'FORBIDDEN: not a party to this session';
  end if;

  if p_action = 'accept' then
    -- FR-13
    if not v_is_coach then
      raise exception 'FORBIDDEN: only the assigned coach can accept this session';
    end if;
    if v_session.status <> 'requested' then
      raise exception 'INVALID_TRANSITION: session % is not requested', p_session_id;
    end if;

    update public.sessions
    set status = 'accepted'
    where id = p_session_id
    returning * into v_session;

  elsif p_action = 'decline' then
    -- FR-14. Reason is optional per the FR ("an optional reason field").
    if not v_is_coach then
      raise exception 'FORBIDDEN: only the assigned coach can decline this session';
    end if;
    if v_session.status <> 'requested' then
      raise exception 'INVALID_TRANSITION: session % is not requested', p_session_id;
    end if;

    update public.sessions
    set status = 'declined', decline_reason = p_reason
    where id = p_session_id
    returning * into v_session;

  elsif p_action = 'complete' then
    -- FR-15: server gated on the scheduled end time having passed, not merely
    -- hidden in the coach UI.
    if not v_is_coach then
      raise exception 'FORBIDDEN: only the assigned coach can complete this session';
    end if;
    if v_session.status <> 'accepted' then
      raise exception 'INVALID_TRANSITION: session % is not accepted', p_session_id;
    end if;
    if (v_session.date + v_session.slot_end) > v_now then
      raise exception 'TOO_EARLY: session % has not reached its scheduled end time', p_session_id;
    end if;

    update public.sessions
    set status = 'completed'
    where id = p_session_id
    returning * into v_session;

  elsif p_action = 'cancel' then
    -- FR-16, PRD-01 FR-26. Either party, only from accepted, only before the
    -- session starts. See header note 3 on why `requested` has no cancel edge.
    if v_session.status <> 'accepted' then
      raise exception 'INVALID_TRANSITION: session % is not accepted', p_session_id;
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'REASON_REQUIRED: a cancellation reason is required';
    end if;
    if (v_session.date + v_session.slot_start) <= v_now then
      raise exception 'SESSION_STARTED: session % has already started', p_session_id;
    end if;

    update public.sessions
    set status = 'cancelled', cancellation_reason = p_reason
    where id = p_session_id
    returning * into v_session;

  elsif p_action = 'reschedule' then
    -- FR-17. See header note 2 on the new-row-plus-tombstone shape.
    if v_session.status <> 'accepted' then
      raise exception 'INVALID_TRANSITION: session % is not accepted', p_session_id;
    end if;
    if p_new_date is null or p_new_slot_start is null then
      raise exception 'VALIDATION: new date and slot_start are required to reschedule';
    end if;
    if (v_session.date + v_session.slot_start) <= v_now then
      raise exception 'SESSION_STARTED: session % has already started', p_session_id;
    end if;

    v_new_slot_end := p_new_slot_start + (v_session.slot_end - v_session.slot_start);

    begin
      insert into public.sessions (
        coach_id, player_id, session_type_id, frequency,
        date, slot_start, slot_end, focus_area, location, status,
        price, platform_fee, total, payment_intent_id
      )
      values (
        v_session.coach_id, v_session.player_id, v_session.session_type_id, v_session.frequency,
        p_new_date, p_new_slot_start, v_new_slot_end,
        v_session.focus_area, v_session.location, 'accepted',
        v_session.price, v_session.platform_fee, v_session.total, v_session.payment_intent_id
      )
      returning * into v_new_session;
    exception
      when unique_violation then
        raise exception 'SLOT_TAKEN: coach % is already booked for % %',
          v_session.coach_id, p_new_date, p_new_slot_start;
    end;

    update public.sessions
    set status = 'rescheduled'
    where id = p_session_id;

    v_session := v_new_session;

  else
    raise exception 'INVALID_TRANSITION: unknown action %', p_action;
  end if;

  return v_session;
end;
$$;

revoke all on function public.session_transition(uuid, text, text, date, time) from public;
revoke execute on function public.session_transition(uuid, text, text, date, time) from anon;
grant execute on function public.session_transition(uuid, text, text, date, time) to authenticated;

-- ============================================================================
-- rate_session: PRD-02 FR-18, PRD-01 FR-25/FR-26. Player only, only from
-- `completed`, once. Moves status completed -> rated (the machine's last edge)
-- and folds the rating into coach_profiles' aggregate in the same
-- transaction, so the discovery-surface rating can never drift from the
-- ratings actually given.
--
-- The aggregate is recomputed from the sessions table rather than incremented
-- in place, so a replay or a future correction cannot double count.
-- ============================================================================

create or replace function public.rate_session(
  p_session_id uuid,
  p_rating smallint,
  p_remarks text default null
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'VALIDATION: rating must be between 1 and 5';
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'NOT_FOUND: session % does not exist', p_session_id;
  end if;

  if v_session.player_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN: only the session player can rate this session';
  end if;

  if v_session.rating is not null or v_session.status = 'rated' then
    raise exception 'ALREADY_RATED: session % has already been rated', p_session_id;
  end if;

  if v_session.status <> 'completed' then
    raise exception 'INVALID_TRANSITION: session % is not completed', p_session_id;
  end if;

  update public.sessions
  set status = 'rated', rating = p_rating, remarks = p_remarks
  where id = p_session_id
  returning * into v_session;

  -- Unlock the coach_profiles aggregate columns for this transaction only.
  perform set_config('app.rating_pipeline', 'on', true);

  update public.coach_profiles cp
  set rating = agg.avg_rating,
      rating_count = agg.n
  from (
    select coalesce(avg(s.rating)::numeric(3, 2), 0) as avg_rating,
           count(s.rating)::int as n
    from public.sessions s
    where s.coach_id = v_session.coach_id
      and s.rating is not null
  ) as agg
  where cp.user_id = v_session.coach_id;

  perform set_config('app.rating_pipeline', 'off', true);

  return v_session;
end;
$$;

revoke all on function public.rate_session(uuid, smallint, text) from public;
revoke execute on function public.rate_session(uuid, smallint, text) from anon;
grant execute on function public.rate_session(uuid, smallint, text) to authenticated;
