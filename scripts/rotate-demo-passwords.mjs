#!/usr/bin/env node
// ATLITOS v2 — scripts/rotate-demo-passwords.mjs
//
// Sets new passwords on the nine shared demo accounts, in whichever project
// SUPABASE_URL points at. Written 2026-09-29: the old passwords were committed
// in this repo, and the same accounts exist in production (including the demo
// admin), so they are rotated rather than trusted.
//
// Run by a founder, never by an agent. Prints no password.
//
//   export SUPABASE_URL='https://syzzfgaudpifwvbpycyi.supabase.co'
//   export SUPABASE_SERVICE_ROLE_KEY='...'          # Settings, API
//   export ATLITOS_DEMO_PASSWORD="$(openssl rand -base64 24)"
//   export EMPOWER_DEMO_PASSWORD="$(openssl rand -base64 24)"
//   node scripts/rotate-demo-passwords.mjs            # dry run: lists what it would change
//   node scripts/rotate-demo-passwords.mjs --apply    # sets the passwords
//
// Keep the two values in your password manager. Everyone who runs the seed,
// verify, e2e or Maestro suites against a hosted project needs them exported.
// Changing a password does not end sessions that are already signed in; they
// expire with their refresh token.

const ATLITOS_ACCOUNTS = [
  "player@atlitos.dev",
  "coach1@atlitos.dev",
  "coach2@atlitos.dev",
  "partner@atlitos.dev",
  "p2-verify-partner@atlitos.dev",
  "admin@atlitos.dev",
];
const EMPOWER_ACCOUNTS = ["upa.verified@atlitos.dev", "upa.tennis@atlitos.dev", "donor@atlitos.dev"];

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the header of this file.`);
    process.exit(1);
  }
  return value;
}

const url = required("SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const atlitosPassword = required("ATLITOS_DEMO_PASSWORD");
const empowerPassword = required("EMPOWER_DEMO_PASSWORD");
const apply = process.argv.includes("--apply");

for (const [name, value] of [
  ["ATLITOS_DEMO_PASSWORD", atlitosPassword],
  ["EMPOWER_DEMO_PASSWORD", empowerPassword],
]) {
  if (value.length < 16) {
    console.error(`${name} must be at least 16 characters. Use: openssl rand -base64 24`);
    process.exit(1);
  }
}
if (atlitosPassword === empowerPassword) {
  console.error("Use two different values for ATLITOS_DEMO_PASSWORD and EMPOWER_DEMO_PASSWORD.");
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function findUsers(emails) {
  const wanted = new Set(emails);
  const found = new Map();
  for (let page = 1; page <= 50 && found.size < wanted.size; page += 1) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`Listing users failed with HTTP ${res.status}`);
    const body = await res.json();
    const users = body.users ?? [];
    for (const user of users) {
      const email = (user.email ?? "").toLowerCase();
      if (wanted.has(email)) found.set(email, user.id);
    }
    if (users.length < 200) break;
  }
  return found;
}

const plan = [
  ...ATLITOS_ACCOUNTS.map((email) => ({ email, password: atlitosPassword })),
  ...EMPOWER_ACCOUNTS.map((email) => ({ email, password: empowerPassword })),
];
const ids = await findUsers(plan.map((row) => row.email));

console.log(`Project: ${url}`);
console.log(apply ? "Mode: APPLY" : "Mode: dry run (add --apply to change passwords)");

let failures = 0;
for (const { email, password } of plan) {
  const id = ids.get(email);
  if (!id) {
    console.log(`  skip    ${email} (no such account in this project)`);
    continue;
  }
  if (!apply) {
    console.log(`  would   ${email}`);
    continue;
  }
  const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    console.log(`  rotated ${email}`);
  } else {
    failures += 1;
    console.log(`  FAILED  ${email} (HTTP ${res.status})`);
  }
}

if (failures > 0) process.exit(1);
