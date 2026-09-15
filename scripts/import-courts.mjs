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
// Nothing is written until the WHOLE file validates. Any bad row aborts the
// run with the row number and the reason, so a half imported sheet can never
// happen. Default is a dry run that prints the plan; pass --apply to write.
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

import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './lib/guard-target.mjs';

const SPORTS = ['football', 'cricket', 'badminton', 'tennis'];
const REQUIRED = ['venue_name', 'address', 'city', 'pincode', 'sport', 'court_name', 'price_per_hour', 'booking_url'];
const OPTIONAL = ['image_url', 'lat', 'lng', 'description'];
const HTTP_URL = /^https?:\/\/\S+$/;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}
const filePath = flag('--file');
const partner = flag('--partner');
const apply = args.includes('--apply');

if (!filePath || !partner) {
  console.error('usage: import-courts.mjs --file <courts.csv> --partner <email or user id> [--apply]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error('[import-courts] SUPABASE_SERVICE_ROLE_KEY is required. Run with: node --env-file=.env.local scripts/import-courts.mjs ...');
  process.exit(1);
}
if (apply) assertWritableTarget(SUPABASE_URL, 'import-courts.mjs');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// csv (RFC 4180 subset: quoted fields, doubled quotes, CRLF or LF)
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function readSheet(path) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const [header, ...lines] = parseCsv(text);
  if (!header) throw new Error('the file is empty');
  const columns = header.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !columns.includes(c));
  if (missing.length > 0) throw new Error(`missing column(s): ${missing.join(', ')}`);
  const unknown = columns.filter((c) => !REQUIRED.includes(c) && !OPTIONAL.includes(c));
  if (unknown.length > 0) throw new Error(`unknown column(s): ${unknown.join(', ')}. Use the template in scripts/templates/courts.csv`);

  return lines.map((cells, index) => {
    const record = {};
    columns.forEach((col, i) => {
      record[col] = (cells[i] ?? '').trim();
    });
    // Header is line 1, so the first data row is line 2.
    record._line = index + 2;
    return record;
  });
}

// ---------------------------------------------------------------------------
// validation, whole file first
// ---------------------------------------------------------------------------

function validate(records) {
  const problems = [];
  for (const r of records) {
    const bad = (why) => problems.push(`line ${r._line}: ${why}`);
    for (const col of REQUIRED) {
      if (!r[col]) bad(`${col} is empty`);
    }
    if (r.sport && !SPORTS.includes(r.sport.toLowerCase())) bad(`sport "${r.sport}" is not one of ${SPORTS.join(', ')}`);
    if (r.pincode && !/^\d{6}$/.test(r.pincode)) bad(`pincode "${r.pincode}" must be 6 digits`);
    if (r.price_per_hour && !(Number(r.price_per_hour) > 0)) bad(`price_per_hour "${r.price_per_hour}" must be a number above 0`);
    if (r.booking_url && !HTTP_URL.test(r.booking_url)) bad(`booking_url must start with http:// or https://`);
    if (r.image_url && !HTTP_URL.test(r.image_url)) bad(`image_url must start with http:// or https://`);
    if ((r.lat && !r.lng) || (!r.lat && r.lng)) bad('lat and lng must be given together');
    if (r.lat && !(Math.abs(Number(r.lat)) <= 90)) bad(`lat "${r.lat}" is not a latitude`);
    if (r.lng && !(Math.abs(Number(r.lng)) <= 180)) bad(`lng "${r.lng}" is not a longitude`);
  }
  return problems;
}

/** Groups rows into venues (name + city, case insensitive) with their courts.
 * The first row's address, pincode, booking_url, image_url, lat, lng and
 * description are the venue's; later rows for the same venue only add courts. */
function groupVenues(records) {
  const venues = new Map();
  for (const r of records) {
    const key = `${r.venue_name.toLowerCase()}|${r.city.toLowerCase()}`;
    if (!venues.has(key)) {
      venues.set(key, {
        name: r.venue_name,
        address: r.address,
        city: r.city,
        pincode: r.pincode,
        booking_url: r.booking_url,
        image_url: r.image_url || null,
        lat: r.lat ? Number(r.lat) : null,
        lng: r.lng ? Number(r.lng) : null,
        description: r.description || null,
        courts: [],
      });
    }
    venues.get(key).courts.push({
      name: r.court_name,
      sport: r.sport.toLowerCase(),
      base_price_per_hour: Number(r.price_per_hour),
    });
  }
  return [...venues.values()];
}

// ---------------------------------------------------------------------------
// partner lookup: the account that will own the imported venues
// ---------------------------------------------------------------------------

async function resolvePartnerId(value) {
  if (!value.includes('@')) return value;
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === value.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) throw new Error(`no account with email ${value}`);
    page += 1;
  }
}

// ---------------------------------------------------------------------------
// upserts, one venue at a time so a failure names the venue
// ---------------------------------------------------------------------------

async function findVenue(partnerId, venue) {
  const { data, error } = await supabase
    .from('venues')
    .select('id')
    .eq('partner_user_id', partnerId)
    .ilike('name', venue.name)
    .ilike('city', venue.city)
    .limit(1);
  if (error) throw new Error(`venue lookup failed for ${venue.name}: ${error.message}`);
  return data?.[0]?.id ?? null;
}

async function upsertVenue(partnerId, venue) {
  const fields = {
    partner_user_id: partnerId,
    name: venue.name,
    address: venue.address,
    city: venue.city,
    pincode: venue.pincode,
    lat: venue.lat,
    lng: venue.lng,
    description: venue.description,
    booking_url: venue.booking_url,
    image_url: venue.image_url,
    status: 'verified',
    rejection_reason: null,
  };
  const existing = await findVenue(partnerId, venue);
  if (existing) {
    const { error } = await supabase.from('venues').update(fields).eq('id', existing);
    if (error) throw new Error(`venue update failed for ${venue.name}: ${error.message}`);
    return { id: existing, action: 'updated' };
  }
  const { data, error } = await supabase.from('venues').insert(fields).select('id').single();
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
  const fields = { venue_id: venueId, name: court.name, sport: court.sport, base_price_per_hour: court.base_price_per_hour, active: true };
  if (found?.[0]) {
    const { error } = await supabase.from('courts').update(fields).eq('id', found[0].id);
    if (error) throw new Error(`court update failed for ${court.name}: ${error.message}`);
    return 'updated';
  }
  const { error } = await supabase.from('courts').insert(fields);
  if (error) throw new Error(`court insert failed for ${court.name}: ${error.message}`);
  return 'created';
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let records;
  try {
    records = readSheet(filePath);
  } catch (err) {
    console.error(`[import-courts] ${filePath}: ${err.message}`);
    process.exit(1);
  }
  if (records.length === 0) {
    console.error('[import-courts] no data rows found under the header');
    process.exit(1);
  }

  const problems = validate(records);
  if (problems.length > 0) {
    console.error(`[import-courts] ${problems.length} problem(s), nothing written:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  const venues = groupVenues(records);
  const courtCount = venues.reduce((n, v) => n + v.courts.length, 0);
  console.log(`[import-courts] ${venues.length} venue(s), ${courtCount} court(s) in ${filePath}`);
  for (const v of venues) {
    console.log(`  ${v.name}, ${v.city}  ->  ${v.booking_url}`);
    for (const c of v.courts) console.log(`      ${c.sport.padEnd(9)} ${c.name}  ${c.base_price_per_hour}/hour`);
  }

  if (!apply) {
    console.log('\n[import-courts] dry run, nothing written. Add --apply to import.');
    return;
  }

  const partnerId = await resolvePartnerId(partner);
  console.log(`\n[import-courts] writing to ${SUPABASE_URL} as partner ${partnerId}`);
  for (const v of venues) {
    const venue = await upsertVenue(partnerId, v);
    const outcomes = [];
    for (const c of v.courts) outcomes.push(await upsertCourt(venue.id, c));
    console.log(`  venue ${venue.action}: ${v.name} (${outcomes.join(', ')})`);
  }
  console.log('[import-courts] done');
}

main().catch((err) => {
  console.error(`[import-courts] ${err.message}`);
  process.exit(1);
});
