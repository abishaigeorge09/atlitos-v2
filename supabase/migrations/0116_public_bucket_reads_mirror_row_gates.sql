-- ATLITOS v2 - 0116_public_bucket_reads_mirror_row_gates.sql
-- Domain: storage, privacy. P0.
--
-- ============================================================================
-- THE DEFECT: the row gate and the object gate were written in different
-- migrations, and only the row gate ever got its status condition.
-- ============================================================================
--
-- Every anon SELECT policy on storage.objects gates on the bucket name ALONE:
--
--   avatars_public_read           (bucket_id = 'avatars')
--   gratitude_photos_public_read  (bucket_id = 'gratitude-photos')
--   product_media_public_read     (bucket_id = 'product-media')
--   upa_photos_public_read        (bucket_id = 'upa-photos')
--   venue_media_public_read       (bucket_id = 'venue-media')
--
-- while each owning table correctly hides non public rows. The database
-- refuses the row and then serves its photograph.
--
-- REPRODUCED END TO END 2026-08-14 against production, no credentials at all:
--
--   GET /rest/v1/upa_applications?applicant_user_id=eq.b488950f-...
--       with the publishable key            -> 200 []          (correctly hidden)
--   GET /storage/v1/object/public/upa-photos/b488950f-.../a8bceaac-....png
--       with NO apikey header whatsoever    -> 200, 2,795,648 bytes,
--                                              PNG 1672x941
--
-- That object belongs to application e115d1dc-166c-4c2c-be94-943b728ddc62,
-- status `submitted`. It is the photograph of a real person who applied for
-- charity aid, whose application has not been reviewed, published on the open
-- internet and reachable in two commands by anyone who can list a bucket.
--
-- Exposure measured per bucket before writing this, rather than assumed:
--   upa-photos       9 non verified applications ->  1 object exposed  (above)
--   venue-media      6 pending venues            ->  0 objects
--   product-media    4 inactive products         ->  4 product images
--   gratitude-photos 0 unpublished posts         ->  0 objects (bucket empty)
--
-- So one instance carries sensitive data and the rest are latent. This fixes
-- the CLASS, because leaving four policies with the same shape is how the same
-- bug ships three times.
--
-- ============================================================================
-- FOLDER KEY SCHEMES, established from live data, not from the docs
-- ============================================================================
--
--   upa-photos        foldername[1] is the applicant's auth.uid()  PER THE
--                     INSERT POLICY, but the one verified applicant's folder
--                     is an APPLICATION id, written by a privileged path that
--                     bypassed that policy. Both schemes exist in the bucket
--                     right now, so this policy accepts EITHER. Narrowing to
--                     user id alone would have closed the leak and broken the
--                     one legitimate photo, which is the failure this comment
--                     exists to prevent. The inconsistency itself is recorded
--                     for a follow up; it is not fixed here, because renaming
--                     a live object is a data migration, not a policy change.
--   venue-media       foldername[1] = venues.id            (6 of 6 objects)
--   product-media     foldername[1] = products.id          (18 of 21), plus a
--                     literal `promo` prefix for marketing banners, which are
--                     deliberately public and belong to no product.
--   gratitude-photos  foldername[1] = author's auth.uid(). gratitude_posts has
--                     no author column; it hangs off upa_id, so the join goes
--                     through upa_applications.applicant_user_id.
--
-- AVATARS IS DELIBERATELY LEFT PUBLIC. A profile picture is public by design:
-- the Clutch feed, coach browse and public profiles all show avatars to signed
-- out visitors, and gating them would break guest browsing, which is the
-- product's entire acquisition path. Recorded as a decision, not an oversight.
--
-- Each policy below mirrors the condition its OWN table already enforces, so
-- the object can never be more visible than the row it belongs to. That is the
-- invariant, and it is the thing to check when a sixth bucket is added.

-- ---------------------------------------------------------------------------
-- upa-photos. The P0.
-- ---------------------------------------------------------------------------
drop policy if exists upa_photos_public_read on storage.objects;

create policy upa_photos_public_read
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'upa-photos'
  and exists (
    select 1 from public.upa_applications a
    where a.status = 'verified'
      and (
        a.applicant_user_id::text = (storage.foldername(name))[1]
        or a.id::text = (storage.foldername(name))[1]
      )
  )
);

-- ---------------------------------------------------------------------------
-- venue-media. Mirrors venues_select_public: status = 'verified'.
-- ---------------------------------------------------------------------------
drop policy if exists venue_media_public_read on storage.objects;

create policy venue_media_public_read
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'venue-media'
  and exists (
    select 1 from public.venues v
    where v.id::text = (storage.foldername(name))[1]
      and v.status = 'verified'
  )
);

-- ---------------------------------------------------------------------------
-- product-media. Mirrors products_select_public: active. The `promo` prefix
-- holds marketing banners that belong to no product and are meant to be public.
-- ---------------------------------------------------------------------------
drop policy if exists product_media_public_read on storage.objects;

create policy product_media_public_read
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'product-media'
  and (
    (storage.foldername(name))[1] = 'promo'
    or exists (
      select 1 from public.products p
      where p.id::text = (storage.foldername(name))[1]
        and p.active
    )
  )
);

-- ---------------------------------------------------------------------------
-- gratitude-photos. Mirrors gratitude_posts_select_public, which is published
-- AND belonging to a verified UPA. Bucket is empty today, so this is purely
-- preventative.
-- ---------------------------------------------------------------------------
drop policy if exists gratitude_photos_public_read on storage.objects;

create policy gratitude_photos_public_read
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'gratitude-photos'
  and exists (
    select 1
    from public.gratitude_posts g
    join public.upa_applications a on a.id = g.upa_id
    where g.status = 'published'
      and a.status = 'verified'
      and a.applicant_user_id::text = (storage.foldername(name))[1]
  )
);

-- ---------------------------------------------------------------------------
-- Prove the file achieved its purpose in the same transaction rather than
-- trusting the DDL, the way 0115 does. Any anon-readable SELECT policy on
-- storage.objects whose qual is nothing but a bucket_id test is the defect
-- this migration exists to remove. `avatars` is the one documented exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(pol.policyname, ', ' order by pol.policyname) into v_bad
  from pg_policies pol
  where pol.schemaname = 'storage'
    and pol.tablename = 'objects'
    and pol.cmd = 'SELECT'
    and 'anon' = any (pol.roles::text[])
    and pol.policyname <> 'avatars_public_read'
    and pol.qual !~ 'exists|EXISTS';

  if v_bad is not null then
    raise exception
      'PUBLIC BUCKET GATE: policy(ies) % gate on bucket_id alone, so an object stays readable after its row is hidden',
      v_bad;
  end if;
end
$$;
