-- 0091_consolidate_duplicate_permissive_select: merge only exactly-{authenticated} PERMISSIVE SELECT policies (OR-union, access-preserving theorem). Never anon/public, never FOR ALL.
do $$
declare t record; p record; v_union text; v_merged_name text; v_tables int := 0; v_dropped int := 0;
begin
  for t in select tablename, count(*) as n from pg_policies
    where schemaname='public' and permissive='PERMISSIVE' and cmd='SELECT' and roles=array['authenticated']::name[] and qual is not null
    group by tablename having count(*) >= 2
  loop
    v_tables := v_tables + 1; v_merged_name := t.tablename || '_select_merged'; v_union := null;
    for p in select policyname, qual from pg_policies
      where schemaname='public' and tablename=t.tablename and permissive='PERMISSIVE' and cmd='SELECT' and roles=array['authenticated']::name[] and qual is not null
      order by policyname
    loop
      if v_union is null then v_union := '(' || p.qual || ')'; else v_union := v_union || ' or (' || p.qual || ')'; end if;
      execute format('drop policy %I on public.%I', p.policyname, t.tablename); v_dropped := v_dropped + 1;
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (%s)', v_merged_name, t.tablename, v_union);
    raise notice '0091 merged authenticated SELECT policies on public.% into %', t.tablename, v_merged_name;
  end loop;
  raise notice '0091 consolidation complete: % tables, % policies dropped into merged policies', v_tables, v_dropped;
end $$;
