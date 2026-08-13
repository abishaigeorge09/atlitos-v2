-- ATLITOS v2 — 0107_money_edge_referential_restrict.sql
-- Domain: payments, referential integrity.
--
-- WRITTEN, NOT APPLIED. The DB write gate forbids applying it. Everything
-- below is derived from the repo's own DDL plus the read-only catalog work
-- recorded in docs/qa/verify/MONEY-INVARIANTS.md section 2.
--
-- ============================================================================
-- THE DEFECT, confirmed against production by SQL, not theorised
-- ============================================================================
--
-- 56 captured `membership` payment_intents (Rs 64,000) point at
-- `group_memberships` ids that no longer exist. The ledger balanced perfectly
-- the whole time, which is the point: a balance check structurally cannot see
-- money orphaned from its entity. It also produced Rs 63,440 of phantom
-- WITHDRAWABLE coach balance, because get_coach_wallet_balance() sums
-- ledger_entries with no join back to the owning membership.
--
-- The mechanism is two FK actions that disagree about who owns the money,
-- both declared in 0076:
--
--   group_memberships.group_id          -> training_groups   ON DELETE CASCADE
--   group_memberships.payment_intent_id -> payment_intents   ON DELETE SET NULL
--
-- Delete a training group and its memberships cascade away. The payments sit
-- on the other side of a SET NULL edge, so they survive with every ledger leg
-- intact and an `entity_id` that resolves to nothing. `entity_id` is a plain
-- uuid with no FK of its own, so nothing in the database objects.
--
-- ============================================================================
-- THE CORRECT BEHAVIOUR, stated as an invariant
-- ============================================================================
--
-- A captured payment must never become unattributable. Concretely: no single
-- DELETE may leave a payment_intent, or a ledger leg, whose owning row is gone
-- or whose link to it has been blanked.
--
-- RESTRICT is the enforcement, and it is not a new pattern here. 0076 line 140
-- already declares the sibling edge that way:
--
--   sessions.group_id -> training_groups ON DELETE RESTRICT
--
-- So within one migration the money-bearing child of training_groups was
-- protected and the fare-bearing one was not. This file makes them agree.
--
-- WHAT RESTRICT COSTS. A training group that has ever had a membership can no
-- longer be hard deleted. That is the intended outcome, not a side effect: the
-- recorded incident WAS a hard delete of 36 groups, and this is the statement
-- that would have refused it. Nothing in the product deletes a training group:
-- `grep -rn "training_groups"` across supabase/functions, packages/api and
-- apps finds no delete, and there is no delete_training_group RPC. Retiring a
-- group is a status change (0080's update_training_group), not a DELETE.
--
-- ============================================================================
-- CLASS SWEEP. Three more edges of the same shape, all fixed here
-- ============================================================================
--
-- Every `payment_intent_id` column in the schema was enumerated:
--
--   ledger_entries.payment_intent_id     0010:95   SET NULL   <- same class
--   sessions.payment_intent_id           0018:146  SET NULL   <- same class
--   group_memberships.payment_intent_id  0076:115  SET NULL   <- the confirmed one
--   orders.payment_intent_id             0031:252  NO ACTION  already refuses
--   refunds.payment_intent_id            0026:259  RESTRICT   already correct
--   donations.payment_intent_id          0048:183  RESTRICT   already correct
--   stock_reservations.payment_intent_id 0033:113  CASCADE    correct, a hold is not money
--   donation_intent_drafts.payment_...   0053:48   CASCADE    correct, a draft is not money
--
-- A SET NULL on `ledger_entries.payment_intent_id` is the worst of the three:
-- it detaches a ledger leg from the charge that produced it while leaving the
-- group balanced, so the balance check still passes and the attribution is
-- gone. All three become RESTRICT.
--
-- KNOWN REMAINING INSTANCE, deliberately NOT changed here. The entity rows
-- themselves cascade from `users`:
--
--   group_memberships.player_id -> users ON DELETE CASCADE   (0076:105)
--   sessions.player_id          -> users ON DELETE CASCADE   (0018:133)
--   orders.user_id              -> users ON DELETE CASCADE   (0031:196)
--
-- So deleting a user reproduces exactly this defect by a different door. It is
-- not fixed here because account deletion (0098) is not on this branch and the
-- right answer there is anonymise-and-retain rather than RESTRICT, which is a
-- design decision with a legal dimension, not a one-line FK change. Recorded
-- so the next agent does not read its absence as "already handled".
--
-- AN INTERACTION THAT MUST BE READ BEFORE 0098 IS APPLIED.
-- payment_intents.user_id -> users is ON DELETE CASCADE (0010:70). With
-- ledger_entries.payment_intent_id now RESTRICT, deleting a user who has ever
-- paid will FAIL: the cascade tries to remove their payment_intents and the
-- ledger legs refuse. That is the invariant doing its job, and it is also a
-- hard blocker for account deletion as currently designed. Whoever lands 0098
-- has to choose deliberately: anonymise the user row and keep the money rows
-- (the correct answer for a financial record), or explicitly detach with a
-- service-role step that records what it detached. What must not happen is
-- reverting this edge to SET NULL to make the delete pass, because that is
-- precisely the defect this file exists to close.
--
-- ============================================================================
-- PRE-EXISTING ROWS
-- ============================================================================
--
-- This migration does NOT repair the 56 orphans that already exist. It cannot:
-- the memberships they pointed at are gone, so there is nothing to re-attach
-- them to, and inventing replacement rows would be fabricating a money record.
-- It stops the 57th. The existing 56 need the founder decision recorded in
-- docs/qa/verify/VERIFICATION-WAVE-1.md section 6, cheap item 5.
--
-- The new constraints are added NOT VALID and then validated separately, so a
-- pre-existing row that violates one surfaces as a loud VALIDATE failure that
-- names the constraint, rather than an ALTER that either blocks the table for
-- the length of a full scan or fails with no indication of which edge broke.
-- Direction B was measured at zero for all of these (MONEY-INVARIANTS section
-- 2), so validation is expected to pass; it is written this way so that if the
-- expectation is wrong, the failure is legible.

-- ============================================================================
-- A helper that refuses to silently no-op.
--
-- `alter table ... drop constraint if exists <wrong_name>` is the exact shape
-- CURRENT-STATE.md warns about: the absence passes, the migration reports
-- success, and the FK action is unchanged. So the constraint is located by
-- (table, column, referenced table) in pg_constraint and the swap raises if
-- there is nothing to swap.
-- ============================================================================

create or replace function pg_temp.retarget_fk_to_restrict(
  p_table text,
  p_column text,
  p_ref_table text
)
returns void
language plpgsql
as $$
declare
  v_conname text;
  v_confdeltype "char";
begin
  select c.conname, c.confdeltype
    into v_conname, v_confdeltype
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_class rt on rt.oid = c.confrelid
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and n.nspname = 'public'
    and t.relname = p_table
    and rt.relname = p_ref_table
    and a.attname = p_column
    and array_length(c.conkey, 1) = 1;

  if v_conname is null then
    raise exception
      'MIGRATION_PRECONDITION: no single-column FK found on public.%(%) referencing public.%',
      p_table, p_column, p_ref_table;
  end if;

  -- 'r' is RESTRICT. Already-correct edges are left alone rather than dropped
  -- and recreated, so re-running this migration is a genuine no-op on them.
  if v_confdeltype = 'r' then
    raise notice 'public.%(%) -> public.% is already ON DELETE RESTRICT, leaving it',
      p_table, p_column, p_ref_table;
    return;
  end if;

  execute format('alter table public.%I drop constraint %I', p_table, v_conname);

  execute format(
    'alter table public.%I add constraint %I foreign key (%I) references public.%I (id) on delete restrict not valid',
    p_table, v_conname, p_column, p_ref_table
  );

  execute format('alter table public.%I validate constraint %I', p_table, v_conname);
end;
$$;

-- The confirmed defect: a training group can no longer be deleted out from
-- under the memberships that were paid for.
select pg_temp.retarget_fk_to_restrict('group_memberships', 'group_id', 'training_groups');

-- The three SET NULL money edges. Blanking the link is the same loss of
-- attribution as deleting the row, one indirection later.
select pg_temp.retarget_fk_to_restrict('group_memberships', 'payment_intent_id', 'payment_intents');
select pg_temp.retarget_fk_to_restrict('sessions', 'payment_intent_id', 'payment_intents');
select pg_temp.retarget_fk_to_restrict('ledger_entries', 'payment_intent_id', 'payment_intents');

comment on column public.group_memberships.group_id is
  '0107: ON DELETE RESTRICT, not CASCADE. A group that has been paid into cannot be hard deleted; retire it with update_training_group instead. The CASCADE this replaces is what orphaned 56 captured payments.';

comment on column public.group_memberships.payment_intent_id is
  '0107: ON DELETE RESTRICT, not SET NULL. A captured payment must never become unattributable, and blanking this column is how attribution was lost.';

comment on column public.ledger_entries.payment_intent_id is
  '0107: ON DELETE RESTRICT, not SET NULL. A detached ledger leg keeps its entry group balanced, so the balance check cannot see the loss.';
