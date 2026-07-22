-- ATLITOS v2 — 0049_empower_rls.sql
-- Domain: empower. Epic AT-8, story AT-109.
-- Requirements: PRD-05 FR-3, FR-9, FR-12, FR-13, FR-24; PRD-06 FR-1, FR-12.
--
-- RLS + grants for every table 0048 created, plus the three storage buckets.
--
-- ============================================================================
-- PERMISSIVE-OR WARNING. READ THIS BEFORE WRITING ANY EMPOWER QUERY.
--
-- This is the exact shape CLAUDE.md records FOUR incidents for. Three empower
-- tables carry a PUBLIC verified-browse policy BESIDE an owner policy on the
-- same table for the same role:
--
--   * upa_applications      public: status = 'verified'
--   * upa_wishlist_items     public: the parent UPA is verified
--   * gratitude_posts        public: the parent UPA is verified
--
-- Postgres combines permissive policies for the same role and command with OR.
-- So an UNSCOPED `select * from upa_applications` run by a UPA owner returns
-- their OWN submitted / under_review / needs_info / rejected / deactivated rows
-- ALONGSIDE every verified UPA's public row. It does not error. It silently
-- returns rows a public browse must never show and rows that belong to other
-- owners.
--
-- THE APP CODE CONTRACT, a requirement not a suggestion (CLAUDE.md, PHASE-6-
-- STATUS.md trap 1):
--   * The consumer public browse carries its OWN `.eq('status','verified')`.
--   * The owner dashboard carries its OWN `.eq('applicant_user_id', user.id)`
--     (or reaches items/gratitude THROUGH an owner-filtered application id).
--   * That applies to app code, packages/api, supabase/seed and every test.
--   * Isolation tests assert the two parties' ids DIFFER before trusting the
--     result (the AT-62 vacuous-pass lesson): an assertion run as one user, or
--     against a row that user already owns, proves nothing.
--
-- RLS here is an authorization ceiling, not a scoping mechanism.
-- ============================================================================

alter table public.upa_applications enable row level security;
alter table public.upa_evidence enable row level security;
alter table public.upa_wishlist_items enable row level security;
alter table public.donations enable row level security;
alter table public.gratitude_posts enable row level security;

-- ============================================================================
-- upa_applications
--
-- SELECT (permissive-OR, see warning): verified rows are public (the consumer
-- Empower hub / profile, PRD-06 FR-1), the applicant reads their own row in any
-- status (the Life portal /status, /dashboard), admin/moderator read all for
-- review. There is DELIBERATELY NO client INSERT/UPDATE/DELETE policy: the row
-- is created only by submit_upa_application / reapply_upa_application (0050) and
-- its story fields edited only by resubmit_upa_application; status moves only
-- via those RPCs and the admin verify branch. Grants below withdraw every write
-- verb so it is enforced twice (the 0010/0032 house pattern).
-- ============================================================================

create policy upa_applications_select_verified on public.upa_applications
  for select to anon, authenticated
  using (status = 'verified');

create policy upa_applications_select_own on public.upa_applications
  for select to authenticated
  using (applicant_user_id = auth.uid());

create policy upa_applications_select_admin on public.upa_applications
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

-- ============================================================================
-- upa_evidence
--
-- Read only by the owning applicant (through their application) and admin;
-- NEVER public (evidence includes ID proof and guardian consent, PRD-05 FR-3).
-- INSERT is own-application only, so the apply wizard can attach evidence to a
-- row it owns; NO UPDATE/DELETE after submission (evidence is immutable review
-- material, RLS.md). AT-63 lesson: the EXISTS targets upa_applications, whose
-- own-row select policy (above) authorizes the applicant's read of their own
-- application inside this subquery.
-- ============================================================================

create policy upa_evidence_select_own on public.upa_evidence
  for select to authenticated
  using (
    exists (
      select 1 from public.upa_applications a
      where a.id = upa_evidence.application_id and a.applicant_user_id = auth.uid()
    )
  );

create policy upa_evidence_select_admin on public.upa_evidence
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

create policy upa_evidence_insert_own on public.upa_evidence
  for insert to authenticated
  with check (
    exists (
      select 1 from public.upa_applications a
      where a.id = upa_evidence.application_id and a.applicant_user_id = auth.uid()
    )
  );

-- ============================================================================
-- upa_wishlist_items
--
-- SELECT (permissive-OR): items of a VERIFIED UPA are public (the funding grid,
-- PRD-06 FR-4), the owning UPA reads its own items in any status. INSERT is
-- own-UPA only. UPDATE/DELETE are own-UPA AND gated to `status = 'open' AND
-- funded_amount = 0` in BOTH using and with check (PRD-05 FR-12/FR-13: an item
-- cannot be edited or removed once any money has arrived).
--
-- CRITICAL (PHASE-6-STATUS.md trap 3, gate clause 7): funded_amount and status
-- are NOT in the client's allowed column set. RLS WITH CHECK cannot by itself
-- forbid setting a specific column, so this is enforced by GRANT: the UPDATE
-- grant to authenticated is COLUMN-SCOPED to the editable fields only (title,
-- cost, updated_at), and funded_amount/status carry no update privilege for
-- authenticated at all. The donate finalize handler moves them under the
-- service role. A client UPDATE touching funded_amount or status fails at the
-- privilege check (42501) before any policy runs.
-- ============================================================================

create policy upa_wishlist_items_select_verified on public.upa_wishlist_items
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.upa_applications a
      where a.id = upa_wishlist_items.upa_id and a.status = 'verified'
    )
  );

create policy upa_wishlist_items_select_own on public.upa_wishlist_items
  for select to authenticated
  using (
    exists (
      select 1 from public.upa_applications a
      where a.id = upa_wishlist_items.upa_id and a.applicant_user_id = auth.uid()
    )
  );

create policy upa_wishlist_items_insert_own on public.upa_wishlist_items
  for insert to authenticated
  with check (
    status = 'open'
    and funded_amount = 0
    and exists (
      select 1 from public.upa_applications a
      where a.id = upa_wishlist_items.upa_id and a.applicant_user_id = auth.uid()
    )
  );

create policy upa_wishlist_items_update_own_open on public.upa_wishlist_items
  for update to authenticated
  using (
    status = 'open'
    and funded_amount = 0
    and exists (
      select 1 from public.upa_applications a
      where a.id = upa_wishlist_items.upa_id and a.applicant_user_id = auth.uid()
    )
  )
  with check (
    status = 'open'
    and funded_amount = 0
    and exists (
      select 1 from public.upa_applications a
      where a.id = upa_wishlist_items.upa_id and a.applicant_user_id = auth.uid()
    )
  );

create policy upa_wishlist_items_delete_own_open on public.upa_wishlist_items
  for delete to authenticated
  using (
    status = 'open'
    and funded_amount = 0
    and exists (
      select 1 from public.upa_applications a
      where a.id = upa_wishlist_items.upa_id and a.applicant_user_id = auth.uid()
    )
  );

-- ============================================================================
-- donations
--
-- SELECT: the donor reads their own donations (My Impact, PRD-06 FR-12), the
-- owning UPA reads donations attributed to it (via upa_id), admin reads all.
-- NO write policy of ANY kind for anon/authenticated: donations are inserted
-- ONLY by the donate finalize edge function under the service role (PHASE-6-
-- STATUS.md trap 3, gate clause 7). Enforced twice, by the absence of a write
-- policy AND by the grant revocation below.
-- ============================================================================

create policy donations_select_own_donor on public.donations
  for select to authenticated
  using (donor_id = auth.uid());

create policy donations_select_own_upa on public.donations
  for select to authenticated
  using (
    upa_id is not null
    and exists (
      select 1 from public.upa_applications a
      where a.id = donations.upa_id and a.applicant_user_id = auth.uid()
    )
  );

create policy donations_select_admin on public.donations
  for select to authenticated
  using (public.has_role('admin') or public.has_role('moderator'));

-- ============================================================================
-- gratitude_posts
--
-- SELECT (permissive-OR): posts of a VERIFIED UPA that are `published` are
-- public (the item detail and public profile, PRD-05 FR-19), the owning UPA
-- reads its own posts in any status. INSERT is own-UPA AND only for a
-- funded/delivered item that has NO existing post (the UNIQUE(wishlist_item_id)
-- is the hard backstop; this WITH CHECK gives the friendly gate). soft-delete
-- is an own-UPA UPDATE to status = 'removed' only; NO hard DELETE (posts are
-- immutable history, RLS.md). The editable-column grant below restricts the
-- UPDATE to status/deleted_at so the body/photo cannot be rewritten after post.
-- ============================================================================

create policy gratitude_posts_select_public on public.gratitude_posts
  for select to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.upa_applications a
      where a.id = gratitude_posts.upa_id and a.status = 'verified'
    )
  );

create policy gratitude_posts_select_own on public.gratitude_posts
  for select to authenticated
  using (
    exists (
      select 1 from public.upa_applications a
      where a.id = gratitude_posts.upa_id and a.applicant_user_id = auth.uid()
    )
  );

create policy gratitude_posts_insert_own on public.gratitude_posts
  for insert to authenticated
  with check (
    status = 'published'
    and exists (
      select 1 from public.upa_applications a
      where a.id = gratitude_posts.upa_id and a.applicant_user_id = auth.uid()
    )
    and exists (
      select 1 from public.upa_wishlist_items i
      where i.id = gratitude_posts.wishlist_item_id
        and i.upa_id = gratitude_posts.upa_id
        and i.status in ('funded', 'delivered')
    )
    and not exists (
      select 1 from public.gratitude_posts g
      where g.wishlist_item_id = gratitude_posts.wishlist_item_id
    )
  );

create policy gratitude_posts_update_own_softdelete on public.gratitude_posts
  for update to authenticated
  using (
    exists (
      select 1 from public.upa_applications a
      where a.id = gratitude_posts.upa_id and a.applicant_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.upa_applications a
      where a.id = gratitude_posts.upa_id and a.applicant_user_id = auth.uid()
    )
  );

-- ============================================================================
-- GRANTS. The second lock, independent of policy (0010/0032/0042 house pattern).
-- ============================================================================

-- upa_applications: read only for clients; every write goes through a 0050 RPC.
-- anon keeps SELECT (the verified public browse is guest-visible, PRD-06 FR-1).
revoke insert, update, delete on public.upa_applications from anon, authenticated;
revoke all on public.upa_applications from anon;
grant select on public.upa_applications to anon;

-- upa_evidence: own-application INSERT for authenticated; never public, never
-- updatable/deletable by a client. anon has no evidence surface at all.
revoke update, delete on public.upa_evidence from anon, authenticated;
revoke all on public.upa_evidence from anon;

-- upa_wishlist_items: authenticated may INSERT/DELETE (own, open, unfunded) and
-- UPDATE ONLY the editable columns. funded_amount and status carry NO update
-- privilege for authenticated, so a client UPDATE of either fails 42501 before
-- any policy is evaluated (this is the column-exclusion the WITH CHECK alone
-- cannot express). The donate finalize handler writes them under service_role.
revoke insert, update, delete on public.upa_wishlist_items from anon, authenticated;
grant insert, delete on public.upa_wishlist_items to authenticated;
grant update (title, cost, updated_at) on public.upa_wishlist_items to authenticated;
-- anon keeps SELECT (verified UPAs' items are guest-browsable, PRD-06 FR-4).

-- donations: NO client write by either mechanism. anon has no surface at all.
-- The donate finalize edge function inserts under service_role (bypasses RLS
-- and grants).
revoke insert, update, delete on public.donations from anon, authenticated;
revoke all on public.donations from anon;

-- gratitude_posts: own INSERT and soft-delete-only UPDATE (status/deleted_at)
-- for authenticated; NO hard DELETE, NO body/photo rewrite. anon keeps SELECT
-- (published posts of verified UPAs are public).
revoke insert, update, delete on public.gratitude_posts from anon, authenticated;
grant insert on public.gratitude_posts to authenticated;
grant update (status, deleted_at) on public.gratitude_posts to authenticated;

-- ============================================================================
-- verification_requests: wire the UPA applicant ownership branches, left as
-- no-ops in 0003 until public.upa_applications existed (0003 header note). The
-- UPA's applicant_id is the upa_applications.id (SCHEMA.md), so ownership is a
-- join to that row's applicant_user_id. NO client INSERT policy is added: the
-- UPA verification_requests row is created ONLY by submit/reapply_upa_application
-- (0050, SECURITY DEFINER), mirroring how the coach flow's row is created by
-- submit_coach_verification, so an application can never exist without its
-- linked request. The admin approve/reject UPDATE policy from 0003 already
-- covers every applicant_type.
-- ============================================================================

create policy verification_requests_select_own_upa on public.verification_requests
  for select to authenticated
  using (
    applicant_type = 'upa'
    and exists (
      select 1 from public.upa_applications a
      where a.id = verification_requests.applicant_id and a.applicant_user_id = auth.uid()
    )
  );

-- ============================================================================
-- Storage buckets (RLS.md Storage table).
--   upa-evidence     PRIVATE: owner + admin read, owner insert, path {application_id}/...
--                    but the application_id folder is owned by the applicant, so
--                    the owner check joins the object's folder to an application
--                    the caller owns. Never public.
--   upa-photos       public read; owner insert/update/delete, path {owner_id}/...
--   gratitude-photos public read; owner insert/update/delete, path {owner_id}/...
-- ============================================================================

-- upa-evidence: read only by the owning applicant (folder = an application they
-- own) or admin. Never public.
create policy upa_evidence_bucket_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'upa-evidence'
    and (
      public.has_role('admin') or public.has_role('moderator')
      or exists (
        select 1 from public.upa_applications a
        where a.id::text = (storage.foldername(name))[1]
          and a.applicant_user_id = auth.uid()
      )
    )
  );

create policy upa_evidence_bucket_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'upa-evidence'
    and exists (
      select 1 from public.upa_applications a
      where a.id::text = (storage.foldername(name))[1]
        and a.applicant_user_id = auth.uid()
    )
  );

-- upa-photos: public read; owner-only write, path prefix {owner_id}/...
create policy upa_photos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'upa-photos');

create policy upa_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'upa-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy upa_photos_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'upa-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'upa-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy upa_photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'upa-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- gratitude-photos: public read; owner-only write, path prefix {owner_id}/...
create policy gratitude_photos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'gratitude-photos');

create policy gratitude_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gratitude-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy gratitude_photos_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'gratitude-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'gratitude-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy gratitude_photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gratitude-photos' and (storage.foldername(name))[1] = auth.uid()::text);
