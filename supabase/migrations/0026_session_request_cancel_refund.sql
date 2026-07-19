-- ATLITOS v2 — 0026_session_request_cancel_refund.sql
-- Domain: coaching + payments. Epic AT-11, story AT-60.
-- Requirements: PRD-02 FR-19 (amended 2026-07-19), FR-34, FR-35;
--               PRD-01 FR-25, FR-26.
--
-- Three things, all in service of one founder-approved amendment: an athlete
-- who books a session and changes their mind before the coach has answered
-- can get out, and gets their money back automatically.
--
--   1. session_transition gains the `requested` -> `cancelled` edge, athlete
--      only. 0021's header note 3 explicitly flagged the absence of this edge
--      as a real gap rather than inventing one; the amendment closes it, and
--      that note is superseded here rather than in 0021 (migrations are
--      append-only history, so the correction lives in the newer file).
--   2. A `refunds` table: the durable record of one refund attempt, and the
--      representation of a refund that is owed but not yet issued.
--   3. settle_refund(): the single atomic "this refund really happened" step,
--      called by both the synchronous cancel-session-refund path and the
--      refund.processed webhook, so the two converge on exactly one refund
--      record and exactly one reversing ledger group.
--
-- ============================================================================
-- Why `requested` -> `cancelled` is athlete only (FR-34)
-- ============================================================================
--
-- A coach getting rid of an unanswered request already has an edge:
-- `declined` (FR-14). The two are different economic and product events and
-- FR-34 requires they stay distinct in reporting, so a coach reaching for
-- 'cancel' on a `requested` session gets FORBIDDEN rather than being quietly
-- routed to the same place as the athlete. The `accepted` -> `cancelled`
-- edge is untouched: either party may take it, it still requires a reason,
-- it still refuses after the session has started, and it still carries NO
-- automatic refund (PRD-01 FR-26, PRD-02 section 8's carve-out is for the
-- `requested` case only).
--
-- No reason is required from `requested`, per FR-34 ("without a reason and
-- without coach involvement"). One is stored if the client sends one.
--
-- ============================================================================
-- How a PENDING refund is represented, and why a table (FR-35)
-- ============================================================================
--
-- FR-35 requires that a failed Razorpay call never strands the athlete and
-- never silently loses the refund: the session cancels anyway, the refund is
-- retried, and the outstanding refund is visible to admin. Something durable
-- therefore has to hold "this session is owed X and has not been paid it
-- yet". The three candidates, and why this one:
--
--   * A `payment_intents.status` value ('refund_pending'). Rejected: the
--     enum's states describe one CHARGE's lifecycle, and a pending refund is
--     a second, later obligation against that charge with its own attempt
--     count, its own failure reason, and its own Razorpay id. Overloading
--     the charge's status would give the retry job nowhere to record WHY the
--     last attempt failed, and no key to dedupe Razorpay's refund id against.
--   * A ledger tag. Rejected outright, and this is the important one:
--     ledger_entries is the record of money that HAS MOVED. A pending refund
--     is money that has NOT moved. Writing a ledger row for it would put a
--     liability into the same table the platform's balances are summed from,
--     which is exactly the "second balance representation" PAYMENTS.md
--     forbids, and it cannot be undone later because ledger_entries is
--     INSERT-only at the grant level.
--   * A transfers-style row. Chosen. `transfers` already models precisely
--     this shape: an outbound money movement with a provider id, a status
--     that starts optimistic and is confirmed by webhook, and a pointer to
--     the ledger group written when it settles. A refund is the same object
--     pointed the other way, so it gets the same shape rather than a novel
--     one, and admin visibility is one indexed query
--     (`where status = 'pending'`), not a join across enums.
--
-- payment_intents.status still flips to `refunded` when the refund settles,
-- because that IS a fact about the charge's lifecycle. It is set by
-- settle_refund, never by the pending path, so a pending refund never claims
-- the money went back.

-- ============================================================================
-- 1. The requested -> cancelled edge
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
    -- Two distinct cancels wearing one action name, deliberately kept apart
    -- (PRD-01 FR-26 requires the product copy not conflate them either).
    if v_session.status = 'requested' then
      -- FR-34, added 2026-07-19. Athlete only: a coach disposing of an
      -- unanswered request declines it, which is a different outcome and
      -- stays a different status. No reason required, no coach involvement,
      -- and no time gate, because nothing has been committed to yet.
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
      -- refund (that stays an admin judgement call, PRD-02 section 8).
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

revoke all on function public.session_transition(uuid, text, text, date, time) from public;
revoke execute on function public.session_transition(uuid, text, text, date, time) from anon;
grant execute on function public.session_transition(uuid, text, text, date, time) to authenticated;

-- ============================================================================
-- 2. refunds
-- ============================================================================

create type public.refund_status as enum ('pending', 'processed', 'failed');

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete restrict,
  domain public.payment_domain not null,
  entity_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  razorpay_refund_id text,
  status public.refund_status not null default 'pending',
  -- Why the last attempt did not go through, for the retry job and for the
  -- admin looking at a stuck refund. Cleared on success.
  failure_reason text,
  attempts integer not null default 0,
  -- Set only when the refund settles; a pending refund has written no ledger
  -- group, because no money has moved yet.
  ledger_entry_group_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotency on the domain row (for AT-60: the session id). This index is
-- what makes a double tap safe at the database level rather than at the edge
-- function's discretion: the second insert loses, and the caller reads the
-- existing row instead of issuing a second refund.
create unique index refunds_one_per_entity on public.refunds (domain, entity_id);

-- Razorpay's own refund id, the key the webhook dedupes on. Partial, because
-- a pending refund has not got one yet and several may coexist as null.
create unique index refunds_razorpay_refund_id_key
  on public.refunds (razorpay_refund_id)
  where razorpay_refund_id is not null;

-- The admin queue FR-35 requires: outstanding refunds, oldest first.
create index idx_refunds_status_created on public.refunds (status, created_at)
  where status <> 'processed';

create index idx_refunds_payment_intent_id on public.refunds (payment_intent_id);

create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();

alter table public.refunds enable row level security;

-- No client writes, ever: this is a money row, and CLAUDE.md's financial
-- invariant puts every write to it inside a service-role edge function.
revoke all on table public.refunds from anon, authenticated;
grant select on table public.refunds to authenticated;

-- Read access: admin sees everything (the FR-35 visibility requirement), and
-- the athlete who paid can see the refund owed to them so the app can say
-- "refund on its way" rather than going silent.
create policy refunds_select_admin on public.refunds
  for select to authenticated
  using (public.has_role('admin'));

create policy refunds_select_payer on public.refunds
  for select to authenticated
  using (
    exists (
      select 1 from public.payment_intents pi
      where pi.id = refunds.payment_intent_id
        and pi.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. settle_refund
--
-- The convergence point. Called by cancel-session-refund on Razorpay's
-- synchronous success AND by razorpay-webhook on refund.processed, both under
-- the service role. It is a no-op on an already-processed refund, which is
-- what makes "duplicate webhook + synchronous path" land on exactly one
-- refund record and exactly one ledger group.
--
-- The reversing ledger group, for a session cancelled from `requested`:
--
--   debit  platform                     total   money leaves platform custody
--   credit user <payer>                 total   returned to the athlete
--
-- Two legs, balanced, so assert_ledger_group_balanced passes. It mirrors the
-- capture convention in complete-session (debit platform = the clearing
-- account is the source of the movement, credits name the destinations),
-- pointed outward instead of inward.
--
-- "Nets the session to zero" (FR-35) is checkable exactly as written: for
-- domain = 'session' and this entity_id, sum(credits) - sum(debits) = 0. It
-- was zero before (a session accrues NOTHING at capture; see
-- finalize-session-payment.ts, the coach is credited only at completion) and
-- a balanced group keeps it zero. Critically, no coach credit and no platform
-- fee credit exists for this session, which is the real content of "the
-- platform retains no fee": there is no fee row to reverse because the coach
-- never accepted and the session was never completed.
-- ============================================================================

create or replace function public.settle_refund(
  p_refund_id uuid,
  p_razorpay_refund_id text default null
)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.refunds;
  v_intent public.payment_intents;
  v_group_id uuid := gen_random_uuid();
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;

  if v_refund.id is null then
    raise exception 'NOT_FOUND: refund % does not exist', p_refund_id;
  end if;

  -- Already settled: return it untouched. This is the whole idempotency
  -- story for the duplicate-webhook case, and it is a single row lock rather
  -- than a check-then-act race.
  if v_refund.status = 'processed' then
    return v_refund;
  end if;

  select * into v_intent
  from public.payment_intents
  where id = v_refund.payment_intent_id;

  if v_intent.id is null then
    raise exception 'NOT_FOUND: payment_intent % does not exist', v_refund.payment_intent_id;
  end if;

  insert into public.ledger_entries (
    entry_group_id, payment_intent_id, account_type, account_ref,
    direction, amount, domain, entity_id, description
  )
  values
    (
      v_group_id, v_intent.id, 'platform', null,
      'debit', v_refund.amount, v_refund.domain, v_refund.entity_id,
      format('Reversing: full refund of %s %s, no service rendered', v_refund.domain, v_refund.entity_id)
    ),
    (
      v_group_id, v_intent.id, 'user', v_intent.user_id,
      'credit', v_refund.amount, v_refund.domain, v_refund.entity_id,
      format('Refund returned to payer, %s %s', v_refund.domain, v_refund.entity_id)
    );

  update public.refunds
  set status = 'processed',
      razorpay_refund_id = coalesce(p_razorpay_refund_id, razorpay_refund_id),
      ledger_entry_group_id = v_group_id,
      failure_reason = null
  where id = p_refund_id
  returning * into v_refund;

  -- The charge's own lifecycle. Full refund only in this flow, so `refunded`
  -- rather than `partially_refunded`; admin-order-refund owns the partial
  -- case when it lands.
  update public.payment_intents
  set status = 'refunded'
  where id = v_intent.id;

  return v_refund;
end;
$$;

-- Service role only. Unlike session_transition this is not a user action; it
-- asserts that money moved, which no client may ever assert.
revoke all on function public.settle_refund(uuid, text) from public;
revoke execute on function public.settle_refund(uuid, text) from anon, authenticated;
grant execute on function public.settle_refund(uuid, text) to service_role;
