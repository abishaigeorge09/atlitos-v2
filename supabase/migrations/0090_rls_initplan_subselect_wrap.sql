-- ATLITOS v2 — 0090_rls_initplan_subselect_wrap.sql
-- Domain: RLS performance (LAUNCH Phase 3). Item P1-4 (initplan half).
-- Track A (Database).
--
-- Since 0062 drove auth_rls_initplan to 0, migrations 0065-0089 added new
-- policies that call auth.uid() / auth.jwt() DIRECTLY, so those calls re-evaluate
-- per row (Supabase lint 0003). This migration wraps every such call in a scalar
-- subselect, `(select auth.uid())` / `(select auth.jwt())`, which Postgres
-- evaluates ONCE as an InitPlan instead of per row.
--
-- WHY THIS IS SAFE (access-preserving BY CONSTRUCTION, the 0062 argument):
-- `(select auth.uid())` returns the identical scalar as `auth.uid()`; the rewrite
-- is EXPRESSION-ONLY. It is applied with ALTER POLICY, which preserves the
-- policy's roles, command, and permissive/restrictive flag verbatim. The set of
-- rows any role can see therefore cannot change. This is a performance fix, not
-- an authorization change. (The isolation matrix in scripts/verify-rls-phase3.mjs
-- still proves it empirically, per verify-never-assert.)
--
-- Rather than hand-list the flagged policies (which requires reading live
-- pg_policies and drifts the moment another migration lands), this rewrites
-- WHATEVER the live set is: it finds every public-schema policy whose USING or
-- WITH CHECK text still contains a BARE auth.uid()/auth.jwt() and wraps only the
-- bare occurrences, leaving already-wrapped calls (from 0062) untouched. It is
-- idempotent: a second run finds nothing to change.

do $$
declare
  r record;
  v_new_qual text;
  v_new_check text;
  v_sql text;
  v_changed boolean;
  v_count int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual is not null and qual ~ 'auth\.(uid|jwt)\(\)')
        or (with_check is not null and with_check ~ 'auth\.(uid|jwt)\(\)')
      )
  loop
    v_new_qual := r.qual;
    v_new_check := r.with_check;
    v_changed := false;

    -- Rewrite helper is inlined per expression: neutralize already-wrapped forms
    -- (any spacing), wrap the remaining bare calls, restore. The neutralize step
    -- is what keeps this idempotent and prevents double-wrapping 0062's output.
    if v_new_qual is not null then
      v_new_qual := regexp_replace(v_new_qual, '\(\s*select\s+auth\.uid\(\)\s+as\s+uid\s*\)', '__WUID__', 'gi');
      v_new_qual := regexp_replace(v_new_qual, '\(\s*select\s+auth\.jwt\(\)\s+as\s+jwt\s*\)', '__WJWT__', 'gi');
      v_new_qual := regexp_replace(v_new_qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      v_new_qual := regexp_replace(v_new_qual, 'auth\.jwt\(\)', '(select auth.jwt())', 'g');
      -- Restore to Postgres's own canonical rendering so an already-wrapped
      -- policy reconstructs byte-identical and is skipped (true idempotence).
      v_new_qual := replace(v_new_qual, '__WUID__', '( SELECT auth.uid() AS uid)');
      v_new_qual := replace(v_new_qual, '__WJWT__', '( SELECT auth.jwt() AS jwt)');
      if v_new_qual is distinct from r.qual then v_changed := true; end if;
    end if;

    if v_new_check is not null then
      v_new_check := regexp_replace(v_new_check, '\(\s*select\s+auth\.uid\(\)\s+as\s+uid\s*\)', '__WUID__', 'gi');
      v_new_check := regexp_replace(v_new_check, '\(\s*select\s+auth\.jwt\(\)\s+as\s+jwt\s*\)', '__WJWT__', 'gi');
      v_new_check := regexp_replace(v_new_check, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      v_new_check := regexp_replace(v_new_check, 'auth\.jwt\(\)', '(select auth.jwt())', 'g');
      v_new_check := replace(v_new_check, '__WUID__', '( SELECT auth.uid() AS uid)');
      v_new_check := replace(v_new_check, '__WJWT__', '( SELECT auth.jwt() AS jwt)');
      if v_new_check is distinct from r.with_check then v_changed := true; end if;
    end if;

    if not v_changed then
      continue;
    end if;

    -- Only include the clause the policy actually supports: a SELECT policy has
    -- qual (USING) and no with_check; an INSERT policy has with_check and no qual.
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_new_qual is not null then
      v_sql := v_sql || format(' using (%s)', v_new_qual);
    end if;
    if v_new_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_new_check);
    end if;

    execute v_sql;
    v_count := v_count + 1;
    raise notice 'initplan-wrapped: %.% policy %', r.schemaname, r.tablename, r.policyname;
  end loop;

  raise notice '0090 initplan wrap complete: % policies rewritten', v_count;
end
$$;
