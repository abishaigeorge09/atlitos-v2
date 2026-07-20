-- ATLITOS v2 — 0027_session_transition_service_role_gate.sql
-- Domain: coaching / payments. Epic AT-11, story AT-61.
-- Requirements: CLAUDE.md financial invariant; PRD-02 FR-15, FR-19 (amended
--               2026-07-19), FR-25, FR-34, FR-35.
--
-- THE HOLE THIS CLOSES
--
-- 0021 granted `session_transition` to `authenticated`, and 0026 kept that
-- grant while adding a second, money-bearing cancel edge. Two of the actions
-- it exposes have a money consequence that lives OUTSIDE the RPC, in an edge
-- function, so a client calling the RPC directly performs half a money event
-- and silently drops the other half:
--
--   * `complete` (from any state). The status moves to `completed`, but the
--     balanced earnings accrual group in `ledger_entries` is written by the
--     `complete-session` edge function, not here (0021 header note 1, upheld).
--     A client calling the bare RPC completes the session and the coach is
--     NEVER CREDITED. complete-session's own header note (c) already named
--     this as "the one real gap in this design" and shipped a repair path for
--     it; this migration removes the gap instead of repairing after the fact.
--
--   * `cancel` WHEN THE SESSION IS `requested`. 0026 added this edge, and
--     PRD-02 FR-35 now promises the athlete an automatic full refund with no
--     fee retained. The refund is issued by the `cancel-session-refund` edge
--     function. A client calling the bare RPC cancels the session and the
--     athlete IS NEVER REPAID, which is precisely the state FR-35 exists to
--     make unreachable.
--
-- Both were reachable from client code today. CLAUDE.md: "Clients never write
-- money rows or state transitions directly." This is the enforcement.
--
-- WHAT STAYS CLIENT CALLABLE, UNCHANGED
--
--   accept, decline, reschedule, and `cancel` from `accepted`. None of them
--   moves money: an accepted-session cancellation deliberately issues NO
--   automatic refund (0026's note, PRD-02 section 8 keeps that an admin
--   judgement call), so it has no edge-function half to skip. Their behaviour,
--   identity rules, error vocabulary, and grant are all byte-for-byte what
--   0026 left them.
--
-- SHAPE OF THE FIX, AND WHY NOT A GUC CHECK
--
-- The obvious implementation is one function that asks "am I service_role?"
-- by reading `request.jwt.claims`. Rejected: that is a string in a GUC, and a
-- `security definer` function is exactly the wrong place to trust one. The
-- enforcement here is a GRANT instead, which nothing running as
-- `authenticated` can talk its way past:
--
--   * `session_transition_internal` holds the whole machine, takes the actor
--     as an explicit argument, and is granted to `service_role` ONLY, the
--     same shape `settle_refund` (0026) and `court_booking_confirm_payment`
--     (0012) already use for money-bearing RPCs.
--   * `session_transition` keeps its exact 5-argument signature and its
--     `authenticated` grant, refuses the two money-consequential cases, and
--     otherwise delegates. Existing client call sites (packages/api
--     use-coach.ts, use-coaching.ts) need no change at all.
--
-- WHY AN EXPLICIT p_actor_id
--
-- Under the service-role key `auth.uid()` is NULL, so the machine cannot read
-- its own actor when the edge functions call it the way this migration now
-- requires. The actor therefore comes in as an argument. This is not a
-- weakening: the edge functions derive it from `getAuthenticatedUser()`,
-- which round-trips the caller's bearer token to GoTrue rather than decoding
-- it locally, and only `service_role` can call the function at all. Every
-- identity rule (coach-only accept/decline/complete, athlete-only cancel of
-- an unanswered request, either-party cancel/reschedule) is still enforced
-- inside the RPC, unchanged, just against `p_actor_id` instead of
-- `auth.uid()`.
--
-- NEW ERROR CODE: USE_EDGE_FUNCTION
--
-- Deliberately not FORBIDDEN. FORBIDDEN already means one specific thing
-- across this codebase and packages/types/src/errors.ts documents it as such:
-- "the caller is not the party this action belongs to". Here the caller may
-- well BE the right party; the coach completing their own session is doing a
-- legitimate thing through an illegitimate door. Reusing FORBIDDEN would tell
-- the client "you are not allowed to do this", which is false and would send
-- a UI toward hiding the button. USE_EDGE_FUNCTION says the true thing: right
-- action, wrong entry point, call the edge function. It is also unambiguous
-- in logs, where a spike in it means client code regressed to the bare RPC.
--
-- COURTS: NOT THE SAME EXPOSURE. `court_booking_transition` (0009) is also
-- granted to `authenticated`, but its `complete`/`cancel` edges have no
-- edge-function money half to skip: courts accrue their ledger group at
-- BOOKING time (`_shared/finalize-court-booking-payment.ts`), not on
-- completion, and there is no court cancellation refund function. The courts
-- money RPCs (`court_booking_confirm_payment`, `court_booking_expire_payment`)
-- were already service_role-only in 0012. Deliberately NOT touched here.
-- Recorded in PAYMENTS.md as a constraint on any future courts completion
-- accrual or cancellation refund: adding one makes this same gate mandatory.

-- ============================================================================
-- session_transition_internal — the machine. service_role only.
-- Body is 0026's verbatim, with auth.uid() replaced by p_actor_id.
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
  -- The actor is supplied, not inferred, because auth.uid() is null under the
  -- service-role key. A null actor is the same failure as no session was.
  if p_actor_id is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'NOT_FOUND: session % does not exist', p_session_id;
  end if;

  v_is_coach := v_session.coach_id = p_actor_id;
  v_is_player := v_session.player_id = p_actor_id;

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
    -- hidden in the coach UI. Reachable only from complete-session, which
    -- writes the earnings accrual in the same request (FR-25).
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
    -- Two distinct cancels wearing one action name, deliberately kept apart
    -- (PRD-01 FR-26 requires the product copy not conflate them either).
    if v_session.status = 'requested' then
      -- FR-34, added 2026-07-19. Athlete only: a coach disposing of an
      -- unanswered request declines it, which is a different outcome and
      -- stays a different status. No reason required, no coach involvement,
      -- and no time gate, because nothing has been committed to yet.
      -- Reachable only from cancel-session-refund, which issues FR-35's
      -- automatic full refund in the same request.
      if not v_is_player then
        raise exception 'FORBIDDEN: only the booking athlete can cancel an unanswered request; a coach declines it instead';
      end if;

      update public.sessions
      set status = 'cancelled',
          cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
      where id = p_session_id
      returning * into v_session;

    elsif v_session.status = 'accepted' then
      -- FR-16, PRD-01 FR-26. Unchanged from 0021: either party, reason
      -- required, refused once the session has started, and NO automatic
      -- refund (that stays an admin judgement call, PRD-02 section 8). This
      -- is the one cancel edge that stays client callable, because it has no
      -- money half.
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
    -- FR-17. See 0021's header note 2 on the new-row-plus-tombstone shape.
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

revoke all on function public.session_transition_internal(uuid, uuid, text, text, date, time) from public;
revoke execute on function public.session_transition_internal(uuid, uuid, text, text, date, time) from anon, authenticated;
grant execute on function public.session_transition_internal(uuid, uuid, text, text, date, time) to service_role;

-- ============================================================================
-- session_transition — the client-facing door. Signature and grant unchanged
-- from 0021/0026, so no client call site moves. Refuses the two
-- money-consequential cases with USE_EDGE_FUNCTION; delegates the rest.
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
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  -- 'complete' is refused from EVERY state, not just `accepted`. Refusing
  -- only the legal starting state would let a client probe the machine, and
  -- the honest message is the same regardless of status: this action is not
  -- reachable from here at all.
  if p_action = 'complete' then
    raise exception 'USE_EDGE_FUNCTION: completing a session must go through the complete-session edge function, which writes the coach earnings accrual';
  end if;

  if p_action = 'cancel' then
    -- Peek at status to tell the two cancels apart. Read only, and only for
    -- a caller who is already a party to the session, so this never becomes
    -- a way for a stranger to learn that a session exists or what state it
    -- is in. A non-party, or a missing id, falls through to the machine and
    -- gets its FORBIDDEN / NOT_FOUND exactly as before.
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
</content>
</invoke>
