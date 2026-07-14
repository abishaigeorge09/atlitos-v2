#!/usr/bin/env node
// ATLITOS v2 — scripts/seed-onboarding-demo.mjs
//
// PRD-03 FR-1 through FR-7 (P2 cycle-2 punch item 4). The phase 2 biased
// approver's finding: "No /onboarding route exists anywhere in
// apps/portal-court. The verification agent had to seed venues/courts and
// mark a partner verified via direct service-role SQL because no real
// intake path exists." supabase/seed/seed_p2.sql still does exactly that
// for its own 8-venue bulk fixture (by design, see that file's own header:
// bulk fixture data, not a verification-path demo), which means there was
// still no fixture proving the real intake path (submit -> photos ->
// admin approve) actually works end to end.
//
// This script is that proof. It deliberately does NOT use the service role
// key: every write goes through a real authenticated session (anon key +
// the demo partner/admin passwords `scripts/seed-demo-users.mjs` already
// created), calling exactly the RPCs `apps/portal-court/src/lib/onboarding.ts`
// calls:
//   1. Sign in as partner@atlitos.dev, call submit_venue_verification
//      (0009_courts.sql) — the same call the Courts step's Continue button
//      makes.
//   2. Upload 3 placeholder photos to the venue-media bucket and insert
//      venue_photos rows — the same calls the Photos step makes.
//   3. Sign in as admin@atlitos.dev, find the resulting verification_requests
//      row, call admin_approve_verification_request — the same call the
//      admin portal's Verification Detail approve action makes.
//
// End state: one venue owned by partner@atlitos.dev, status='verified',
// created and approved entirely through the live RPCs, no raw SQL insert
// anywhere in this file.
//
// Idempotent: looks up the demo venue by name first; if it is already
// 'verified' the script is a no-op. Safe to re-run.
//
// Run order: AFTER scripts/seed-demo-users.mjs (needs partner@atlitos.dev
// and admin@atlitos.dev to already exist with their roles granted).
//
// Env required:
//   SUPABASE_ANON_KEY  — the anon/publishable key (safe to expose client
//                        side; this script signs in as a real user with it,
//                        it never touches the service role key).
//   SUPABASE_URL       — optional, defaults to the project's URL below.
//
// NOTE for whoever runs this: it creates real rows against the project
// named below (a new `venues` row owned by partner@atlitos.dev, its courts,
// 3 photo objects in `venue-media`, one `verification_requests` row, one
// `audit_log` row from the approval). It is not run automatically by this
// change; run it deliberately, the same way seed-demo-users.mjs and
// seed_p2.sql already are.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://syzzfgaudpifwvbpycyi.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!ANON_KEY) {
  console.error(
    '[seed-onboarding-demo] SUPABASE_ANON_KEY is required (the anon/publishable key from apps/portal-court/.env.local\'s ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY, never the service role key, this script signs in as a real demo user).'
  );
  process.exit(1);
}

const DEMO_PASSWORD = 'AtlitosDemo!2026'; // matches scripts/seed-demo-users.mjs
const PARTNER_EMAIL = 'partner@atlitos.dev';
const ADMIN_EMAIL = 'admin@atlitos.dev';
const DEMO_VENUE_NAME = 'Onboarding Demo Turf';

// A tiny valid 1x1 PNG. Content is irrelevant for a fixture, only that it is
// a real uploadable image object satisfying PRD-03 FR-3's minimum photo
// count through the real upload path (not a placeholder row with no
// underlying storage object).
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function newClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(client, email) {
  const { data, error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (error) {
    throw new Error(`[seed-onboarding-demo] sign in as ${email} failed: ${error.message} (run scripts/seed-demo-users.mjs first)`);
  }
  return data.user;
}

async function main() {
  const partnerClient = newClient();
  await signIn(partnerClient, PARTNER_EMAIL);

  const { data: existing, error: existingError } = await partnerClient
    .from('venues')
    .select('id, status')
    .eq('name', DEMO_VENUE_NAME)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existingError) {
    throw new Error(`[seed-onboarding-demo] could not look up existing demo venue: ${existingError.message}`);
  }

  let venueId = existing?.[0]?.id ?? null;
  let status = existing?.[0]?.status ?? null;

  if (venueId && status === 'verified') {
    console.log(`[seed-onboarding-demo] '${DEMO_VENUE_NAME}' already verified (${venueId}), nothing to do.`);
    return;
  }

  if (!venueId) {
    console.log(`[seed-onboarding-demo] submitting '${DEMO_VENUE_NAME}' via submit_venue_verification ...`);
    const { error: submitError } = await partnerClient.rpc('submit_venue_verification', {
      p_payload: {
        name: DEMO_VENUE_NAME,
        address: 'Plot 12, Kompally Main Road',
        city: 'Hyderabad',
        pincode: '500014',
        lat: 17.5453,
        lng: 78.4882,
        description: 'Onboarding demo fixture, produced through the real submit_venue_verification RPC.',
        courts: [
          { sport: 'cricket', name: 'Turf 1', capacity: 12, basePricePerHour: '600' },
        ],
      },
    });
    if (submitError) {
      throw new Error(`[seed-onboarding-demo] submit_venue_verification failed: ${submitError.message}`);
    }

    const { data: created, error: createdError } = await partnerClient
      .from('venues')
      .select('id, status')
      .eq('name', DEMO_VENUE_NAME)
      .order('created_at', { ascending: false })
      .limit(1);
    if (createdError || !created?.[0]) {
      throw new Error(`[seed-onboarding-demo] could not read back the venue just created: ${createdError?.message ?? 'no row'}`);
    }
    venueId = created[0].id;
    status = created[0].status;
    console.log(`[seed-onboarding-demo] venue created (${venueId}), status='${status}'.`);
  }

  const { count: photoCount, error: photoCountError } = await partnerClient
    .from('venue_photos')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if (photoCountError) {
    throw new Error(`[seed-onboarding-demo] could not count existing photos: ${photoCountError.message}`);
  }

  const needed = Math.max(0, 3 - (photoCount ?? 0));
  for (let i = 0; i < needed; i += 1) {
    const path = `${venueId}/demo-${(photoCount ?? 0) + i + 1}.png`;
    const { error: uploadError } = await partnerClient.storage.from('venue-media').upload(path, PIXEL_PNG, {
      contentType: 'image/png',
      upsert: true,
    });
    if (uploadError) {
      throw new Error(`[seed-onboarding-demo] photo upload failed: ${uploadError.message}`);
    }
    const { error: insertError } = await partnerClient
      .from('venue_photos')
      .insert({ venue_id: venueId, storage_path: path, position: (photoCount ?? 0) + i });
    if (insertError) {
      throw new Error(`[seed-onboarding-demo] venue_photos insert failed: ${insertError.message}`);
    }
  }
  if (needed > 0) {
    console.log(`[seed-onboarding-demo] uploaded ${needed} photo(s), venue now has at least 3.`);
  }

  if (status === 'verified') {
    console.log('[seed-onboarding-demo] venue already verified.');
    return;
  }

  if (status === 'rejected') {
    console.log(
      `[seed-onboarding-demo] '${DEMO_VENUE_NAME}' is rejected, not pending; approving a rejected venue is not a real ` +
        'admin flow, skipping. Delete the venue or change its name to reseed a fresh one.'
    );
    return;
  }

  const adminClient = newClient();
  await signIn(adminClient, ADMIN_EMAIL);

  const { data: requests, error: requestsError } = await adminClient
    .from('verification_requests')
    .select('id, status')
    .eq('applicant_type', 'venue')
    .eq('applicant_id', venueId)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(1);
  if (requestsError) {
    throw new Error(`[seed-onboarding-demo] could not read verification_requests as admin: ${requestsError.message}`);
  }
  const request = requests?.[0];
  if (!request) {
    throw new Error('[seed-onboarding-demo] no pending_review verification_requests row found for this venue.');
  }

  console.log(`[seed-onboarding-demo] approving verification_requests ${request.id} as ${ADMIN_EMAIL} ...`);
  const { error: approveError } = await adminClient.rpc('admin_approve_verification_request', {
    p_request_id: request.id,
  });
  if (approveError) {
    throw new Error(`[seed-onboarding-demo] admin_approve_verification_request failed: ${approveError.message}`);
  }

  console.log(`[seed-onboarding-demo] done. '${DEMO_VENUE_NAME}' (${venueId}) is now verified.`);
}

main().catch((err) => {
  console.error('[seed-onboarding-demo] FAILED:', err.message ?? err);
  process.exit(1);
});
