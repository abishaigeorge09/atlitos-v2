-- has_role(text) predates the named-role default privilege convention (created
-- in 0001 alongside handle_new_user) and still carried a literal PUBLIC
-- execute grant. Revoke PUBLIC, keep authenticated (used inside dozens of
-- `to authenticated` RLS policies).
revoke execute on function public.has_role(text) from public;
grant execute on function public.has_role(text) to authenticated;
