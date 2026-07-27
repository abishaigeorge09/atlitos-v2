-- ATLITOS v2 — 0085_co04_decline_refund.sql
-- Domain: coaching + payments. QA finding CO-04 (P0 money).
-- Requirements: CLAUDE.md financial invariant; PRD-02 FR-14, FR-19, FR-35;
--               PRD-01 FR-25.
--
-- THE HOLE THIS CLOSES (CO-04)
--
-- A coach declining a `requested` session whose `payment_intents` row is
-- already `captured` left the money stranded. `session_transition('decline')`
-- (0021, unchanged through 0026/0027) only sets `status='declined'`. A session
-- accrues NO ledger group at capture (finalize-session-payment.ts: the coach is
-- credited only at completion), so a declined session correctly has zero ledger
-- rows — but the captured charge is never reversed. The intent sat `captured`
-- with no `refunds` row and no reversing ledger group: the athlete paid and was
-- never repaid.
--
-- This is the exact mirror of the athlete-initiated `requested` -> `cancelled`
-- refund AT-60/AT-61 built (FR-35). That edge was made unskippable by closing
-- the bare RPC and routing the cancel through `cancel-session-refund`, which
-- issues the automatic full refund. `decline` had the same money half (a
-- captured request must be refunded when disposed of, whoever disposes of it)
-- but never got the same gate, because at the time decline was treated as
-- money-free. It is not: no service was rendered and no fee was accrued, so the
-- full captured amount must go back, exactly as for the athlete-cancel case.
--
-- THE FIX, IDENTICAL IN SHAPE TO AT-61
--
--   * `session_transition_internal` already implements the `decline` machine
--     (coach only, from `requested` only, sets `decline_reason`). It is service
--     role only and needs no change: the new edge function calls it the same
--     way `cancel-session-refund` calls the cancel edge.
--   * `session_transition` (the client door) now REFUSES `decline` with
--     `USE_EDGE_FUNCTION`, so a client can no longer decline a request without
--     going through `decline-session-refund`, which issues the refund. This is
--     the same enforcement AT-61 applied to `complete` (from any state) and to
--     `cancel` when `requested`: the action is legitimate, the entry point is
--     wrong because its money half lives in an edge function.
--
-- WHY REFUSE `decline` FROM EVERY STATE, NOT ONLY WHEN CAPTURED
--
-- `decline` is only ever legal from `requested` (the internal machine enforces
-- that), so refusing it from every state at the door is the honest, probe-proof
-- message `complete` already uses: this action is not reachable from the bare
-- RPC at all. The edge function decides refund applicability — a `requested`
-- session with no captured intent (an abandoned-payment case, 0024) is declined
-- with `refund_status: not_applicable` and no `refunds` row, exactly as
-- `cancel-session-refund` handles the same situation. Putting the captured
-- check in the RPC would duplicate the edge function's own captured lookup and
-- split the refund decision across two layers.
--
-- COURTS: still not the same exposure (0027's note holds). Courts accrue at
-- booking time and have no cancellation/decline refund, so no gate is owed
-- there. Adding one would make this same routing mandatory in the same change.

-- ============================================================================
-- session_transition — the client-facing door. Signature and grant unchanged
-- from 0021/0026/0027, so no client call site's SIGNATURE moves (the coach
-- decline call site is repointed to the edge function separately, the way the
-- athlete cancel and coach complete call sites were). Refuses `complete`
-- (unchanged), `cancel` from `requested` (unchanged), and now `decline` (new),
-- all with USE_EDGE_FUNCTION; delegates everything else to the internal machine.
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

  -- 'complete' is refused from EVERY state (AT-61). Its money half (the coach
  -- earnings accrual) lives in the complete-session edge function.
  if p_action = 'complete' then
    raise exception 'USE_EDGE_FUNCTION: completing a session must go through the complete-session edge function, which writes the coach earnings accrual';
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
$$;

revoke all on function public.session_transition(uuid, text, text, date, time) from public;
revoke execute on function public.session_transition(uuid, text, text, date, time) from anon;
grant execute on function public.session_transition(uuid, text, text, date, time) to authenticated;
