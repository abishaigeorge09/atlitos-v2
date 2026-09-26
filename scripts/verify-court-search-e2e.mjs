#!/usr/bin/env node
// ATLITOS v2 - scripts/verify-court-search-e2e.mjs
//
// End to end through the ai-search edge function: the queries that returned
// ZERO courts in production on 2026-09-26 ("badminton court tonight" and
// friends, because time words were required keywords) must now return
// bookable courts whose free slot sits inside the asked window.
//
// Needs the local stack, the seed data, and the functions served:
//   supabase functions serve --env-file <file with ANTHROPIC_API_KEY= and VOYAGE_API_KEY= empty>
// Empty AI keys pin the deterministic path, which is what production runs for
// intent (index.ts: Claude no longer parses intent on the request path).
//
// Usage: export PATH=/opt/homebrew/bin:$PATH; node scripts/verify-court-search-e2e.mjs

import { createClient } from '@supabase/supabase-js';
import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-court-search-e2e.mjs');
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== undefined ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
  if (!ok) failures.push(label);
}

const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

async function search(query) {
  const { data, error } = await client.functions.invoke('ai-search', {
    body: { query, entityTypes: ['court'], limit: 10, city: 'Hyderabad' },
  });
  if (error) throw new Error(`${query}: ${error.message} ${await error.context?.text?.()}`);
  return data;
}

function istDate(offset) {
  return new Date(Date.now() + 5.5 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
}

async function main() {
  const { error: ae } = await client.auth.signInAnonymously();
  if (ae) throw new Error(`anonymous sign in: ${ae.message}`);
  const hour = Number(new Date(Date.now() + 5.5 * 3600000).toISOString().slice(11, 13));

  // 1. The production regression: time words no longer empty the results.
  const tonight = await search('badminton court tonight');
  if (hour < 22) {
    check('1a "badminton court tonight" returns courts', tonight.results.length > 0, tonight.broaden);
    check('1b every result is free today from 6 PM', tonight.results.every((r) => r.slot?.date === istDate(0) && r.slot.start >= '18:00'), tonight.results.map((r) => `${r.slot?.date} ${r.slot?.start}`));
  } else {
    console.log('  SKIP  1a/1b: too late in the day for a tonight check');
  }
  const eve = await search('cricket turf tomorrow evening');
  check('1c "cricket turf tomorrow evening" returns courts', eve.results.length > 0, eve.broaden);
  check('1d every result is free tomorrow between 4 and 9 PM', eve.results.every((r) => r.slot?.date === istDate(1) && r.slot.start >= '16:00' && r.slot.start < '21:00'), eve.results.map((r) => `${r.slot?.date} ${r.slot?.start}`));
  const at7 = await search('badminton court tomorrow at 7pm');
  check('1e "tomorrow at 7pm" returns courts around 7 PM', at7.results.length > 0 && at7.results.every((r) => r.slot.start >= '18:30' && r.slot.start < '20:00'), at7.results.map((r) => r.slot?.start));
  check('1f no time word survives as a keyword', [tonight, eve, at7].every((d) => d.parsedIntent.keywords.length === 0), [tonight, eve, at7].map((d) => d.parsedIntent.keywords));

  // 2. Prices shown are slot prices and respect the ceiling.
  const budget = await search('badminton tomorrow 7 to 9pm under 450');
  check('2a a budget search returns only slots at or under the ceiling', budget.results.length > 0 && budget.results.every((r) => r.slot.price <= 450), budget.results.map((r) => r.slot?.price));

  // 3. One row per venue.
  const venues = tonight.results.length ? tonight : eve;
  const names = venues.results.map((r) => r.title);
  check('3 each venue appears once', new Set(names).size === names.length, names);

  // 4. An impossible ask gets ONE specific real alternative, not "remove words".
  const none = await search('badminton court tomorrow evening under 100');
  check('4a an impossible budget returns no results', none.results.length === 0);
  check('4b and names a real alternative instead of asking to remove words', /The (soonest|cheapest)/.test(none.broaden ?? '') && !/Try removing/.test(none.broaden ?? ''), none.broaden);
  check('4c the copy has no dashes or emoji', !/[–—-]|\p{Extended_Pictographic}/u.test(none.broaden ?? ''), none.broaden);
}

main()
  .catch((e) => {
    console.error(`ERROR ${e.message}`);
    failures.push('exception');
  })
  .finally(() => {
    console.log(failures.length ? `\nFAILED ${failures.length} check(s)` : '\nALL CHECKS PASSED');
    process.exit(failures.length ? 1 : 0);
  });
