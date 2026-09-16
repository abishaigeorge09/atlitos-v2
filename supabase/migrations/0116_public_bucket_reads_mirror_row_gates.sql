-- 0116_public_bucket_reads_mirror_row_gates
-- P0. Every anon SELECT policy on storage.objects gated on the bucket name
-- ALONE, while each owning table correctly hid its non public rows. The
-- database refused the row and then served its photograph.
--
-- Reproduced end to end 2026-08-14 with NO credentials at all: a 2,795,648
-- byte PNG belonging to upa_application e115d1dc (status `submitted`, an
-- unreviewed charity application) returned HTTP 200, while an anon read of
-- that same application row correctly returned [].
--
-- Each policy below now mirrors the condition its OWN table enforces, so an
-- object can never be more visible than the row it belongs to.
--
-- avatars is deliberately left public: profile pictures are shown to signed
-- out visitors across the Clutch feed, coach browse and public profiles, and
-- gating them would break guest browsing.
--
-- upa-photos accepts BOTH folder key schemes because both exist in the live
-- bucket right now: the INSERT policy requires auth.uid(), but the one
-- verified applicant's folder is an application id written by a privileged
-- path. Narrowing to user id alone would close the leak and break the one
-- legitimate photo.

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
