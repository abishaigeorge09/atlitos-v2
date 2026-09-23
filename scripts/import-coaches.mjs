#!/usr/bin/env node
// ATLITOS v2 — scripts/import-coaches.mjs
//
// Release task 6: the data entry path for coaches. Reads a CSV (template:
// scripts/templates/coaches.csv) and creates each coach as a real, verified,
// bookable coach: the auth account, the users row, the coach role, the
// coach_profiles row (status verified, so coach discovery lists them) and
// their session types with prices.
//
// One CSV row = one session type. Rows that share an email are one coach
// with several session types. Re-running is safe: accounts match on email,
// profiles on the account, session types on coach + name.
//
// SIGN IN. The account is created with a random password that is never
// shown or stored anywhere. The coach signs in by tapping Forgot password
// in the app with the email on the sheet and setting their own. Tell them.
//
// Availability is NOT on the sheet: the coach sets their weekly windows in
// the app's Trainings tab after signing in, the same way every coach does.
//
// Nothing is written until the WHOLE file validates. Default is a dry run;
// pass --apply to write. See scripts/lib/import-sheet.mjs.
//
// Env required:
//   SUPABASE_SERVICE_ROLE_KEY   creating accounts and setting status verified
//                               are admin actions.
//   SUPABASE_URL                optional, defaults to production; production
//                               also needs ATLITOS_ALLOW_PRODUCTION_WRITE.
//
// Run:
//   node --env-file=.env.local scripts/import-coaches.mjs --file coaches.csv
//   node --env-file=.env.local scripts/import-coaches.mjs --file coaches.csv --apply

import { randomBytes } from 'node:crypto';

import { SPORTS, flag, groupBy, hasFlag, loadSheet, resolveUserId, serviceClient } from './lib/import-sheet.mjs';

const SCRIPT = 'import-coaches';
const TEMPLATE = 'scripts/templates/coaches.csv';
const REQUIRED = ['email', 'name', 'phone', 'sport', 'city', 'state', 'experience_years', 'session_name', 'session_minutes', 'session_price'];
const OPTIONAL = ['bio', 'specialization', 'coaching_style'];

const filePath = flag('--file');
const apply = hasFlag('--apply');

if (!filePath) {
  console.error(`usage: ${SCRIPT}.mjs --file <coaches.csv> [--apply]`);
  process.exit(1);
}

const { url, supabase } = serviceClient(SCRIPT, apply);

function check(r, bad) {
  if (r.email && !/^\S+@\S+\.\S+$/.test(r.email)) bad(`email "${r.email}" does not look like an email`);
  if (r.phone && !/^\d{10}$/.test(r.phone)) bad(`phone "${r.phone}" must be 10 digits, no +91`);
  if (r.sport && !SPORTS.includes(r.sport.toLowerCase())) bad(`sport "${r.sport}" is not one of ${SPORTS.join(', ')}`);
  if (r.experience_years && !(Number.isInteger(Number(r.experience_years)) && Number(r.experience_years) >= 0)) {
    bad(`experience_years "${r.experience_years}" must be a whole number`);
  }
  if (r.session_minutes && !(Number.isInteger(Number(r.session_minutes)) && Number(r.session_minutes) > 0)) {
    bad(`session_minutes "${r.session_minutes}" must be a whole number above 0`);
  }
  if (r.session_price && !(Number(r.session_price) > 0)) bad(`session_price "${r.session_price}" must be a number above 0`);
}

/** The first row's profile fields are the coach's; later rows for the same
 * email only add session types. `specialization` is a semicolon list. */
function toCoaches(records) {
  return groupBy(
    records,
    (r) => r.email,
    (r) => ({
      email: r.email.toLowerCase(),
      name: r.name,
      phone: r.phone,
      sport: r.sport.toLowerCase(),
      city: r.city,
      state: r.state,
      experience_years: Number(r.experience_years),
      bio: r.bio || null,
      coaching_style: r.coaching_style || null,
      specialization: r.specialization
        ? r.specialization.split(';').map((s) => s.trim()).filter(Boolean)
        : [],
    }),
    (r) => ({ name: r.session_name, duration_minutes: Number(r.session_minutes), price: Number(r.session_price) }),
  );
}

async function ensureAccount(coach) {
  const existing = await resolveUserId(supabase, coach.email);
  if (existing) return { id: existing, action: 'existing account' };

  const { data, error } = await supabase.auth.admin.createUser({
    email: coach.email,
    // Random, discarded. The coach sets their own through Forgot password.
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { name: coach.name, phone: coach.phone },
  });
  if (error) throw new Error(`could not create the account for ${coach.email}: ${error.message}`);
  return { id: data.user.id, action: 'account created' };
}

async function upsertCoach(userId, coach) {
  // The signup trigger already wrote name and phone for a new account; this
  // keeps an existing account's row in step with the sheet too.
  const { error: userError } = await supabase
    .from('users')
    .update({ name: coach.name, phone: coach.phone, city: coach.city, state: coach.state, sports: [coach.sport] })
    .eq('id', userId);
  if (userError) throw new Error(`users row failed for ${coach.email}: ${userError.message}`);

  const { error: roleError } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role: 'coach' }, { onConflict: 'user_id,role', ignoreDuplicates: true });
  if (roleError) throw new Error(`coach role failed for ${coach.email}: ${roleError.message}`);

  const { error: profileError } = await supabase.from('coach_profiles').upsert(
    {
      user_id: userId,
      sport: coach.sport,
      experience_years: coach.experience_years,
      coaching_style: coach.coaching_style,
      specialization: coach.specialization,
      bio: coach.bio,
      city: coach.city,
      state: coach.state,
      status: 'verified',
    },
    { onConflict: 'user_id' },
  );
  if (profileError) throw new Error(`coach profile failed for ${coach.email}: ${profileError.message}`);
}

async function upsertSessionType(coachId, session) {
  const { data: found, error: findError } = await supabase
    .from('session_types')
    .select('id')
    .eq('coach_id', coachId)
    .ilike('name', session.name)
    .limit(1);
  if (findError) throw new Error(`session type lookup failed for ${session.name}: ${findError.message}`);

  const row = { ...session, coach_id: coachId, active: true };
  if (found?.[0]) {
    const { error } = await supabase.from('session_types').update(row).eq('id', found[0].id);
    if (error) throw new Error(`session type update failed for ${session.name}: ${error.message}`);
    return 'updated';
  }
  const { error } = await supabase.from('session_types').insert(row);
  if (error) throw new Error(`session type insert failed for ${session.name}: ${error.message}`);
  return 'created';
}

async function main() {
  const records = loadSheet(SCRIPT, filePath, REQUIRED, OPTIONAL, TEMPLATE, check);
  const coaches = toCoaches(records);
  const sessionCount = coaches.reduce((n, c) => n + c.children.length, 0);

  console.log(`[${SCRIPT}] ${coaches.length} coach(es), ${sessionCount} session type(s) in ${filePath}`);
  for (const c of coaches) {
    console.log(`  ${c.name} <${c.email}>  ${c.sport}, ${c.city}, ${c.experience_years} yrs`);
    for (const s of c.children) console.log(`      ${s.name}  ${s.duration_minutes} min  ${s.price}`);
  }

  if (!apply) {
    console.log(`\n[${SCRIPT}] dry run, nothing written. Add --apply to import.`);
    return;
  }

  console.log(`\n[${SCRIPT}] writing to ${url}`);
  for (const c of coaches) {
    const account = await ensureAccount(c);
    await upsertCoach(account.id, c);
    const outcomes = [];
    for (const s of c.children) outcomes.push(await upsertSessionType(account.id, s));
    console.log(`  ${c.email}: ${account.action}, profile verified, session types ${outcomes.join(', ')}`);
  }
  console.log(`[${SCRIPT}] done. Each new coach signs in with Forgot password using the email above.`);
}

main().catch((err) => {
  console.error(`[${SCRIPT}] ${err.message}`);
  process.exit(1);
});
