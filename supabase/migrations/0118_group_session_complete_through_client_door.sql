-- ATLITOS v2 - 0118_group_session_complete_through_client_door.sql
-- Domain: coaching, group sessions. P0 for the coach journey.
--
-- ============================================================================
-- THE DEFECT: a coach can start a group session and can never end it.
-- ============================================================================
--
-- Found on a real device on 2026-08-14, by running .maestro/groups-coach.yaml
-- against the local stack. It could not have been found before, because that
-- flow WRITES and production is read only by standing rule, so it had never
-- executed once in this project's history.
--
-- The whole coach lifecycle works right up to the last step: create the group,
-- schedule the session, start it, mark attendance (the screenshot shows
-- "3 of 3 present"), and then End session fails and the card stays
-- "In progress" forever.
--
-- Two halves disagree, and each is individually reasonable:
--
--   packages/api/src/use-groups.ts:809-812 completeGroupSession() calls
--     session_transition('complete') directly, and its docblock states
--     "0077 allows only for group rows because they carry no money".
--
--   session_transition() refuses `complete` from EVERY state with
--     USE_EDGE_FUNCTION, with NO group exemption. Read from the live catalog,
--     not from the migration that was supposed to have written it.
--
-- The docblock's claim is simply false against the shipped function, so the
-- client calls a door that is always locked.
--
-- Routing group sessions to the complete-session edge function is NOT the fix.
-- That function exists to write the coach earnings accrual for a 1:1 session
-- against its payment_intent. A group session has no per session payment at
-- all; members pay a monthly membership. Every occurrence of the word "group"
-- in complete-session/index.ts means LEDGER ENTRY GROUP, not training group.
-- Sending a moneyless session through a money path would either fail on the
-- missing intent or invent an accrual that nothing paid for.
--
-- So the gate is over broad, and this migration narrows it.
--
-- ============================================================================
-- THE EXEMPTION PROVES THE MONEY FREE CLAIM RATHER THAN TRUSTING group_id
-- ============================================================================
--
-- It would be enough, today, to exempt `group_id is not null`. That is exactly
-- the kind of assumption this codebase has been bitten by: the moment a group
-- session gains a per session charge, a `group_id is not null` exemption
-- becomes a silent hole in the financial invariant, and nothing would fail.
--
-- So the exemption additionally requires that the session carry NO money by
-- either route: no payment_intent_id on the row, and no session domain
-- payment_intent pointing at it. If a group session ever acquires money, this
-- refuses it again with the original message, which is the correct and loud
-- behaviour.
--
-- Verified against production before writing, read only:
--   group sessions total                                  4
--   group sessions with a payment_intent_id               0
--   group sessions with a session domain payment_intent   0
--   group sessions ever completed                         0
--   1:1 sessions ever completed                           0
--
-- The last line is worth its own note: the completion path has NEVER run in
-- production for either kind of session.

create or replace function public.session_transition(
  p_session_id uuid,
  p_action text,
  p_reason text default null,
  p_new_date date default null,
  p_new_slot_start time without time zone default null
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_is_party boolean;
  v_is_moneyless_group_session boolean;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  -- 0118. A GROUP session that carries no money may complete through this
  -- door. A 1:1 session, or any session that has money attached by either
  -- route, still must not: its earnings accrual lives in the complete-session
  -- edge function and writing the status without the accrual would leave a
  -- completed session that never paid its coach.
  if p_action = 'complete' then
    select s.group_id is not null
           and s.payment_intent_id is null
           and not exists (
             select 1 from public.payment_intents pi
             where pi.entity_id = s.id and pi.domain = 'session'
           )
      into v_is_moneyless_group_session
    from public.sessions s
    where s.id = p_session_id;

    if v_is_moneyless_group_session is not true then
      raise exception 'USE_EDGE_FUNCTION: completing a session must go through the complete-session edge function, which writes the coach earnings accrual';
    end if;
  end if;

  -- 'decline' is refused from EVERY state (CO-04). Its money half (the
  -- automatic full refund of an already-captured request) lives in the
  -- decline-session-refund edge function. Refused from every state, not just
  -- `requested`, for the same probe-proof reason as `complete`: decline is
  -- only ever legal from `requested`, and the honest message is identical
  -- regardless of status.
  if p_action = 'decline' then
    raise exception 'USE_EDGE_FUNCTION: declining a request must go through the decline-session-refund edge function, which issues the automatic full refund of any captured payment';
  end if;

  if p_action = 'cancel' then
    -- Peek at status to tell the two cancels apart (AT-61). Read only, and
    -- only for a caller who is already a party to the session, so this never
    -- becomes a way for a stranger to learn a session exists. A non-party, or
    -- a missing id, falls through to the machine and gets its FORBIDDEN /
    -- NOT_FOUND exactly as before.
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
$function$;

comment on function public.session_transition(uuid, text, text, date, time without time zone) is
  '0021 + 0027 + 0118: the client door onto the session state machine. complete is refused for any session carrying money (its earnings accrual belongs to the complete-session edge function) but ALLOWED for a group session with no payment_intent by either route, because a group session has no per session charge and previously could be started and never ended. decline and the requested-state cancel remain edge function only.';
