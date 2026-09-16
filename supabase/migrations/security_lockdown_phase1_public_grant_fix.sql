-- follow-up: these 4 trigger-only functions predate the named-role default
-- privilege convention and still carried a literal PUBLIC execute grant,
-- which anon inherits regardless of any anon-specific revoke. Close it.
revoke execute on function public.create_group_chat_thread() from public;
revoke execute on function public.sync_group_chat_membership() from public;
revoke execute on function public.grant_court_staff_role_on_accept() from public;
revoke execute on function public.handle_new_user() from public;
