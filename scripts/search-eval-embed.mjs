#!/usr/bin/env node
// ATLITOS v2 - scripts/search-eval-embed.mjs
//
// Generates docs/search-eval/fixtures/embeddings.b64.json: REAL Voyage
// embeddings for the 60 fixture products and the 160 evaluation queries, so the
// harness (scripts/verify-search-eval.mjs) can run the vector path on real
// geometry with no key and no network (ADR-014 D1; plan section 1.2).
//
// Run ONCE by someone holding a Voyage key, and again only when VOYAGE_MODEL
// changes. The harness refuses a blob whose model tag differs from VOYAGE_MODEL.
//
// KEY. Read from ~/.config/atlitos/voyage.env (a line VOYAGE_API_KEY=...), or
// from the VOYAGE_API_KEY environment variable when set. The key is never
// printed, never written into the output, and never sent anywhere but
// api.voyageai.com.
//
// TEXT. Products are embedded as input_type "document" with EXACTLY the text
// gear-embed builds (title, brand, sport, skill_level, age_range, description
// joined by spaces; supabase/functions/gear-embed/index.ts documentText), read
// from the local stack after scripts/seed-search-eval.mjs. Queries are
// embedded as input_type "query" from the trimmed query text, which is what
// ai-search embeds; the harness caches them under sha256(lower(trim(query))).
//
// Usage:
//   export PATH=/opt/homebrew/bin:$PATH
//   node scripts/seed-search-eval.mjs
//   node scripts/search-eval-embed.mjs            # writes the blob
//   node scripts/search-eval-embed.mjs --check    # key present? fixture present? no network call

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/search-eval/fixtures/embeddings.b64.json');
const KEY_FILE = join(homedir(), '.config/atlitos/voyage.env');
const MODEL = process.env.VOYAGE_MODEL || 'voyage-3';
const DIMS = 1024;
const BATCH = 64;
const CHECK_ONLY = process.argv.includes('--check');

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  console.error(`REFUSED: search-eval-embed.mjs reads the fixture from the local stack only (${SUPABASE_URL}).`);
  process.exit(1);
}
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function loadKey() {
  if (process.env.VOYAGE_API_KEY) return { key: process.env.VOYAGE_API_KEY, source: 'the VOYAGE_API_KEY environment variable' };
  if (!existsSync(KEY_FILE)) return { key: null, source: null };
  const line = readFileSync(KEY_FILE, 'utf8').split('\n').find((l) => /^\s*VOYAGE_API_KEY\s*=/.test(l));
  const key = line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : '';
  return { key: key || null, source: KEY_FILE };
}

function documentText(row) {
  return [row.title, row.brand, row.sport, row.skill_level, row.age_range, row.description]
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .join(' ');
}

async function voyage(key, texts, inputType) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: texts.slice(i, i + BATCH), model: MODEL, input_type: inputType, output_dimension: DIMS }),
    });
    if (!res.ok) throw new Error(`Voyage returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const d of body.data) {
      if (!Array.isArray(d.embedding) || d.embedding.length !== DIMS) throw new Error(`Voyage returned a vector of length ${d.embedding?.length}, expected ${DIMS}`);
      out.push(d.embedding);
    }
  }
  return out;
}

const b64 = (vec) => Buffer.from(new Float32Array(vec).buffer).toString('base64');

async function main() {
  const { key, source } = loadKey();
  if (!key) {
    console.error(
      `search-eval-embed.mjs: no Voyage key. Put a line VOYAGE_API_KEY=... in ${KEY_FILE}\n` +
        '(or export VOYAGE_API_KEY) and run again. Nothing was written, and the harness keeps\n' +
        'reporting "vector path not exercised: no committed embeddings" until this runs.',
    );
    process.exit(1);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rows, error } = await svc.from('affiliate_products')
    .select('id, title, brand, sport, skill_level, age_range, description')
    .gte('id', 'e0000000-0000-0000-0000-000000000000').lte('id', 'e0000000-ffff-ffff-ffff-ffffffffffff')
    .order('id');
  if (error) throw new Error(error.message);
  if (rows.length !== 60) throw new Error(`expected 60 fixture products, found ${rows.length}. Run node scripts/seed-search-eval.mjs first.`);
  const queries = readFileSync(join(ROOT, 'docs/search-eval/queries.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

  console.log(`key from ${source}; model ${MODEL}; ${rows.length} products, ${queries.length} queries.`);
  if (CHECK_ONLY) {
    console.log('--check: everything needed is present. No call was made.');
    return;
  }

  const docVecs = await voyage(key, rows.map(documentText), 'document');
  const qVecs = await voyage(key, queries.map((q) => q.query.trim()), 'query');

  const blob = {
    model: MODEL,
    dims: DIMS,
    encoding: 'float32 little endian, base64',
    generatedAt: new Date().toISOString(),
    productText: 'gear-embed documentText: title brand sport skill_level age_range description',
    products: Object.fromEntries(rows.map((r, i) => [r.id, b64(docVecs[i])])),
    queries: Object.fromEntries(queries.map((q, i) => [q.id, { text: q.query.trim(), b64: b64(qVecs[i]) }])),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(blob) + '\n');
  console.log(`wrote ${OUT.replace(ROOT + '/', '')}: ${rows.length} product and ${queries.length} query vectors.`);
}

main().catch((e) => {
  console.error(`search-eval-embed.mjs: ${e.message}`);
  process.exit(1);
});
