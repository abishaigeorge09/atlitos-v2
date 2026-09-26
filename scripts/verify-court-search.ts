// ATLITOS v2 - scripts/verify-court-search.ts
//
// Proves the court search time parser (supabase/functions/ai-search/when.ts)
// and its integration into parseIntent, against a FIXED clock, so every
// expectation is a concrete date rather than "whatever today is".
//
// The clock: Wednesday 23 September 2026, 2:00 PM IST (08:30 UTC).
//
// Section K is the regression that motivated all of this: before when.ts, a
// time word stayed in the keyword list and failed every court's text match.
//
// Run: apps/portal-court/node_modules/.bin/tsx scripts/verify-court-search.ts

import { parseWhen, slotLabel } from '../supabase/functions/ai-search/when.ts';
import { parseIntent } from '../supabase/functions/ai-search/search-core.ts';

const NOW = new Date('2026-09-23T08:30:00Z'); // Wed 14:00 IST

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failed += 1;
}

function expectWhen(query: string, want: { dateFrom: string; dateTo?: string; timeFrom?: string; timeTo?: string } | undefined) {
  const w = parseWhen(query, NOW);
  if (want === undefined) {
    check(`"${query}" has no time window`, w === undefined, w);
    return;
  }
  const ok =
    !!w &&
    w.dateFrom === want.dateFrom &&
    w.dateTo === (want.dateTo ?? want.dateFrom) &&
    (want.timeFrom === undefined || w.timeFrom === want.timeFrom) &&
    (want.timeTo === undefined || w.timeTo === want.timeTo);
  check(`"${query}" -> ${want.dateFrom}${want.dateTo ? `..${want.dateTo}` : ''} ${want.timeFrom ?? '*'} to ${want.timeTo ?? '*'}`, ok, w);
}

// A. Parts of the day and relative dates
expectWhen('badminton court tonight', { dateFrom: '2026-09-23', timeFrom: '18:00', timeTo: '24:00' });
expectWhen('cricket turf tomorrow evening', { dateFrom: '2026-09-24', timeFrom: '16:00', timeTo: '21:00' });
expectWhen('tennis court tomorrow morning', { dateFrom: '2026-09-24', timeFrom: '05:00', timeTo: '12:00' });
expectWhen('court day after tomorrow', { dateFrom: '2026-09-25', timeFrom: '00:00', timeTo: '24:00' });

// B. Weekdays and weekends
expectWhen('tennis court this weekend', { dateFrom: '2026-09-26', dateTo: '2026-09-27' });
expectWhen('court on saturday', { dateFrom: '2026-09-26' });
expectWhen('court wednesday', { dateFrom: '2026-09-23' });
expectWhen('court next wednesday', { dateFrom: '2026-09-30' });

// C. Clock times
expectWhen('badminton court tonight after 8', { dateFrom: '2026-09-23', timeFrom: '20:00', timeTo: '24:00' });
expectWhen('court at 7pm', { dateFrom: '2026-09-23', timeFrom: '18:30', timeTo: '20:00' });
expectWhen('court 7:30 pm tomorrow', { dateFrom: '2026-09-24', timeFrom: '19:00', timeTo: '20:30' });
expectWhen('court 19:00', { dateFrom: '2026-09-23', timeFrom: '18:30', timeTo: '20:00' });

// D. Ranges, including the meridiem inference
expectWhen('court 7 to 9pm saturday', { dateFrom: '2026-09-26', timeFrom: '19:00', timeTo: '21:00' });
expectWhen('court between 6 and 8 am tomorrow', { dateFrom: '2026-09-24', timeFrom: '06:00', timeTo: '08:00' });
expectWhen('court 11 to 1pm friday', { dateFrom: '2026-09-25', timeFrom: '11:00', timeTo: '13:00' });
expectWhen('court before 9am tomorrow', { dateFrom: '2026-09-24', timeFrom: '05:00', timeTo: '09:00' });

// E. A time already past today rolls to tomorrow (it is 2 PM)
expectWhen('court at 10am', { dateFrom: '2026-09-24', timeFrom: '09:30', timeTo: '11:00' });
expectWhen('court in the morning', { dateFrom: '2026-09-24', timeFrom: '05:00', timeTo: '12:00' });

// F. Numbers that are not times
expectWhen('badminton court under 500', undefined);
expectWhen('court between 500 and 800', undefined);

// G. Gear queries are never read as times
{
  const i = parseIntent('racket for an 8 to 10 year old', undefined, NOW);
  check('a gear query gets no time window', i.when === undefined, i.when);
}

// H. Keywords: time words are removed for court queries, places are kept
{
  const i = parseIntent('badminton court tonight in gachibowli', undefined, NOW);
  check('"tonight" is not a keyword, "gachibowli" is', JSON.stringify(i.keywords) === '["gachibowli"]', i.keywords);
  const j = parseIntent('court at 7pm tomorrow', undefined, NOW);
  check('"7pm" and "tomorrow" are not keywords', j.keywords.length === 0, j.keywords);
  const k = parseIntent('cricket turf this weekend available', undefined, NOW);
  check('"this", "weekend", "available" are not keywords', k.keywords.length === 0, k.keywords);
}

// I. Price and time together
{
  const i = parseIntent('badminton court tonight under 500', undefined, NOW);
  check('price ceiling and time window both parsed', i.priceMax === 500 && i.when?.timeFrom === '18:00', { priceMax: i.priceMax, when: i.when });
}

// J. Slot labels for results
check('slot label today', slotLabel('2026-09-23', '19:00:00', NOW) === 'today at 7:00 PM', slotLabel('2026-09-23', '19:00:00', NOW));
check('slot label tomorrow', slotLabel('2026-09-24', '06:00:00', NOW) === 'tomorrow at 6:00 AM', slotLabel('2026-09-24', '06:00:00', NOW));
check('slot label weekday', slotLabel('2026-09-26', '08:30:00', NOW) === 'Saturday at 8:30 AM', slotLabel('2026-09-26', '08:30:00', NOW));

// K. The production regression
{
  for (const q of ['badminton court tonight', 'badminton court at 7pm', 'cricket turf tomorrow evening', 'tennis court this weekend']) {
    const i = parseIntent(q, { entityTypes: ['court'] }, NOW);
    check(`"${q}" leaves no time word as a required keyword`, i.keywords.length === 0 && !!i.when, i.keywords);
  }
}

console.log(failed ? `\n=== ${failed} FAILED ===` : '\n=== ALL PASS ===');
process.exit(failed ? 1 : 0);
