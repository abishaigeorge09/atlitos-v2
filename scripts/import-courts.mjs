#!/usr/bin/env node
// ATLITOS v2 — scripts/import-courts.mjs
//
// Release task 5 / 6: the data entry path for courts. Reads a CSV that a
// non engineer fills in a spreadsheet (template: scripts/templates/courts.csv)
// and upserts venues + courts, each venue carrying the outbound booking page
// the app clicks out to (migration 0120_venue_booking_url.sql).
//
// One CSV row = one court. Rows that share venue_name + city are one venue
// with several courts. Re-running the same file is safe: venues match on
// name + city, courts on venue + court_name, and matches are updated, not
// duplicated.
//
// Nothing is written until the WHOLE file validates. Default is a dry run
// that prints the plan; pass --apply to write. See scripts/lib/import-sheet.mjs.
//
// Env required:
//   SUPABASE_SERVICE_ROLE_KEY   venues.status is set to verified directly,
//                               which no client role may do.
//   SUPABASE_URL                optional, defaults to production; production
//                               also needs ATLITOS_ALLOW_PRODUCTION_WRITE, see
//                               scripts/lib/guard-target.mjs.
//
// Run:
//   node --env-file=.env.local scripts/import-courts.mjs --file courts.csv --partner <email or user id>
//   node --env-file=.env.local scripts/import-courts.mjs --file courts.csv --partner <email or user id> --apply

import { HTTP_URL, SPORTS, flag, groupBy, hasFlag, loadSheet, resolveUserId, serviceClient } from './lib/import-sheet.mjs';

const SCRIPT = 'import-courts';
const TEMPLATE = 'scripts/templates/courts.csv';
const REQUIRED = ['venue_name', 'address', 'city', 'pincode', 'sport', 'court_name', 'price_per_hour', 'booking_url'];
const OPTIONAL = ['image_url', 'lat', 'lng', 'description'];

const filePath = flag('--file');
const partner = flag('--partner');
const apply = hasFlag('--apply');

if (!filePath || !partner) {
  console.error(`usage: ${SCRIPT}.mjs --file <courts.csv> --partner <email or user id> [--apply]`);
  process.exit(1);
}

const { url, supabase } = serviceClient(SCRIPT, apply);

function check(r, bad) {
  if (r.sport && !SPORTS.includes(r.sport.toLowerCase())) bad(`sport "${r.sport}" is not one of ${SPORTS.join(', ')}`);
  if (r.pincode && !/^\d{6}$/.test(r.pincode)) bad(`pincode "${r.pincode}" must be 6 digits`);
  if (r.price_per_hour && !(Number(r.price_per_hour) > 0)) bad(`price_per_hour "${r.price_per_hour}" must be a number above 0`);
  if (r.booking_url && !HTTP_URL.test(r.booking_url)) bad('booking_url must start with http:// or https://');
  if (r.image_url && !HTTP_URL.test(r.image_url)) bad('image_url must start with http:// or https://');
  if ((r.lat && !r.lng) || (!r.lat && r.lng)) bad('lat and lng must be given together');
  if (r.lat && !(Math.abs(Number(r.lat)) <= 90)) bad(`lat "${r.lat}" is not a latitude`);
  if (r.lng && !(Math.abs(Number(r.lng)) <= 180)) bad(`lng "${r.lng}" is not a longitude`);
}

/** The first row's address, pincode, links, coordinates and description are
 * the venue's; later rows for the same venue only add courts. */
function toVenues(records) {
  return groupBy(
    records,
    (r) => `${r.venue_name}|${r.city}`,
    (r) => ({
      name: r.venue_name,
      address: r.address,
      city: r.city,
      pincode: r.pincode,
      booking_url: r.booking_url,
      image_url: r.image_url || null,
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
      description: r.description || null,
    }),
    (r) => ({ name: r.court_name, sport: r.sport.toLowerCase(), base_price_per_hour: Number(r.price_per_hour) }),
  );
}

async function upsertVenue(partnerId, venue) {
  const { children, ...fields } = venue;
  const row = { ...fields, partner_user_id: partnerId, status: 'verified', rejection_reason: null };

  const { data: found, error: findError } = await supabase
    .from('venues')
    .select('id')
    .eq('partner_user_id', partnerId)
    .ilike('name', venue.name)
    .ilike('city', venue.city)
    .limit(1);
  if (findError) throw new Error(`venue lookup failed for ${venue.name}: ${findError.message}`);

  if (found?.[0]) {
    const { error } = await supabase.from('venues').update(row).eq('id', found[0].id);
    if (error) throw new Error(`venue update failed for ${venue.name}: ${error.message}`);
    return { id: found[0].id, action: 'updated' };
  }
  const { data, error } = await supabase.from('venues').insert(row).select('id').single();
  if (error) throw new Error(`venue insert failed for ${venue.name}: ${error.message}`);
  return { id: data.id, action: 'created' };
}

async function upsertCourt(venueId, court) {
  const { data: found, error: findError } = await supabase
    .from('courts')
    .select('id')
    .eq('venue_id', venueId)
    .ilike('name', court.name)
    .limit(1);
  if (findError) throw new Error(`court lookup failed for ${court.name}: ${findError.message}`);

  const row = { ...court, venue_id: venueId, active: true };
  if (found?.[0]) {
    const { error } = await supabase.from('courts').update(row).eq('id', found[0].id);
    if (error) throw new Error(`court update failed for ${court.name}: ${error.message}`);
    return 'updated';
  }
  const { error } = await supabase.from('courts').insert(row);
  if (error) throw new Error(`court insert failed for ${court.name}: ${error.message}`);
  return 'created';
}

async function main() {
  const records = loadSheet(SCRIPT, filePath, REQUIRED, OPTIONAL, TEMPLATE, check);
  const venues = toVenues(records);
  const courtCount = venues.reduce((n, v) => n + v.children.length, 0);

  console.log(`[${SCRIPT}] ${venues.length} venue(s), ${courtCount} court(s) in ${filePath}`);
  for (const v of venues) {
    console.log(`  ${v.name}, ${v.city}  ->  ${v.booking_url}`);
    for (const c of v.children) console.log(`      ${c.sport.padEnd(9)} ${c.name}  ${c.base_price_per_hour}/hour`);
  }

  if (!apply) {
    console.log(`\n[${SCRIPT}] dry run, nothing written. Add --apply to import.`);
    return;
  }

  const partnerId = await resolveUserId(supabase, partner);
  if (!partnerId) throw new Error(`no account with email ${partner}`);
  console.log(`\n[${SCRIPT}] writing to ${url} as partner ${partnerId}`);
  for (const v of venues) {
    const venue = await upsertVenue(partnerId, v);
    const outcomes = [];
    for (const c of v.children) outcomes.push(await upsertCourt(venue.id, c));
    console.log(`  venue ${venue.action}: ${v.name} (${outcomes.join(', ')})`);
  }
  console.log(`[${SCRIPT}] done`);
}

main().catch((err) => {
  console.error(`[${SCRIPT}] ${err.message}`);
  process.exit(1);
});
