-- 0093_account_deletion.sql
--
-- App Store guideline 5.1.1(v): an app that lets a member create an account
-- must let them delete it from inside the app. Nothing in this repo did.
--
-- WHY THIS IS NOT `auth.admin.deleteUser`. The obvious implementation is to
-- delete the auth identity and let `public.users.id references auth.users(id)
-- on delete cascade` take the rest. That does not work here, for two separate
-- reasons found by reading the FK graph rather than assuming it:
--
--   1. `orders.user_id` has NO on-delete action, i.e. NO ACTION. Deleting a
--      member who has ever placed an order raises a foreign key violation, so
--      the call simply fails for exactly the members most likely to ask.
--   2. Where it does succeed it is destructive to financial records:
--      `payment_intents.user_id` cascades, and `ledger_entries.payment_intent_id`
--      is `on delete set null`, so the intent row disappears and every ledger
--      row that referenced it is permanently orphaned. Gateway reconciliation
--      would never balance again, and `donations` cascades away with it.
--
-- So deletion here is: purge the personal data, retain the financial record,
-- and revoke access permanently. That is also what DPDP and Indian tax
-- retention actually require of us, and it is what the privacy policy must
-- say. See docs/qa/RELEASE-READINESS.md for the disclosure wording.
--
-- ENFORCEMENT IS NOT NEW CODE. 0090 already built three layers keyed on
-- account state: the access-token hook, `getAuthenticatedUser`, and the
-- RESTRICTIVE `is_active_user()` insert policies on twelve tables. Deletion
-- reuses all three by widening their predicate instead of adding a parallel
-- mechanism, so a deleted account inherits enforcement that already has tests.
--
-- `deleted_at` is a column rather than a `user_status` enum value on purpose:
-- `alter type ... add value` cannot be used in the same transaction that adds
-- it, which would force this into two migrations for no benefit.

alter table public.users
  add column deleted_at timestamptz;

comment on column public.users.deleted_at is
  'Set by delete_my_account(). Non-null means the member exercised their deletion right: personal data is purged and the row is anonymized, while money-bearing rows (orders, payment_intents, ledger_entries, donations) are deliberately retained. Access is refused by is_active_user(), custom_access_token_hook and getAuthenticatedUser.';

-- ============================================================================
-- 1. Widen the three existing enforcement layers.
-- ============================================================================

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.status <> 'suspended' and u.deleted_at is null
       from public.users u where u.id = (select auth.uid())),
    -- No users row: an anonymous/guest session, or a service context. Not
    -- suspended, so not this function's business to refuse.
    true
  );
$$;

comment on function public.is_active_user() is
  'SEC-F4 + 0093. False when the calling user is suspended OR has deleted their account. Used as a RESTRICTIVE policy predicate on client-writable tables. Reads the live row rather than a JWT claim so the refusal takes effect on the next request, not the next token refresh.';

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
  v_deleted timestamptz;
begin
  select u.status::text, u.deleted_at into v_status, v_deleted
    from public.users u
    where u.id = (event ->> 'user_id')::uuid;

  -- 0093. A deleted account must not be able to obtain or refresh a token.
  -- Checked before suspension so the member sees the accurate reason.
  if v_deleted is not null then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'This account has been deleted.'
      )
    );
  end if;

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
    to_jsonb(case when v_deleted is not null then 'deleted'
                  else coalesce(v_status, 'active') end)
  );
  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- ============================================================================
-- 2. delete_my_account()
--
-- SECURITY DEFINER because it must delete rows across tables whose RLS the
-- caller cannot satisfy for a bulk purge, and because the anonymization must
-- be atomic with the purge. It takes NO user id argument: the target is always
-- `auth.uid()`. That is deliberate and is the whole authorization model here.
-- An id parameter would make this an account-deletion weapon pointable at any
-- member by anyone who can call an RPC.
--
-- WHAT IS PURGED vs RETAINED
--
-- Purged (personal data, no legal basis to keep):
--   profile detail, avatar, contact, sports, social graph, all Clutch content,
--   chat, addresses, cart, wishlists, drafts, notifications, push tokens,
--   learn progress, coach profile, UPA application and its evidence.
--
-- Retained (financial and moderation records, anonymized by association):
--   orders + order_items + order_timeline, payment_intents, ledger_entries,
--   transfers, refunds, donations, court_bookings, sessions. These carry the
--   money history and are required for reconciliation, tax and dispute
--   handling. They now point at an anonymized users row, so they identify a
--   transaction rather than a person.
--
--   reports FILED BY this member are also retained. Deleting them would let an
--   abusive account erase the evidence against it by deleting itself, which is
--   the exact failure the report queue exists to prevent. `reporter_id` stays,
--   pointing at the anonymized row.
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  -- Idempotent: a second call is a no-op rather than an error, so a retried
  -- request after a dropped connection does not surface a failure to a member
  -- whose account is already gone.
  if exists (select 1 from public.users u where u.id = v_uid and u.deleted_at is not null) then
    return;
  end if;

  -- Clutch. clips cascades to its own likes and comments; the two deletes
  -- below cover this member's likes and comments on OTHER people's clips.
  delete from public.clips where owner_id = v_uid;
  delete from public.clip_likes where user_id = v_uid;
  delete from public.clip_comments where user_id = v_uid;
  delete from public.follows where follower_id = v_uid or followee_id = v_uid;
  delete from public.user_blocks where blocker_id = v_uid or blocked_id = v_uid;

  -- Messaging. chat_threads cascades its messages and members.
  delete from public.chat_messages where sender_id = v_uid;
  delete from public.chat_thread_members where user_id = v_uid;
  delete from public.chat_threads where participant_a = v_uid or participant_b = v_uid;

  -- Commerce state that is not a completed transaction.
  delete from public.cart_items where user_id = v_uid;
  delete from public.product_wishlist_items where user_id = v_uid;
  delete from public.order_drafts where user_id = v_uid;
  delete from public.donation_drafts where donor_id = v_uid;
  delete from public.addresses where user_id = v_uid;

  -- Notifications and device identifiers.
  delete from public.notifications where user_id = v_uid;
  delete from public.push_tokens where user_id = v_uid;
  delete from public.notification_prefs where user_id = v_uid;

  -- Learn progress and profile detail.
  delete from public.drill_completions where user_id = v_uid;
  delete from public.xp_events where user_id = v_uid;
  delete from public.user_milestones where user_id = v_uid;
  delete from public.athlete_sports where user_id = v_uid;

  -- Coach and UPA identity documents. Both parents cascade their children:
  -- coach_profiles -> coach_certificates (coach_id references coach_profiles
  -- (user_id)), and upa_applications -> upa_evidence + upa_wishlist_items.
  delete from public.coach_profiles where user_id = v_uid;
  delete from public.upa_applications where applicant_user_id = v_uid;

  -- Roles: a deleted account holds no privileges.
  delete from public.user_roles where user_id = v_uid;

  -- Anonymize what remains. The row must survive because orders.user_id has no
  -- on-delete action and the money tables reference it.
  update public.users
     set name = 'Deleted member',
         phone = null,
         dob = null,
         avatar_url = null,
         channel_name = null,
         city = null,
         state = null,
         sports = '{}',
         show_donor_name = false,
         deleted_at = now()
   where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'App Store 5.1.1(v) in-app account deletion. Purges personal data, retains money-bearing and moderation rows against an anonymized users row, and stamps deleted_at so all three 0090 enforcement layers refuse the account. Targets auth.uid() only, never a parameter.';
