-- ATLITOS v2 — scripts/verify-security-fixes.sql
--
-- Executable regression suite for the SQL half of the 2026-09-04 security
-- remediation: SEC-F2 (payment finalization recovery, 0088), SEC-F3 (coach
-- trainee video path lock, 0089), SEC-F4 (suspension enforcement, 0090) and
-- SEC-F5 (atomic order audit, 0091).
--
-- WHY A SQL FILE AND NOT A PLAYWRIGHT SPEC. apps/e2e's truth lane needs a live
-- Supabase project and SUPABASE_SERVICE_ROLE_KEY, which is the right shape for
-- asserting the deployed system but means the SQL cannot be exercised by anyone
-- without those credentials. This file needs neither: it runs against ANY
-- Postgres with the migration chain applied, including a scratch cluster with
-- the platform shim, so the migrations are provable on a laptop and in CI.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-security-fixes.sql
--
-- Every case runs inside ONE transaction that is ROLLED BACK at the end, so it
-- is safe to point at a real database: it writes nothing that survives. It does
-- take row locks while it runs, so do not aim it at production during traffic.
--
-- Assertions raise on failure. A clean run prints one ok line per case and
-- ends with "verify-security-fixes: all cases passed".

\set ON_ERROR_STOP on
begin;

-- Identity helpers. auth.uid()/has_role() read the request.jwt.claims GUC, the
-- same shape PostgREST sets, so "acting as" a user is one set_config call.
create or replace function pg_temp.act_as(p_uid uuid, p_roles text[] default '{}')
returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_uid::text,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('roles', to_jsonb(p_roles))
    )::text,
    true
  );
end;
$$;

create or replace function pg_temp.assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception 'FAILED: %', p_label;
  end if;
  raise notice 'ok  %', p_label;
end;
$$;

-- Fixtures.
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_trainee uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_admin), (v_member), (v_coach), (v_trainee), (v_stranger);
  -- 0073's handle_new_user trigger already mirrors each auth.users row into
  -- public.users, so this only names them for readable failure messages.
  insert into public.users (id, name) values
    (v_admin, 'SEC admin'), (v_member, 'SEC member'), (v_coach, 'SEC coach'),
    (v_trainee, 'SEC trainee'), (v_stranger, 'SEC stranger')
  on conflict (id) do update set name = excluded.name;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin'), (v_coach, 'coach');
  perform set_config('sec.admin', v_admin::text, true);
  perform set_config('sec.member', v_member::text, true);
  perform set_config('sec.coach', v_coach::text, true);
  perform set_config('sec.trainee', v_trainee::text, true);
  perform set_config('sec.stranger', v_stranger::text, true);
end;
$$;

-- ============================================================================
-- SEC-F4 — suspension is enforced, and suspend/reinstate are atomic + audited
-- ============================================================================

do $$
declare
  v_admin uuid := current_setting('sec.admin')::uuid;
  v_member uuid := current_setting('sec.member')::uuid;
  v_audit int;
  v_notif int;
  v_hook jsonb;
  v_err text;
begin
  -- Baseline.
  perform pg_temp.act_as(v_member);
  perform pg_temp.assert(public.is_active_user(), 'SEC-F4 an active member is_active_user() = true');

  -- Reason is mandatory.
  perform pg_temp.act_as(v_admin, array['admin']);
  begin
    perform public.admin_suspend_user(v_member, '   ');
    perform pg_temp.assert(false, 'SEC-F4 blank reason must be refused');
  exception when others then
    perform pg_temp.assert(sqlerrm like 'REASON_REQUIRED%', 'SEC-F4 blank suspension reason raises REASON_REQUIRED');
  end;

  -- A non-admin cannot suspend anyone.
  perform pg_temp.act_as(v_member);
  begin
    perform public.admin_suspend_user(v_admin, 'privilege escalation attempt');
    perform pg_temp.assert(false, 'SEC-F4 non-admin must not suspend');
  exception when others then
    perform pg_temp.assert(sqlerrm like 'FORBIDDEN%', 'SEC-F4 a non-admin calling admin_suspend_user raises FORBIDDEN');
  end;

  -- An admin cannot suspend themselves out of the tool.
  perform pg_temp.act_as(v_admin, array['admin']);
  begin
    perform public.admin_suspend_user(v_admin, 'self');
    perform pg_temp.assert(false, 'SEC-F4 self-suspension must be refused');
  exception when others then
    perform pg_temp.assert(sqlerrm like 'FORBIDDEN%', 'SEC-F4 an admin cannot suspend their own account');
  end;

  -- The real suspension.
  perform public.admin_suspend_user(v_member, 'e2e reason');
  perform pg_temp.assert(
    (select status = 'suspended' and suspended_reason = 'e2e reason' from public.users where id = v_member),
    'SEC-F4 suspension sets status and reason');

  -- Atomic side effects: exactly one audit row, exactly one notification, both
  -- in the same transaction as the status change (SEC-F5's shape).
  select count(*) into v_audit from public.audit_log
    where entity_id = v_member and action = 'user.suspend';
  perform pg_temp.assert(v_audit = 1, 'SEC-F4 suspension writes exactly one audit_log row');
  perform pg_temp.assert(
    (select actor_id = v_admin and note = 'e2e reason'
       and before ->> 'status' = 'active' and after ->> 'status' = 'suspended'
     from public.audit_log where entity_id = v_member and action = 'user.suspend'),
    'SEC-F4 the audit row names the actor, the reason and the real before/after');

  select count(*) into v_notif from public.notifications where user_id = v_member;
  perform pg_temp.assert(v_notif = 1, 'SEC-F4 the suspended member is notified');

  -- Enforcement.
  perform pg_temp.act_as(v_member);
  perform pg_temp.assert(not public.is_active_user(), 'SEC-F4 a suspended member is_active_user() = false');

  -- The access-token hook denies a token rather than minting claims.
  v_hook := public.custom_access_token_hook(
    jsonb_build_object('user_id', v_member::text, 'claims', jsonb_build_object('app_metadata', '{}'::jsonb)));
  perform pg_temp.assert(v_hook ? 'error', 'SEC-F4 the access token hook refuses a suspended user');
  perform pg_temp.assert(
    (v_hook -> 'error' ->> 'http_code') = '403',
    'SEC-F4 the hook refusal is a 403');

  -- Idempotence: re-suspending writes no second audit row.
  perform pg_temp.act_as(v_admin, array['admin']);
  perform public.admin_suspend_user(v_member, 'again');
  select count(*) into v_audit from public.audit_log
    where entity_id = v_member and action = 'user.suspend';
  perform pg_temp.assert(v_audit = 1, 'SEC-F4 re-suspending writes no second audit row');

  -- Reinstate.
  perform public.admin_reinstate_user(v_member, 'appeal upheld');
  perform pg_temp.assert(
    (select status = 'active' and suspended_reason is null from public.users where id = v_member),
    'SEC-F4 reinstating clears the status and the reason');
  select count(*) into v_audit from public.audit_log
    where entity_id = v_member and action = 'user.reinstate';
  perform pg_temp.assert(v_audit = 1, 'SEC-F4 reinstatement writes exactly one audit_log row');

  perform pg_temp.act_as(v_member);
  perform pg_temp.assert(public.is_active_user(), 'SEC-F4 access returns after reinstatement');

  -- And the hook mints normally again, carrying the status claim.
  v_hook := public.custom_access_token_hook(
    jsonb_build_object('user_id', v_member::text, 'claims', jsonb_build_object('app_metadata', '{}'::jsonb)));
  perform pg_temp.assert(not (v_hook ? 'error'), 'SEC-F4 the hook mints for a reinstated user');
  perform pg_temp.assert(
    (v_hook -> 'claims' -> 'app_metadata' ->> 'user_status') = 'active',
    'SEC-F4 the hook injects app_metadata.user_status');
end;
$$;

-- The restrictive RLS layer, which needs a real non-superuser role: `postgres`
-- bypasses RLS, so asserting a policy as postgres proves nothing.
do $$
declare
  v_member uuid := current_setting('sec.member')::uuid;
  v_admin uuid := current_setting('sec.admin')::uuid;
  v_blocked boolean := false;
begin
  perform pg_temp.act_as(v_admin, array['admin']);
  perform public.admin_suspend_user(v_member, 'rls layer check');
  perform pg_temp.act_as(v_member);

  set local role authenticated;
  begin
    insert into public.addresses (user_id, line1, city, state, pincode)
    values (v_member, '1 Test Road', 'Hyderabad', 'TS', '500001');
  exception when others then
    -- Same discipline as SEC-F3: the block must be the restrictive policy, not
    -- an absent grant.
    v_blocked := sqlerrm like '%row-level security policy%';
    if not v_blocked then raise exception 'SEC-F4 RLS blocked for the wrong reason: %', sqlerrm; end if;
  end;
  reset role;

  perform pg_temp.assert(v_blocked, 'SEC-F4 a suspended member cannot insert directly through RLS');

  perform pg_temp.act_as(v_admin, array['admin']);
  perform public.admin_reinstate_user(v_member, null);
end;
$$;

-- ============================================================================
-- SEC-F3 — coach trainee video storage paths and relationships
-- ============================================================================

do $$
declare
  v_coach uuid := current_setting('sec.coach')::uuid;
  v_trainee uuid := current_setting('sec.trainee')::uuid;
  v_stranger uuid := current_setting('sec.stranger')::uuid;
  v_session_type uuid;
  v_refused boolean;
  v_ok uuid;
begin
  insert into public.coach_profiles (user_id, sport, city, state, experience_years, status)
  values (v_coach, 'football', 'Hyderabad', 'TS', 5, 'verified')
  on conflict (user_id) do update set status = 'verified';

  -- The only coach/player link in the schema is a sessions row, which is what
  -- 0089's policy and coach-trainee-video-upload-url both check.
  insert into public.session_types (coach_id, name, duration_minutes, price)
  values (v_coach, 'SEC 1:1', 60, 100)
  returning id into v_session_type;

  insert into public.sessions (coach_id, player_id, session_type_id, date, slot_start, slot_end, frequency, price, platform_fee, total)
  values (v_coach, v_trainee, v_session_type, current_date + 1, '10:00', '11:00', 'one_time', 100, 10, 110);

  perform pg_temp.act_as(v_coach, array['coach']);
  set local role authenticated;

  -- The refusals below must come from the POLICY, not from a missing GRANT.
  -- Both raise SQLSTATE 42501, so matching on the state alone would let a
  -- privilege gap masquerade as an enforced policy: exactly the "passes for the
  -- wrong reason" failure CLAUDE.md's third RLS incident describes. Match the
  -- message text instead.

  -- (a) a client-chosen storage_path is refused.
  v_refused := false;
  begin
    insert into public.coach_trainee_videos (coach_id, player_id, storage_path, caption)
    values (v_coach, v_trainee, 'someone-else/their-clip.mp4', 'path injection');
  exception when others then
    v_refused := sqlerrm like '%row-level security policy%';
    if not v_refused then raise exception 'SEC-F3 (a) refused for the wrong reason: %', sqlerrm; end if;
  end;
  perform pg_temp.assert(v_refused, 'SEC-F3 a coach cannot choose storage_path on insert');

  -- (b) a non-trainee player_id is refused.
  v_refused := false;
  begin
    insert into public.coach_trainee_videos (coach_id, player_id, caption)
    values (v_coach, v_stranger, 'relationship injection');
  exception when others then
    v_refused := sqlerrm like '%row-level security policy%';
    if not v_refused then raise exception 'SEC-F3 (b) refused for the wrong reason: %', sqlerrm; end if;
  end;
  perform pg_temp.assert(v_refused, 'SEC-F3 a coach cannot attach video to a non-trainee');

  -- (c) the legitimate caption-only draft still works, so the guard did not
  --     simply break the feature.
  insert into public.coach_trainee_videos (coach_id, player_id, caption)
  values (v_coach, v_trainee, 'legitimate draft')
  returning id into v_ok;
  perform pg_temp.assert(v_ok is not null, 'SEC-F3 a caption-only draft for a real trainee still inserts');

  reset role;
end;
$$;

-- ============================================================================
-- SEC-F2 — captured payments with unfinished downstream work
-- ============================================================================

do $$
declare
  v_member uuid := current_setting('sec.member')::uuid;
  v_stranded uuid;
  v_done uuid;
  v_backlog int;
  v_sweep jsonb;
begin
  -- A charge that landed and whose handler never finished.
  insert into public.payment_intents (user_id, domain, amount, razorpay_order_id, status, finalized_at)
  values (v_member, 'court', 500, 'order_sec_stranded', 'captured', null)
  returning id into v_stranded;

  -- And one that completed, to prove the backlog discriminates rather than
  -- listing every captured row.
  insert into public.payment_intents (user_id, domain, amount, razorpay_order_id, status, finalized_at)
  values (v_member, 'court', 500, 'order_sec_done', 'captured', now())
  returning id into v_done;

  select count(*) into v_backlog
  from public.payment_finalization_backlog(interval '0')
  where payment_intent_id = v_stranded;
  perform pg_temp.assert(v_backlog = 1, 'SEC-F2 a captured intent with null finalized_at is backlog');

  select count(*) into v_backlog
  from public.payment_finalization_backlog(interval '0')
  where payment_intent_id = v_done;
  perform pg_temp.assert(v_backlog = 0, 'SEC-F2 a finalized intent is not backlog');

  perform pg_temp.assert(
    (select not has_ledger_group from public.payment_finalization_backlog(interval '0')
      where payment_intent_id = v_stranded),
    'SEC-F2 the backlog distinguishes work-missing from marker-missing');

  -- The grace window keeps an in-flight finalization out of the backlog.
  select count(*) into v_backlog
  from public.payment_finalization_backlog(interval '15 minutes')
  where payment_intent_id = v_stranded;
  perform pg_temp.assert(v_backlog = 0, 'SEC-F2 an intent inside the grace window is not yet backlog');

  -- The sweep arm reports it.
  v_sweep := public.expire_stale_holds();
  perform pg_temp.assert(v_sweep ? 'payments_unfinalized', 'SEC-F2 expire_stale_holds reports a payments arm');

  -- A created (unpaid) intent is not backlog: only captured money counts.
  insert into public.payment_intents (user_id, domain, amount, razorpay_order_id, status)
  values (v_member, 'court', 500, 'order_sec_created', 'created');
  select count(*) into v_backlog
  from public.payment_finalization_backlog(interval '0')
  where razorpay_order_id = 'order_sec_created';
  perform pg_temp.assert(v_backlog = 0, 'SEC-F2 an uncaptured intent is not backlog');
end;
$$;

-- ============================================================================
-- SEC-F5 — the order audit row cannot diverge from the transition
-- ============================================================================

do $$
declare
  v_member uuid := current_setting('sec.member')::uuid;
  v_admin uuid := current_setting('sec.admin')::uuid;
  v_order uuid;
  v_cancel uuid;
  v_audit int;
begin
  insert into public.orders (user_id, subtotal, total, ship_to_line1, ship_to_city, ship_to_state, ship_to_pincode)
  values (v_member, 100, 100, '1 Test Road', 'Hyderabad', 'TS', '500001')
  returning id into v_order;

  perform public.order_transition(v_order, 'shipped', v_admin, 'left the warehouse', 'Hyderabad');

  select count(*) into v_audit from public.audit_log
    where entity_id = v_order and action = 'order.advance';
  perform pg_temp.assert(v_audit = 1, 'SEC-F5 one audit row per accepted advance');
  perform pg_temp.assert(
    (select before ->> 'status' = 'placed' and after ->> 'status' = 'shipped' and actor_id = v_admin
     from public.audit_log where entity_id = v_order and action = 'order.advance'),
    'SEC-F5 the audit row records the real before status');

  -- A refused transition must leave no audit row claiming it happened.
  begin
    perform public.order_transition(v_order, 'delivered', v_admin, 'illegal skip', null);
    perform pg_temp.assert(false, 'SEC-F5 an illegal edge must raise');
  exception when others then
    if sqlerrm not like 'INVALID_TRANSITION%' then raise; end if;
  end;
  select count(*) into v_audit from public.audit_log
    where entity_id = v_order and action = 'order.advance';
  perform pg_temp.assert(v_audit = 1, 'SEC-F5 a refused advance writes no audit row');

  -- THE REGRESSION THIS FIXES. placed -> cancelled: the pre-0091 edge function
  -- derived the before status from a lookup whose fallback returned
  -- "in_transit", so an order that never shipped was audited as though it had.
  insert into public.orders (user_id, subtotal, total, ship_to_line1, ship_to_city, ship_to_state, ship_to_pincode)
  values (v_member, 100, 100, '2 Test Road', 'Hyderabad', 'TS', '500001')
  returning id into v_cancel;
  perform public.order_transition(v_cancel, 'cancelled', v_admin, 'shopper changed their mind', null);
  perform pg_temp.assert(
    (select before ->> 'status' = 'placed'
     from public.audit_log where entity_id = v_cancel and action = 'order.advance'),
    'SEC-F5 placed -> cancelled audits a before of placed, not in_transit');
end;
$$;

-- ============================================================================
-- 0092 — blocking actually subtracts content, and only for the blocker
--
-- Every read below runs under `set local role authenticated`, because RLS does
-- not apply to the table owner. A version of this test without the role switch
-- passes vacuously, which is precisely the trap CLAUDE.md's third RLS incident
-- describes.
-- ============================================================================

create or replace function pg_temp.visible_clips(p_uid uuid, p_clip uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.act_as(p_uid);
  set local role authenticated;
  select count(*) into n from public.clips where id = p_clip;
  reset role;
  return n;
end;
$$;

do $$
declare
  v_a uuid := gen_random_uuid();   -- the member who blocks
  v_b uuid := gen_random_uuid();   -- the member being blocked
  v_c uuid := gen_random_uuid();   -- an uninvolved third member
  v_clip_b uuid;
  v_clip_c uuid;
  v_seen bigint;
begin
  insert into auth.users (id) values (v_a), (v_b), (v_c);
  insert into public.users (id, name) values
    (v_a, 'Blocker'), (v_b, 'Blocked'), (v_c, 'Bystander')
  on conflict (id) do update set name = excluded.name;

  insert into public.clips (owner_id, caption, sport, status)
    values (v_b, 'clip by b', 'cricket', 'published') returning id into v_clip_b;
  insert into public.clips (owner_id, caption, sport, status)
    values (v_c, 'clip by c', 'cricket', 'published') returning id into v_clip_c;
  insert into public.clip_comments (clip_id, user_id, text)
    values (v_clip_c, v_b, 'comment by b');

  perform pg_temp.assert(pg_temp.visible_clips(v_a, v_clip_b) = 1,
    '0092 before blocking, a published clip is visible');

  insert into public.user_blocks (blocker_id, blocked_id) values (v_a, v_b);

  -- THE POINT. These are unqualified selects with no client-side filter at all.
  -- If the subtraction depended on the caller remembering to add a filter, this
  -- would fail, which is why the policy is RESTRICTIVE rather than advice.
  perform pg_temp.assert(pg_temp.visible_clips(v_a, v_clip_b) = 0,
    '0092 a blocked member''s clip is gone from an unfiltered read');
  perform pg_temp.assert(pg_temp.visible_clips(v_a, v_clip_c) = 1,
    '0092 blocking one member does not hide anyone else');

  perform pg_temp.act_as(v_a);
  set local role authenticated;
  select count(*) into v_seen from public.clip_comments where clip_id = v_clip_c;
  reset role;
  perform pg_temp.assert(v_seen = 0, '0092 a blocked member''s comments are hidden too');

  -- One directional, and invisible to the blocked member.
  perform pg_temp.assert(pg_temp.visible_clips(v_b, v_clip_b) = 1,
    '0092 the blocked member still sees their own clip');
  perform pg_temp.act_as(v_b);
  set local role authenticated;
  select count(*) into v_seen from public.user_blocks;
  reset role;
  perform pg_temp.assert(v_seen = 0, '0092 a member cannot read who blocked them');

  -- A third party is untouched by someone else's block.
  perform pg_temp.assert(pg_temp.visible_clips(v_c, v_clip_b) = 1,
    '0092 one member''s block does not hide content from anyone else');

  delete from public.user_blocks where blocker_id = v_a and blocked_id = v_b;
  perform pg_temp.assert(pg_temp.visible_clips(v_a, v_clip_b) = 1,
    '0092 unblocking restores visibility');
end;
$$;

-- ============================================================================
-- 0093 — account deletion purges personal data and RETAINS the money record
-- ============================================================================

do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_order uuid;
  v_clip uuid;
begin
  insert into auth.users (id) values (v_user), (v_other);
  insert into public.users (id, name, phone, city, avatar_url)
    values (v_user, 'Real Name', '+919000000001', 'Hyderabad', 'https://example.test/a.png')
  on conflict (id) do update set name = excluded.name, phone = excluded.phone,
    city = excluded.city, avatar_url = excluded.avatar_url;
  insert into public.users (id, name) values (v_other, 'Someone Else')
  on conflict (id) do update set name = excluded.name;
  -- handle_new_user() already seeded the default 'player' role.

  insert into public.clips (owner_id, caption, sport, status)
    values (v_user, 'my clip', 'cricket', 'published') returning id into v_clip;
  insert into public.follows (follower_id, followee_id) values (v_user, v_other);
  insert into public.addresses (user_id, line1, city, state, pincode)
    values (v_user, '1 Road', 'Hyderabad', 'TS', '500001');
  insert into public.notifications (user_id, type, title, body, deep_link)
    values (v_user, 'order', 'hello', 'body', '/home');

  -- The money record. orders.user_id has NO on-delete action, which is exactly
  -- why a hard delete is impossible and this function exists.
  insert into public.orders (user_id, subtotal, total, ship_to_line1, ship_to_city, ship_to_state, ship_to_pincode)
    values (v_user, 500, 500, '1 Road', 'Hyderabad', 'TS', '500001')
    returning id into v_order;
  insert into public.payment_intents (user_id, domain, entity_id, razorpay_order_id, amount, status)
    values (v_user, 'commerce', v_order, 'order_test_del_1', 500, 'captured');

  perform pg_temp.act_as(v_user, array['player']);
  perform public.delete_my_account();

  -- Personal data is gone.
  perform pg_temp.assert((select count(*) from public.clips where owner_id = v_user) = 0,
    '0093 deletion purges clips');
  perform pg_temp.assert((select count(*) from public.follows where follower_id = v_user) = 0,
    '0093 deletion purges the social graph');
  perform pg_temp.assert((select count(*) from public.addresses where user_id = v_user) = 0,
    '0093 deletion purges addresses');
  perform pg_temp.assert((select count(*) from public.notifications where user_id = v_user) = 0,
    '0093 deletion purges notifications');
  perform pg_temp.assert((select count(*) from public.user_roles where user_id = v_user) = 0,
    '0093 deletion drops every role');

  -- The users row survives, anonymized, because the money rows point at it.
  perform pg_temp.assert(
    (select name = 'Deleted member' and phone is null and city is null
            and avatar_url is null and deleted_at is not null
     from public.users where id = v_user),
    '0093 the users row is anonymized, not removed');

  -- The financial record is intact and still linked.
  perform pg_temp.assert((select count(*) from public.orders where id = v_order) = 1,
    '0093 the order is RETAINED');
  perform pg_temp.assert(
    (select count(*) from public.payment_intents where entity_id = v_order) = 1,
    '0093 the payment intent is RETAINED');

  -- All three enforcement layers now refuse the account.
  perform pg_temp.assert(public.is_active_user() = false,
    '0093 is_active_user() is false for a deleted account');
  perform pg_temp.assert(
    (public.custom_access_token_hook(
       jsonb_build_object('user_id', v_user::text,
                          'claims', jsonb_build_object('app_metadata', '{}'::jsonb)))
     -> 'error' ->> 'http_code') = '403',
    '0093 the access token hook refuses a deleted account with 403');

  -- Idempotent: a retried request must not error.
  perform public.delete_my_account();
  perform pg_temp.assert(true, '0093 a second deletion call is a no-op');
end;
$$;

-- ============================================================================
-- 0095 / SEC-F9 — the spend ceiling actually counts, and it is per key
-- ============================================================================

do $$
declare
  v_key text := 'test:' || gen_random_uuid()::text;
  v_other text := 'test:' || gen_random_uuid()::text;
  v_allowed boolean;
begin
  -- Three requests against a limit of 3: all three pass.
  perform pg_temp.assert(public.rate_limit_hit(v_key, 3, 60), '0095 request 1 of 3 is allowed');
  perform pg_temp.assert(public.rate_limit_hit(v_key, 3, 60), '0095 request 2 of 3 is allowed');
  perform pg_temp.assert(public.rate_limit_hit(v_key, 3, 60), '0095 request 3 of 3 is allowed');

  -- The fourth is refused, and stays refused.
  v_allowed := public.rate_limit_hit(v_key, 3, 60);
  perform pg_temp.assert(not v_allowed, '0095 the request over the limit is refused');
  v_allowed := public.rate_limit_hit(v_key, 3, 60);
  perform pg_temp.assert(not v_allowed, '0095 it stays refused rather than resetting');

  -- A different key has its own budget: one caller cannot exhaust another's.
  perform pg_temp.assert(public.rate_limit_hit(v_other, 3, 60),
    '0095 a different key has an independent budget');

  -- THE PROPERTY THIS EXISTS FOR. The increment and the test are one
  -- statement, so the counter reflects every call, including the refused ones.
  -- A read-then-write limiter would let two concurrent callers both see the
  -- last free slot and both proceed.
  perform pg_temp.assert(
    (select count from public.rate_limit_counters where bucket_key = v_key) = 5,
    '0095 refused requests still increment, so a retry loop cannot outrun the counter');

  -- A window boundary starts a fresh budget rather than carrying the count.
  perform pg_temp.assert(
    (select count(distinct window_start) from public.rate_limit_counters
      where bucket_key = v_key) = 1,
    '0095 one window row per key per window');

  perform pg_temp.assert(public.prune_rate_limit_counters() = 0,
    '0095 pruning leaves counters inside the retention window alone');

  -- The prune is wired into the EXISTING sweep, not a second cron job. If a
  -- future edit to expire_stale_holds() drops the arm, this fails.
  perform pg_temp.assert(
    public.expire_stale_holds() ? 'rate_limit_rows_pruned',
    '0095 the cron sweep reports a rate limit arm');
end;
$$;

do $$ begin raise notice 'verify-security-fixes: all cases passed'; end $$;

rollback;
