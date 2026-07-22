-- ATLITOS v2 — 0059_learn_xp_engine.sql
-- Domain: learn. Epic AT-9, story AT-131 (Track A).
-- Requirements: PRD-01 FR-49, FR-50, FR-51.
--
-- THE XP ENGINE. One AFTER INSERT trigger on drill_completions that:
--   1. Appends EXACTLY ONE xp_events row, xp_amount read SERVER-SIDE from
--      drills.xp_value (never from any client input), in the SAME transaction as
--      the completion. This is what makes XP un-forgeable: the client's only
--      write is the completion row; it never supplies or influences the amount.
--   2. Evaluates every milestone's criteria against the caller's fresh XP total
--      (sum(xp_amount)) and completion count, and unlocks each newly met one.
--
-- Both idempotent by construction:
--   * A duplicate completion fails 0057's UNIQUE(user_id, drill_id) BEFORE this
--     trigger fires, so no second xp_events row is ever written (the FR-49
--     idempotency guard is the schema constraint, not this code).
--   * A milestone re-evaluation cannot double-unlock: the insert is
--     ON CONFLICT (user_id, milestone_id) DO NOTHING against 0057's UNIQUE.
--
-- SECURITY DEFINER: the function writes xp_events and user_milestones, on which
-- the caller (authenticated) has NO write grant (0058). It runs as the table
-- owner and so bypasses that lockdown by design. This is the ONLY writer of
-- those two tables. NOT A MONEY PATH: a plain trigger is the proportionate
-- mechanism (no edge function, no RPC, no ledger), PHASE-7-STATUS.md assumption 5.

create function public.grant_xp_on_drill_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xp_value int;
  v_xp_total int;
  v_drill_count int;
begin
  -- (1) Read the award amount SERVER-SIDE from the drill. The client supplied
  -- only user_id + drill_id on the completion row; the amount comes from here,
  -- never from client input. A drill row must exist (FK guarantees it) and
  -- xp_value is CHECK (> 0), so the grant is always a positive int.
  select d.xp_value into v_xp_value
  from public.drills d
  where d.id = new.drill_id;

  -- Append EXACTLY ONE xp_events row, same transaction as the completion.
  insert into public.xp_events (user_id, drill_id, source, xp_amount)
  values (new.user_id, new.drill_id, 'drill_complete', v_xp_value);

  -- (2) Milestone evaluation against the caller's FRESH totals (the row above is
  -- already visible in this transaction). XP total is the derived sum; drill
  -- count is the completion count including this one.
  select coalesce(sum(xp_amount), 0) into v_xp_total
  from public.xp_events
  where user_id = new.user_id;

  select count(*) into v_drill_count
  from public.drill_completions
  where user_id = new.user_id;

  -- Unlock every milestone whose criteria is now met and not already earned.
  -- ON CONFLICT DO NOTHING makes the unlock idempotent (0057 UNIQUE), so a
  -- re-fire or an already-earned milestone never produces a duplicate row.
  insert into public.user_milestones (user_id, milestone_id)
  select new.user_id, m.id
  from public.milestones m
  where (
    (m.criteria->>'type' = 'xp_threshold' and (m.criteria->>'value')::int <= v_xp_total)
    or (m.criteria->>'type' = 'drill_count' and (m.criteria->>'value')::int <= v_drill_count)
  )
  on conflict (user_id, milestone_id) do nothing;

  return new;
end;
$$;

-- A trigger fires as the table owner regardless of execute grants, so withdraw
-- execute from every client role: the function must not be reachable over
-- /rest/v1/rpc (the 0037/0047 advisor fix, applied at creation here so a fresh
-- replay is clean).
revoke all on function public.grant_xp_on_drill_completion() from public, anon, authenticated;

create trigger drill_completions_grant_xp
  after insert on public.drill_completions
  for each row execute function public.grant_xp_on_drill_completion();

comment on function public.grant_xp_on_drill_completion() is
  'The XP engine (AT-131). AFTER INSERT on drill_completions: appends exactly one xp_events row with xp_amount read server-side from drills.xp_value (un-forgeable), then unlocks each newly met milestone (idempotent via ON CONFLICT on the 0057 UNIQUE). SECURITY DEFINER: the sole writer of xp_events/user_milestones, which no client can write (0058).';
