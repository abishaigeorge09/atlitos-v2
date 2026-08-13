-- ATLITOS v2 — 0089_session_transition_notifications.sql
-- Domain: coaching + notifications. Closes gap B1: no notification has ever
-- fired on any coaching session transition.
--
-- THE GAP, precisely. dispatchNotification (_shared/notify.ts) has exactly
-- two callers in the whole supabase/functions tree: notify-dispatch/index.ts
-- (its own HTTP entry) and _shared/finalize-court-booking-payment.ts (a COURT
-- booking). book-session, complete-session, join-group and
-- renew-group-membership emit nothing. So an athlete whose coach accepts,
-- declines, starts or completes their session is told nothing, by any channel.
--
-- WHERE THE EMISSION BELONGS, and why it is here in SQL rather than in the
-- edge functions. Only one of the four transitions passes through an edge
-- function at all:
--
--   accept    client -> session_transition RPC            (no edge function)
--   decline   client -> session_transition RPC            (no edge function)
--   start     client -> session_transition RPC            (no edge function)
--   complete  1:1   -> complete-session edge function -> session_transition_internal
--             group -> session_transition RPC             (no edge function)
--
-- Emitting from the edge functions would therefore cover one and a half of
-- the four cases and would need a second copy of the same code the day a
-- transition moves. `session_transition_internal` is the single chokepoint
-- every path already funnels through (0027 made it so, 0077 extended it), so
-- putting the emission there means no caller can transition a session without
-- notifying, present or future. This is the moderate_clip (0043),
-- record_donation_from_draft (0054) and verification (0066) pattern: a
-- SECURITY DEFINER RPC writes the notifications row itself. Writing it here
-- also makes the notification part of the SAME transaction as the status
-- change, so a rolled back transition can never leave a lie in the inbox.
--
-- WHAT IN-APP DELIVERY MEANS TODAY. The notifications row IS the in-app
-- notification (_shared/notify.ts header). The device push leg in that file
-- is still the P9 stub (`deliverToDevice` logs and returns "stubbed"), so
-- routing through notify-dispatch would buy zero real pushes today and cost a
-- service-role HTTP hop from inside a transaction. When the real APNs/FCM
-- transport lands, the relay belongs on the notifications table itself (one
-- trigger, every domain covered) rather than re-plumbed per RPC.
--
-- WHO GETS TOLD: the athlete side, never the coach. All four transitions are
-- coach actions, so the coach already knows; notifying the actor is noise
-- that trains people to ignore the bell. For a 1:1 session that is
-- sessions.player_id. For a group session (player_id is null, 0076 note 5) it
-- is every session_participants row, which is exactly the roster the coach
-- scheduled.
--
-- NOT emitted here: cancel and reschedule. Both are already covered by their
-- own refund paths and by 0026's product decisions, and B1's scope is accept,
-- decline, start and complete. They are the obvious next two and cost one
-- more branch in notify_session_parties when someone wants them.

-- ============================================================================
-- notify_session_parties: builds one notification per athlete party for a
-- session that has just transitioned. Called only from
-- session_transition_internal, which is service_role only, and runs as the
-- definer there, which is what lets it insert into a table that grants no
-- authenticated INSERT (0002).
--
-- Re-reads the session row rather than taking a composite parameter so the
-- signature does not churn every time public.sessions gains a column. It runs
-- inside the transition's own transaction, after the UPDATE, so it always
-- sees the new status.
-- ============================================================================

create or replace function public.notify_session_parties(
  p_session_id uuid,
  p_action text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
  v_coach_name text;
  v_when text;
  v_title text;
  v_body text;
  v_deep_link text;
  v_sent int := 0;
begin
  select * into v_session from public.sessions where id = p_session_id;
  if v_session.id is null then
    return 0;
  end if;

  select coalesce(nullif(btrim(u.name), ''), 'Your coach')
    into v_coach_name
    from public.users u
   where u.id = v_session.coach_id;
  v_coach_name := coalesce(v_coach_name, 'Your coach');

  -- "24 Jul 2026 at 06:30". Copy strings carry no emoji, no hyphens and no
  -- em dashes (CLAUDE.md house style), which is also why the two word forms
  -- below read "one to one" and "no show" style rather than hyphenated.
  v_when := to_char(v_session.date, 'DD Mon YYYY') || ' at '
    || to_char(v_session.slot_start, 'HH24:MI');

  -- A group session opens on the group session screen, a 1:1 on the session
  -- screen. Both routes exist in apps/mobile/src/app/(tabs)/trainings.
  v_deep_link := case
    when v_session.group_id is not null
      then '/trainings/group-session/' || v_session.id::text
    else '/trainings/session/' || v_session.id::text
  end;

  if p_action = 'accept' then
    v_title := 'Session confirmed';
    v_body := v_coach_name || ' accepted your session on ' || v_when || '.';
  elsif p_action = 'decline' then
    v_title := 'Session declined';
    v_body := v_coach_name || ' declined your session on ' || v_when || '.'
      || case
           when nullif(btrim(coalesce(v_session.decline_reason, '')), '') is not null
             then ' Reason: ' || btrim(v_session.decline_reason)
           else ' Your payment is refunded automatically.'
         end;
  elsif p_action = 'start' then
    v_title := 'Session started';
    v_body := v_coach_name || ' started your session for ' || v_when || '.';
  elsif p_action = 'complete' then
    v_title := 'Session completed';
    v_body := 'Your session on ' || v_when || ' is complete. Rate it to help other athletes.';
  else
    -- Any other action is not a notifying transition. See the header.
    return 0;
  end if;

  if v_session.player_id is not null then
    insert into public.notifications (user_id, type, title, body, deep_link)
    values (v_session.player_id, 'session', v_title, v_body, v_deep_link);
    v_sent := 1;
  else
    -- Group session: the roster the coach scheduled. The coach is never a
    -- session_participants row, so this cannot notify the actor.
    insert into public.notifications (user_id, type, title, body, deep_link)
    select sp.player_id, 'session', v_title, v_body, v_deep_link
      from public.session_participants sp
     where sp.session_id = p_session_id;
    get diagnostics v_sent = row_count;
  end if;

  return v_sent;
end;
$$;

revoke all on function public.notify_session_parties(uuid, text) from public;
revoke execute on function public.notify_session_parties(uuid, text) from anon, authenticated;
grant execute on function public.notify_session_parties(uuid, text) to service_role;

comment on function public.notify_session_parties(uuid, text) is
  'B1: writes the in app notification for a session transition (accept, decline, start, complete) to the athlete side only. Called from session_transition_internal, which is the single chokepoint every transition path funnels through.';

-- ============================================================================
-- session_transition_internal — 0077's body VERBATIM plus four
-- notify_session_parties calls. No guard, no state, no error text and no
-- transition edge is changed; diff this against 0077 and the only additions
-- are the four `perform` lines and this header.
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

    perform public.notify_session_parties(p_session_id, 'accept');

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

    perform public.notify_session_parties(p_session_id, 'decline');

  elsif p_action = 'start' then
    -- Coach-driven, accepted only, no time gate. See 0077 header notes 1 and 4.
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

    perform public.notify_session_parties(p_session_id, 'start');

  elsif p_action = 'complete' then
    -- FR-15 for the accepted edge (TOO_EARLY gated, unchanged); a started
    -- session completes whenever the coach ends it. See 0077 header note 2.
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

    perform public.notify_session_parties(p_session_id, 'complete');

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
