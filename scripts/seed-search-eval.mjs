#!/usr/bin/env node
// ATLITOS v2 - scripts/seed-search-eval.mjs
//
// Applies the search evaluation fixture (supabase/seed/local_seed_search_eval.sql:
// 60 products, 130 offers, 12 venues, all ids e0000000-, all URLs on
// example.test) to the LOCAL stack. docs/PLAN-SEARCH-LOCATION-AFFILIATE.md L0-T1,
// ADR-014 D1.
//
// REFUSES ANY TARGET THAT IS NOT LOOPBACK, before it writes anything. Two
// independent guards, both evaluated before psql is ever spawned:
//   1. assertWritableTarget (scripts/lib/guard-target.mjs) on SUPABASE_URL,
//      which exits 1 on the production ref;
//   2. a loopback check on BOTH SUPABASE_URL and the database URL, which exits
//      1 on any host that is not 127.0.0.1 or localhost. The production
//      override that guard-target.mjs honours is deliberately NOT honoured
//      here: the fixture is invented data and has no business anywhere else.
//
// Usage:
//   export PATH=/opt/homebrew/bin:$PATH
//   node scripts/seed-search-eval.mjs            # apply (idempotent)
//   node scripts/seed-search-eval.mjs --clean    # remove every e0000000- fixture row
//
// Needs partner@atlitos.dev (scripts/seed-demo-users.mjs) to own the venues.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertWritableTarget } from './lib/guard-target.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const DB_URL = process.env.ATLITOS_LOCAL_DB_URL ?? process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function isLoopback(url) {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

// Guard 1: the shared production guard. Exits the process on the prod ref.
// The override variable is stripped first so a deliberate production write
// switch set for some other script cannot carry this one through.
delete process.env.ATLITOS_ALLOW_PRODUCTION_WRITE;
assertWritableTarget(SUPABASE_URL, 'seed-search-eval.mjs');

// Guard 2: loopback only, for both the API URL and the database URL.
for (const [label, url] of [['SUPABASE_URL', SUPABASE_URL], ['database URL', DB_URL]]) {
  if (!isLoopback(url)) {
    console.error(
      `\nREFUSED: seed-search-eval.mjs only writes to the local stack.\n\n  ${label}: ${url.replace(/:\/\/[^@]*@/, '://***@')}\n\n` +
        'The search evaluation fixture is invented data (example.test URLs, e0000000 ids).\n' +
        'It must never reach a shared or production database. Nothing was written.\n',
    );
    process.exit(1);
  }
}

const clean = process.argv.includes('--clean');
const SQL_FILE = join(ROOT, 'supabase/seed/local_seed_search_eval.sql');

const args = clean
  ? ['-v', 'ON_ERROR_STOP=1', '-q', '-c',
     "begin; delete from public.affiliate_products where id::text like 'e0000000-%'; delete from public.venues where id::text like 'e0000000-%'; commit;"]
  : ['-v', 'ON_ERROR_STOP=1', '-q', '-f', SQL_FILE];

const res = spawnSync('psql', [DB_URL, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
if (res.error) {
  console.error(`seed-search-eval.mjs: could not run psql (${res.error.message}). export PATH=/opt/homebrew/bin:$PATH`);
  process.exit(1);
}
if (res.status !== 0) {
  console.error(`seed-search-eval.mjs: psql exited ${res.status}`);
  process.exit(1);
}

const count = spawnSync('psql', [DB_URL, '-At', '-c',
  "select (select count(*) from public.affiliate_products where id::text like 'e0000000-%') || ' products, ' || " +
  "(select count(*) from public.product_offers where id::text like 'e0000000-%') || ' offers, ' || " +
  "(select count(*) from public.venues where id::text like 'e0000000-%') || ' venues, ' || " +
  "(select count(*) from public.courts where id::text like 'e0000000-%') || ' courts'"], { encoding: 'utf8' });
console.log(`seed-search-eval.mjs: ${clean ? 'cleaned' : 'applied'}; fixture now holds ${count.stdout.trim()}`);
