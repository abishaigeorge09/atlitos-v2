-- ATLITOS v2 - 0143_clip_moderation_deep_link.sql
--
-- BUG-074. moderate_clip (0043) writes the creator's notification with
-- deep_link '/clutch/clip/<id>', but the app's clip screen is
-- clutch/post/[id]. Tapping "Your clip is live", "Your clip was not approved"
-- or "Your clip was removed" opened an unmatched route. 32 production rows
-- carried the bad link on 2026-09-29.
--
-- This file redefines moderate_clip() with the IDENTICAL signature, security,
-- search_path and grants, every step exactly as it was, and changes only the
-- deep_link literal. Existing rows are NOT rewritten: notifications_lock_fields
-- (0002) makes deep_link immutable for every role, and that guard stays on.
-- The mobile app maps the old path instead
-- (apps/mobile/src/lib/notification-link.ts), which also covers a push already
-- delivered to a device with the link it was sent with.
--
-- Safe to apply at any time: no schema change, no client contract change, the
-- app resolves both paths.

create or replace function public.moderate_clip(
  p_clip_id uuid,
  p_action text,
  p_reason text default null
)
returns public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.clips;
  v_after public.clips;
  v_to public.clip_status;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  select * into v_before from public.clips where id = p_clip_id;
  if v_before.id is null then
    raise exception 'NOT_FOUND: clip % does not exist', p_clip_id;
  end if;

  v_to := case p_action
    when 'approve' then 'published'
    when 'reject'  then 'rejected'
    when 'remove'  then 'removed'
    else null
  end::public.clip_status;

  if v_to is null then
    raise exception 'VALIDATION: unknown moderation action %', p_action;
  end if;

  if p_action in ('reject', 'remove') and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'VALIDATION: a reason is required to % a clip', p_action;
  end if;

  v_after := public.clip_transition_internal(p_clip_id, v_to, p_reason);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'clip.' || p_action,
    'clip',
    p_clip_id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status),
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  -- Copy strings: no emoji, no hyphens, no em dashes.
  insert into public.notifications (user_id, type, title, body, deep_link)
  values (
    v_after.owner_id,
    'clip_moderation',
    case p_action
      when 'approve' then 'Your clip is live'
      when 'reject'  then 'Your clip was not approved'
      else 'Your clip was removed'
    end,
    case p_action
      when 'approve' then 'Your clip is now in the Clutch feed.'
      when 'reject'  then coalesce(nullif(btrim(p_reason), ''), 'Your clip did not meet our guidelines.')
      else coalesce(nullif(btrim(p_reason), ''), 'Your clip was removed after review.')
    end,
    '/clutch/post/' || p_clip_id::text
  );

  return v_after;
end;
$$;

revoke all on function public.moderate_clip(uuid, text, text) from public;
revoke execute on function public.moderate_clip(uuid, text, text) from anon;
grant execute on function public.moderate_clip(uuid, text, text) to authenticated, service_role;
