-- Phase 1 pre launch security lockdown: storage bucket limits + anon RPC lockdown

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id in ('avatars', 'venue-media', 'upa-photos', 'gratitude-photos', 'product-media');

revoke execute on function public.create_group_chat_thread() from anon, authenticated;
revoke execute on function public.sync_group_chat_membership() from anon, authenticated;
revoke execute on function public.grant_court_staff_role_on_accept() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;

revoke execute on function public.is_group_coach(uuid, uuid) from anon;
revoke execute on function public.is_group_member_live(uuid, uuid) from anon;
revoke execute on function public.is_session_coach(uuid, uuid) from anon;
revoke execute on function public.is_session_participant(uuid, uuid) from anon;

revoke execute on function public.has_role(text) from anon;

revoke execute on function public.set_athlete_sports(public.sport[], public.sport) from anon;
