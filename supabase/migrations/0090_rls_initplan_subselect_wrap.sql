-- 0090_rls_initplan_subselect_wrap: wrap bare auth.uid()/auth.jwt() in scalar subselect (initplan). Expression-only, access-preserving, idempotent.
do $$
declare r record; v_new_qual text; v_new_check text; v_sql text; v_changed boolean; v_count int := 0;
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
    where schemaname='public' and ((qual is not null and qual ~ 'auth\.(uid|jwt)\(\)') or (with_check is not null and with_check ~ 'auth\.(uid|jwt)\(\)'))
  loop
    v_new_qual := r.qual; v_new_check := r.with_check; v_changed := false;
    if v_new_qual is not null then
      v_new_qual := regexp_replace(v_new_qual, '\(\s*select\s+auth\.uid\(\)\s+as\s+uid\s*\)', '__WUID__', 'gi');
      v_new_qual := regexp_replace(v_new_qual, '\(\s*select\s+auth\.jwt\(\)\s+as\s+jwt\s*\)', '__WJWT__', 'gi');
      v_new_qual := regexp_replace(v_new_qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      v_new_qual := regexp_replace(v_new_qual, 'auth\.jwt\(\)', '(select auth.jwt())', 'g');
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
    if not v_changed then continue; end if;
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_new_qual is not null then v_sql := v_sql || format(' using (%s)', v_new_qual); end if;
    if v_new_check is not null then v_sql := v_sql || format(' with check (%s)', v_new_check); end if;
    execute v_sql; v_count := v_count + 1;
  end loop;
  raise notice '0090 initplan wrap complete: % policies rewritten', v_count;
end $$;
