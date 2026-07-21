-- ATLITOS v2 — 0044_clutch_engagement_rpcs.sql
-- Domain: clutch. Epic AT-7, story AT-92.
-- Requirements: PRD-01 FR-43, FR-46.
--
-- The like and follow toggles. 0042 grants no direct DML on clip_likes or
-- follows, so these SECURITY DEFINER RPCs are the only write path; the count
-- triggers (0041) then keep clips.likes_count and the follower counts
-- authoritative. Both are idempotent by construction (membership toggle) and
-- both refuse guests server-side (FR-3/FR-43: a guest tap opens LoginGateSheet
-- on the client; the server refuses regardless of what the client does).

-- ============================================================================
-- toggle_clip_like. Idempotent: liking an already-liked clip is a no-op that
-- returns the same state, unliking removes the row. Returns the fresh state and
-- the trigger-maintained count so the client never computes the count itself.
-- Only a `published` clip can be liked (a non-published clip is not in any
-- feed and has no like affordance).
-- ============================================================================

create function public.toggle_clip_like(p_clip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.clip_status;
  v_liked boolean;
  v_count int;
begin
  if v_uid is null or public.is_guest() then
    raise exception 'FORBIDDEN: sign in to like clips';
  end if;

  select status into v_status from public.clips where id = p_clip_id;
  if v_status is null then
    raise exception 'NOT_FOUND: clip % does not exist', p_clip_id;
  end if;
  if v_status <> 'published' then
    raise exception 'FORBIDDEN: only published clips can be liked';
  end if;

  if exists (select 1 from public.clip_likes where clip_id = p_clip_id and user_id = v_uid) then
    delete from public.clip_likes where clip_id = p_clip_id and user_id = v_uid;
    v_liked := false;
  else
    insert into public.clip_likes (clip_id, user_id) values (p_clip_id, v_uid)
      on conflict (clip_id, user_id) do nothing;
    v_liked := true;
  end if;

  select likes_count into v_count from public.clips where id = p_clip_id;
  return jsonb_build_object('liked', v_liked, 'likes_count', v_count);
end;
$$;

revoke all on function public.toggle_clip_like(uuid) from public;
revoke execute on function public.toggle_clip_like(uuid) from anon;
grant execute on function public.toggle_clip_like(uuid) to authenticated, service_role;

-- ============================================================================
-- toggle_follow. Idempotent follow/unfollow of a creator. Refuses guests and a
-- self-follow (the follows table also CHECKs follower_id <> followee_id, this
-- gives a clean error before hitting it). Returns the fresh state and the
-- followee's current follower count.
-- ============================================================================

create function public.toggle_follow(p_followee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_following boolean;
  v_count int;
begin
  if v_uid is null or public.is_guest() then
    raise exception 'FORBIDDEN: sign in to follow creators';
  end if;
  if p_followee_id is null then
    raise exception 'VALIDATION: a creator to follow is required';
  end if;
  if p_followee_id = v_uid then
    raise exception 'VALIDATION: you cannot follow yourself';
  end if;
  if not exists (select 1 from public.users where id = p_followee_id) then
    raise exception 'NOT_FOUND: user % does not exist', p_followee_id;
  end if;

  if exists (
    select 1 from public.follows where follower_id = v_uid and followee_id = p_followee_id
  ) then
    delete from public.follows where follower_id = v_uid and followee_id = p_followee_id;
    v_following := false;
  else
    insert into public.follows (follower_id, followee_id) values (v_uid, p_followee_id)
      on conflict (follower_id, followee_id) do nothing;
    v_following := true;
  end if;

  select count(*)::int into v_count from public.follows where followee_id = p_followee_id;
  return jsonb_build_object('following', v_following, 'followers_count', v_count);
end;
$$;

revoke all on function public.toggle_follow(uuid) from public;
revoke execute on function public.toggle_follow(uuid) from anon;
grant execute on function public.toggle_follow(uuid) to authenticated, service_role;
