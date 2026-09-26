#!/usr/bin/env node
// ATLITOS v2 - scripts/verify-court-slots.mjs
//
// Proves 0132 search_court_slots against fixtures built to catch each rule it
// adds. Everything is anchored on TOMORROW in IST so no check depends on what
// time the script happens to run.
//
// The fixture venue has a unique sport-free name and its own courts:
//   PEAK   badminton, base 400, every day 06:00 to 23:00, and a peak rule
//          making 19:00 to 22:00 cost 600
//   BUSY   badminton, base 300, same hours, one slot tomorrow booked
//   DARK   badminton, base 300, blacked out tomorrow only
// plus an UNVERIFIED venue with a cheap badminton court that must never
// appear.
//
// LOCAL ONLY.
//
// Usage: export PATH=/opt/homebrew/bin:$PATH; node scripts/verify-court-slots.mjs

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-court-slots.mjs');
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, opts);
const anon = createClient(SUPABASE_URL, ANON_KEY, opts);

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== undefined ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
  if (!ok) failures.push(label);
}

const stamp = randomUUID().slice(0, 6);
const CITY = `Verifytown${stamp}`;
function istDate(offset) {
  return new Date(Date.now() + 5.5 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
}
const TOMORROW = istDate(1);
const DAY_AFTER = istDate(2);

async function must(p, what) {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function makeCourt(venueId, name, base) {
  const court = await must(svc.from('courts').insert({ venue_id: venueId, sport: 'badminton', name, base_price_per_hour: base }).select('id').single(), `court ${name}`);
  await must(
    svc.from('court_availability_windows').insert(
      [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ court_id: court.id, day_of_week: dow, open_time: '06:00', close_time: '23:00', slot_duration_minutes: 60 })),
    ),
    `windows ${name}`,
  );
  return court.id;
}

async function search(client, params) {
  const { data, error } = await client.rpc('search_court_slots', { p_city: CITY, p_sport: 'badminton', ...params });
  if (error) throw new Error(`search: ${error.message}`);
  return data ?? [];
}
const byName = (rows, name) => rows.find((r) => r.court_name === name);

const created = [];

async function main() {
  console.log(`verify-court-slots against ${SUPABASE_URL} (run ${stamp}, tomorrow IST ${TOMORROW})`);

  const { data: seeded } = await svc.from('venues').select('partner_user_id').limit(1).single();
  if (!seeded) throw new Error('no seeded venue; run scripts/seed-demo-users.mjs and supabase/seed/seed_p2.sql');
  const partner = { id: seeded.partner_user_id };

  const venue = await must(svc.from('venues').insert({ partner_user_id: partner.id, name: `Verify Slots ${stamp}`, address: '1 Test Road', city: CITY, pincode: '500001', status: 'verified' }).select('id').single(), 'venue');
  const hidden = await must(svc.from('venues').insert({ partner_user_id: partner.id, name: `Unverified ${stamp}`, address: '2 Test Road', city: CITY, pincode: '500001', status: 'pending' }).select('id').single(), 'hidden venue');
  created.push(venue.id, hidden.id);

  const PEAK = `Peak ${stamp}`;
  const BUSY = `Busy ${stamp}`;
  const DARK = `Dark ${stamp}`;
  const HIDDEN = `Hidden ${stamp}`;
  const peakId = await makeCourt(venue.id, PEAK, 400);
  const busyId = await makeCourt(venue.id, BUSY, 300);
  const darkId = await makeCourt(venue.id, DARK, 300);
  await makeCourt(hidden.id, HIDDEN, 100);

  await must(svc.from('court_pricing_rules').insert({ court_id: peakId, day_of_week_start: 0, day_of_week_end: 6, time_start: '19:00', time_end: '22:00', fixed_price: 600, active: true }), 'peak rule');
  await must(svc.from('court_blackouts').insert({ court_id: darkId, start_date: TOMORROW, end_date: TOMORROW, reason: 'verify blackout' }), 'blackout');
  await must(svc.from('court_bookings').insert({ court_id: busyId, date: TOMORROW, slot_start: '19:00', slot_end: '20:00', subtotal: 300, gst: 0, platform_fee: 0, total: 300 }), 'booking');

  // 1. The window and the verified-venue floor
  {
    const rows = await search(anon, { p_date_from: TOMORROW, p_date_to: TOMORROW, p_time_from: '19:00', p_time_to: '20:00' });
    check('1a anon can search (guests browse courts)', Array.isArray(rows));
    check('1b PEAK is free at 7 PM tomorrow at its PEAK price, 600', Number(byName(rows, PEAK)?.first_price) === 600, byName(rows, PEAK));
    check('1c the unverified venue never appears', !byName(rows, HIDDEN));
    check('1d every returned slot starts inside the window', rows.every((r) => r.first_start >= '19:00:00' && r.first_start < '20:00:00'));
  }

  // 2. The price ceiling is tested against the slot price, not the base price
  {
    const at7 = await search(anon, { p_date_from: TOMORROW, p_date_to: TOMORROW, p_time_from: '19:00', p_time_to: '20:00', p_price_max: 500 });
    check('2a "under 500 at 7 PM": PEAK is absent (base 400, but 7 PM costs 600)', !byName(at7, PEAK));
    const at5 = await search(anon, { p_date_from: TOMORROW, p_date_to: TOMORROW, p_time_from: '17:00', p_time_to: '18:00', p_price_max: 500 });
    check('2b "under 500 at 5 PM": PEAK is present at 400', Number(byName(at5, PEAK)?.first_price) === 400, byName(at5, PEAK));
  }

  // 3. A booked slot is not free
  {
    const rows = await search(anon, { p_date_from: TOMORROW, p_date_to: TOMORROW, p_time_from: '19:00', p_time_to: '20:00' });
    check('3a BUSY, booked at 7 PM tomorrow, is absent from the 7 PM window', !byName(rows, BUSY));
    const wide = await search(anon, { p_date_from: TOMORROW, p_date_to: TOMORROW, p_time_from: '18:00', p_time_to: '21:00' });
    const busy = byName(wide, BUSY);
    check('3b in 6 to 9 PM, BUSY shows 2 free slots, not 3', busy?.matching_slots === 2, busy);
    const peak = byName(wide, PEAK);
    check('3c and PEAK, unbooked, shows all 3', peak?.matching_slots === 3, peak);
  }

  // 4. A blackout day is not free, the next day is
  {
    const t = await search(anon, { p_date_from: TOMORROW, p_date_to: TOMORROW });
    check('4a DARK is absent on its blackout day', !byName(t, DARK));
    const d = await search(anon, { p_date_from: DAY_AFTER, p_date_to: DAY_AFTER });
    check('4b and present the day after', !!byName(d, DARK));
    const span = await search(anon, { p_date_from: TOMORROW, p_date_to: DAY_AFTER });
    check('4c across both days its first free slot is the day after', byName(span, DARK)?.first_date === DAY_AFTER, byName(span, DARK));
  }

  // 5. Nothing in the past
  {
    const rows = await search(anon, { p_date_from: istDate(-3), p_date_to: istDate(0) });
    const nowIst = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(11, 19);
    check('5 a search reaching into the past returns only slots not yet started', rows.every((r) => r.first_date > istDate(0) || (r.first_date === istDate(0) && r.first_start > nowIst)), rows.map((r) => `${r.first_date} ${r.first_start}`));
  }

  // 6. Limits hold
  {
    const rows = await search(anon, { p_date_from: TOMORROW, p_date_to: istDate(60) });
    const lastAllowed = istDate(1 + 13);
    check('6a a 60 day request never looks past 14 days', rows.every((r) => r.first_date <= lastAllowed));
    const one = await search(anon, { p_date_from: TOMORROW, p_date_to: TOMORROW, p_limit: 1 });
    check('6b p_limit is honoured', one.length === 1, one.length);
    const bad = await anon.rpc('search_court_slots', { p_date_from: null, p_date_to: TOMORROW });
    check('6c a missing date is refused', !!bad.error, bad.error?.message);
  }
}

main()
  .catch((e) => {
    console.error(`ERROR ${e.message}`);
    failures.push('exception');
  })
  .finally(async () => {
    // Remove this run's venues (courts, windows, rules, blackouts and bookings
    // cascade), so fixtures never leak into search results seen by hand.
    if (created.length) {
      const { error } = await svc.from('venues').delete().in('id', created);
      console.log(error ? `  (cleanup failed: ${error.message})` : `  (removed ${created.length} fixture venues)`);
    }
    console.log(failures.length ? `\nFAILED ${failures.length} check(s)` : '\nALL CHECKS PASSED');
    process.exit(failures.length ? 1 : 0);
  });
