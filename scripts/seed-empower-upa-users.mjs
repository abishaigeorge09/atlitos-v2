#!/usr/bin/env node
// ATLITOS v2 — scripts/seed-empower-upa-users.mjs
//
// Creates the Phase 6 UPA demo accounts via the Supabase Auth admin API.
// This script creates fixture users for the Empower/UPA Life portal and
// consumer app surfaces (PRD-05, PRD-06).
//
// Run order: BEFORE supabase/seed/seed_p6_empower_fixtures.sql
// Idempotent: safe to re-run.
//
// Env required:
//   SUPABASE_SERVICE_ROLE_KEY  — service role key, never the anon/publishable key.
//   SUPABASE_URL               — optional, defaults to the project's URL below.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    '[seed-empower-upa-users] SUPABASE_SERVICE_ROLE_KEY is required.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = 'EmpowerDemo!2026';

const UPA_USERS = [
  { email: 'upa.verified@atlitos.dev', name: 'Priya Cricket', sport: 'cricket', region: 'Mumbai' },
  { email: 'upa.tennis@atlitos.dev', name: 'Rajesh Tennis', sport: 'tennis', region: 'Bengaluru' },
  { email: 'upa.badminton@atlitos.dev', name: 'Ananya Badminton', sport: 'badminton', region: 'Hyderabad' },
  { email: 'upa.football@atlitos.dev', name: 'Vikram Football', sport: 'football', region: 'Delhi' },
  { email: 'donor@atlitos.dev', name: 'Demo Donor', sport: null, region: null },
];

async function findUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    throw new Error(`listUsers failed: ${error.message}`);
  }
  return data.users.find((u) => u.email === email) ?? null;
}

async function ensureUser(email, name) {
  const existing = await findUserByEmail(email);
  if (existing) {
    console.log(`[seed-empower-upa-users] ${email}: already exists (${existing.id})`);
    return existing;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });

  if (error) {
    throw new Error(`failed to create ${email}: ${error.message}`);
  }

  console.log(`[seed-empower-upa-users] ${email}: created (${data.user.id})`);
  return data.user;
}

async function main() {
  for (const user of UPA_USERS) {
    const created = await ensureUser(user.email, user.name);
    console.log(`[seed-empower-upa-users] ${user.email} (${user.sport}, ${user.region}): ready for upa_applications seed`);
  }

  console.log(
    '[seed-empower-upa-users] done. Next: apply supabase/seed/seed_p6_empower_fixtures.sql to populate UPA applications and related data.'
  );
}

main().catch((err) => {
  console.error('[seed-empower-upa-users] FAILED:', err.message ?? err);
  process.exit(1);
});
