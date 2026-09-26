#!/usr/bin/env node
// ATLITOS v2 - scripts/probe-search-latency.mjs
//
// Production search latency, measured the way a shopper feels it (ADR-014 D7;
// docs/PLAN-SEARCH-LOCATION-AFFILIATE.md section 1.3). 20 queries, 3 runs each,
// on both paths: typing (rerank false) and submit (rerank true). Reports p50 and
// p95 per path and writes JSON to docs/qa/evidence/search/latency-<date>.json.
// Targets: typing p95 <= 1,500 ms and submit p95 <= 3,500 ms from an Indian
// client. Run at the L1, L4 and L5 gates, from a machine whose location you
// state in --from, because a number measured from California is not the number
// a shopper in Hyderabad sees.
//
// READ ONLY FROM THIS CLIENT, BY CONSTRUCTION. The only network call this script
// can make is POST /functions/v1/ai-search (and, when no session token is given,
// one anonymous sign in). It holds no table or RPC handle at all: there is no
// supabase client in this file, only fetch against those two URLs.
//
// WHAT THE SERVER DOES ON ITS OWN, stated so nobody calls this side effect free:
//   - an anonymous sign in creates one auth user (pass ATLITOS_PROBE_ACCESS_TOKEN
//     from an existing anonymous session to avoid even that);
//   - ai-search takes a rate limit token per request, may write a query
//     embedding cache row, and on the submit path may call Claude and record
//     the spend. Those are the function's normal bookkeeping for any shopper.
// The probe paces itself under the 10 per minute per user throttle so every
// request takes the real path, not the throttled keyword path. That makes a
// full run about 13 minutes; --no-pace measures the throttled path instead
// and the output says so.
//
// Keys: the ANON key only. A service role key is refused (it would bypass RLS
// and the numbers would not be a shopper's).
//
// Usage:
//   ATLITOS_PROBE_ANON_KEY=<anon key> node scripts/probe-search-latency.mjs --confirm-production --from "Hyderabad, home broadband"
//   ATLITOS_PROBE_URL=http://127.0.0.1:54321 ATLITOS_PROBE_ANON_KEY=<local anon> node scripts/probe-search-latency.mjs --out /tmp/x.json --runs 1

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

const URL_BASE = (process.env.ATLITOS_PROBE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co').replace(/\/$/, '');
const ANON = process.env.ATLITOS_PROBE_ANON_KEY;
const TOKEN = process.env.ATLITOS_PROBE_ACCESS_TOKEN;
const RUNS = Number(arg('--runs') ?? 3);
const PACE = !argv.includes('--no-pace');
const FROM = arg('--from') ?? 'unstated';
const isProduction = URL_BASE.includes('syzzfgaudpifwvbpycyi');

function jwtRole(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    return null;
  }
}

if (!ANON) {
  console.error('probe-search-latency.mjs: set ATLITOS_PROBE_ANON_KEY to the project ANON key.');
  process.exit(1);
}
if (ANON.startsWith('sb_secret_') || jwtRole(ANON) === 'service_role') {
  console.error('REFUSED: that is a service role key. The probe measures a shopper, so it takes the anon key only.');
  process.exit(1);
}
if (isProduction && !argv.includes('--confirm-production')) {
  console.error('REFUSED: target is production. Pass --confirm-production after reading the side effects in this file header.');
  process.exit(1);
}

// Twenty queries across the surfaces a shopper uses. Real words, no fixtures:
// production holds its own catalogue.
const QUERIES = [
  ['shop', 'yonex'], ['shop', 'badminton racket'], ['shop', 'cricket bat under 3000'], ['shop', 'shoes'],
  ['shop', 'tennis racket for beginners'], ['shop', 'babolat under 2000'], ['shop', 'football'],
  ['shop', 'kids cricket bat'], ['shop', 'shuttlecocks'], ['shop', 'shoes for indoor court'],
  ['courts', 'badminton court tonight'], ['courts', 'cricket turf tomorrow evening'], ['courts', 'tennis this weekend'],
  ['courts', 'badminton near me'], ['courts', 'football turf under 1500'],
  ['home', 'badminton'], ['home', 'cricket coaching'], ['home', 'tennis'], ['home', 'yonex racket'], ['home', 'turf near me'],
];
const TYPES = { shop: ['gear'], courts: ['court'], home: undefined };

async function session() {
  if (TOKEN) return TOKEN;
  const res = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ data: {} }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`anonymous sign in failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token;
}

async function search(token, surface, query, rerank) {
  const body = { query, limit: 20, rerank };
  if (TYPES[surface]) body.entityTypes = TYPES[surface];
  if (surface !== 'shop') body.city = 'Hyderabad';
  const t0 = performance.now();
  const res = await fetch(`${URL_BASE}/functions/v1/ai-search`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-region': 'ap-south-1' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  const ms = Math.round(performance.now() - t0);
  return { ms, status: res.status, results: json?.results?.length ?? null, mode: json?.mode ?? null, vector: json?.vector ?? null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null;
};

async function main() {
  console.log(`probe-search-latency  target ${URL_BASE}${isProduction ? ' (PRODUCTION)' : ''}  from "${FROM}"  runs ${RUNS}  pace ${PACE ? 'on' : 'OFF (throttled path)'}`);
  const token = await session();
  const samples = [];
  for (let run = 1; run <= RUNS; run++) {
    for (const [surface, query] of QUERIES) {
      for (const rerank of [false, true]) {
        const s = await search(token, surface, query, rerank);
        samples.push({ run, surface, query, path: rerank ? 'submit' : 'typing', ...s });
        process.stdout.write(`  ${String(s.ms).padStart(5)} ms  ${s.status}  ${rerank ? 'submit' : 'typing'}  ${surface.padEnd(6)} ${query}\n`);
        if (PACE) await sleep(6500);
      }
    }
  }
  const ok = samples.filter((s) => s.status === 200);
  const by = (path) => ok.filter((s) => s.path === path).map((s) => s.ms);
  const summary = {
    typing: { n: by('typing').length, p50: pct(by('typing'), 0.5), p95: pct(by('typing'), 0.95), targetP95: 1500 },
    submit: { n: by('submit').length, p50: pct(by('submit'), 0.5), p95: pct(by('submit'), 0.95), targetP95: 3500 },
    errors: samples.length - ok.length,
  };
  const out = {
    measuredAt: new Date().toISOString(),
    target: URL_BASE,
    production: isProduction,
    from: FROM,
    paced: PACE,
    runs: RUNS,
    note: 'Client side wall time per POST /functions/v1/ai-search, including TLS and the network path from the stated location.',
    summary,
    samples,
  };
  const file = arg('--out') ?? join(ROOT, `docs/qa/evidence/search/latency-${out.measuredAt.slice(0, 10)}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  console.log(`\ntyping p50 ${summary.typing.p50} ms p95 ${summary.typing.p95} ms (target <= 1500)`);
  console.log(`submit p50 ${summary.submit.p50} ms p95 ${summary.submit.p95} ms (target <= 3500)`);
  console.log(`${summary.errors} non 200 responses. Wrote ${file}`);
  process.exit(summary.errors ? 1 : 0);
}

main().catch((e) => {
  console.error(`probe-search-latency.mjs: ${e.message}`);
  process.exit(1);
});
