#!/usr/bin/env node
// ATLITOS v2 - scripts/verify-manual-payouts.mjs
//
// Proves 0130: payout methods and the manual payout run. Every check is
// written so the WRONG behaviour fails it, and the ones that guard money are
// paired: proving the allowed write succeeds is never enough, the forbidden
// one has to be refused too (CLAUDE.md, "prove the forbidden write").
//
// The fixture is two coaches, one venue with its partner, and an admin, all
// created fresh per run. Ledger credits are written as balanced groups with
// backdated timestamps so the 24 hour hold has something real to hold back:
//   coach A: 990 credited three days ago (eligible), 495 credited now (held)
//   venue:   a slot that ended two days ago (eligible), a slot tomorrow (held)
//
// LOCAL ONLY. Refuses any non-local target.
//
// Usage: export PATH=/opt/homebrew/bin:$PATH; node scripts/verify-manual-payouts.mjs

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-manual-payouts.mjs');

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
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
}
const code = (e) => (e?.message ?? '').split(':')[0];

const stamp = randomUUID().slice(0, 8);
const PASSWORD = `Verify-${randomUUID()}`;
const ACCOUNT_A = '123456789012';
const ACCOUNT_A2 = '999988887777';
const REF = stamp.replace(/[^a-z0-9]/gi, '').toUpperCase();

async function makeUser(label, roles) {
  const email = `verify.payout.${label}.${stamp}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  for (const role of roles) {
    const { error: re } = await svc.from('user_roles').upsert({ user_id: data.user.id, role });
    if (re) throw new Error(`role ${role}: ${re.message}`);
  }
  const client = createClient(SUPABASE_URL, ANON_KEY, opts);
  const { error: se } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (se) throw new Error(`signIn ${email}: ${se.message}`);
  return { id: data.user.id, email, client };
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}
function istDate(offsetDays) {
  const d = new Date(Date.now() + 5.5 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

async function ledgerGroup(rows, createdAt) {
  const group = randomUUID();
  const { error } = await svc.from('ledger_entries').insert(
    rows.map((r) => ({ entry_group_id: group, created_at: createdAt, description: 'verify-manual-payouts', ...r })),
  );
  if (error) throw new Error(`ledger insert: ${error.message}`);
}

async function sessionCredit(coachId, gross, fee, createdAt) {
  const entity = randomUUID();
  await ledgerGroup(
    [
      { account_type: 'platform', account_ref: null, direction: 'debit', amount: gross, domain: 'session', entity_id: entity },
      { account_type: 'coach', account_ref: coachId, direction: 'credit', amount: gross - fee, domain: 'session', entity_id: entity },
      { account_type: 'platform', account_ref: null, direction: 'credit', amount: fee, domain: 'session', entity_id: entity },
    ],
    createdAt,
  );
}

async function courtCredit(venueId, courtId, date, slotStart, slotEnd, amount) {
  const { data: b, error } = await svc
    .from('court_bookings')
    .insert({ court_id: courtId, date, slot_start: slotStart, slot_end: slotEnd, subtotal: amount, gst: 0, platform_fee: 0, total: amount })
    .select('id')
    .single();
  if (error) throw new Error(`court booking: ${error.message}`);
  await ledgerGroup(
    [
      { account_type: 'platform', account_ref: null, direction: 'debit', amount, domain: 'court', entity_id: b.id },
      { account_type: 'court_partner', account_ref: venueId, direction: 'credit', amount, domain: 'court', entity_id: b.id },
    ],
    new Date().toISOString(),
  );
}

async function ledgerGroupsFor(transferId) {
  const { data } = await svc.from('ledger_entries').select('entry_group_id').eq('entity_id', transferId);
  return new Set((data ?? []).map((r) => r.entry_group_id)).size;
}

async function main() {
  console.log(`verify-manual-payouts against ${SUPABASE_URL} (run ${stamp})`);

  // ---- fixture ----
  const coachA = await makeUser('coacha', ['coach']);
  const coachB = await makeUser('coachb', ['coach']);
  const partner = await makeUser('partner', ['court_partner']);
  const admin = await makeUser('admin', ['admin']);
  for (const c of [coachA, coachB]) {
    const { error } = await svc.from('coach_profiles').upsert({
      user_id: c.id, sport: 'badminton', experience_years: 3, city: 'Hyderabad', state: 'Telangana', status: 'verified',
    });
    if (error) throw new Error(`coach profile: ${error.message}`);
  }
  const { data: venue, error: ve } = await svc
    .from('venues')
    .insert({ partner_user_id: partner.id, name: `Verify Arena ${stamp}`, address: '1 Test Road', city: 'Hyderabad', pincode: '500001', status: 'verified' })
    .select('id')
    .single();
  if (ve) throw new Error(`venue: ${ve.message}`);
  const { data: court, error: ce } = await svc
    .from('courts')
    .insert({ venue_id: venue.id, sport: 'badminton', name: `Court ${stamp}`, base_price_per_hour: 400 })
    .select('id')
    .single();
  if (ce) throw new Error(`court: ${ce.message}`);

  await sessionCredit(coachA.id, 1000, 10, daysAgo(3));
  await sessionCredit(coachA.id, 500, 5, new Date().toISOString());
  await courtCredit(venue.id, court.id, istDate(-2), '06:00', '07:00', 800);
  await courtCredit(venue.id, court.id, istDate(1), '06:00', '07:00', 600);

  check('fixture: the two coaches are distinct people', coachA.id !== coachB.id, `${coachA.id.slice(0, 8)} vs ${coachB.id.slice(0, 8)}`);

  // ---- 1. nobody reads or writes the table directly ----
  {
    const r1 = await coachA.client.from('payout_methods').select('*');
    check('1a coach cannot SELECT payout_methods directly', !!r1.error, r1.error?.code ?? 'returned rows');
    const r2 = await coachA.client.from('payout_methods').insert({
      payout_account_id: randomUUID(), method_type: 'upi', account_holder_name: 'X', vpa: 'x@okaxis',
    });
    check('1b coach cannot INSERT payout_methods directly', !!r2.error, r2.error?.code ?? 'insert succeeded');
    const r3 = await admin.client.from('payout_methods').select('*');
    check('1c even an admin cannot SELECT the table directly', !!r3.error, r3.error?.code ?? 'returned rows');
    const r4 = await anon.rpc('upsert_my_payout_method', {
      p_owner_type: 'coach', p_venue_id: null, p_method_type: 'upi', p_account_holder_name: 'X',
      p_account_number: null, p_ifsc: null, p_vpa: 'x@okaxis', p_pan: null,
    });
    check('1d anon cannot call upsert_my_payout_method', !!r4.error, r4.error?.message ?? 'call succeeded');
  }

  // ---- 2. owner saves, and only ever sees a mask ----
  const saveA = await coachA.client.rpc('upsert_my_payout_method', {
    p_owner_type: 'coach', p_venue_id: null, p_method_type: 'bank_account', p_account_holder_name: 'Coach A',
    p_account_number: ACCOUNT_A, p_ifsc: 'hdfc0001234', p_vpa: null, p_pan: 'abcde1234f',
  });
  check('2a coach saves bank details', !saveA.error && saveA.data?.changed === true, saveA.error?.message);
  check('2b new account starts pending, not active', saveA.data?.payout_status === 'pending', saveA.data?.payout_status);
  check('2c IFSC normalised to upper case', saveA.data?.method?.ifsc === 'HDFC0001234', saveA.data?.method?.ifsc);
  check('2d save response never contains the full account number', !JSON.stringify(saveA.data).includes(ACCOUNT_A));
  const accountA = saveA.data?.payout_account_id;

  const mineA = await coachA.client.rpc('get_my_payout_method', { p_owner_type: 'coach', p_venue_id: null });
  check('2e owner read shows last four only', mineA.data?.method?.account_number_last4 === '9012' && !JSON.stringify(mineA.data).includes(ACCOUNT_A));
  check('2f owner read carries balance 1485 and eligible 990', Number(mineA.data?.balance) === 1485 && Number(mineA.data?.eligible_balance) === 990, `${mineA.data?.balance} / ${mineA.data?.eligible_balance}`);

  const mineB = await coachB.client.rpc('get_my_payout_method', { p_owner_type: 'coach', p_venue_id: null });
  check('2g coach B sees their own empty record, not coach A\'s', !mineB.error && mineB.data?.method === null && mineB.data?.payout_account_id !== accountA, JSON.stringify(mineB.data?.method));

  {
    const bad = await coachA.client.rpc('upsert_my_payout_method', {
      p_owner_type: 'coach', p_venue_id: null, p_method_type: 'bank_account', p_account_holder_name: 'Coach A',
      p_account_number: '12AB', p_ifsc: 'HDFC0001234', p_vpa: null, p_pan: null,
    });
    check('2h a malformed account number is refused', code(bad.error) === 'VALIDATION', bad.error?.message);
    const hijack = await coachA.client.rpc('upsert_my_payout_method', {
      p_owner_type: 'court_partner', p_venue_id: venue.id, p_method_type: 'upi', p_account_holder_name: 'Coach A',
      p_account_number: null, p_ifsc: null, p_vpa: 'coacha@okaxis', p_pan: null,
    });
    check('2i a coach cannot set payout details on someone else\'s venue', code(hijack.error) === 'FORBIDDEN', hijack.error?.message);
  }

  // ---- 3. admin entry points refuse non-admins ----
  for (const [fn, args] of [
    ['admin_payouts_due', { p_min_amount: 1 }],
    ['admin_reveal_payout_method', { p_payout_account_id: accountA, p_reason: 'test' }],
    ['admin_verify_payout_method', { p_payout_account_id: accountA, p_decision: 'verify', p_note: null }],
    ['admin_record_manual_payout', { p_payout_account_id: accountA, p_amount: 1, p_reference: `UTR123456${REF}`, p_note: null }],
  ]) {
    const r = await coachA.client.rpc(fn, args);
    check(`3 non-admin refused by ${fn}`, code(r.error) === 'FORBIDDEN', r.error?.message ?? 'call succeeded');
  }

  // ---- 4. the due list and the hold ----
  const due = await admin.client.rpc('admin_payouts_due', { p_min_amount: 1 });
  check('4a admin can list payouts due', !due.error, due.error?.message);
  const rowA = (due.data ?? []).find((r) => r.owner_id === coachA.id);
  const rowV = (due.data ?? []).find((r) => r.owner_id === venue.id);
  check('4b coach A listed: balance 1485, eligible 990 (the fresh 495 is held)', Number(rowA?.balance) === 1485 && Number(rowA?.eligible_balance) === 990, `${rowA?.balance} / ${rowA?.eligible_balance}`);
  check('4c venue listed: balance 1400, eligible 800 (tomorrow\'s slot is held)', Number(rowV?.balance) === 1400 && Number(rowV?.eligible_balance) === 800, `${rowV?.balance} / ${rowV?.eligible_balance}`);
  check('4d venue with no bank details shows as missing, not hidden', rowV?.verification_status === 'missing', rowV?.verification_status);
  check('4e the due list carries only the last four digits', !JSON.stringify(due.data).includes(ACCOUNT_A));

  // ---- 5. cannot pay before verification ----
  {
    const r = await admin.client.rpc('admin_record_manual_payout', { p_payout_account_id: accountA, p_amount: 100, p_reference: `UTRPRE0001${REF}`, p_note: null });
    check('5 payout refused while details are unverified', code(r.error) === 'PAYOUT_ACCOUNT_NOT_ACTIVE', r.error?.message ?? 'payout recorded');
  }

  // ---- 6. reveal is audited, and the audit never holds the number ----
  {
    const before = await svc.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'payout_method.reveal');
    const noReason = await admin.client.rpc('admin_reveal_payout_method', { p_payout_account_id: accountA, p_reason: '' });
    check('6a reveal without a reason is refused', code(noReason.error) === 'NOTE_REQUIRED', noReason.error?.message);
    const rev = await admin.client.rpc('admin_reveal_payout_method', { p_payout_account_id: accountA, p_reason: 'verify-manual-payouts check' });
    check('6b admin reveal returns the full number', rev.data?.account_number === ACCOUNT_A, rev.error?.message);
    const after = await svc.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'payout_method.reveal');
    check('6c exactly one audit row per reveal', (after.count ?? 0) - (before.count ?? 0) === 1, `${before.count} -> ${after.count}`);
    const { data: logs } = await svc.from('audit_log').select('before, after, note').like('action', 'payout_method.%');
    check('6d no audit row anywhere contains a full account number', !JSON.stringify(logs).includes(ACCOUNT_A));
  }

  // ---- 7. verify, then the hold caps the payout ----
  const ver = await admin.client.rpc('admin_verify_payout_method', { p_payout_account_id: accountA, p_decision: 'verify', p_note: 'Rs 1 test deposit matched' });
  check('7a admin verifies', ver.data?.verification_status === 'verified', ver.error?.message);
  const { data: paA } = await svc.from('payout_accounts').select('status').eq('id', accountA).single();
  check('7b verification makes the account active', paA?.status === 'active', paA?.status);
  {
    const r = await admin.client.rpc('admin_record_manual_payout', { p_payout_account_id: accountA, p_amount: 1485, p_reference: `UTRTOOMUCH1${REF}`, p_note: null });
    check('7c paying the held 495 as well is refused', code(r.error) === 'INSUFFICIENT_BALANCE', r.error?.message ?? 'payout recorded');
  }

  // ---- 8. record, dedupe, duplicate reference ----
  const pay = await admin.client.rpc('admin_record_manual_payout', { p_payout_account_id: accountA, p_amount: 990, p_reference: `utr 00990 ${REF.toLowerCase()}`, p_note: 'NEFT from HDFC current' });
  check('8a manual payout of the eligible 990 recorded', !pay.error && pay.data?.status === 'processing' && pay.data?.method === 'manual', pay.error?.message ?? pay.data?.status);
  check('8b reference normalised and stored', pay.data?.external_reference === `UTR00990${REF}`, pay.data?.external_reference);
  check('8c one balanced ledger group written', (await ledgerGroupsFor(pay.data?.id)) === 1);
  const again = await admin.client.rpc('admin_record_manual_payout', { p_payout_account_id: accountA, p_amount: 990, p_reference: `UTR00990${REF}`, p_note: null });
  check('8d recording the same UTR again returns the same payout', again.data?.id === pay.data?.id, again.error?.message);
  check('8e and still exactly one ledger group', (await ledgerGroupsFor(pay.data?.id)) === 1);
  const dup = await admin.client.rpc('admin_record_manual_payout', { p_payout_account_id: accountA, p_amount: 5, p_reference: `UTR00990${REF}`, p_note: null });
  check('8f the same UTR for a different amount is refused', code(dup.error) === 'DUPLICATE_REFERENCE', dup.error?.message ?? 'recorded');
  const mineAfter = await coachA.client.rpc('get_my_payout_method', { p_owner_type: 'coach', p_venue_id: null });
  check('8g coach balance drops to 495 with nothing eligible', Number(mineAfter.data?.balance) === 495 && Number(mineAfter.data?.eligible_balance) === 0, `${mineAfter.data?.balance} / ${mineAfter.data?.eligible_balance}`);

  // ---- 9. a bounce writes the reversing group and restores the balance ----
  {
    const noNote = await admin.client.rpc('admin_resolve_manual_payout', { p_transfer_id: pay.data?.id, p_outcome: 'failed', p_note: '' });
    check('9a marking bounced without a reason is refused', code(noNote.error) === 'NOTE_REQUIRED', noNote.error?.message);
    const fail = await admin.client.rpc('admin_resolve_manual_payout', { p_transfer_id: pay.data?.id, p_outcome: 'failed', p_note: 'Beneficiary account closed' });
    check('9b bounced payout marked failed', fail.data?.status === 'failed', fail.error?.message);
    check('9c a second, reversing ledger group exists', (await ledgerGroupsFor(pay.data?.id)) === 2);
    const restored = await coachA.client.rpc('get_my_payout_method', { p_owner_type: 'coach', p_venue_id: null });
    check('9d coach balance back to 1485', Number(restored.data?.balance) === 1485, restored.data?.balance);
  }

  // ---- 10. rule 2: changed details are unverified details ----
  {
    const same = await coachA.client.rpc('upsert_my_payout_method', {
      p_owner_type: 'coach', p_venue_id: null, p_method_type: 'bank_account', p_account_holder_name: 'Coach A',
      p_account_number: ACCOUNT_A, p_ifsc: 'HDFC0001234', p_vpa: null, p_pan: 'ABCDE1234F',
    });
    check('10a resubmitting identical details keeps the verification', same.data?.changed === false && same.data?.payout_status === 'active', `${same.data?.changed} / ${same.data?.payout_status}`);
    const swap = await coachA.client.rpc('upsert_my_payout_method', {
      p_owner_type: 'coach', p_venue_id: null, p_method_type: 'bank_account', p_account_holder_name: 'Coach A',
      p_account_number: ACCOUNT_A2, p_ifsc: 'HDFC0001234', p_vpa: null, p_pan: 'ABCDE1234F',
    });
    check('10b changing the account number returns the account to pending', swap.data?.payout_status === 'pending' && swap.data?.method?.verification_status === 'unverified', `${swap.data?.payout_status} / ${swap.data?.method?.verification_status}`);
    const blocked = await admin.client.rpc('admin_record_manual_payout', { p_payout_account_id: accountA, p_amount: 100, p_reference: `UTRAFTERSWAP1${REF}`, p_note: null });
    check('10c and no payout can be recorded to the new number until re-verified', code(blocked.error) === 'PAYOUT_ACCOUNT_NOT_ACTIVE', blocked.error?.message ?? 'payout recorded');
  }

  // ---- 11. Route path through the shared core is unchanged ----
  {
    const { data: pa } = await svc.from('payout_accounts').insert({ owner_type: 'coach', owner_id: coachB.id, status: 'active' }).select('id').single();
    await sessionCredit(coachB.id, 300, 30, new Date().toISOString());
    const rid = `trf_verify_${stamp}`;
    const t1 = await svc.rpc('record_transfer', { p_payout_account_id: pa.id, p_amount: 270, p_razorpay_transfer_id: rid });
    check('11a record_transfer pays the FULL balance, no hold (0028 behaviour)', !t1.error && t1.data?.method === 'route', t1.error?.message);
    const t2 = await svc.rpc('record_transfer', { p_payout_account_id: pa.id, p_amount: 270, p_razorpay_transfer_id: rid });
    check('11b record_transfer still dedupes on the Razorpay id', t2.data?.id === t1.data?.id && (await ledgerGroupsFor(t1.data?.id)) === 1);
    const t3 = await coachB.client.rpc('record_transfer', { p_payout_account_id: pa.id, p_amount: 1, p_razorpay_transfer_id: `x${rid}` });
    check('11c a coach still cannot call record_transfer', !!t3.error, t3.error?.message ?? 'call succeeded');
  }

  console.log(failures.length ? `\nFAILED ${failures.length} check(s)` : '\nALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`ERROR ${e.message}`);
  process.exit(2);
});
