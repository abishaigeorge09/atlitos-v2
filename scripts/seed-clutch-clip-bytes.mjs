// ATLITOS v2 — scripts/seed-clutch-clip-bytes.mjs
//
// Fixture seed (test-data, NOT product): the P5 Clutch fixtures seeded clip
// ROWS but never uploaded real MP4 bytes to the private `clips` bucket (see the
// PLACEHOLDER ALERT in supabase/seed/seed_p5_clutch_fixtures.sql), so playback
// signed-URL mints resolve to objects that do not decode. This uploads a real,
// tiny, decodable H.264 MP4 (and a matching thumbnail) to EVERY non-terminal
// clip's storage_path + thumb_path, under the service role, into the same
// `clips` bucket the stream-upload-url signed PUT lands in. Terminal
// (removed/rejected) clips are skipped: their playback mint refuses regardless.
//
// This is a storage-only fixture fill; it writes NO clip rows and NO status
// transitions (those remain the state-machine's job). Idempotent (upsert).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const mobileEnv = readEnvFile("apps/mobile/.env");
const rootEnv = readEnvFile(".env.local");
const URL = mobileEnv.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = rootEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from .env.local");

const SP = "/private/tmp/claude-501/-Users-abishaigeorgegosula/fba33c07-a222-4e4f-ab7d-4ba677415610/scratchpad";
const MP4 = readFileSync(`${SP}/clip.mp4`);
const JPG = readFileSync(`${SP}/thumb.jpg`);
const PNG = readFileSync(`${SP}/thumb.png`);
const BUCKET = "clips";

const sb = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data: clips, error } = await sb
  .from("clips")
  .select("id, status, storage_path, thumb_path")
  .not("status", "in", "(removed,rejected)");
if (error) throw error;

const results = { total_clips: clips.length, uploaded_video: 0, uploaded_thumb: 0, errors: [] };
const seen = new Set();

async function put(path, bytes, contentType) {
  if (!path || seen.has(path)) return true;
  seen.add(path);
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) { results.errors.push({ path, msg: error.message }); return false; }
  return true;
}

for (const c of clips) {
  if (await put(c.storage_path, MP4, "video/mp4")) if (c.storage_path) results.uploaded_video++;
  if (c.thumb_path) {
    const isPng = c.thumb_path.toLowerCase().endsWith(".png");
    if (await put(c.thumb_path, isPng ? PNG : JPG, isPng ? "image/png" : "image/jpeg")) results.uploaded_thumb++;
  }
}

console.log(JSON.stringify(results, null, 2));
