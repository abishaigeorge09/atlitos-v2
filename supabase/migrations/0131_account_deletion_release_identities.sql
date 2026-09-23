-- ATLITOS v2 — 0131_account_deletion_release_identities.sql
--
-- Account deletion released the email and phone and banned the GoTrue user,
-- but left its auth.identities rows in place. For an Apple or Google account
-- that row is what GoTrue looks up on the next sign in (provider + provider
-- subject), so the same Apple ID or Google account resolved straight back to
-- the banned user and could never register again. Email and phone accounts
-- were fine because their identifiers were rewritten.
--
-- The fix rides the existing post-release hook: delete-account calls
-- account_deletion_mark_auth_released() only after the GoTrue release and ban
-- succeeded, so the identity rows are dropped at exactly that point. The ban
-- stays on the old user; the next Apple or Google sign in creates a fresh one.
-- Email and phone identities are left alone, the release already neutralised
-- them and the ban still has to hold.
--
-- Same signature, same grants (service_role only).

create or replace function public.account_deletion_mark_auth_released(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.identities
   where user_id = p_user_id
     and provider not in ('email', 'phone');

  update public.account_deletions
     set auth_released_at = now()
   where user_id = p_user_id;
end;
$$;

revoke all on function public.account_deletion_mark_auth_released(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_mark_auth_released(uuid) to service_role;
