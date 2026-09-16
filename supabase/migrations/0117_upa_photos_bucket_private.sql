-- 0117_upa_photos_bucket_private
--
-- 0116 was necessary and NOT sufficient, and the gap is worth writing down
-- because it would fool anyone who verified by reading the policy.
--
-- On a bucket with `public = true`, the /storage/v1/object/public/ path is
-- served WITHOUT consulting storage.objects RLS at all. So 0116's policies,
-- which are correct, govern the list and authenticated paths only. Measured
-- immediately after 0116 was applied to production:
--
--   POST /object/list/upa-photos                -> only the VERIFIED folder
--   POST /object/list/upa-photos {hidden prefix} -> []          (closed)
--   GET  /object/public/upa-photos/<known path> -> 200, 2.79 MB (STILL OPEN)
--
-- Enumeration was closed, direct fetch was not. The photograph of an
-- unreviewed charity applicant remained retrievable by anyone holding the URL.
-- A bucket whose contents are conditionally visible cannot be a public bucket;
-- the condition has nowhere to live.
--
-- upa-photos is the only one of the five that holds conditionally visible
-- content. avatars, venue-media, product-media and gratitude-photos stay
-- public: avatars and product images are public by design, and venue-media
-- currently exposes zero objects for unverified venues. 0116 still governs
-- their list paths, and the invariant it asserts still holds.
--
-- KNOWN CONSEQUENCE, accepted deliberately: portal-life renders the verified
-- applicant photo with getPublicUrl, which will now 400. That is ONE 6,318
-- byte image on one page. The privacy of a person who has not been reviewed
-- outweighs it, and the display is restored by minting a signed URL, which is
-- tracked as its own task rather than rushed in alongside a security fix.

update storage.buckets
set public = false
where id = 'upa-photos';

do $$
declare
  v_public boolean;
begin
  select public into v_public from storage.buckets where id = 'upa-photos';
  if v_public is distinct from false then
    raise exception 'upa-photos is still a public bucket; the object/public path bypasses RLS and the leak is open';
  end if;
end
$$;
