#!/usr/bin/env node
// ATLITOS v2 — scripts/verify-discovery.mjs
//
// Story AT-63 (PRD-01 FR-20 to FR-22, PRD-02 FR-5), regression guard for the
// defect fixed in supabase/migrations/0030_verified_coach_discovery_rls.sql.
//
// WHY A NEW SCRIPT RATHER THAN AN ASSERTION IN verify-realtime.mjs
//
// verify-realtime.mjs proves a socket receives a push, so every one of its
// parts needs a signed-in session, a long-lived subscription, and a timing
// deadline. Half of what AT-63 broke has to be checked with NO session at
// all: a guest browsing coaches (PRD-01 FR-2) hits these policies as the
// Postgres `anon` role, and an anon path cannot be expressed inside a script
// whose whole structure assumes an authenticated subscriber. Folding a
// synchronous, session-less read assertion into a Realtime harness would also
// mean a Realtime flake (a timing deadline miss) reports itself as a
// discovery regression, and vice versa. Separate concern, separate exit code.
//
// WHAT THIS PROVES, and why each assertion is here
//
// The AT-63 defect was silent in exactly the way CLAUDE.md warns about: the
// policies did not error, they returned zero rows. Discovery kept working
// (it reads the definer view coach_profiles_public, which bypasses the base
// table's RLS), so the coach LIST looked healthy while every coach DETAIL
// screen showed a coach with no pricing and no availability, and the slot
// engine silently produced an empty slot list. Nothing threw. So this script
// asserts on ROW COUNTS being non-zero, not on the absence of an error: an
// error-only check would have passed throughout the entire outage.
//
// It drives the read path as a REAL athlete session and as a REAL guest,
// through the same @supabase/supabase-js client and the same packages/api
// query shapes the app uses, never a service-role backdoor.
//
//   Part 1 (guest / anon): the un-authenticated coach browse. Asserts the
//     discovery view returns verified coaches AND that their session_types
//     and coach_availability_windows are readable. The second half is the
//     regression: before 0030 this was 0 rows while part one was fine.
//
//   Part 2 (real athlete session): the full discovery-to-booking read path,
//     end to end, in order: listCoaches -> getCoach -> session types (needed
//     for a price to show and for a duration to slot against) -> availability
//     windows -> get_coach_busy_slots -> computed bookable slots. Asserts a
//     non-empty slot list, which is the actual product outcome AT-63 killed
//     and the thing no lower-level assertion implies on its own.
//
//   Part 3 (negative, athlete): the athlete must NOT have gained a read of
//     anything private as a side effect of the fix. 0030 deliberately did not
//     add a public policy to coach_profiles (see its header for why), so the
//     base table must still return 0 rows for a non-owner, as must
//     coach_certificates. If a future migration "fixes" discovery the blunt
//     way by opening the base table, this part fails and says so.
//
//   Part 4 (negative, anon): the same, with no session at all, plus sessions
//     and payment_intents staying invisible.
//
// Env required:
//   SUPABASE_ANON_KEY — from apps/portal-court/.env.local's
//                       NEXT_PUBLIC_SUPABASE_ANON_KEY. Never the service role
//                       key: a service-role client bypasses RLS entirely and
//                       would make every assertion below pass vacuously,
//                       which is precisely the failure mode CLAUDE.md's third
//                       incident records.
//   SUPABASE_URL      — optional, defaults to the project URL below.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://syzzfgaudpifwvbpycyi.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error(
    "[verify-discovery] SUPABASE_ANON_KEY is required (the anon/publishable key from " +
      "apps/portal-court/.env.local's NEXT_PUBLIC_SUPABASE_ANON_KEY, never the service role key).",
  );
  process.exit(1);
}

const DEMO_PASSWORD = "AtlitosDemo!2026"; // matches scripts/seed-demo-users.mjs
const PLAYER_EMAIL = "player@atlitos.dev";

const failures = [];
const notes = [];

function check(label, ok, detail) {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(label);
  return ok;
}

function newClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(email) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) throw new Error(`[verify-discovery] sign in failed for ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

/** Counts rows a role can actually SEE. A zero count and a permission error
 * are different outcomes and this reports them differently: RLS denial is
 * silent (0 rows), which is the whole reason AT-63 went unnoticed. */
async function visibleCount(client, table, filters = {}) {
  let q = client.from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  const { count, error } = await q;
  if (error) return { count: null, error: error.message };
  return { count: count ?? 0, error: null };
}

/** The same slot derivation packages/api/src/use-coaching.ts's
 * computeAvailableSessionSlots performs, inlined so this script exercises the
 * real arithmetic without importing a built workspace package. */
function computeSlots(windows, durationMinutes, dateISO, busySlots) {
  const toMin = (t) => {
    const [h, m] = t.split(":");
    return Number(h ?? 0) * 60 + Number(m ?? 0);
  };
  const toTime = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  const [y, mo, d] = dateISO.split("-");
  const weekday = new Date(Number(y), Number(mo ?? 1) - 1, Number(d ?? 1)).getDay();
  const busy = new Set(busySlots.filter((s) => s.date === dateISO).map((s) => s.slot_start.slice(0, 5)));

  const slots = [];
  for (const w of windows) {
    if (w.day_of_week !== weekday) continue;
    if (w.effective_from && w.effective_from > dateISO) continue;
    const end = toMin(w.end_time);
    for (let s = toMin(w.start_time); s + durationMinutes <= end; s += durationMinutes) {
      const from = toTime(s);
      if (busy.has(from)) continue;
      slots.push(from);
    }
  }
  return slots;
}

async function main() {
  console.log("=== AT-63 discovery-to-booking read path ===");
  console.log(`Project: ${SUPABASE_URL}\n`);

  // -----------------------------------------------------------------------
  // Part 1: guest / anon. No session at all.
  // -----------------------------------------------------------------------
  console.log("Part 1: guest (anon role, no session) can browse coaches and see their offering");
  const guest = newClient();

  const { data: guestCoaches, error: guestCoachErr } = await guest
    .from("coach_profiles_public")
    .select("user_id, sport, city, rating");
  if (guestCoachErr) throw new Error(`[verify-discovery] guest coach_profiles_public read failed: ${guestCoachErr.message}`);

  check("guest sees verified coaches in coach_profiles_public", (guestCoaches ?? []).length > 0, `${(guestCoaches ?? []).length} coach(es)`);
  if ((guestCoaches ?? []).length === 0) {
    throw new Error("[verify-discovery] no verified coaches in this project; run scripts/seed-coaching-fixtures.mjs first");
  }

  const guestIds = guestCoaches.map((c) => c.user_id);
  const { data: guestTypes } = await guest.from("session_types").select("id, coach_id, price").in("coach_id", guestIds).eq("active", true);
  const { data: guestWindows } = await guest.from("coach_availability_windows").select("coach_id, day_of_week").in("coach_id", guestIds);

  // THE AT-63 REGRESSION ASSERTIONS. Both were 0 before 0030.
  check("guest can read verified coaches' session_types", (guestTypes ?? []).length > 0, `${(guestTypes ?? []).length} row(s)`);
  check("guest can read verified coaches' availability windows", (guestWindows ?? []).length > 0, `${(guestWindows ?? []).length} row(s)`);

  // -----------------------------------------------------------------------
  // Part 2: real athlete session, full path through to bookable slots.
  // -----------------------------------------------------------------------
  console.log("\nPart 2: real athlete session drives listCoaches -> getCoach -> slots");
  const athlete = await signIn(PLAYER_EMAIL);
  console.log(`  signed in as ${PLAYER_EMAIL} (${athlete.userId})`);

  const { data: coaches, error: listErr } = await athlete.client.from("coach_profiles_public").select("*");
  if (listErr) throw new Error(`[verify-discovery] athlete listCoaches failed: ${listErr.message}`);
  check("athlete listCoaches returns coaches", (coaches ?? []).length > 0, `${(coaches ?? []).length} coach(es)`);

  const ids = coaches.map((c) => c.user_id);
  const { data: profiles } = await athlete.client.from("public_profiles").select("id, name, avatar_url").in("id", ids);
  check("athlete can hydrate coach names from public_profiles", (profiles ?? []).length > 0, `${(profiles ?? []).length} row(s)`);

  const { data: listTypes } = await athlete.client
    .from("session_types")
    .select("id, coach_id, name, duration_minutes, price, active")
    .in("coach_id", ids)
    .eq("active", true);
  // Without this, every CoachCard renders with no "from" price (FR-20).
  check("athlete can read session_types for the coach list (priceFrom)", (listTypes ?? []).length > 0, `${(listTypes ?? []).length} row(s)`);

  // Pick a coach that actually has both a session type and a window, so the
  // slot assertion below is about RLS and not about thin fixture data.
  const typesByCoach = new Map();
  for (const t of listTypes ?? []) {
    if (!typesByCoach.has(t.coach_id)) typesByCoach.set(t.coach_id, []);
    typesByCoach.get(t.coach_id).push(t);
  }

  let target = null;
  for (const coachId of typesByCoach.keys()) {
    const { data: w } = await athlete.client
      .from("coach_availability_windows")
      .select("coach_id, day_of_week, start_time, end_time, effective_from")
      .eq("coach_id", coachId);
    if ((w ?? []).length > 0) {
      target = { coachId, types: typesByCoach.get(coachId), windows: w };
      break;
    }
  }

  if (!check("athlete finds a coach with both session types and availability", target !== null)) {
    notes.push("no coach had both a session type and an availability window visible to the athlete");
  } else {
    console.log(`  target coach ${target.coachId}: ${target.types.length} session type(s), ${target.windows.length} window(s)`);

    const { data: busy, error: busyErr } = await athlete.client.rpc("get_coach_busy_slots", {
      p_coach_id: target.coachId,
      p_from: new Date().toISOString().split("T")[0],
      p_to: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
    });
    check("athlete can call get_coach_busy_slots", !busyErr, busyErr ? busyErr.message : `${(busy ?? []).length} busy slot(s)`);

    // The product outcome: at least one bookable slot somewhere in 14 days.
    const duration = target.types[0].duration_minutes;
    let totalSlots = 0;
    let firstDay = null;
    for (let i = 1; i <= 14; i++) {
      const day = new Date(Date.now() + i * 86400000).toISOString().split("T")[0];
      const slots = computeSlots(target.windows, duration, day, busy ?? []);
      if (slots.length > 0 && !firstDay) firstDay = `${day} ${slots[0]}`;
      totalSlots += slots.length;
    }
    check(
      "athlete gets at least one bookable slot (the outcome AT-63 killed)",
      totalSlots > 0,
      totalSlots > 0 ? `${totalSlots} slot(s) over 14 days, first ${firstDay}` : "0 slots",
    );
  }

  // -----------------------------------------------------------------------
  // Part 3: the athlete must not have gained any private read.
  // -----------------------------------------------------------------------
  console.log("\nPart 3: athlete still cannot read what must stay private");
  const cp = await visibleCount(athlete.client, "coach_profiles");
  check("coach_profiles base table invisible to a non-owner athlete", cp.count === 0, `${cp.count} row(s)${cp.error ? `, error: ${cp.error}` : ""}`);

  const certs = await visibleCount(athlete.client, "coach_certificates");
  check("coach_certificates invisible to the athlete", certs.count === 0, `${certs.count} row(s)`);

  // sessions is permissive-OR across coach_id/player_id: the athlete may see
  // their OWN, and must see nobody else's. Assert the scoped fact.
  const allSessions = await visibleCount(athlete.client, "sessions");
  const ownSessions = await visibleCount(athlete.client, "sessions", { player_id: athlete.userId });
  check(
    "athlete sees only their own sessions",
    allSessions.count === ownSessions.count,
    `${allSessions.count} visible, ${ownSessions.count} own`,
  );

  // -----------------------------------------------------------------------
  // Part 4: the guest must not have gained any private read either.
  // -----------------------------------------------------------------------
  console.log("\nPart 4: guest still cannot read what must stay private");
  for (const table of ["coach_profiles", "coach_certificates", "sessions", "payment_intents"]) {
    const r = await visibleCount(guest, table);
    check(`${table} invisible to anon`, r.count === 0, `${r.count} row(s)${r.error ? `, denied: ${r.error}` : ""}`);
  }

  // -----------------------------------------------------------------------
  console.log("\n=== SUMMARY ===");
  console.log("Guard: supabase/migrations/0030_verified_coach_discovery_rls.sql replaced the");
  console.log("session_types / coach_availability_windows public policies' EXISTS-over-coach_profiles");
  console.log("subquery (evaluated under the caller's own RLS, so always false for an athlete) with");
  console.log("the SECURITY DEFINER helper public.is_verified_coach(uuid). coach_profiles itself");
  console.log("gained no reader, so the base table must still be invisible above.");
  for (const n of notes) console.log(`Note: ${n}`);

  if (failures.length === 0) {
    console.log("\nVerdict: discovery-to-booking read path PROVEN WORKING for both a guest and a real athlete, with no private read opened.");
    process.exit(0);
  }
  console.log(`\nVerdict: ${failures.length} FAILED assertion(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[verify-discovery] FAILED:", err.message ?? err);
  process.exit(1);
});
