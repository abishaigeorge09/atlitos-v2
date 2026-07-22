-- ATLITOS v2 — seed_p6_empower_fixtures.sql
-- Phase 6 Empower fixture: UPA applications across states, evidence, wishlist,
-- gratitude posts. Fixture donation rows are created by Track B's finalize
-- handler (not hand-inserted here, per CLAUDE.md financial invariant).
--
-- Run order: AFTER scripts/seed-empower-upa-users.mjs (creates the fixture users).
-- Idempotent: safe to re-run.
--
-- This runs with elevated (migration/service-role) privileges.
-- Defensive check: all reads carry explicit owner/status filters (RLS audit).
-- No emoji, no hyphen/em-dash in any user-visible copy.

do $$
declare
  v_upa_verified_id uuid;
  v_upa_under_review_id uuid;
  v_upa_needs_info_id uuid;
  v_upa_rejected_id uuid;
  v_donor_id uuid;
  v_priya_id uuid;
  v_rajesh_id uuid;
  v_ananya_id uuid;
  v_vikram_id uuid;
  v_wishlist_1_id uuid;
  v_wishlist_2_id uuid;
  v_wishlist_3_id uuid;
begin

  -- ==========================================================================
  -- Fixture users: use existing test users from seed-demo-users.mjs
  -- If specific UPA user accounts exist (created by seed-empower-upa-users.mjs),
  -- they take precedence. Otherwise fall back to existing test users.
  -- ==========================================================================

  select u.id into v_priya_id
  from auth.users au
  join public.users u on u.id = au.id
  where au.email in ('upa.verified@atlitos.dev', 'coach1@atlitos.dev')
  limit 1;

  select u.id into v_rajesh_id
  from auth.users au
  join public.users u on u.id = au.id
  where au.email in ('upa.tennis@atlitos.dev', 'coach2@atlitos.dev')
  limit 1;

  select u.id into v_ananya_id
  from auth.users au
  join public.users u on u.id = au.id
  where au.email in ('upa.badminton@atlitos.dev', 'p2-verify-athlete@atlitos.dev')
  limit 1;

  select u.id into v_vikram_id
  from auth.users au
  join public.users u on u.id = au.id
  where au.email in ('upa.football@atlitos.dev', 'player@atlitos.dev')
  limit 1;

  select u.id into v_donor_id
  from auth.users au
  join public.users u on u.id = au.id
  where au.email = 'partner@atlitos.dev'
  limit 1;

  if v_priya_id is null or v_rajesh_id is null or v_ananya_id is null
     or v_vikram_id is null or v_donor_id is null then
    raise notice 'seed_p6: One or more fixture users do not exist. Expected test users from seed-demo-users.mjs.';
    return;
  end if;

  -- ==========================================================================
  -- UPA 1: Verified (Priya, cricket, Mumbai)
  -- Public, donatable, with wishlist items at varied funding levels.
  -- ==========================================================================

  insert into public.upa_applications (
    id, applicant_user_id, story_headline, story_body, sport, region, state,
    photo_url, status, verified_at, created_at, updated_at
  ) values (
    'f0000000-0000-0000-0000-000000000001',
    v_priya_id,
    'Developing grassroots cricket for underprivileged girls',
    'I coach girls aged 8 to 16 in a Mumbai slum community. My mission is to give them access to quality cricket coaching and equipment, which is rarely available in their neighbourhoods. Every donation directly funds equipment, ground rental, and scholarships for coaching camps.',
    'cricket'::public.sport,
    'Mumbai',
    'Maharashtra',
    'https://images.unsplash.com/photo-1570274455212-04742472609d?w=400',
    'verified'::public.upa_status,
    now() - interval '30 days',
    now() - interval '60 days',
    now() - interval '30 days'
  )
  on conflict (id) do nothing;

  select id into v_upa_verified_id from public.upa_applications
  where id = 'f0000000-0000-0000-0000-000000000001';

  -- Evidence for verified UPA
  insert into public.upa_evidence (
    id, application_id, kind, storage_path, url, created_at
  ) values
    ('e0000000-0000-0000-0000-000000000001', v_upa_verified_id, 'certificate', 'upa-evidence/cert-priya-cricket.pdf', null, now()),
    ('e0000000-0000-0000-0000-000000000002', v_upa_verified_id, 'id_proof', 'upa-evidence/id-priya-aadhar.pdf', null, now())
  on conflict (id) do nothing;

  -- Wishlist items for verified UPA: varied funding states
  -- Item 1: Unfunded
  insert into public.upa_wishlist_items (
    id, upa_id, title, cost, funded_amount, status, created_at, updated_at
  ) values (
    'w0000000-0000-0000-0000-000000000001',
    v_upa_verified_id,
    'Cricket bat set for 10 girls',
    5000.00,
    0.00,
    'open'::public.upa_wishlist_item_status,
    now() - interval '10 days',
    now() - interval '10 days'
  )
  on conflict (id) do nothing;

  select id into v_wishlist_1_id from public.upa_wishlist_items
  where id = 'w0000000-0000-0000-0000-000000000001';

  -- Item 2: Partially funded (2000 of 3000)
  insert into public.upa_wishlist_items (
    id, upa_id, title, cost, funded_amount, status, created_at, updated_at
  ) values (
    'w0000000-0000-0000-0000-000000000002',
    v_upa_verified_id,
    'Ground rental for three months',
    3000.00,
    2000.00,
    'open'::public.upa_wishlist_item_status,
    now() - interval '5 days',
    now() - interval '5 days'
  )
  on conflict (id) do nothing;

  select id into v_wishlist_2_id from public.upa_wishlist_items
  where id = 'w0000000-0000-0000-0000-000000000002';

  -- Item 3: Fully funded (2500 of 2500) - shows as 'funded' state
  insert into public.upa_wishlist_items (
    id, upa_id, title, cost, funded_amount, status, created_at, updated_at
  ) values (
    'w0000000-0000-0000-0000-000000000003',
    v_upa_verified_id,
    'First aid kit and safety equipment',
    2500.00,
    2500.00,
    'funded'::public.upa_wishlist_item_status,
    now() - interval '2 days',
    now() - interval '2 days'
  )
  on conflict (id) do nothing;

  select id into v_wishlist_3_id from public.upa_wishlist_items
  where id = 'w0000000-0000-0000-0000-000000000003';

  -- Gratitude post for the funded item
  insert into public.gratitude_posts (
    id, upa_id, wishlist_item_id, body, photo_url, status, created_at
  ) values (
    'g0000000-0000-0000-0000-000000000001',
    v_upa_verified_id,
    v_wishlist_3_id,
    'The safety equipment arrived yesterday and the girls are thrilled. We did our first outdoor training session with proper protective gear. This donation means we can train safely and expand our program.',
    'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=400',
    'published',
    now() - interval '1 day'
  )
  on conflict (id) do nothing;

  -- ==========================================================================
  -- UPA 2: Under Review (Rajesh, tennis, Bengaluru)
  -- In the admin queue, pending approval.
  -- ==========================================================================

  insert into public.upa_applications (
    id, applicant_user_id, story_headline, story_body, sport, region, state,
    photo_url, status, created_at, updated_at
  ) values (
    'f0000000-0000-0000-0000-000000000002',
    v_rajesh_id,
    'Tennis coaching for underprivileged youth in Bengaluru',
    'I run a tennis program for youth in east Bengaluru. We focus on providing free coaching to children from lower income backgrounds who would otherwise have no access to the sport. Your donation helps us pay court fees and buy equipment.',
    'tennis'::public.sport,
    'Bengaluru',
    'Karnataka',
    'https://images.unsplash.com/photo-1554068865-24cecd4e34c8?w=400',
    'under_review'::public.upa_status,
    now() - interval '7 days',
    now() - interval '7 days'
  )
  on conflict (id) do nothing;

  select id into v_upa_under_review_id from public.upa_applications
  where id = 'f0000000-0000-0000-0000-000000000002';

  insert into public.upa_evidence (
    id, application_id, kind, storage_path, url, created_at
  ) values
    ('e0000000-0000-0000-0000-000000000003', v_upa_under_review_id, 'certificate', 'upa-evidence/cert-rajesh-tennis.pdf', null, now())
  on conflict (id) do nothing;

  -- ==========================================================================
  -- UPA 3: Needs Info (Ananya, badminton, Hyderabad)
  -- Staff flagged a field as incomplete, awaiting resubmission.
  -- ==========================================================================

  insert into public.upa_applications (
    id, applicant_user_id, story_headline, story_body, sport, region, state,
    photo_url, status, needs_info_field, created_at, updated_at
  ) values (
    'f0000000-0000-0000-0000-000000000003',
    v_ananya_id,
    'Badminton academy for girls in Hyderabad',
    'We operate a badminton academy serving girls aged 10 to 18 in Hyderabad. Most of our students come from middle class and working class families. Our goal is to provide affordable, quality coaching to develop their skills.',
    'badminton'::public.sport,
    'Hyderabad',
    'Telangana',
    'https://images.unsplash.com/photo-1556075798-4825dfaaf498?w=400',
    'needs_info'::public.upa_status,
    'story_body',
    now() - interval '14 days',
    now() - interval '3 days'
  )
  on conflict (id) do nothing;

  select id into v_upa_needs_info_id from public.upa_applications
  where id = 'f0000000-0000-0000-0000-000000000003';

  -- ==========================================================================
  -- UPA 4: Rejected (Vikram, football, Delhi)
  -- Terminal state. Represents an application that was not approved.
  -- ==========================================================================

  insert into public.upa_applications (
    id, applicant_user_id, story_headline, story_body, sport, region, state,
    photo_url, status, rejection_reason, reapply_after, created_at, updated_at
  ) values (
    'f0000000-0000-0000-0000-000000000004',
    v_vikram_id,
    'Football training program for youth',
    'We want to start a football program in Delhi.',
    'football'::public.sport,
    'Delhi',
    'Delhi',
    'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=400',
    'rejected'::public.upa_status,
    'Insufficient detail in program description and no evidence of prior coaching experience submitted',
    now()::date + interval '30 days',
    now() - interval '21 days',
    now() - interval '7 days'
  )
  on conflict (id) do nothing;

  select id into v_upa_rejected_id from public.upa_applications
  where id = 'f0000000-0000-0000-0000-000000000004';

  raise notice 'seed_p6: Fixture UPAs created:';
  raise notice '  Verified (Priya cricket, Mumbai):     %', v_upa_verified_id;
  raise notice '  Under Review (Rajesh tennis, Bengaluru): %', v_upa_under_review_id;
  raise notice '  Needs Info (Ananya badminton, Hyderabad): %', v_upa_needs_info_id;
  raise notice '  Rejected (Vikram football, Delhi):    %', v_upa_rejected_id;
  raise notice 'Wishlist items (verified UPA):';
  raise notice '  Item 1 (unfunded, 5000):              %', v_wishlist_1_id;
  raise notice '  Item 2 (partial, 2000/3000):         %', v_wishlist_2_id;
  raise notice '  Item 3 (funded, 2500/2500):          %', v_wishlist_3_id;
  raise notice 'Note: Donation rows and funded_amount updates require real Track B finalize handler. Wishlist items 1 and 2 need scripted donations for funded state verification.';

end $$;
