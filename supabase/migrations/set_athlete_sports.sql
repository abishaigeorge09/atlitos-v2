create or replace function public.set_athlete_sports(
  p_sports public.sport[],
  p_primary public.sport
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if p_sports is null or array_length(p_sports, 1) is null then
    raise exception 'VALIDATION: at least one sport is required';
  end if;

  if p_primary is null or p_primary <> all (p_sports) then
    raise exception 'VALIDATION: primary sport must be one of the selected sports';
  end if;

  update public.users
  set sports = p_sports
  where id = auth.uid();

  delete from public.athlete_sports
  where user_id = auth.uid()
    and sport <> all (p_sports);

  insert into public.athlete_sports (user_id, sport, is_primary)
  select auth.uid(), s, s = p_primary
  from unnest(p_sports) as s
  on conflict (user_id, sport) do update set is_primary = excluded.is_primary;
end;
$$;

revoke all on function public.set_athlete_sports(public.sport[], public.sport) from public;
grant execute on function public.set_athlete_sports(public.sport[], public.sport) to authenticated;
