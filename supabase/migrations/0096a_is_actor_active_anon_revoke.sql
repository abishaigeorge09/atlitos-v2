-- Close the default-privilege anon grant on is_actor_active (0089 discipline: revoke from public does not drop the named anon grant). Safe: restrictive policies calling it are `to authenticated`; anon never evaluates them and never calls it directly.
revoke execute on function public.is_actor_active() from anon;
