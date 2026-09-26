#!/usr/bin/env node
// ATLITOS v2 - scripts/verify-gear-recall.mjs
//
// Proves gear search holds up on a catalogue bigger than a demo:
//   1. RECALL. With 500 filler products, a product that exactly matches the
//      query is found even though it was inserted last. The old keyword path
//      read the first 50 rows in no order, so it never looked at it.
//   2. OWNED CATALOGUE. With shop.owned_enabled false (the launch setting),
//      search returns no owned products, from ANY caller, not only the shop
//      screen that filtered them client side.
//   3. RANKING. "cricket bat under 5000" puts an actual bat first.
//
// Fixtures are LOCAL ONLY and deleted at the end, pass or fail.
// Needs the local stack, seeds, and `supabase functions serve` running with
// empty AI keys (see scripts/verify-court-search-e2e.mjs).
//
// Usage: export PATH=/opt/homebrew/bin:$PATH; node scripts/verify-gear-recall.mjs

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-gear-recall.mjs');
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, opts);
const client = createClient(SUPABASE_URL, ANON_KEY, opts);

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== undefined ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
  if (!ok) failures.push(label);
}

const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
const UNIQUE = `zephyr${stamp}`;
const fixtureIds = [];

async function search(query, entityTypes) {
  const { data, error } = await client.functions.invoke('ai-search', { body: { query, entityTypes, limit: 10 } });
  if (error) throw new Error(`${query}: ${error.message} ${await error.context?.text?.()}`);
  return data;
}

async function main() {
  console.log(`verify-gear-recall against ${SUPABASE_URL} (run ${stamp})`);
  const { error: ae } = await client.auth.signInAnonymously();
  if (ae) throw new Error(`anonymous sign in: ${ae.message}`);

  const { data: flag } = await svc.from('app_config').select('value').eq('key', 'shop.owned_enabled').maybeSingle();
  check('fixture: shop.owned_enabled is false, the launch setting', flag?.value === false, flag?.value);

  // 500 fillers first, the target LAST.
  const fillers = Array.from({ length: 500 }, (_, i) => ({
    title: `Recall Filler ${String(i).padStart(3, '0')} ${stamp}`,
    brand: 'Fillerco',
    sport: 'tennis',
    description: 'A plain filler product for a recall test.',
    active: true,
  }));
  for (let i = 0; i < fillers.length; i += 100) {
    const { data, error } = await svc.from('affiliate_products').insert(fillers.slice(i, i + 100)).select('id');
    if (error) throw new Error(`fillers: ${error.message}`);
    fixtureIds.push(...data.map((r) => r.id));
  }
  const { data: target, error: te } = await svc
    .from('affiliate_products')
    .insert({ title: `${UNIQUE} Titanium Pickle Paddle`, brand: 'Zephyrco', sport: 'tennis', description: 'Lightweight paddle with a textured face.', active: true })
    .select('id')
    .single();
  if (te) throw new Error(`target: ${te.message}`);
  fixtureIds.push(target.id);
  await svc.from('product_offers').insert({ affiliate_product_id: target.id, retailer: 'Test Store', price: 999, affiliate_url: `https://example.test/p/${UNIQUE}` });

  // 1. Recall
  const hit = await search(`${UNIQUE} paddle`, ['gear']);
  const ids = hit.results.map((r) => r.entityId);
  check('1a the exact product is found among 508 active products, though inserted last', ids.includes(`affiliate:${target.id}`), hit.broaden ?? ids.slice(0, 3));
  check('1b and it is the top result', ids[0] === `affiliate:${target.id}`, ids[0]);
  const stemmed = await search(`${UNIQUE} paddles`, ['gear']);
  check('1c a plural still finds it (stemming)', stemmed.results.some((r) => r.entityId === `affiliate:${target.id}`), stemmed.broaden);

  // The recall function runs with its own privileges, so it must apply the
  // public rule itself: a delisted product is never recalled.
  const { data: hidden } = await svc
    .from('affiliate_products')
    .insert({ title: `${UNIQUE} Delisted Paddle`, brand: 'Zephyrco', sport: 'tennis', active: false })
    .select('id')
    .single();
  fixtureIds.push(hidden.id);
  const direct = await client.rpc('search_affiliate_product_ids', { p_terms: [UNIQUE], p_limit: 50 });
  const directIds = (direct.data ?? []).map((r) => r.id);
  check('1d the recall function never returns a delisted product', !directIds.includes(hidden.id) && directIds.includes(target.id), direct.error?.message ?? directIds);

  // 2. Owned catalogue stays out while the flag is off, from every caller
  for (const [query, types] of [['cricket bat', ['gear']], ['cricket bat', undefined], ['badminton racket', undefined]]) {
    const r = await search(query, types);
    const owned = r.results.filter((h) => h.entityType === 'gear' && !h.entityId.startsWith('affiliate:'));
    check(`2 "${query}"${types ? '' : ' (home search, all types)'} returns no owned products`, owned.length === 0, owned.map((h) => h.title));
  }

  // 3. Ranking
  const bats = await search('cricket bat under 5000', ['gear']);
  check('3 "cricket bat under 5000" puts a bat first', /\bbat\b/i.test(bats.results[0]?.title ?? ''), bats.results.slice(0, 3).map((r) => r.title));
}

main()
  .catch((e) => {
    console.error(`ERROR ${e.message}`);
    failures.push('exception');
  })
  .finally(async () => {
    if (fixtureIds.length) {
      for (let i = 0; i < fixtureIds.length; i += 200) await svc.from('affiliate_products').delete().in('id', fixtureIds.slice(i, i + 200));
      console.log(`  (removed ${fixtureIds.length} fixture products)`);
    }
    console.log(failures.length ? `\nFAILED ${failures.length} check(s)` : '\nALL CHECKS PASSED');
    process.exit(failures.length ? 1 : 0);
  });
