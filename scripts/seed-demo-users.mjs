#!/usr/bin/env node
// ATLITOS v2 — scripts/seed-demo-users.mjs
//
// Creates the three Phase 2 demo accounts via the Supabase Auth admin API
// and grants their app roles directly against public.user_roles using a
// service-role client. auth.users cannot be seeded from plain SQL (GoTrue
// owns password hashing), see supabase/seed/seed_identity.sql's README for
// the same note; this script is the equivalent bootstrap step for accounts
// that need a real password and a real role from the start, rather than the
// "match an already-created account by email" pattern seed_identity.sql and
// seed_p2.sql use for content that depends on these accounts existing.
//
// The orchestrator runs this script (not a client app, not CI on every
// build); it never runs anywhere the service role key could leak into a
// client bundle (CLAUDE.md: "never hardcode, never log it").
//
// Run order: BEFORE supabase/seed/seed_p2.sql. venues.partner_user_id is
// NOT NULL, so seed_p2.sql resolves partner@atlitos.dev's id by email and
// silently no-ops until that account exists.
//
// Env required:
//   SUPABASE_SERVICE_ROLE_KEY  — service role key, never the anon/publishable key.
//   SUPABASE_URL               — optional, defaults to the project's URL below.
//
// Idempotent: safe to re-run. Each account is looked up by email first (no
// error on a second run); every role grant is an upsert with
// ignoreDuplicates, matching public.user_roles' UNIQUE(user_id, role).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    '[seed-demo-users] SUPABASE_SERVICE_ROLE_KEY is required (the service role key from supabase/.env or the ' +
      'edge function environment, never the anon/publishable key, never hardcoded).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Fixed demo password. This is test-mode fixture data (same posture as the
// Razorpay TEST key elsewhere in this repo), not a production credential;
// do not reuse for any real account.
const DEMO_PASSWORD = 'AtlitosDemo!2026';

// Every account also receives the default 'player' role automatically, from
// the on_auth_user_created trigger (0001_identity.sql / 0008's
// anonymous-safe version) firing on the auth.users insert itself, before
// this script's own role grants below run. That is expected and harmless:
// ATLITOS's role model is additive (SCHEMA.md app_role: "a user can hold
// several roles at once"), so partner@atlitos.dev and admin@atlitos.dev
// simply also happen to hold 'player'.
const DEMO_USERS = [
  { email: 'player@atlitos.dev', name: 'Demo Player', roles: [] },
  { email: 'partner@atlitos.dev', name: 'Demo Court Partner', roles: ['court_partner'] },
  { email: 'admin@atlitos.dev', name: 'Demo Admin', roles: ['admin'] },
  { email: 'coach1@atlitos.dev', name: 'Demo Coach Cricket', roles: ['coach'] },
  { email: 'coach2@atlitos.dev', name: 'Demo Coach Tennis', roles: ['coach'] },
];

async function findUserByEmail(email) {
  // supabase-js v2's admin.listUsers has no server-side email filter;
  // fixture scale (a handful of demo accounts) makes one large page fine.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    throw new Error(`[seed-demo-users] listUsers failed: ${error.message}`);
  }
  return data.users.find((u) => u.email === email) ?? null;
}

async function ensureUser(email, name) {
  const existing = await findUserByEmail(email);
  if (existing) {
    console.log(`[seed-demo-users] ${email}: already exists (${existing.id})`);
    return existing;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });

  if (error) {
    throw new Error(`[seed-demo-users] failed to create ${email}: ${error.message}`);
  }

  console.log(`[seed-demo-users] ${email}: created (${data.user.id})`);
  return data.user;
}

async function ensureRole(userId, email, role) {
  const { error } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role }, { onConflict: 'user_id,role', ignoreDuplicates: true });

  if (error) {
    throw new Error(`[seed-demo-users] failed to grant role '${role}' to ${email}: ${error.message}`);
  }

  console.log(`[seed-demo-users] ${email}: role '${role}' present`);
}

async function main() {
  for (const demo of DEMO_USERS) {
    const user = await ensureUser(demo.email, demo.name);
    for (const role of demo.roles) {
      await ensureRole(user.id, demo.email, role);
    }
  }

  console.log(
    '[seed-demo-users] done. Next: apply supabase/seed/seed_p2.sql to attach the 8 demo venues to partner@atlitos.dev.'
  );
}

main().catch((err) => {
  console.error('[seed-demo-users] FAILED:', err.message ?? err);
  process.exit(1);
});
