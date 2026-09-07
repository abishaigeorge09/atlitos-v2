-- ATLITOS v2 — 0090_user_suspension_enforcement.sql
-- SEC-F4 (P1) + SEC-F5 (P1), security audit 2026-09-04.
--
-- SEC-F4, THE BUG. `users.status` has been an enum of 'active' / 'suspended'
-- since 0001, and `suspended_reason` beside it. 0065 then stopped a member
-- lifting their own suspension. What no migration ever added is anything that
-- READS the column. Grep the tree before this change and `'suspended'` appears
-- in exactly three places: the enum definition, the 0065 trigger that guards
-- the column, and unrelated Razorpay account-status strings. No RLS policy, no
-- edge function, no auth path consults it.
--
-- So suspension was a label, not a control. An admin could set a user to
-- suspended and that user would keep authenticating, keep booking, keep
-- posting, keep paying, indefinitely. PRD-04 FR-35..FR-38 requires suspension
-- to prevent authentication on the next request; nothing implemented it, and
-- there was no suspend/reinstate path to invoke in the first place (the admin
-- app's /users route is a read-only list, per PHASE-A-GAP-INVENTORY.md).
--
-- ENFORCEMENT IS LAYERED, because no single layer covers everything:
--
--   1. The access-token hook (below) refuses to mint claims for a suspended
--      user. That denies sign-in outright and denies the refresh, so an
--      existing session dies when its access token expires. This is the
--      widest net and the slowest: it is bounded by the access-token TTL.
--
--   2. `getAuthenticatedUser()` in _shared/supabase.ts refuses a suspended
--      caller on the spot. Every protected edge function routes through it,
--      which is every money path, every upload, every admin mutation, so
--      those close IMMEDIATELY on suspension rather than at the next refresh.
--      That is the layer that matters for the damage a suspended account can
--      still do inside its current token's lifetime.
--
--   3. `is_active_user()` plus the RESTRICTIVE policies below, for the tables
--      a client writes directly through PostgREST without an edge function in
--      front. Restrictive rather than rewriting each table's existing policy:
--      a restrictive policy ANDs with whatever permissive policy is already
--      there, so this adds a condition to twelve tables without reproducing
--      (and risking a mistake in) twelve existing predicates.
--
-- `support_tickets` is deliberately NOT in the restrictive list. A suspended
-- member must still be able to open a ticket to appeal the suspension; cutting
-- that off makes the suspension unappealable, which is a product failure, not
-- a security win.

-- ============================================================================
-- 1. is_active_user()
-- ============================================================================
--
-- A live read, in the shape of `is_guest()` (0001), rather than a JWT claim in
-- the shape of `has_role()`. The claim would be cheaper per row, but it is only
-- as fresh as the token: a member suspended thirty seconds ago would keep
-- writing until their access token expired, which is the exact hole this is
-- closing. Correctness beats the query here.
--
-- ponytail: one indexed lookup by primary key per policy evaluation. If this
-- shows up in a query plan, the upgrade is to read `app_metadata.user_status`
-- from the JWT (injected by the hook below) and accept the TTL-bounded
-- staleness, keeping the live read only on the edge-function layer.

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.status <> 'suspended' from public.users u where u.id = (select auth.uid())),
    -- No users row: an anonymous/guest session, or a service context. Not
    -- suspended, so not this function's business to refuse.
    true
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to anon, authenticated, service_role;

comment on function public.is_active_user() is
  'SEC-F4. False only when the calling user has users.status = suspended. Used as a RESTRICTIVE policy predicate on client-writable tables so a suspended member cannot create new content or bookings. Reads the live row rather than a JWT claim so a suspension takes effect on the next request, not the next token refresh.';

-- ============================================================================
-- 2. Access-token hook: deny suspended users a token
-- ============================================================================
--
-- Extends the 0001 hook rather than adding a second one; GoTrue supports one
-- access-token hook per project. Two changes: refuse outright for a suspended
-- user (Supabase's hook contract treats a returned `error` object as a denial,
-- so sign-in and refresh both fail), and inject `app_metadata.user_status`
-- beside `roles` for any future claim-based check.
--
-- The `search_path = ''` pin from 0064 is restated here: CREATE OR REPLACE
-- rewrites the function's config, so leaving it off would silently unpin the
-- search path on a SECURITY-relevant function. Every reference below is fully
-- schema-qualified accordingly.
--
-- REGISTRATION IS NOT SQL. This function only runs if it is registered under
-- Auth > Hooks > Customize Access Token Claims, which 0001's header already
-- notes is a dashboard step performed outside migrations. If the project's
-- registration was ever removed, layers 2 and 3 above still hold and this one
-- is simply inert; it fails open, which is why it is not the only layer.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  user_roles_arr jsonb;
  v_status text;
begin
  select u.status::text into v_status
    from public.users u
    where u.id = (event ->> 'user_id')::uuid;

  -- SEC-F4. Deny the token entirely. Returning an `error` object is the hook
  -- contract's refusal, and it applies to the refresh as well as the initial
  -- grant, so an already-issued session cannot outlive its access token.
  if v_status = 'suspended' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'This account is suspended. Contact support.'
      )
    );
  end if;

  select coalesce(jsonb_agg(ur.role), '[]'::jsonb)
    into user_roles_arr
    from public.user_roles ur
    where ur.user_id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{app_metadata,roles}', user_roles_arr);
  claims := jsonb_set(
    claims,
    '{app_metadata,user_status}',
    to_jsonb(coalesce(v_status, 'active'))
  );
  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- The hook runs as `supabase_auth_admin`, which had select on user_roles from
-- 0017 but nothing on `users`. Without this the new status lookup returns null
-- for every user and the suspension branch never fires: exactly the silent
-- failure 0017 was written to fix for roles.
grant select on public.users to supabase_auth_admin;

drop policy if exists users_auth_admin_select on public.users;
create policy users_auth_admin_select on public.users
  as permissive for select
  to supabase_auth_admin
  using (true);

-- ============================================================================
-- 3. Restrictive write guards on the direct-write tables
-- ============================================================================

do $$
declare
  v_table text;
  v_tables text[] := array[
    'clips',
    'clip_comments',
    'reports',
    'chat_threads',
    'chat_messages',
    'gratitude_posts',
    'upa_evidence',
    'upa_wishlist_items',
    'coach_trainee_notes',
    'coach_trainee_videos',
    'verification_requests',
    'addresses'
  ];
begin
  foreach v_table in array v_tables loop
    execute format(
      'drop policy if exists %I on public.%I',
      v_table || '_active_user_only', v_table
    );
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (public.is_active_user())',
      v_table || '_active_user_only', v_table
    );
  end loop;
end;
$$;

-- ============================================================================
-- 4. admin_suspend_user / admin_reinstate_user
-- ============================================================================
--
-- SEC-F4's missing operational path and SEC-F5's atomicity requirement in one
-- object. The audit's SEC-F5 finding is that a mutation and its audit row can
-- diverge because they are two separate round trips from an edge function: the
-- mutation commits, the audit insert fails, and the operator is left with a
-- 500 and no record of a change that actually happened. The fix shape it asks
-- for is "one SECURITY DEFINER transaction", which is what these are. The
-- users UPDATE, the audit_log row and the member's notification either all
-- commit or none do.
--
-- Both are idempotent on the terminal state: suspending an already-suspended
-- user, or reinstating an active one, is a no-op that writes NO audit row,
-- because an audit trail of non-events is a worse trail.

create or replace function public.admin_suspend_user(
  p_user_id uuid,
  p_reason text
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: a suspension reason is required';
  end if;

  -- An admin suspending themselves locks the operator out of the very tool
  -- they would need to undo it, and the token hook would deny their next
  -- refresh. Refuse rather than let it happen by mis-click.
  if p_user_id = auth.uid() then
    raise exception 'FORBIDDEN: an admin cannot suspend their own account';
  end if;

  select * into v_user from public.users where id = p_user_id for update;

  if v_user.id is null then
    raise exception 'NOT_FOUND: user % does not exist', p_user_id;
  end if;

  if v_user.status = 'suspended' then
    return v_user;
  end if;

  update public.users
  set status = 'suspended', suspended_reason = btrim(p_reason)
  where id = p_user_id
  returning * into v_user;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'user.suspend',
    'users',
    p_user_id,
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'suspended'),
    btrim(p_reason)
  );

  insert into public.notifications (user_id, type, title, body, deep_link)
  values (
    p_user_id,
    'support',
    'Your account is suspended',
    btrim(p_reason),
    '/settings'
  );

  return v_user;
end;
$$;

create or replace function public.admin_reinstate_user(
  p_user_id uuid,
  p_reason text default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users;
  v_before text;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select * into v_user from public.users where id = p_user_id for update;

  if v_user.id is null then
    raise exception 'NOT_FOUND: user % does not exist', p_user_id;
  end if;

  if v_user.status <> 'suspended' then
    return v_user;
  end if;

  v_before := v_user.suspended_reason;

  update public.users
  set status = 'active', suspended_reason = null
  where id = p_user_id
  returning * into v_user;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'user.reinstate',
    'users',
    p_user_id,
    jsonb_build_object('status', 'suspended', 'suspended_reason', v_before),
    jsonb_build_object('status', 'active'),
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  insert into public.notifications (user_id, type, title, body, deep_link)
  values (
    p_user_id,
    'support',
    'Your account is active again',
    'Your suspension was lifted. You can sign in and use Atlitos normally.',
    '/settings'
  );

  return v_user;
end;
$$;

revoke all on function public.admin_suspend_user(uuid, text) from public;
revoke execute on function public.admin_suspend_user(uuid, text) from anon;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated, service_role;

revoke all on function public.admin_reinstate_user(uuid, text) from public;
revoke execute on function public.admin_reinstate_user(uuid, text) from anon;
grant execute on function public.admin_reinstate_user(uuid, text) to authenticated, service_role;

comment on function public.admin_suspend_user(uuid, text) is
  'PRD-04 FR-35..FR-38, SEC-F4/SEC-F5. Admin-only. Suspends a member and writes the audit_log row and the member notification in the SAME transaction, so the record can never diverge from the mutation. Reason required. Idempotent: re-suspending writes nothing. Refuses self-suspension.';
comment on function public.admin_reinstate_user(uuid, text) is
  'PRD-04 FR-35..FR-38, SEC-F4/SEC-F5. Admin-only. Lifts a suspension and clears suspended_reason, with the audit row and notification in the same transaction. Idempotent on an already-active user.';
