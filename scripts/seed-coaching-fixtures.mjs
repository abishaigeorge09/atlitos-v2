#!/usr/bin/env node
// ATLITOS v2 — scripts/seed-coaching-fixtures.mjs
//
// AT-56: Coaching seed data through real RPCs (not raw SQL).
//
// This script signs in as fixture coach users with the anon key and drives
// the real schema writes for coaching:
//   1. Complete public.users onboarding (city/state/sports) via the
//      complete_player_setup RPC, the same path player-setup/[step].tsx
//      calls, so seeded coaches clear needsOnboarding() (AT-56)
//   2. Upsert session_types (coach offerings with duration and price)
//   3. Insert coach_availability_windows covering the next 7 days
//   4. Detect coaching accounts and report what was seeded
//
// Deliberate design: NO service role key used anywhere. Account creation
// for new coach fixtures needs service role (run scripts/seed-demo-users.mjs
// with SUPABASE_SERVICE_ROLE_KEY first). This script seeds fixture data
// for existing users or reports clearly when blocked.
//
// Idempotent: looks up existing session_types by name before inserting;
// upserts availability windows (replaces if same day+time).
//
// Env required:
//   SUPABASE_ANON_KEY  — the anon/publishable key (from apps/portal-court/.env.local)
//   SUPABASE_URL       — optional, defaults to the project's URL below
//
// Run after: scripts/seed-demo-users.mjs (needs coach fixture accounts to exist)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error(
    '[seed-coaching-fixtures] SUPABASE_ANON_KEY is required (the anon/publishable key from apps/portal-court/.env.local, never the service role key).'
  );
  process.exit(1);
}

const DEMO_PASSWORD = 'AtlitosDemo!2026'; // matches scripts/seed-demo-users.mjs

// Demo coach emails and details. These accounts must already exist (created via seed-demo-users.mjs).
// Format: [{ email, name, sport, city, state, sessionTypes, status }]
const FIXTURE_COACHES = [
  {
    email: 'coach1@atlitos.dev',
    name: 'Ravi Kumar', // BUG-002: distinct from coach2 so rows do not read as duplicates
    sport: 'cricket',
    city: 'Bangalore',
    state: 'Karnataka',
    status: 'verified', // Would need admin to set via service role
    sessionTypes: [
      { name: 'Batting Basics', durationMinutes: 60, price: '1000.00' },
      { name: 'Advanced Bowling', durationMinutes: 90, price: '1500.00' },
    ],
  },
  {
    email: 'coach2@atlitos.dev',
    name: 'Sana Iyer', // BUG-002: distinct from coach1 so rows do not read as duplicates
    sport: 'tennis',
    city: 'Delhi',
    state: 'Delhi',
    status: 'verified',
    sessionTypes: [
      { name: 'Forehand Drill', durationMinutes: 45, price: '800.00' },
      { name: 'Match Prep', durationMinutes: 120, price: '2000.00' },
    ],
  },
];

function newClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(client, email) {
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
    if (error) {
      return null; // Account doesn't exist or wrong password
    }
    return data.user;
  } catch (e) {
    return null;
  }
}

// AT-56 fix: this script used to go straight to session_types/availability
// writes and never touched public.users, so a freshly created coach account
// (name from the signup trigger, city/state left null) sailed straight past
// needsOnboarding()'s check (session-store.ts: `me != null && !me.city`) and
// got stuck on the role-select screen forever, no matter what role_grants or
// coach_profiles rows existed. The real, only client path that clears that
// gate is the complete_player_setup RPC (supabase/migrations/0004_player_and
// _coach_setup_rpc.sql): it writes sports + avatar_url + city + state onto
// public.users for auth.uid(). Call it here, same as the player-setup wizard
// does, instead of ever touching public.users directly. Idempotent: the RPC
// is a plain UPDATE, safe to re-run every seed pass.
async function ensureOnboardingComplete(client, coach) {
  const { error } = await client.rpc('complete_player_setup', {
    p_sports: [coach.sport],
    p_avatar_url: null,
    p_city: coach.city,
    p_state: coach.state,
  });

  if (error) {
    throw new Error(`[seed-coaching-fixtures] failed to complete onboarding via complete_player_setup: ${error.message}`);
  }

  console.log(`[seed-coaching-fixtures]   onboarding complete (city='${coach.city}', state='${coach.state}', sports=[${coach.sport}])`);
}

async function ensureSessionTypes(client, coachId, sessionTypes) {
  const seeded = [];
  for (const st of sessionTypes) {
    const { data: existing, error: existingError } = await client
      .from('session_types')
      .select('id')
      .eq('coach_id', coachId)
      .eq('name', st.name)
      .limit(1);

    if (existingError && existingError.code !== 'PGRST116') {
      // PGRST116 is RLS deny (coach can't read others' types), which is expected
      // if they're not actually a coach yet
      throw new Error(`[seed-coaching-fixtures] failed to check existing session_types: ${existingError.message}`);
    }

    if (existing && existing.length > 0) {
      console.log(`[seed-coaching-fixtures]   session type '${st.name}' already exists`);
      seeded.push({ name: st.name, status: 'exists' });
      continue;
    }

    const { error: insertError } = await client.from('session_types').insert({
      coach_id: coachId,
      name: st.name,
      duration_minutes: st.durationMinutes,
      price: st.price,
      active: true,
    });

    if (insertError) {
      if (insertError.code === 'PGRST116') {
        // RLS deny: this user doesn't have coach role or isn't the owner
        return { seeded, error: 'PERMISSION_DENIED', details: insertError.message };
      }
      throw new Error(`[seed-coaching-fixtures] failed to insert session_type: ${insertError.message}`);
    }

    console.log(`[seed-coaching-fixtures]   created session type '${st.name}' (${st.durationMinutes}min, ${st.price})`);
    seeded.push({ name: st.name, status: 'created' });
  }

  return { seeded, error: null };
}

async function ensureAvailabilityWindows(client, coachId) {
  // Generate windows for the next 7 days: Mon-Sun, 10am-6pm
  const today = new Date();
  const windows = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const effectiveFrom = date.toISOString().split('T')[0];

    windows.push({
      coach_id: coachId,
      day_of_week: dayOfWeek,
      start_time: '10:00:00',
      end_time: '18:00:00',
      effective_from: effectiveFrom,
    });
  }

  const seeded = [];
  for (const w of windows) {
    // Check if this window already exists for this date
    const { data: existing, error: checkError } = await client
      .from('coach_availability_windows')
      .select('id')
      .eq('coach_id', w.coach_id)
      .eq('day_of_week', w.day_of_week)
      .eq('effective_from', w.effective_from)
      .eq('start_time', w.start_time)
      .eq('end_time', w.end_time)
      .limit(1);

    if (checkError && checkError.code !== 'PGRST116') {
      throw new Error(`[seed-coaching-fixtures] failed to check availability windows: ${checkError.message}`);
    }

    if (existing && existing.length > 0) {
      seeded.push({ date: w.effective_from, status: 'exists' });
      continue;
    }

    const { error: insertError } = await client.from('coach_availability_windows').insert(w);

    if (insertError) {
      if (insertError.code === 'PGRST116') {
        return { seeded, error: 'PERMISSION_DENIED', details: insertError.message };
      }
      // Could also be overlap constraint 23P01 or other DB error
      if (insertError.code === '23P01') {
        console.log(`[seed-coaching-fixtures]   availability window for ${w.effective_from} already exists (overlap constraint)`);
        seeded.push({ date: w.effective_from, status: 'overlap' });
        continue;
      }
      throw new Error(`[seed-coaching-fixtures] failed to insert availability window: ${insertError.message}`);
    }

    console.log(`[seed-coaching-fixtures]   created availability window ${w.effective_from} (${w.start_time} - ${w.end_time})`);
    seeded.push({ date: w.effective_from, status: 'created' });
  }

  return { seeded, error: null };
}

async function seedCoach(coach) {
  console.log(`\n[seed-coaching-fixtures] processing ${coach.email} (${coach.sport}) ...`);

  const client = newClient();
  const user = await signIn(client, coach.email);

  if (!user) {
    console.log(`[seed-coaching-fixtures] BLOCKED: ${coach.email} account does not exist. Create it with seed-demo-users.mjs first.`);
    return {
      email: coach.email,
      success: false,
      reason: 'ACCOUNT_NOT_FOUND',
      details: 'Run scripts/seed-demo-users.mjs to create coach fixture accounts',
    };
  }

  console.log(`[seed-coaching-fixtures]   signed in as ${user.id}`);

  // AT-56: complete public.users (city/state/sports) through the real RPC
  // before anything else, so this account clears needsOnboarding().
  await ensureOnboardingComplete(client, coach);

  // Seed session types
  const { seeded: sessionTypesSeeded, error: stError } = await ensureSessionTypes(client, user.id, coach.sessionTypes);
  if (stError === 'PERMISSION_DENIED') {
    console.log(
      `[seed-coaching-fixtures]   BLOCKED: user does not have 'coach' role. The coach role must be granted via admin API.`
    );
    return {
      email: coach.email,
      userId: user.id,
      success: false,
      reason: 'NO_COACH_ROLE',
      details: 'The coach role must be granted via admin/service-role API before seeding session data',
      sessionTypes: sessionTypesSeeded,
    };
  }

  // Seed availability windows
  const { seeded: windowsSeeded, error: awError } = await ensureAvailabilityWindows(client, user.id);
  if (awError === 'PERMISSION_DENIED') {
    console.log(`[seed-coaching-fixtures]   BLOCKED: insufficient permissions for availability windows.`);
    return {
      email: coach.email,
      userId: user.id,
      success: false,
      reason: 'PERMISSION_DENIED',
      details: 'User may not have coach role yet',
      sessionTypes: sessionTypesSeeded,
      windows: windowsSeeded,
    };
  }

  console.log(`[seed-coaching-fixtures]   ${coach.email} complete: ${sessionTypesSeeded.length} session type(s), ${windowsSeeded.length} availability window(s)`);
  return {
    email: coach.email,
    userId: user.id,
    success: true,
    sessionTypes: sessionTypesSeeded,
    windows: windowsSeeded,
  };
}

async function main() {
  console.log('[seed-coaching-fixtures] starting ...');

  const results = [];
  for (const coach of FIXTURE_COACHES) {
    const result = await seedCoach(coach);
    results.push(result);
  }

  console.log('\n[seed-coaching-fixtures] summary:');
  const successful = results.filter((r) => r.success).length;
  const blocked = results.filter((r) => !r.success).length;
  console.log(`  ${successful} coach(es) seeded successfully`);
  console.log(`  ${blocked} coach(es) blocked`);

  if (blocked > 0) {
    console.log('\n[seed-coaching-fixtures] BLOCKERS:');
    for (const r of results) {
      if (!r.success) {
        console.log(`  ${r.email}: ${r.reason}`);
        console.log(`    ${r.details}`);
      }
    }
    console.log('\n[seed-coaching-fixtures] To unblock, you must:');
    console.log('  1. Create coach fixture accounts: SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo-users.mjs');
    console.log('     (add coach1/coach2 email entries to DEMO_USERS array)');
    console.log('  2. Grant coach role: admin API call to insert user_roles rows with role=coach');
    console.log('  3. Set coach status to "verified": admin API call to update coach_profiles.status');
    process.exit(1);
  }

  console.log('[seed-coaching-fixtures] done.');
}

main().catch((err) => {
  console.error('[seed-coaching-fixtures] FAILED:', err.message ?? err);
  process.exit(1);
});
