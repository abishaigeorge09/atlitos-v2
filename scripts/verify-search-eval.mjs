#!/usr/bin/env node
// ATLITOS v2 - scripts/verify-search-eval.mjs
//
// The search accuracy bar (docs/PLAN-SEARCH-LOCATION-AFFILIATE.md section 1.3,
// ADR-014 D1). Runs the 160 query evaluation set in docs/search-eval/ through
// the REAL ai-search edge function on the local stack, grades every hit against
// the frozen judgments, and exits 1 when any threshold is missed.
//
//   node scripts/verify-search-eval.mjs                   thresholds, per class and overall
//   node scripts/verify-search-eval.mjs --baseline-diff   id level diff vs docs/search-eval/baseline.json
//   node scripts/verify-search-eval.mjs --degraded        spend guard forced over budget, the lexical floor
//   node scripts/verify-search-eval.mjs --write-baseline  record baseline.json from this run
//   add --class <name> to run one class only (never valid for --write-baseline)
//
// Needs: the local stack, scripts/seed-demo-users.mjs, scripts/seed-search-eval.mjs,
// and the functions served with EMPTY AI keys:
//   supabase functions serve --env-file <file with ANTHROPIC_API_KEY= and VOYAGE_API_KEY=>
//
// WHAT IT WRITES, local only (it refuses any non loopback target):
//   - edge_rate_limits rows for its OWN anonymous user, cleared before every
//     query so the spend gate decides the same way for query 1 and query 160
//     (the per user throttle is 10 a minute), or saturated for --degraded;
//   - affiliate_products.embedding on FIXTURE rows and query_embedding_cache
//     rows for the eval queries, only when committed embeddings exist.
// It never touches a row outside the e0000000- fixture range except its own
// rate limit rows and cache rows keyed by the eval queries.
//
// JUDGMENTS. Metrics use every judgment row that is not judgedBy "llm"
// (derived, agent and human). The harness prints how many of each exist, so a
// green here is never mistaken for a human graded result.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './lib/guard-target.mjs';
import * as M from './lib/search-eval-metrics.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVAL = join(ROOT, 'docs/search-eval');

// ---------------------------------------------------------------------------
// Arguments and target
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const OPT = {
  baselineDiff: argv.includes('--baseline-diff'),
  degraded: argv.includes('--degraded'),
  writeBaseline: argv.includes('--write-baseline'),
  onlyClass: argv.includes('--class') ? argv[argv.indexOf('--class') + 1] : null,
};
if (OPT.writeBaseline && (OPT.onlyClass || OPT.degraded)) {
  console.error('--write-baseline records the whole normal run; it cannot be combined with --class or --degraded.');
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
delete process.env.ATLITOS_ALLOW_PRODUCTION_WRITE;
assertWritableTarget(SUPABASE_URL, 'verify-search-eval.mjs');
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  console.error(`REFUSED: verify-search-eval.mjs runs against the local stack only (${SUPABASE_URL}). It writes rate limit and embedding rows.`);
  process.exit(1);
}
const ANON_KEY = process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, opts);
const client = createClient(SUPABASE_URL, ANON_KEY, opts);

const FIX_LO = 'e0000000-0000-0000-0000-000000000000';
const FIX_HI = 'e0000000-ffff-ffff-ffff-ffffffffffff';
const HYD_POINT = { lat: 17.385, lng: 78.4867 };
const BROWSE = new Set(['gear_brand', 'gear_type', 'gear_price', 'gear_brand_price', 'gear_sport']);
const RECALL = new Set(['gear_typo', 'gear_hinglish']);

// ---------------------------------------------------------------------------
// Load the set
// ---------------------------------------------------------------------------
const readJsonl = (f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
let queries = readJsonl(join(EVAL, 'queries.jsonl'));
const judgments = readJsonl(join(EVAL, 'judgments.jsonl'));
if (OPT.onlyClass) queries = queries.filter((q) => q.class === OPT.onlyClass);
if (queries.length === 0) {
  console.error(`no queries${OPT.onlyClass ? ` in class ${OPT.onlyClass}` : ''}`);
  process.exit(2);
}

const byJudge = { derived: 0, agent: 0, human: 0, llm: 0, other: 0 };
const J = new Map(); // queryId -> Map(entity -> grade), non llm rows only
for (const j of judgments) {
  byJudge[j.judgedBy in byJudge ? j.judgedBy : 'other'] += 1;
  if (j.judgedBy === 'llm') continue;
  if (!J.has(j.queryId)) J.set(j.queryId, new Map());
  J.get(j.queryId).set(j.entity, j.grade);
}

const istNow = () => new Date(Date.now() + 5.5 * 3600000);
const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
const istMinutes = () => istNow().getUTCHours() * 60 + istNow().getUTCMinutes();

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT }).trim(); } catch { return 'unknown'; }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const failures = [];
const notes = [];

async function main() {
  const mode = OPT.degraded ? 'DEGRADED (spend guard forced over budget)' : OPT.baselineDiff ? 'BASELINE DIFF' : 'THRESHOLDS';
  console.log(`verify-search-eval  ${mode}`);
  console.log(`target   ${SUPABASE_URL}`);
  console.log(`git      ${sh('git', ['rev-parse', '--short', 'HEAD'])}${sh('git', ['status', '--porcelain', 'supabase/functions/ai-search']) ? ' (ai-search has uncommitted changes)' : ''}`);
  console.log(`clock    IST ${istNow().toISOString().slice(0, 16).replace('T', ' ')}`);
  console.log(`queries  ${queries.length}${OPT.onlyClass ? ` (class ${OPT.onlyClass} only)` : ''}`);
  console.log(`judgments ${judgments.length} rows: ${byJudge.derived} derived, ${byJudge.agent} agent, ${byJudge.human} human, ${byJudge.llm} llm${byJudge.other ? `, ${byJudge.other} unlabelled` : ''}.`);
  console.log('          Metrics use every row that is not llm (derived, agent and human).');
  if (byJudge.human === 0) console.log('          NO row is human graded. This measures the bar on derived and agent grades only.');

  // Preflight: the fixture is present and whole, and what else shares the stack.
  const count = async (q) => { const { count: n, error } = await q; if (error) throw new Error(error.message); return n ?? 0; };
  const fxProducts = await count(svc.from('affiliate_products').select('id', { count: 'exact', head: true }).gte('id', FIX_LO).lte('id', FIX_HI).eq('active', true));
  const fxVenues = await count(svc.from('venues').select('id', { count: 'exact', head: true }).gte('id', FIX_LO).lte('id', FIX_HI));
  if (fxProducts !== 60 || fxVenues !== 12) {
    throw new Error(`fixture incomplete: ${fxProducts} of 60 active products, ${fxVenues} of 12 venues. Run node scripts/seed-search-eval.mjs`);
  }
  const foreignProducts = await count(svc.from('affiliate_products').select('id', { count: 'exact', head: true }).eq('active', true).or(`id.lt.${FIX_LO},id.gt.${FIX_HI}`));
  const foreignVenues = await count(svc.from('venues').select('id', { count: 'exact', head: true }).eq('status', 'verified').or(`id.lt.${FIX_LO},id.gt.${FIX_HI}`));
  const { data: ownedFlag } = await svc.from('app_config').select('value').eq('key', 'shop.owned_enabled').maybeSingle();
  console.log(`fixture  60 products, 12 venues present.`);
  console.log(`sharing  ${foreignProducts} active non fixture affiliate products, ${foreignVenues} verified non fixture venues, shop.owned_enabled=${JSON.stringify(ownedFlag?.value)}.`);
  if (foreignProducts || foreignVenues) {
    console.log('          Non fixture rows are NOT removed from results. They count as unjudged (grade 0) where they');
    console.log('          appear, so a shared stack lowers the scores rather than being silently excluded.');
  }

  const vectorNote = await prepareEmbeddings();

  const { data: auth, error: ae } = await client.auth.signInAnonymously();
  if (ae) throw new Error(`anonymous sign in: ${ae.message}`);
  const uid = auth.user.id;

  // Warm the function once so the first measured query is not a cold start.
  await setThrottle(uid, false);
  await client.functions.invoke('ai-search', { body: { query: 'warmup', entityTypes: ['gear'], limit: 1 } });

  const lateForTonight = istMinutes() >= 22 * 60 + 30;
  const runs = [];
  for (const q of queries) {
    if (q.tonight && lateForTonight) {
      runs.push({ q, skipped: 'tonight query after 22:30 IST' });
      continue;
    }
    const body = { query: q.query, limit: 20 };
    if (q.entityTypes) body.entityTypes = q.entityTypes;
    if (q.override?.sport) body.sport = q.override.sport;
    if (q.override?.priceMax !== undefined) body.priceMax = q.override.priceMax;
    if (q.place?.city) body.city = q.place.city;
    if (q.place?.lat !== undefined) { body.lat = q.place.lat; body.lng = q.place.lng; }
    if (q.expect?.flagsOnly) body.rerank = false;

    await setThrottle(uid, OPT.degraded);
    const t0 = performance.now();
    const res = await client.functions.invoke('ai-search', { body });
    const wallMs = Math.round(performance.now() - t0);
    if (res.error) {
      const detail = await res.error.context?.text?.().catch(() => '') ?? '';
      runs.push({ q, error: `${res.error.message} ${detail}`.trim(), wallMs });
      continue;
    }
    const run = { q, data: res.data, wallMs };

    // LOC-13: gear never reads the place. Same query with a location attached.
    if (!OPT.degraded && !OPT.baselineDiff && q.surface === 'shop' && !q.expect?.flagsOnly) {
      await setThrottle(uid, false);
      const withPlace = await client.functions.invoke('ai-search', { body: { ...body, ...HYD_POINT, city: 'Hyderabad' } });
      run.placeIds = withPlace.error ? `error ${withPlace.error.message}` : withPlace.data.results.map(hitKey);
    }
    runs.push(run);
  }
  await clearThrottle(uid);

  const skipped = runs.filter((r) => r.skipped);
  if (skipped.length) console.log(`\nSKIPPED ${skipped.length}: ${skipped.map((r) => `${r.q.id} (${r.skipped})`).join(', ')}`);
  const errored = runs.filter((r) => r.error);
  for (const r of errored) failures.push(`${r.q.id} "${r.q.query}" request failed: ${r.error}`);

  const attrs = await loadAttributes(runs);
  const evaluated = runs.filter((r) => r.data).map((r) => evaluate(r, attrs));

  if (OPT.baselineDiff) return baselineDiff(runs);

  const summary = summarise(evaluated, vectorNote);
  if (OPT.writeBaseline) writeBaseline(runs, summary, vectorNote, { foreignProducts, foreignVenues });
}

// ---------------------------------------------------------------------------
// Spend gate control
// ---------------------------------------------------------------------------
async function setThrottle(uid, saturate) {
  await svc.from('edge_rate_limits').delete().eq('bucket', 'ai-search-user').eq('key', uid);
  if (!saturate) return;
  // A fixed 60 second window: saturate this window and the next two so a query
  // that straddles a boundary still sees an exhausted bucket.
  const now = Math.floor(Date.now() / 60000) * 60000;
  const rows = [0, 1, 2].map((i) => ({ bucket: 'ai-search-user', key: uid, window_start: new Date(now + i * 60000).toISOString(), count: 100000 }));
  const { error } = await svc.from('edge_rate_limits').insert(rows);
  if (error) throw new Error(`could not saturate the throttle: ${error.message}`);
}
async function clearThrottle(uid) {
  await svc.from('edge_rate_limits').delete().eq('bucket', 'ai-search-user').eq('key', uid);
}

// ---------------------------------------------------------------------------
// Committed embeddings
// ---------------------------------------------------------------------------
async function prepareEmbeddings() {
  const file = join(EVAL, 'fixtures/embeddings.b64.json');
  const { count: withEmb } = await svc.from('affiliate_products').select('id', { count: 'exact', head: true })
    .gte('id', FIX_LO).lte('id', FIX_HI).not('embedding', 'is', null);
  if (!existsSync(file)) {
    console.log('\nvector   vector path not exercised: no committed embeddings (docs/search-eval/fixtures/embeddings.b64.json is absent).');
    console.log('          Generate them with scripts/search-eval-embed.mjs and a real Voyage key; see docs/search-eval/README.md.');
    if (withEmb) {
      // Stub or stale vectors on fixture rows would be measured as if they were
      // real geometry. Clear them and say so.
      await svc.from('affiliate_products').update({ embedding: null }).gte('id', FIX_LO).lte('id', FIX_HI);
      console.log(`          Cleared ${withEmb} fixture embedding(s) that did not come from the committed file.`);
    }
    return 'vector path not exercised: no committed embeddings';
  }
  const blob = JSON.parse(readFileSync(file, 'utf8'));
  const expected = process.env.VOYAGE_MODEL || 'voyage-3';
  if (blob.model !== expected) {
    throw new Error(`committed embeddings are tagged ${blob.model}, VOYAGE_MODEL is ${expected}. Regenerate: node scripts/search-eval-embed.mjs (docs/search-eval/README.md).`);
  }
  const decode = (b64) => `[${Array.from(new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0))).join(',')}]`;
  let p = 0;
  for (const [id, b64] of Object.entries(blob.products ?? {})) {
    const { error } = await svc.from('affiliate_products').update({ embedding: decode(b64) }).eq('id', id);
    if (error) throw new Error(`embedding load ${id}: ${error.message}`);
    p += 1;
  }
  let qn = 0;
  const now = new Date().toISOString();
  for (const q of Object.values(blob.queries ?? {})) {
    const hash = createHash('sha256').update(q.text.toLowerCase().trim()).digest('hex');
    const { error } = await svc.from('query_embedding_cache').upsert({ query_hash: hash, embedding: decode(q.b64), created_at: now }, { onConflict: 'query_hash' });
    if (error) throw new Error(`query cache load: ${error.message}`);
    qn += 1;
  }
  const missing = queries.filter((q) => !blob.queries?.[q.id]).length;
  console.log(`\nvector   loaded ${p} product and ${qn} query embeddings (${blob.model}, generated ${blob.generatedAt}).${missing ? ` ${missing} queries have no committed vector and will call the embedder (stub without a key).` : ''}`);
  return `vector path exercised on committed ${blob.model} embeddings`;
}

// ---------------------------------------------------------------------------
// Attributes for constraint checks, read live so non fixture hits are checked too
// ---------------------------------------------------------------------------
function hitKey(h) {
  return `${h.entityType}:${h.entityId}`;
}
async function loadAttributes(runs) {
  const gearIds = new Set();
  const courtIds = new Set();
  for (const r of runs) for (const h of r.data?.results ?? []) {
    if (h.entityType === 'gear' && h.entityId.startsWith('affiliate:')) gearIds.add(h.entityId.slice(10));
    if (h.entityType === 'court') courtIds.add(h.entityId);
  }
  const gear = new Map();
  const ids = [...gearIds];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await svc.from('affiliate_products')
      .select('id, title, brand, sport, active, product_offers ( id, price, in_stock, last_checked_at )').in('id', ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const p of data) {
      const inStock = p.product_offers.filter((o) => o.in_stock).map((o) => Number(o.price));
      gear.set(`gear:affiliate:${p.id}`, { ...p, inStockMin: inStock.length ? Math.min(...inStock) : null });
    }
  }
  const court = new Map();
  if (courtIds.size) {
    const { data, error } = await svc.from('courts').select('id, sport, venues ( id, name, city, status )').in('id', [...courtIds]);
    if (error) throw new Error(error.message);
    for (const c of data) court.set(`court:${c.id}`, c);
  }
  return { gear, court };
}

// ---------------------------------------------------------------------------
// Per query evaluation
// ---------------------------------------------------------------------------
function evaluate(run, attrs) {
  const { q, data, wallMs } = run;
  const results = data.results ?? [];
  const inScope = results.filter((h) => h.entityType === 'gear' || h.entityType === 'court');
  const outOfScope = results.length - inScope.length;
  const judged = J.get(q.id) ?? new Map();
  const ranked = inScope.map((h) => judged.get(hitKey(h)) ?? 0);
  const top10 = inScope.slice(0, 10);
  const unjudged = top10.filter((h) => !judged.has(hitKey(h))).length;
  const pool = [...judged.values()];
  const e = { id: q.id, cls: q.class, query: q.query, wallMs, results: results.length, outOfScope, unjudged, top10: top10.length, problems: [], vector: data.vector, mode: data.mode };
  if (OPT.degraded && data.vector !== false) e.problems.push(`degraded run but the response says vector=${data.vector}: the spend guard did not degrade this request`);

  if (q.expect?.flagsOnly) {
    const f = q.expect.flagsOnly;
    e.flagsOk = data.mode === f.mode && data.vector === f.vector && wallMs < f.maxWallMs;
    if (!e.flagsOk) e.problems.push(`keystroke flags mode=${data.mode} vector=${data.vector} wall=${wallMs}ms (want ${f.mode}, ${f.vector}, < ${f.maxWallMs}ms)`);
    return e;
  }

  e.ndcg = M.ndcgAt(ranked, pool, 10);
  if (BROWSE.has(q.class)) e.p5 = M.precisionAt(ranked, pool, 5, 2);
  if (q.expect?.hit1) e.hit1 = M.hitAt1(ranked, pool);
  if (RECALL.has(q.class)) e.recall5 = M.recallAt(ranked, pool, 5);

  // Constraint precision against the ground truth constraints.
  const c = q.expect?.constraints ?? {};
  let ok = 0;
  for (const h of inScope) {
    const why = violation(h, c, attrs);
    if (why) e.problems.push(`constraint: ${h.title} (${why})`);
    else ok += 1;
  }
  e.cpHits = inScope.length;
  e.cpOk = ok;

  // Honest empty.
  const kind = q.expect?.kind ?? 'results';
  if (kind === 'empty') {
    const b = String(data.broaden ?? '');
    const missing = (q.expect.broadenMentions ?? []).filter((m) => !b.replace(/(\d),(\d)/g, '$1$2').toLowerCase().includes(m.toLowerCase()));
    e.honest = results.length === 0 && b.length > 0 && missing.length === 0 && !M.hasDashOrEmoji(b);
    if (!e.honest) e.problems.push(`honest empty: ${results.length} results, broaden ${JSON.stringify(b)}${missing.length ? `, missing ${missing.join(', ')}` : ''}`);
  } else {
    e.honest = results.length > 0;
    if (!e.honest) e.problems.push(`expected results, got none (broaden ${JSON.stringify(data.broaden ?? '')})`);
  }

  // Court window accuracy.
  const courtHits = results.filter((h) => h.entityType === 'court');
  if (courtHits.length || q.expect?.courtPredicate) {
    const why = courtWindow(courtHits, data, q);
    e.court = why.length === 0;
    for (const w of why) e.problems.push(`court window: ${w}`);
  }

  // Answer grounding.
  if (q.expect?.answer && kind === 'results') {
    const why = grounding(data, attrs);
    e.grounded = why === null;
    if (why) e.problems.push(`answer grounding: ${why}`);
  }

  if (run.placeIds !== undefined) {
    const same = JSON.stringify(run.placeIds) === JSON.stringify(results.map(hitKey));
    e.locIndependent = same;
    if (!same) e.problems.push('LOC-13: gear results changed when a location was attached');
  }
  if (wallMs > M.THRESHOLDS.maxWallMs) e.problems.push(`latency: ${wallMs} ms over ${M.THRESHOLDS.maxWallMs} ms locally`);
  return e;
}

function violation(h, c, attrs) {
  if (c.entityTypes && !c.entityTypes.includes(h.entityType)) return `entity ${h.entityType} not asked`;
  if (h.entityType === 'gear') {
    const g = c.gear;
    if (!g) return null;
    const a = attrs.gear.get(hitKey(h));
    if (!a) return h.entityId.startsWith('affiliate:') ? 'product row not found' : 'owned product, cannot check';
    if (g.brand && String(a.brand ?? '').toLowerCase() !== g.brand) return `brand ${a.brand}, asked ${g.brand}`;
    if (g.sport && a.sport !== g.sport) return `sport ${a.sport}, asked ${g.sport}`;
    if (g.priceMax !== undefined && (a.inStockMin === null || a.inStockMin > g.priceMax)) return `cheapest in stock ${a.inStockMin ?? 'none (sold out)'}, ceiling ${g.priceMax}`;
    if (g.excludeIds?.includes(hitKey(h))) return 'the comparison anchor itself';
    return null;
  }
  if (h.entityType === 'court') {
    const cc = c.court;
    if (!cc) return null;
    const a = attrs.court.get(hitKey(h));
    if (!a) return 'court row not found';
    if (a.venues?.status !== 'verified') return `venue ${a.venues?.status}`;
    if (cc.sport && a.sport !== cc.sport) return `sport ${a.sport}, asked ${cc.sport}`;
    if (cc.city && String(a.venues?.city).toLowerCase() !== cc.city.toLowerCase()) return `city ${a.venues?.city}, asked ${cc.city}`;
    const price = h.slot?.price ?? h.price;
    if (cc.priceMax !== undefined && typeof price === 'number' && price > cc.priceMax) return `slot price ${price}, ceiling ${cc.priceMax}`;
    return null;
  }
  return null;
}

function courtWindow(courtHits, data, q) {
  const out = [];
  const w = data.parsedIntent?.when ?? { dateFrom: istDate(0), dateTo: istDate(6), timeFrom: '00:00', timeTo: '24:00', hasTime: false };
  const ceiling = q.expect?.constraints?.court?.priceMax;
  let sawLink = false;
  for (const h of courtHits) {
    if (h.slot) {
      if (sawLink && w.hasTime) out.push(`${h.title}: a slot hit after a link hit in a timed query`);
      if (h.slot.date < w.dateFrom || h.slot.date > w.dateTo) out.push(`${h.title}: slot date ${h.slot.date} outside ${w.dateFrom} to ${w.dateTo}`);
      if (h.slot.start < w.timeFrom || (w.timeTo !== '24:00' && h.slot.start >= w.timeTo)) out.push(`${h.title}: slot ${h.slot.start} outside ${w.timeFrom} to ${w.timeTo}`);
      if (ceiling !== undefined && h.slot.price > ceiling) out.push(`${h.title}: slot price ${h.slot.price} over ${ceiling}`);
    } else if (h.booking) {
      sawLink = true;
    } else {
      out.push(`${h.title}: a court hit with neither a slot nor a booking link`);
    }
  }
  if (q.expect?.courtPredicate === 'nearest_first') {
    const d = courtHits.map((h) => h.distanceKm).filter((x) => typeof x === 'number');
    for (let i = 1; i < d.length; i++) if (d[i] < d[i - 1]) { out.push(`not nearest first: ${d.join(', ')} km`); break; }
  }
  return out;
}

function grounding(data, attrs) {
  const a = data.answer;
  if (!a || typeof a.text !== 'string') return 'no answer field in the response';
  const resultIds = new Set((data.results ?? []).map(hitKey));
  const cites = Array.isArray(a.citations) ? a.citations : [];
  if (cites.length === 0) return 'answer has no citations';
  const allowed = new Set([(data.results ?? []).length]);
  if (data.parsedIntent?.priceMax !== undefined) allowed.add(Number(data.parsedIntent.priceMax));
  if (data.courts) { allowed.add(data.courts.slotVenues); allowed.add(data.courts.linkVenues); }
  for (const cte of cites) {
    const k = `${cte.entityType}:${cte.entityId}`;
    if (!resultIds.has(k)) return `citation ${k} is not in results`;
    const hit = data.results.find((h) => hitKey(h) === k);
    if (typeof hit.price === 'number') allowed.add(hit.price);
    if (hit.slot) {
      allowed.add(hit.slot.price);
      const [hh, mm] = hit.slot.start.split(':').map(Number);
      allowed.add(hh); allowed.add(hh % 12 === 0 ? 12 : hh % 12); allowed.add(mm);
    }
    const g = attrs.gear.get(k);
    for (const o of g?.product_offers ?? []) {
      allowed.add(Number(o.price));
      const hrs = (Date.now() - new Date(o.last_checked_at).getTime()) / 3600000;
      allowed.add(Math.floor(hrs)); allowed.add(Math.round(hrs)); allowed.add(Math.ceil(hrs));
    }
  }
  const stray = M.numbersIn(a.text).filter((n) => !allowed.has(n));
  if (stray.length) return `numbers not on any cited row: ${stray.join(', ')} in ${JSON.stringify(a.text)}`;
  if (M.hasDashOrEmoji(a.text)) return `dash or emoji in ${JSON.stringify(a.text)}`;
  return null;
}

// ---------------------------------------------------------------------------
// Aggregation and the gate
// ---------------------------------------------------------------------------
const fmt = (x) => (x === null || x === undefined ? '  n/a' : x.toFixed(3));

function summarise(ev, vectorNote) {
  const classes = [...new Set(ev.map((e) => e.cls))];
  const T = M.THRESHOLDS;
  const rows = [];
  const perClass = {};
  const gate = (label, value, ok) => { if (!ok) failures.push(`${label} = ${fmt(value)}`); };

  for (const cls of classes) {
    const es = ev.filter((e) => e.cls === cls);
    const cpHits = es.reduce((s, e) => s + (e.cpHits ?? 0), 0);
    const cpOk = es.reduce((s, e) => s + (e.cpOk ?? 0), 0);
    const r = {
      n: es.length,
      cp: cpHits ? cpOk / cpHits : null,
      ndcg: M.mean(es.map((e) => e.ndcg)),
      p5: M.mean(es.map((e) => e.p5)),
      hit1: M.mean(es.map((e) => e.hit1)),
      recall5: M.mean(es.map((e) => e.recall5)),
      honest: M.mean(es.map((e) => (e.honest === undefined ? null : e.honest ? 1 : 0))),
      court: M.mean(es.map((e) => (e.court === undefined ? null : e.court ? 1 : 0))),
      grounded: M.mean(es.map((e) => (e.grounded === undefined ? null : e.grounded ? 1 : 0))),
      flags: M.mean(es.map((e) => (e.flagsOk === undefined ? null : e.flagsOk ? 1 : 0))),
      ndcgUndefined: es.filter((e) => e.ndcg === null && e.flagsOk === undefined).length,
    };
    perClass[cls] = r;
    rows.push(cls);
    if (r.cp !== null) gate(`constraint precision [${cls}] (needs ${T.constraintPrecision})`, r.cp, r.cp >= T.constraintPrecision);
    if (r.ndcg.value !== null && !OPT.degraded) gate(`NDCG@10 [${cls}] (needs ${T.ndcgClass})`, r.ndcg.value, r.ndcg.value >= T.ndcgClass);
    if (BROWSE.has(cls) && r.p5.value !== null && !OPT.degraded) gate(`P@5 [${cls}] (needs ${T.precisionAt5})`, r.p5.value, r.p5.value >= T.precisionAt5);
    if (r.hit1.value !== null && !OPT.degraded) gate(`Hit@1 [${cls}] (needs ${T.hitAt1})`, r.hit1.value, r.hit1.value >= T.hitAt1);
    if (RECALL.has(cls) && r.recall5.value !== null && !OPT.degraded) gate(`Recall@5 [${cls}] (needs ${T.recallAt5})`, r.recall5.value, r.recall5.value >= T.recallAt5);
    if (r.flags.value !== null && r.flags.value < 1) gate(`keystroke flags [${cls}] (needs 1)`, r.flags.value, false);
  }

  const graded = ev.filter((e) => e.flagsOk === undefined);
  const cpHits = graded.reduce((s, e) => s + (e.cpHits ?? 0), 0);
  const cpOk = graded.reduce((s, e) => s + (e.cpOk ?? 0), 0);
  const overall = {
    cp: cpHits ? cpOk / cpHits : null,
    ndcg: M.mean(graded.map((e) => e.ndcg)),
    honest: M.mean(graded.map((e) => (e.honest ? 1 : 0))),
    court: M.mean(graded.map((e) => (e.court === undefined ? null : e.court ? 1 : 0))),
    grounded: M.mean(graded.map((e) => (e.grounded === undefined ? null : e.grounded ? 1 : 0))),
    unjudged: graded.reduce((s, e) => s + e.top10, 0) ? graded.reduce((s, e) => s + e.unjudged, 0) / graded.reduce((s, e) => s + e.top10, 0) : 0,
    outOfScope: graded.reduce((s, e) => s + e.outOfScope, 0),
    loc: M.mean(graded.map((e) => (e.locIndependent === undefined ? null : e.locIndependent ? 1 : 0))),
    slow: graded.filter((e) => e.wallMs > T.maxWallMs).length,
    wall: graded.map((e) => e.wallMs).sort((a, b) => a - b),
  };

  // Table.
  console.log('\nclass              n   CP     NDCG@10 P@5    Hit@1  R@5    honest court  ground flags');
  for (const cls of rows) {
    const r = perClass[cls];
    console.log(`${cls.padEnd(18)} ${String(r.n).padStart(3)} ${fmt(r.cp)} ${fmt(r.ndcg.value)}   ${fmt(r.p5.value)} ${fmt(r.hit1.value)} ${fmt(r.recall5.value)} ${fmt(r.honest.value)}  ${fmt(r.court.value)} ${fmt(r.grounded.value)} ${fmt(r.flags.value)}`);
  }
  console.log(`${'OVERALL'.padEnd(18)} ${String(graded.length).padStart(3)} ${fmt(overall.cp)} ${fmt(overall.ndcg.value)}   ${' '.repeat(20)} ${fmt(overall.honest.value)}  ${fmt(overall.court.value)} ${fmt(overall.grounded.value)}`);
  const undef = Object.values(perClass).reduce((s, r) => s + r.ndcgUndefined, 0);
  console.log(`\nNDCG averaged over ${overall.ndcg.n} queries; ${undef} queries have no grade above 0 (expected empty) and are scored by honest empty accuracy instead.`);
  console.log(`Unjudged rate ${fmt(overall.unjudged)} of the top 10 gear and court hits. ${overall.outOfScope} coach, athlete or clip hits sat outside graded scope and were removed before ranking metrics.`);
  console.log(`Answer grounding checked on ${overall.grounded.n} queries that must carry an answer.`);
  if (overall.loc.value !== null) console.log(`LOC-13 gear independent of place on ${fmt(overall.loc.value)} of ${overall.loc.n} shop queries.`);
  const p = (x) => overall.wall[Math.min(overall.wall.length - 1, Math.floor(x * overall.wall.length))];
  console.log(`Local wall time p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${overall.wall[overall.wall.length - 1]} ms; ${overall.slow} over ${T.maxWallMs} ms.`);
  console.log(`Vector: ${vectorNote}.`);
  const vecOn = ev.filter((e) => e.vector === true).length;
  const llmOn = ev.filter((e) => e.mode === 'llm').length;
  console.log(`Response flags: vector=true on ${vecOn} of ${ev.length} queries, mode=llm on ${llmOn} (empty ANTHROPIC_API_KEY keeps mode keyword).`);

  if (OPT.degraded) {
    if (vecOn) failures.push(`degraded run: ${vecOn} responses still report vector=true, so the floor was not measured degraded`);
    gate(`degraded NDCG@10 overall (needs ${T.degradedNdcg})`, overall.ndcg.value, overall.ndcg.value !== null && overall.ndcg.value >= T.degradedNdcg);
    gate(`degraded constraint precision (needs ${T.degradedConstraintPrecision})`, overall.cp, overall.cp === null || overall.cp >= T.degradedConstraintPrecision);
  } else {
    if (overall.cp !== null) gate(`constraint precision overall (needs ${T.constraintPrecision})`, overall.cp, overall.cp >= T.constraintPrecision);
    gate(`NDCG@10 overall (needs ${T.ndcgOverall})`, overall.ndcg.value, overall.ndcg.value !== null && overall.ndcg.value >= T.ndcgOverall);
    gate(`honest empty accuracy (needs ${T.honestEmpty})`, overall.honest.value, overall.honest.value >= T.honestEmpty);
    if (overall.court.value !== null) gate(`court window accuracy (needs ${T.courtWindow})`, overall.court.value, overall.court.value >= T.courtWindow);
    if (overall.grounded.value !== null) gate(`answer grounding (needs ${T.answerGrounding})`, overall.grounded.value, overall.grounded.value >= T.answerGrounding);
    gate(`unjudged rate (needs <= ${T.unjudgedRate})`, overall.unjudged, overall.unjudged <= T.unjudgedRate);
    if (overall.loc.value !== null) gate('LOC-13 location independence (needs 1)', overall.loc.value, overall.loc.value === 1);
  }
  if (overall.slow) failures.push(`${overall.slow} queries over ${T.maxWallMs} ms locally (regression signal)`);

  // Per query problems, so a red run says where to look.
  console.log('\nPer query findings:');
  let shown = 0;
  for (const e of ev) {
    if (!e.problems.length) continue;
    shown += 1;
    console.log(`  ${e.id} "${e.query}"${e.ndcg !== undefined && e.ndcg !== null ? ` ndcg=${e.ndcg.toFixed(2)}` : ''}`);
    for (const p2 of e.problems.slice(0, 4)) console.log(`      ${p2}`);
    if (e.problems.length > 4) console.log(`      and ${e.problems.length - 4} more`);
  }
  if (!shown) console.log('  none');
  return { perClass, overall: { ...overall, wall: undefined } };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------
function writeBaseline(runs, summary, vectorNote, sharing) {
  const out = {
    recordedAt: new Date().toISOString(),
    recordedAtIst: istNow().toISOString().slice(0, 16).replace('T', ' '),
    gitHead: sh('git', ['rev-parse', 'HEAD']),
    note: 'Recorded against the ai-search function BEFORE the L0-T2 module split. --baseline-diff compares result ids per query, in order.',
    vector: vectorNote,
    sharing,
    queries: Object.fromEntries(runs.map((r) => [r.q.id, r.skipped ? { skipped: r.skipped } : r.error ? { error: r.error } : {
      ids: r.data.results.map(hitKey),
      broaden: r.data.broaden ?? null,
      mode: r.data.mode,
      vector: r.data.vector,
    }])),
    metrics: summary,
  };
  writeFileSync(join(EVAL, 'baseline.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`\nwrote docs/search-eval/baseline.json (${runs.length} queries)`);
}

function baselineDiff(runs) {
  const file = join(EVAL, 'baseline.json');
  if (!existsSync(file)) throw new Error('docs/search-eval/baseline.json does not exist; record one with --write-baseline');
  const base = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\nbaseline recorded ${base.recordedAtIst} IST at ${String(base.gitHead).slice(0, 7)}`);
  // A court broaden names a real slot ("Shuttle House, today at 9:30 PM"), and
  // that slot moves with the clock without any code change. The slot phrase is
  // masked before comparison; the venue named and every other word still count.
  const SLOT = /\b(today|tomorrow|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|\d{1,2} [A-Z][a-z]{2}) at \d{1,2}:\d{2} (AM|PM)\b/g;
  const norm = (s) => (s === null || s === undefined ? null : String(s).replace(SLOT, '<slot>'));
  console.log('  (court broaden lines are compared with their slot day and time masked, since the clock moves them)');
  let changed = 0;
  let compared = 0;
  const notCompared = [];
  for (const r of runs) {
    const b = base.queries?.[r.q.id];
    if (!b) { notCompared.push(`${r.q.id} (not in baseline)`); continue; }
    if (r.skipped || b.skipped) { notCompared.push(`${r.q.id} (${r.skipped ?? b.skipped})`); continue; }
    if (r.error || b.error) { changed += 1; console.log(`  CHANGED ${r.q.id}: error now=${r.error ?? 'none'} before=${b.error ?? 'none'}`); continue; }
    compared += 1;
    const now = r.data.results.map(hitKey);
    if (JSON.stringify(now) !== JSON.stringify(b.ids) || norm(r.data.broaden) !== norm(b.broaden)) {
      changed += 1;
      console.log(`  CHANGED ${r.q.id} "${r.q.query}"`);
      const gone = b.ids.filter((x) => !now.includes(x));
      const added = now.filter((x) => !b.ids.includes(x));
      if (gone.length) console.log(`      removed ${gone.join(', ')}`);
      if (added.length) console.log(`      added   ${added.join(', ')}`);
      if (!gone.length && !added.length && JSON.stringify(now) !== JSON.stringify(b.ids)) console.log('      same ids, different order');
      if (norm(r.data.broaden) !== norm(b.broaden)) console.log(`      broaden ${JSON.stringify(b.broaden)} -> ${JSON.stringify(r.data.broaden ?? null)}`);
    }
  }
  if (notCompared.length) console.log(`  not compared: ${notCompared.join(', ')}`);
  console.log(`\nbaseline diff: ${changed} of ${compared} compared queries changed (result ids in order, and the broaden line).`);
  if (changed) failures.push(`${changed} queries differ from the baseline`);
}

main()
  .catch((e) => {
    console.error(`\nERROR ${e.message}`);
    failures.push(`exception: ${e.message}`);
  })
  .finally(() => {
    for (const n of notes) console.log(n);
    if (failures.length) {
      console.log(`\nFAILED ${failures.length} gate(s):`);
      for (const f of failures) console.log(`  ${f}`);
    } else {
      console.log('\nALL GATES PASSED');
    }
    process.exit(failures.length ? 1 : 0);
  });
