-- ATLITOS v2 — 0042_clutch_rls.sql
-- Domain: clutch. Epic AT-7, story AT-90.
-- Requirements: PRD-01 FR-42, FR-45; PRD-04 FR-2.
--
-- RLS for every table 0041 created, plus the PRIVATE `clips` storage bucket.
-- 0041 did not enable RLS, so until this migration the tables are protected by
-- default grants alone; this closes them properly.
--
-- ============================================================================
-- PERMISSIVE-OR WARNING. READ THIS BEFORE WRITING ANY CLUTCH QUERY.
--
-- This is the exact shape CLAUDE.md records four incidents for. `clips` carries
-- BOTH a public browse policy (`status = 'published'`, the feed) AND an owner
-- policy (own clip, any status, for the profile and the immediate post-upload
-- view, FR-45). Postgres combines permissive policies for the same role and
-- command with OR, so:
--
--   an unscoped `select * from clips` returns the caller's own uploading,
--   processing, ready, rejected and removed clips ALONGSIDE everyone's
--   published clips. It does not error. It silently returns rows a feed query
--   must never show.
--
-- THE APP CODE CONTRACT, a requirement not a suggestion (CLAUDE.md, PHASE-5-
-- STATUS.md trap 2):
--   * The published feed query carries its OWN `.eq('status','published')`.
--   * The own-profile query carries its OWN `.eq('owner_id', user.id)`.
--   * That applies to app code, packages/api, supabase/seed and every test.
--   * Isolation tests assert the two parties' ids DIFFER before trusting the
--     result (the AT-62 vacuous-pass lesson): an assertion run as one user, or
--     against a row that user already owns, proves nothing.
--
-- RLS here is an authorization ceiling, not a scoping mechanism.
-- ============================================================================

alter table public.clips enable row level security;
alter table public.clip_likes enable row level security;
alter table public.clip_comments enable row level security;
alter table public.follows enable row level security;
alter table public.reports enable row level security;

-- ============================================================================
-- clips
--
-- Three SELECT policies (permissive-OR, see the warning): the published feed
-- (public), the owner's own clips in any status, and an admin/moderator read of
-- everything for the Moderation Queue. INSERT is own-row and forces `uploading`
-- (a client cannot insert a row already `published`). There is deliberately NO
-- UPDATE or DELETE policy: status only moves forward via the edge function
-- finalizer (stream-webhook, service_role) and the moderation RPCs (0043), and
-- the grants below withdraw those verbs so it is enforced twice. This is
-- PHASE-5-STATUS.md trap 3 (no client-set status) in the schema.
-- ============================================================================

create policy clips_select_published on public.clips
  for select to anon, authenticated
  using (status = 'published');

create policy clips_select_own on public.clips
  for select to authenticated
  using (owner_id = auth.uid());

create policy clips_select_admin on public.clips
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

create policy clips_insert_own on public.clips
  for insert to authenticated
  with check (owner_id = auth.uid() and status = 'uploading');

-- ============================================================================
-- clip_likes and follows. Public SELECT (the like/follow counts and the
-- viewer's own membership are read on the feed and profile). NO direct write
-- policy: the toggle RPCs (0044) are the only write path, which keeps the
-- count triggers authoritative and race-free (RLS.md clutch table). The grants
-- below withdraw insert/update/delete so a PostgREST write cannot bypass them.
-- ============================================================================

create policy clip_likes_select_public on public.clip_likes
  for select to anon, authenticated
  using (true);

create policy follows_select_public on public.follows
  for select to anon, authenticated
  using (true);

-- ============================================================================
-- clip_comments. SELECT on visible clips (published feed, own clip, or admin);
-- three permissive policies, same OR shape as clips. INSERT requires a signed-in
-- (NOT guest) author on a PUBLISHED clip (FR-43 comments are a feed action).
-- Own-row DELETE; NO UPDATE (comments are immutable once posted, RLS.md).
--
-- AT-63 lesson: an EXISTS subquery in a policy is itself subject to the
-- subquery target's RLS. clips_select_published (above, this migration) makes
-- published clips readable by anon, so these EXISTS predicates evaluate for the
-- feed reader rather than silently returning false.
-- ============================================================================

create policy clip_comments_select_on_published on public.clip_comments
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.clips c
      where c.id = clip_comments.clip_id and c.status = 'published'
    )
  );

create policy clip_comments_select_own_clip on public.clip_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.clips c
      where c.id = clip_comments.clip_id and c.owner_id = auth.uid()
    )
  );

create policy clip_comments_select_admin on public.clip_comments
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

create policy clip_comments_insert_own on public.clip_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.is_guest()
    and exists (
      select 1 from public.clips c
      where c.id = clip_comments.clip_id and c.status = 'published'
    )
  );

create policy clip_comments_delete_own on public.clip_comments
  for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- reports. Own submitted reports (a reporter sees their own), admin/moderator
-- reads all for the Reports Queue (PRD-04 FR-31). INSERT is own-row and
-- requires NOT guest (FR-32). NO client UPDATE: resolution goes through
-- resolve_report (0043), so a client can never hand-set a report's status.
--
-- Note: RLS.md's moderation table names `admin` for the reports read; this
-- aligns it to `admin OR moderator`, matching audit_log/verification_requests
-- in the same domain, because the Reports Queue is the same admin/moderator
-- surface as the Moderation Queue. Recorded in the RLS.md update.
-- ============================================================================

create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = auth.uid());

create policy reports_select_admin on public.reports
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and not public.is_guest());

-- ============================================================================
-- GRANTS. The second lock, independent of policy (0010/0032 house pattern).
--
-- clips: no client status write, by policy AND by grant. INSERT stays for
-- authenticated (own-row create, status forced uploading) per RLS.md; the
-- stream-upload-url edge function also creates rows under service_role.
-- ============================================================================

-- clips: anon KEEPS select (the published feed and creator_stats are guest
-- browsable, FR-42/FR-3; guest gating is on actions, not viewing). No client
-- status write by either mechanism; anon never inserts.
revoke insert, update, delete on public.clips from anon;
revoke update, delete on public.clips from authenticated;

-- Likes and follows: RPC-only writes, no direct DML for anyone. Both roles KEEP
-- select: the counts and creator_stats (a security_invoker view over follows)
-- are read by guests and members alike (RLS.md: "public, needed for counts").
revoke insert, update, delete on public.clip_likes from anon, authenticated;
revoke insert, update, delete on public.follows from anon, authenticated;

-- Comments: authenticated inserts (RLS gated) and own-row deletes; never
-- updatable. Anon reads comments on the published feed but never writes.
revoke insert, update, delete on public.clip_comments from anon;
revoke update on public.clip_comments from authenticated;

-- Reports: own-row insert for authenticated; resolution is RPC only. Anon has
-- no report surface at all (no policy grants it a read or write).
revoke update, delete on public.reports from anon, authenticated;
revoke all on public.reports from anon;

-- ============================================================================
-- THE PRIVATE `clips` STORAGE BUCKET. The crux of the phase's privacy design.
--
-- public = false, and there is DELIBERATELY NO policy on storage.objects for
-- this bucket: no anon read, no public read, no authenticated direct read. This
-- is the Supabase Storage equivalent of Cloudflare Stream's
-- requireSignedURLs: true. No clip object is resolvable by a guessed or scraped
-- path, in ANY clip status, because there is no policy that would authorize a
-- direct object fetch at all.
--
-- Every legitimate access goes through the service role instead:
--   * Upload: stream-upload-url (Track B, AT-94) mints a signed UPLOAD url with
--     the service role; the client PUTs against a token, which bypasses RLS.
--   * Playback: get_clip_playback_url / get_clip_moderation_url (Track B,
--     AT-96) mint short lived (TTL 300s) signed download urls with the service
--     role, AFTER checking the LIVE clip row. A path in a clip column is inert
--     on its own; only a fresh mint against a still-eligible row resolves.
--
-- This reconciles RLS.md's stale Storage row: it named bucket `clutch-video`
-- "governed by Cloudflare Stream signed URLs". The v1 reality, recorded in the
-- RLS.md update alongside this migration, is bucket `clips`, PRIVATE, Supabase
-- Storage signed URLs minted by edge functions. `clutch-video` was never
-- created (0006 shipped only avatars and coach-certificates), so there is no
-- stale bucket to drop, only the doc to correct.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('clips', 'clips', false)
on conflict (id) do nothing;
