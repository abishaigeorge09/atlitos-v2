-- 0107_money_edge_referential_restrict
-- Retargets the four FK edges that let captured money become unattributable.
-- 56 captured membership payment_intents (Rs 64,000) pointed at group_memberships
-- ids that no longer existed, because group_memberships.group_id CASCADEd from
-- training_groups while payment_intent_id was SET NULL. The ledger balanced
-- throughout, which is the point: a balance check cannot see money orphaned
-- from its entity. Verified before applying: 0 orphan rows on all four edges.

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

select pg_temp.retarget_fk_to_restrict('group_memberships', 'group_id', 'training_groups');
select pg_temp.retarget_fk_to_restrict('group_memberships', 'payment_intent_id', 'payment_intents');
select pg_temp.retarget_fk_to_restrict('sessions', 'payment_intent_id', 'payment_intents');
select pg_temp.retarget_fk_to_restrict('ledger_entries', 'payment_intent_id', 'payment_intents');

comment on column public.group_memberships.group_id is
  '0107: ON DELETE RESTRICT, not CASCADE. A group that has been paid into cannot be hard deleted; retire it with update_training_group instead. The CASCADE this replaces is what orphaned 56 captured payments.';

comment on column public.group_memberships.payment_intent_id is
  '0107: ON DELETE RESTRICT, not SET NULL. A captured payment must never become unattributable, and blanking this column is how attribution was lost.';

comment on column public.ledger_entries.payment_intent_id is
  '0107: ON DELETE RESTRICT, not SET NULL. A detached ledger leg keeps its entry group balanced, so the balance check cannot see the loss.';
