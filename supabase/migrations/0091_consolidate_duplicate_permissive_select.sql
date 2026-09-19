-- ATLITOS v2 — 0091_consolidate_duplicate_permissive_select.sql
-- Domain: RLS performance (LAUNCH Phase 3). Item P1-4 (consolidation half).
-- Track A (Database). HIGHEST BLAST RADIUS OF THE PHASE.
--
-- Postgres OR-combines permissive policies: N permissive SELECT policies for the
-- SAME role set are EXACTLY equivalent to one policy whose USING is their OR
-- union. Collapsing them removes a per-row policy evaluation with zero change to
-- the visible-row set. This is the 0063 pass re-applied to the duplicates that
-- accumulated in migrations 0065-0089.
--
-- THE HARD SAFETY RULE (CLAUDE.md permissive-OR, three prior cross-tenant
-- incidents): a merge is safe ONLY when it does not fold an owner disjunct into
-- an anon-reachable expression. This migration therefore merges ONLY policies
-- whose role set is EXACTLY {authenticated}:
--   * roles = {authenticated} exactly (NEVER a set containing anon or public);
--   * cmd = SELECT exactly (NEVER a FOR ALL policy: splitting one risks widening
--     a write path, and its SELECT contribution is left intact and simply OR'd
--     at evaluation time);
--   * PERMISSIVE only (RESTRICTIVE policies AND together and are never merged).
-- Any table whose duplicate SELECT policies include an {anon,authenticated} or
-- {public} policy is LEFT UNTOUCHED here (the P8 "21 KEEP" set): a cross-role-set
-- merge is exactly the footgun the rule forbids, and the initplan win on those
-- policies was already taken by 0090.
--
-- Access-preservation is therefore a THEOREM, not a guess: for a fixed role set
-- and command, the effective USING is the OR of every permissive policy's USING;
-- replacing several with one whose USING is that same OR leaves the effective
-- predicate identical. scripts/verify-rls-phase3.mjs proves it empirically with
-- the AT-62 id-differ isolation matrix regardless.
--
-- Merged policy name per table: <table>_select_merged (the 0063 convention). If a
-- prior _select_merged already exists it is folded in and recreated, so re-runs
-- and future duplicates converge on one policy.

do $$
declare
  t record;
  p record;
  v_union text;
  v_n int;
  v_merged_name text;
  v_tables int := 0;
  v_dropped int := 0;
begin
  -- Tables in public with >= 2 permissive, SELECT, exactly-{authenticated}
  -- policies whose USING is non-null.
  for t in
    select tablename, count(*) as n
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual is not null
    group by tablename
    having count(*) >= 2
  loop
    v_tables := v_tables + 1;
    v_merged_name := t.tablename || '_select_merged';
    v_union := null;
    v_n := 0;

    -- Build the OR union and drop each participating policy.
    for p in
      select policyname, qual
      from pg_policies
      where schemaname = 'public'
        and tablename = t.tablename
        and permissive = 'PERMISSIVE'
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
        and qual is not null
      order by policyname
    loop
      v_n := v_n + 1;
      if v_union is null then
        v_union := '(' || p.qual || ')';
      else
        v_union := v_union || ' or (' || p.qual || ')';
      end if;
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
      v_dropped := v_dropped + 1;
    end loop;

    -- One merged permissive SELECT policy for {authenticated}, USING the union.
    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      v_merged_name, t.tablename, v_union
    );

    raise notice '0091 merged % authenticated SELECT policies on public.% into %',
      v_n, t.tablename, v_merged_name;
  end loop;

  raise notice '0091 consolidation complete: % tables, % policies dropped into merged policies',
    v_tables, v_dropped;
end
$$;
