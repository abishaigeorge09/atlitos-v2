-- ATLITOS v2 — 0047_clutch_trigger_fn_grant_fix.sql
-- Domain: clutch. Epic AT-7, story AT-89 (advisor fix).
--
-- The two count TRIGGER functions were RPC-executable by anon/authenticated
-- (RLS advisor: anon_/authenticated_security_definer_function_executable). A
-- trigger fires as the table owner regardless of execute grants, so withdraw
-- execute from every client role so neither is reachable over /rest/v1/rpc.
-- Same fix 0037 applied to block_delete_address_in_use. (Also asserted inline
-- in 0041 so a fresh replay is clean without this migration.)
revoke all on function public.clip_likes_maintain_count() from public, anon, authenticated;
revoke all on function public.clip_comments_maintain_count() from public, anon, authenticated;
