#!/usr/bin/env node
// ATLITOS v2 - scripts/verify-admin-allowlist.mjs
//
// Proves 0128: an allowlisted address becomes an admin on sign up, and
// nobody else does, and nobody but the service role can touch the list.
//
// Every check is written so the WRONG behaviour fails it. The one that
// matters most is check 2: if the trigger granted admin to everyone, or to
// nobody, check 1 alone could still look right, so the two run against two
// accounts created in the same way in the same run and their ids are
// asserted to differ before anything else is believed.
//
// LOCAL ONLY by default. Creates and deletes its own throwaway accounts.
//
// Usage: export PATH=/opt/homebrew/bin:$PATH; node scripts/verify-admin-allowlist.mjs

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-admin-allowlist.mjs');

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
}

const stamp = randomUUID().slice(0, 8);
const ALLOWED = `verify.allowed.${stamp}@atlitos.com`;
const OUTSIDER = `verify.outsider.${stamp}@example.com`;
const PASSWORD = `Verify-${randomUUID()}`;

async function createConfirmedUser(email) {
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user;
}

async function rolesOf(userId) {
  const { data } = await svc.from('user_roles').select('role').eq('user_id', userId);
  return (data ?? []).map((r) => r.role).sort();
}

async function main() {
  // The allowlist row has to exist BEFORE the account, which is the whole
  // point of the mechanism.
  const { error: insErr } = await svc
    .from('admin_email_allowlist')
    .insert({ email: ALLOWED, note: 'verify-admin-allowlist.mjs throwaway' });
  if (insErr) throw new Error(`could not seed the allowlist: ${insErr.message}`);

  let allowed = null;
  let outsider = null;
  try {
    allowed = await createConfirmedUser(ALLOWED);
    outsider = await createConfirmedUser(OUTSIDER);

    // Non vacuous: two different accounts, or checks 1 and 2 are the same check.
    check('the two test accounts are distinct', allowed.id !== outsider.id, `${allowed.id.slice(0, 8)} vs ${outsider.id.slice(0, 8)}`);

    const allowedRoles = await rolesOf(allowed.id);
    const outsiderRoles = await rolesOf(outsider.id);

    check('1. an allowlisted signup holds admin', allowedRoles.includes('admin'), allowedRoles.join(', '));
    check('2. a signup that is NOT allowlisted holds no admin', !outsiderRoles.includes('admin'), outsiderRoles.join(', '));
    check('   both still get the default player role', allowedRoles.includes('player') && outsiderRoles.includes('player'), `${allowedRoles.join('+')} / ${outsiderRoles.join('+')}`);

    // 3. The list is not readable or writable by a client, admin included.
    // An admin who can add a row to this table can promote anyone, which
    // would make the control decorative.
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data: anonRead, error: anonErr } = await anon.from('admin_email_allowlist').select('email');
    check('3. anon cannot read the allowlist', (anonRead ?? []).length === 0, anonErr ? anonErr.code : `${(anonRead ?? []).length} rows`);

    const adminClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: signInErr } = await adminClient.auth.signInWithPassword({ email: ALLOWED, password: PASSWORD });
    check('   the allowlisted account can sign in', !signInErr, signInErr?.message ?? 'ok');

    const { data: adminRead } = await adminClient.from('admin_email_allowlist').select('email');
    check('4. an ADMIN cannot read the allowlist', (adminRead ?? []).length === 0, `${(adminRead ?? []).length} rows`);

    const { error: adminWriteErr } = await adminClient
      .from('admin_email_allowlist')
      .insert({ email: `escalation.${stamp}@example.com` });
    check('5. an ADMIN cannot add an address to it', Boolean(adminWriteErr), adminWriteErr?.code ?? 'the insert succeeded');

    // 6. The confirmation requirement is the whole control: an allowlisted
    // address that has NOT been confirmed must not be admin, or anyone could
    // claim a colleague's address with a password of their choosing.
    const unconfirmedEmail = `verify.unconfirmed.${stamp}@atlitos.com`;
    await svc.from('admin_email_allowlist').insert({ email: unconfirmedEmail, note: 'throwaway' });
    const { data: unconfirmed, error: unconfirmedErr } = await svc.auth.admin.createUser({
      email: unconfirmedEmail,
      password: PASSWORD,
      email_confirm: false,
    });
    if (!unconfirmedErr && unconfirmed?.user) {
      const roles = await rolesOf(unconfirmed.user.id);
      check('6. an allowlisted but UNCONFIRMED address holds no admin', !roles.includes('admin'), roles.join(', '));
      await svc.auth.admin.deleteUser(unconfirmed.user.id).catch(() => {});
    } else {
      check('6. an allowlisted but UNCONFIRMED address holds no admin', false, `could not create: ${unconfirmedErr?.message}`);
    }
    await svc.from('admin_email_allowlist').delete().eq('email', unconfirmedEmail);

    const { count: escalated } = await svc
      .from('admin_email_allowlist')
      .select('email', { count: 'exact', head: true })
      .eq('email', `escalation.${stamp}@example.com`);
    check('   and no row landed', escalated === 0, String(escalated));
  } finally {
    if (allowed) await svc.auth.admin.deleteUser(allowed.id).catch(() => {});
    if (outsider) await svc.auth.admin.deleteUser(outsider.id).catch(() => {});
    await svc.from('admin_email_allowlist').delete().eq('email', ALLOWED);
    await svc.from('admin_email_allowlist').delete().eq('email', `escalation.${stamp}@example.com`);
  }

  console.log('');
  if (failures.length) {
    console.log(`verify-admin-allowlist FAILED: ${failures.length}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('verify-admin-allowlist: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
