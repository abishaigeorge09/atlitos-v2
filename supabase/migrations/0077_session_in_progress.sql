-- ATLITOS v2 — 0077_session_in_progress.sql
-- Domain: coaching. Design authority: docs/design/COACH-TRAININGS-GAP.md
-- "What MISSING requires" item 5 (Start/End Session, screens #13/#15).
--
-- Adds the `in_progress` session status and the coach-driven edges
--
--   accepted -> in_progress   ('start', new)
--   in_progress -> completed  ('complete', new starting state)
--
-- while keeping EVERY pre-existing transition byte-for-byte intact:
-- accepted -> completed (the 1:1 path through complete-session, TOO_EARLY
-- gated) still exists, as do accept, decline, both cancels, and reschedule.
-- The client mirror of this machine is SESSION_TRANSITIONS in
-- packages/types/src/transitions/index.ts, updated in the same commit.
--
-- Decisions:
--
--   1. 'start' is coach-only and has NO time gate. The design's Start
--      Session button is the coach standing on the field tapping start; the
--      product trusts the coach on when their session begins, exactly as it
--      trusts them on decline. It is refused from every state but
--      `accepted`, so a declined/cancelled/completed session can never come
--      back to life.
--
--   2. 'complete' from `in_progress` skips the TOO_EARLY gate. That gate
--      exists to stop a coach completing a session that never happened;  a
--      session the coach explicitly started IS happening, and ending it
--      early (rain, injury) must not strand it in `in_progress`. The gate
--      is unchanged for the legacy accepted -> completed edge.
--
--   3. WHO may call 'complete' through the client door (session_transition)
--      changes shape: a GROUP session's completion moves no money (the fare
--      moved at membership capture, 0076 header note 5; group session rows
--      are price 0 with no payment intent), so it has no edge-function half
--      to skip and USE_EDGE_FUNCTION would be wrong for it. Group sessions
--      complete directly through the RPC; 1:1 sessions keep the 0027 gate
--      and must still go through complete-session, which writes the
--      earnings accrual. The distinction is the row's own group_id, read
--      inside the RPC, never client-asserted.
--
--   4. 'start' also flows through for 1:1 sessions. Nothing about
--      in_progress is group-specific in the machine; the coach Trainings
--      design gives 1:1 sessions the same Start affordance later, and money
--      still only moves at complete-session time.
--
--   5. cancel / reschedule remain unreachable from `in_progress` (their
--      status guards are untouched): a session that has started was already
--      unreachable for both under the SESSION_STARTED time gate; the status
--      guard now says the same thing structurally.
--
--   6. `in_progress` keeps holding the slot: sessions_coach_date_slot_unique
--      excludes only declined and cancelled, unchanged.

alter type public.session_status add value if not exists 'in_progress' after 'accepted';

-- ============================================================================
-- session_transition_internal — 0027's body plus 'start' and the widened
-- 'complete'. service_role only, actor explicit, unchanged contract.
-- ============================================================================

create or replace function public.session_transition_internal(
  p_actor_id uuid,
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
  if p_actor_id is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'NOT_FOUND: session % does not exist', p_session_id;
  end if;

  v_is_coach := v_session.coach_id = p_actor_id;
  v_is_player := v_session.player_id is not distinct from p_actor_id
    and v_session.player_id is not null;

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

  elsif p_action = 'start' then
    -- Coach-driven, accepted only, no time gate. See header notes 1 and 4.
    if not v_is_coach then
      raise exception 'FORBIDDEN: only the assigned coach can start this session';
    end if;
    if v_session.status <> 'accepted' then
      raise exception 'INVALID_TRANSITION: session % is not accepted', p_session_id;
    end if;

    update public.sessions
    set status = 'in_progress'
    where id = p_session_id
    returning * into v_session;

  elsif p_action = 'complete' then
    -- FR-15 for the accepted edge (TOO_EARLY gated, unchanged); a started
    -- session completes whenever the coach ends it. See header note 2.
    if not v_is_coach then
      raise exception 'FORBIDDEN: only the assigned coach can complete this session';
    end if;
    if v_session.status not in ('accepted', 'in_progress') then
      raise exception 'INVALID_TRANSITION: session % is not accepted or in progress', p_session_id;
    end if;
    if v_session.status = 'accepted'
      and (v_session.date + v_session.slot_end) > v_now then
      raise exception 'TOO_EARLY: session % has not reached its scheduled end time', p_session_id;
    end if;

    update public.sessions
    set status = 'completed'
    where id = p_session_id
    returning * into v_session;

  elsif p_action = 'cancel' then
    -- Two distinct cancels wearing one action name, unchanged from 0027.
    if v_session.status = 'requested' then
      if not v_is_player then
        raise exception 'FORBIDDEN: only the booking athlete can cancel an unanswered request; a coach declines it instead';
      end if;

      update public.sessions
      set status = 'cancelled',
          cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
      where id = p_session_id
      returning * into v_session;

    elsif v_session.status = 'accepted' then
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

    else
      raise exception 'INVALID_TRANSITION: session % is not requested or accepted', p_session_id;
    end if;

  elsif p_action = 'reschedule' then
    -- FR-17, unchanged from 0027 (tombstone + new accepted row).
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
        price, platform_fee, total, payment_intent_id, group_id
      )
      values (
        v_session.coach_id, v_session.player_id, v_session.session_type_id, v_session.frequency,
        p_new_date, p_new_slot_start, v_new_slot_end,
        v_session.focus_area, v_session.location, 'accepted',
        v_session.price, v_session.platform_fee, v_session.total, v_session.payment_intent_id,
        v_session.group_id
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

revoke all on function public.session_transition_internal(uuid, uuid, text, text, date, time) from public;
revoke execute on function public.session_transition_internal(uuid, uuid, text, text, date, time) from anon, authenticated;
grant execute on function public.session_transition_internal(uuid, uuid, text, text, date, time) to service_role;

-- ============================================================================
-- session_transition — the client door. 'start' flows through; 'complete'
-- is now refused only for NON-group sessions (header note 3); the requested
-- cancel refund gate is unchanged.
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
  v_actor uuid := auth.uid();
  v_status text;
  v_is_party boolean;
  v_group_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_action = 'complete' then
    -- Group sessions carry no money (0076 header note 5), so their
    -- completion has no accrual half and completes right here. 1:1
    -- completion keeps 0027's gate: only complete-session may perform it,
    -- because it writes the coach earnings accrual in the same request.
    select s.group_id,
           (s.coach_id = v_actor or s.player_id = v_actor)
      into v_group_id, v_is_party
      from public.sessions s
     where s.id = p_session_id;

    -- Fall through to the machine ONLY for a party to a group session; a
    -- stranger, a missing id, or any 1:1 session gets the same refusal 0027
    -- always gave, so this peek leaks nothing about rows the caller is not
    -- part of.
    if not (v_group_id is not null and coalesce(v_is_party, false)) then
      raise exception 'USE_EDGE_FUNCTION: completing a session must go through the complete-session edge function, which writes the coach earnings accrual';
    end if;
  end if;

  if p_action = 'cancel' then
    -- Unchanged from 0027: an unanswered request's cancel must go through
    -- cancel-session-refund, which issues the automatic full refund.
    select s.status,
           (s.coach_id = v_actor or s.player_id = v_actor)
      into v_status, v_is_party
      from public.sessions s
     where s.id = p_session_id;

    if coalesce(v_is_party, false) and v_status = 'requested' then
      raise exception 'USE_EDGE_FUNCTION: cancelling an unanswered request must go through the cancel-session-refund edge function, which issues the automatic full refund';
    end if;
  end if;

  return public.session_transition_internal(
    v_actor, p_session_id, p_action, p_reason, p_new_date, p_new_slot_start
  );
end;
$$;

revoke all on function public.session_transition(uuid, text, text, date, time) from public;
revoke execute on function public.session_transition(uuid, text, text, date, time) from anon;
grant execute on function public.session_transition(uuid, text, text, date, time) to authenticated;
