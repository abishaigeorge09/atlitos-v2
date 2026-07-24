-- ============================================================================
-- 0074: rebuild creator_stats over public_profiles so it actually returns rows
-- for creators other than the caller.
--
-- Defect: 0041 defined creator_stats with security_invoker = on and
-- FROM public.users. users RLS (0001) is own-row/admin only, so under invoker
-- RLS the view's FROM yields zero rows for anon and only the caller's own row
-- for authenticated. useClutch.getCreator's .maybeSingle() on creator_stats
-- therefore returned null for every creator except self, and the Clutch
-- creator profile rendered its not-found state, despite API-MAPPING.md
-- declaring the surface public read. The 0042/0046 grant history only touched
-- clips/follows; nothing ever fixed the users FROM.
--
-- Fix: keep security_invoker = on (the advisor-clean posture; the clips and
-- follows subqueries stay public read per 0042/0046 so the aggregate remains
-- deterministic and identical for every viewer), but drive the row set from
-- public.public_profiles, the security definer view that is the sole
-- cross-user read surface for users (0001, extended in 0072). One row per
-- user, same id set as users, no private column exposure.
--
-- create or replace is safe: the column list (user_id + four aggregates) is
-- unchanged, only the FROM changes. Grants persist across create or replace
-- but are restated to keep the surface explicit.
-- ============================================================================

create or replace view public.creator_stats
with (security_invoker = on)
as
select
  p.id as user_id,
  (
    select count(*) from public.clips c
    where c.owner_id = p.id and c.status = 'published'
  )::int as published_clips_count,
  (
    select count(*) from public.follows f
    where f.followee_id = p.id
  )::int as followers_count,
  (
    select count(*) from public.follows f
    where f.follower_id = p.id
  )::int as following_count,
  coalesce((
    select sum(c.likes_count) from public.clips c
    where c.owner_id = p.id and c.status = 'published'
  ), 0)::bigint as total_likes
from public.public_profiles p;

grant select on public.creator_stats to anon, authenticated;

comment on view public.creator_stats is
  'Display only per creator aggregate for the Clutch profile (FR-47): published clip count, follower/following counts, total likes across published clips. Rows come from public_profiles (the definer cross-user surface) so every viewer, including anon, sees every creator; the clips/follows subqueries run under caller RLS (security_invoker) and only published clips and public follows contribute, so no private clip leaks and the numbers are identical for every viewer.';
