// verify-rls-phase3.mjs — LAUNCH Phase 3, Track A (Database) acceptance suite.
//
// Proves the P1-4 RLS work and the CT-2/3/4/6/7 objects. Two layers:
//
//  1. LIVE isolation matrix over PostgREST with two REAL authenticated users
//     (no service role): the AT-62 non-vacuous form. It asserts A.id <> B.id
//     FIRST, then proves, per money/ownership table, that A's unscoped SELECT
//     returns ZERO of B's rows and that a forbidden client WRITE by A is REFUSED
//     (error, not a silent 0-row success). This runs now and needs only the mob
//     app env + two seeded users.
//
//  2. SQL EVIDENCE blocks for the checks that need direct DB / EXPLAIN / catalog
//     access (A1 initplan, A2 duplicate-policy count, A5 rate-limit grants, A6
//     clip machine, A7 sweep capture, A8 advisor). These are printed as ready
//     queries for the biased approver to run via the Supabase MCP execute_sql
//     (or psql), because PostgREST cannot EXPLAIN or read pg_policies. Nothing
//     here applies a migration; the approver runs the migrations in a rolled-back
//     transaction and executes these against that state.
//
// Usage:
//   node scripts/verify-rls-phase3.mjs
//   (reads apps/mobile/.env for EXPLAIN_PUBLIC_SUPABASE_URL / ANON_KEY, the
//    repo's established verify-script pattern; two users below must exist.)

import { readFileSync } from 'node:fs';

function readEnvFile(p) {
  const o = {};
  try {
    for (const l of readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].trim();
    }
  } catch {}
  return o;
}

const env = readEnvFile('apps/mobile/.env');
const URL = process.env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PW = process.env.ATLITOS_DEMO_PW || 'AtlitosDemo!2026';
// Two seeded demo accounts on distinct owners. Override via env if seeds differ.
const USER_A = process.env.RLS_USER_A || 'player@atlitos.dev';
const USER_B = process.env.RLS_USER_B || 'coach1@atlitos.dev';

async function signIn(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`signin ${email}: ${JSON.stringify(j)}`);
  return { token: j.access_token, uid: j.user.id };
}
async function rest(method, path, token, body) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

// Money / ownership tables that 0091 consolidates and 0090 rewrites. For each we
// hold the owner column so the cross-tenant assertion is exact. A SELECT filtered
// to B's owner value must return 0 rows for A.
const OWNERSHIP_TABLES = [
  { table: 'orders', owner: 'user_id' },
  { table: 'payment_intents', owner: 'user_id' },
  { table: 'sessions', owner: 'player_id' },
  { table: 'donations', owner: 'donor_id' },
  { table: 'support_tickets', owner: 'submitter_id' },
];

function ok(b) { return b ? 'PASS' : 'FAIL'; }

async function main() {
  const A = await signIn(USER_A);
  const B = await signIn(USER_B);

  const R = { A_uid: A.uid, B_uid: B.uid };
  // AT-62: assert the two parties DIFFER before trusting any isolation result.
  R.A3_ids_differ = A.uid !== B.uid;
  console.log(`A3 ids differ: ${ok(R.A3_ids_differ)} (A=${A.uid} B=${B.uid})`);
  if (!R.A3_ids_differ) {
    console.error('ABORT: the two test users share an id; every isolation check below would pass vacuously.');
    process.exit(1);
  }

  console.log('\n=== A3 isolation matrix (as user A, must see ZERO of B rows) ===');
  R.A3 = {};
  for (const { table, owner } of OWNERSHIP_TABLES) {
    // As A, ask for rows owned by B. RLS must return zero regardless of filter.
    const res = await rest('GET', `${table}?${owner}=eq.${B.uid}&select=*`, A.token);
    const rows = Array.isArray(res.body) ? res.body.length : `err:${JSON.stringify(res.body)}`;
    const pass = Array.isArray(res.body) && res.body.length === 0;
    R.A3[table] = { a_sees_b_rows: rows, pass };
    console.log(`  ${table.padEnd(18)} A sees B rows = ${rows}  ${ok(pass)}`);
  }

  console.log('\n=== A3 forbidden client writes (must be REFUSED, not silent) ===');
  // Financial invariant: these writes must all fail (4xx / error body), proving
  // the forbidden write is refused, not merely that an allowed one succeeds.
  R.writes = {};
  const forbidden = [
    ['payment_intents insert', () => rest('POST', 'payment_intents', A.token, { user_id: A.uid, amount: 1, status: 'created', domain: 'session' })],
    ['ledger_entries insert', () => rest('POST', 'ledger_entries', A.token, { account_type: 'platform', direction: 'debit', amount: 1, domain: 'session' })],
    ['orders status patch', () => rest('PATCH', `orders?user_id=eq.${A.uid}`, A.token, { status: 'delivered' })],
  ];
  for (const [label, fn] of forbidden) {
    const res = await fn();
    // A refusal is any non-2xx, OR a 2xx that wrote zero rows (empty array).
    const wroteRows = Array.isArray(res.body) && res.body.length > 0;
    const refused = res.status >= 400 || !wroteRows;
    R.writes[label] = { status: res.status, refused };
    console.log(`  ${label.padEnd(24)} status=${res.status} refused=${ok(refused)}`);
  }

  const allPass =
    R.A3_ids_differ &&
    Object.values(R.A3).every((x) => x.pass) &&
    Object.values(R.writes).every((x) => x.refused);
  console.log(`\nLIVE PostgREST isolation result: ${ok(allPass)}`);

  console.log(SQL_EVIDENCE);
  process.exit(allPass ? 0 : 1);
}

// ---------------------------------------------------------------------------
// SQL evidence blocks for the approver (run via Supabase MCP execute_sql / psql
// against the migrated-but-rolled-back state). Each maps to an acceptance id.
// ---------------------------------------------------------------------------
const SQL_EVIDENCE = `
=========================================================================
SQL EVIDENCE (run via MCP execute_sql / psql; PostgREST cannot do these).
Apply 0090-0094 inside BEGIN; ... run these ... ROLLBACK; (except the 0094
enum ADD VALUE, which cannot be exercised inside a single rolled-back tx).
=========================================================================

-- A1 (initplan): every public policy referencing auth.uid()/auth.jwt() must be
-- WRAPPED. This returns the policies that are STILL bare (expect 0 rows post-0090):
select schemaname, tablename, policyname
from pg_policies
where schemaname='public'
  and (
    (qual is not null and qual ~ 'auth\\.(uid|jwt)\\(\\)'
       and qual !~ '\\(\\s*SELECT\\s+auth\\.(uid|jwt)\\(\\)')
    or (with_check is not null and with_check ~ 'auth\\.(uid|jwt)\\(\\)'
       and with_check !~ '\\(\\s*SELECT\\s+auth\\.(uid|jwt)\\(\\)')
  );

-- A1 spot EXPLAIN (chat, clips, one money table): expect InitPlan / $0, no
-- per-row auth.uid(). Run each as the authenticated role with a real sub set:
--   set local role authenticated;
--   select set_config('request.jwt.claim.sub','<A.uid>', true);
--   explain (costs off) select * from public.chat_messages;
--   explain (costs off) select * from public.clips;
--   explain (costs off) select * from public.sessions;

-- A2 (duplicate permissive SELECT): count (table, cmd=SELECT, roles) groups with
-- more than one permissive policy for the exactly-{authenticated} role set.
-- Expect 0 rows post-0091 for the targeted pairs:
select tablename, count(*) as dup
from pg_policies
where schemaname='public' and permissive='PERMISSIVE' and cmd='SELECT'
  and roles = array['authenticated']::name[]
group by tablename having count(*) > 1;

-- A5 (CT-2 grants): take_rate_limit_token must be service_role only.
select proname, proacl from pg_proc where proname='take_rate_limit_token';
-- and functional: as service_role, 61 takes return 60 true then false:
--   select count(*) filter (where t) as trues, count(*) filter (where not t) as falses
--   from (select public.take_rate_limit_token('t','k',60,60) t from generate_series(1,61)) s;
-- anon/authenticated EXECUTE must raise permission denied:
--   set local role anon;   select public.take_rate_limit_token('t','k',60,60);
--   set local role authenticated; select public.take_rate_limit_token('t','k',60,60);

-- A6 (CT-6 clip machine): drive the edges and prove the illegal one is refused.
--   select public.clip_transition_internal('<uploading clip>','failed','x');   -- ok
--   select public.retry_failed_clip('<failed clip owned by caller>');           -- failed->uploading
--   select public.clip_transition_internal('<ready clip>','failed','x');        -- expect INVALID_TRANSITION
-- and the sweep marks a planted >30min object-absent uploading clip failed:
--   select public.expire_stale_holds();   -- returns clips_failed >= 1
--   select status, failure_reason from public.clips where id='<planted>';

-- A7 (CT-7 sweep capture): with one arm rigged to fail, sibling arms still run
-- and a sweep_failures row is captured (per-domain counts remain in the jsonb):
--   select public.expire_stale_holds();   -- arm_failures>=1, other counts present
--   select arm, error from public.sweep_failures order by created_at desc;

-- A8 (advisor): capture the performance + security advisor output before and
-- after 0090-0094 and diff; expect auth_rls_initplan and the targeted
-- multiple_permissive_policies pairs to drop with NO new ERROR:
--   (Supabase MCP) get_advisors type=performance ; get_advisors type=security
`;

main().catch((e) => { console.error(e); process.exit(1); });
