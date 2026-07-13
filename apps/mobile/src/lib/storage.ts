import { supabase } from '@/lib/supabase';

/**
 * Uploads a locally picked file (expo-image-picker / expo-document-picker
 * asset uri) to a Supabase Storage bucket at `{ownerId}/...`, matching the
 * path convention RLS.md's Storage table locks for every owner-scoped
 * bucket. Returns the storage object path (not a signed/public URL) so
 * callers can resolve display URLs on demand.
 *
 * TODO: both `avatars` (public) and `coach-certificates` (owner + admin
 * read only) buckets are provisioned in
 * supabase/migrations/0006_storage_buckets.sql. If a future environment
 * (a fresh local `supabase start`, a branch that has not run migrations
 * past 0005) is missing either bucket, this throws a normal Supabase
 * "Bucket not found" error; callers below catch that and surface a
 * TODO-flagged inline message instead of crashing the wizard.
 */
async function uploadToBucket(bucket: string, path: string, localUri: string, contentType: string): Promise<void> {
  const response = await fetch(localUri);
  const arrayBuffer = await response.arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, arrayBuffer, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
}

export async function uploadAvatar(userId: string, localUri: string): Promise<string> {
  const extension = localUri.split('.').pop()?.split('?')[0] || 'jpg';
  const path = `${userId}/avatar.${extension}`;
  await uploadToBucket('avatars', path, localUri, `image/${extension === 'jpg' ? 'jpeg' : extension}`);
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadCoachCertificate(
  coachId: string,
  localUri: string,
  fileName: string,
): Promise<string> {
  const extension = fileName.split('.').pop()?.split('?')[0] || 'pdf';
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${coachId}/${Date.now()}-${safeName}`;
  await uploadToBucket('coach-certificates', path, localUri, `application/${extension}`);
  return path;
}
