-- ATLITOS v2 — 0098_account_deletion.sql
-- Apple App Store Guideline 5.1.1(v) / Google Play account deletion policy:
-- an account created in the app must be deletable FROM INSIDE the app.
-- The atlitos.com/delete-account page is a request-by-email mechanism and does
-- not satisfy either policy on its own.
--
-- ============================================================================
-- WHY THIS DOES NOT DELETE THE ROW
-- ============================================================================
-- public.users.id references auth.users ON DELETE CASCADE, and 45 foreign keys
-- point back at public.users. Replaying the full migration history on a local
-- Postgres and running `delete from auth.users where id = <athlete>` against a
-- fixture with three captured payment intents produced:
--
--   payment_intents   3 -> 0     every financial record destroyed
--   donations         1 -> 0     a receipt with tax consequences destroyed
--   sessions          1 -> 0     the coach's paid earning history destroyed
--   chat_messages     2 -> 0     including the coach's own message
--   ledger_entries    8 -> 8     but all 8 lost payment_intent_id (SET NULL)
--   ledger imbalance  0 -> 0     the ledger BALANCED through the whole disaster
--
-- The last two lines are the point. Sum(debits) = sum(credits) survived a total
-- loss of traceability, so "the ledger balances" is necessary but nowhere near
-- sufficient. The RESTRICT on donations -> payment_intents never fired, because
-- donations.donor_id CASCADE removed the donation first.
--
-- Therefore: deletion NEVER removes the public.users row or the FK graph under
-- it. The user's own row becomes their own tombstone. Because nothing is
-- deleted at the top of the graph, NO cascade fires at all, and every retained
-- row (payment intents, ledger entries, refunds, orders, donations, sessions,
-- court bookings, chat threads) keeps a live, resolvable author reference. That
-- is what "anonymise, do not orphan" means here.
--
-- ============================================================================
-- TABLE BY TABLE
-- ============================================================================
-- DELETED (the user's own data, no second party depends on it):
--   addresses, athlete_sports, cart_items, clip_likes, clip_saves, clips,
--   coach_certificates, coach_trainee_notes, coach_trainee_videos,
--   donation_drafts, drill_completions, follows (both directions),
--   notification_prefs, notifications, order_drafts, product_wishlist_items,
--   push_tokens, user_milestones, user_roles, xp_events,
--   blocked_users (rows where the deleting user is the blocker).
--
-- ANONYMISED (a second party still reads the row):
--   users            PII scrubbed in place, name becomes 'Deleted user'
--   coach_profiles   bio, coaching_style, specialization cleared; the ROW stays
--                    because sessions.coach_id and training_groups.coach_id are
--                    ON DELETE CASCADE off it
--   chat_messages    text kept (it is the other party's conversation too),
--                    author resolves to the tombstone
--   clip_comments    kept, so clips.comment_count stays truthful
--   donations        donor_display_name scrubbed. No amount, status, intent
--                    link or ledger row is touched
--   upa_applications status moved to 'deactivated' so it stops being listed
--   blocked_users    rows where the deleting user is the blocked party are kept,
--                    they belong to the other user's list
--
-- RETAINED UNTOUCHED (financial, legal, or another party's record):
--   payment_intents, ledger_entries, refunds, transfers, payout_accounts,
--   orders, order_items, order_timeline, order_feedback, stock_reservations,
--   sessions, session_participants, court_bookings, group_memberships,
--   venues, venue_staff, courts, audit_log, reports, verification_requests,
--   support_tickets, gratitude_posts, upa_evidence, upa_wishlist_items.
--   These are retained exactly as atlitos.com/privacy already discloses.
--
-- ============================================================================
-- WHAT MAKES THE ACCOUNT ACTUALLY GONE
-- ============================================================================
--   1. users.deleted_at is set, and is_actor_active() now requires it to be
--      null, so every restrictive suspension policy from 0096 refuses the
--      deleted user's next write platform wide.
--   2. Every user_roles row is revoked, so the next access token carries no
--      roles at all.
--   3. The account-deletion edge function, under the service role, releases the
--      email and phone on auth.users and bans the GoTrue user, so sign in is
--      impossible and the same email can register a fresh account.

-- ============================================================================
-- users.deleted_at
-- ============================================================================
-- Deliberately a nullable timestamp rather than a new public.user_status enum
-- value: `alter type ... add value` cannot be used in the same transaction that
-- reads it, and `supabase db push` wraps a migration in one transaction.

alter table public.users
  add column deleted_at timestamptz;

comment on column public.users.deleted_at is
  'Set by delete_my_account(). Non-null means the account is deleted: PII is scrubbed, roles are revoked, and is_actor_active() refuses every write. The row itself is retained as the tombstone that retained financial records resolve their author against.';

create index idx_users_deleted_at on public.users (deleted_at) where deleted_at is not null;

-- ============================================================================
-- account_deletions: the audit trail, and the idempotency record
-- ============================================================================

create table public.account_deletions (
  user_id uuid primary key references public.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  -- Counts of what was removed and what was retained, so a support question
  -- ("did my order survive?") is answerable without reconstructing the run.
  removed jsonb not null default '{}'::jsonb,
  retained jsonb not null default '{}'::jsonb,
  auth_released_at timestamptz
);

comment on table public.account_deletions is
  'One row per completed in-app account deletion (Apple Guideline 5.1.1(v)). Retained after the user row is tombstoned so the deletion itself is auditable. auth_released_at is stamped by the account-deletion edge function once GoTrue has released the email and banned the user.';

alter table public.account_deletions enable row level security;

-- The deleted user can still read their own receipt for the seconds between the
-- RPC returning and the client signing out. Admins read all. Nobody writes from
-- a client: every write is through the SECURITY DEFINER functions below.
create policy account_deletions_select_own on public.account_deletions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy account_deletions_select_admin on public.account_deletions
  for select to authenticated
  using (public.has_role('admin'));

-- ============================================================================
-- is_actor_active(): a deleted account is not active
-- ============================================================================
-- 0096 created restrictive `... _active_insert / _active_update / _active_delete`
-- policies calling this on every mutating table. Widening it here is what makes
-- a deleted user's still-valid access token harmless for the rest of its life.

create or replace function public.is_actor_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select status = 'active'::public.user_status and deleted_at is null
       from public.users where id = (select auth.uid())),
    true
  );
$$;

comment on function public.is_actor_active() is
  'FALSE when the caller is suspended (0096) or deleted (0098). Fails OPEN when there is no users row at all, so guests are never bricked.';

-- ============================================================================
-- coach_profiles_public: a deleted coach stops being discoverable
-- ============================================================================
-- The coach_profiles row must survive (sessions and training_groups cascade off
-- it), so discovery is filtered at the view instead.

create or replace view public.coach_profiles_public
with (security_invoker = false) as
select
  cp.user_id,
  cp.sport,
  cp.experience_years,
  cp.coaching_style,
  cp.specialization,
  cp.bio,
  cp.city,
  cp.state,
  cp.rating,
  cp.rating_count,
  cp.players_coached_count,
  cp.created_at
from public.coach_profiles cp
join public.users u on u.id = cp.user_id
where cp.status = 'verified'
  and u.deleted_at is null;

grant select on public.coach_profiles_public to anon, authenticated;

-- ============================================================================
-- account_deletion_preview(): what the confirmation screen is allowed to claim
-- ============================================================================
-- The client must not invent this copy. It reads the real counts, and the real
-- blockers, so the confirmation text is true for this specific account.

create function public.account_deletion_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean;
  v_other_admins int;
  v_in_flight int;
  v_future_sessions int;
  v_future_bookings int;
  v_blocker text := null;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: sign in required';
  end if;

  if exists (select 1 from public.account_deletions where user_id = v_uid) then
    return jsonb_build_object('already_deleted', true, 'blocker', null);
  end if;

  select exists (select 1 from public.user_roles where user_id = v_uid and role = 'admin')
    into v_is_admin;

  select count(*) into v_other_admins
    from public.user_roles ur
    join public.users u on u.id = ur.user_id
   where ur.role = 'admin' and ur.user_id <> v_uid and u.deleted_at is null;

  select count(*) into v_in_flight
    from public.payment_intents
   where user_id = v_uid and status in ('created', 'authorized');

  -- A coach the other side is still relying on, and a partner whose customers
  -- hold a slot. Both blockers are time bounded by the booking horizon.
  select count(*) into v_future_sessions
    from public.sessions
   where coach_id = v_uid
     and status in ('requested', 'accepted', 'in_progress')
     and date >= current_date;

  select count(*) into v_future_bookings
    from public.court_bookings cb
    join public.courts c on c.id = cb.court_id
    join public.venues v on v.id = c.venue_id
   where v.partner_user_id = v_uid
     and cb.status = 'confirmed'
     and cb.date >= current_date;

  if v_in_flight > 0 then
    v_blocker := 'PAYMENT_IN_FLIGHT';
  elsif v_is_admin and v_other_admins = 0 then
    v_blocker := 'LAST_ADMIN';
  elsif v_future_sessions > 0 then
    v_blocker := 'COACH_HAS_UPCOMING_SESSIONS';
  elsif v_future_bookings > 0 then
    v_blocker := 'PARTNER_HAS_UPCOMING_BOOKINGS';
  end if;

  return jsonb_build_object(
    'already_deleted', false,
    'blocker', v_blocker,
    'blocker_count', coalesce(
      nullif(v_in_flight, 0),
      case when v_blocker = 'COACH_HAS_UPCOMING_SESSIONS' then v_future_sessions
           when v_blocker = 'PARTNER_HAS_UPCOMING_BOOKINGS' then v_future_bookings
           else 0 end),
    'removed', jsonb_build_object(
      'clips',         (select count(*) from public.clips where owner_id = v_uid),
      'follows',       (select count(*) from public.follows where follower_id = v_uid or followee_id = v_uid),
      'addresses',     (select count(*) from public.addresses where user_id = v_uid),
      'saved_items',   (select count(*) from public.product_wishlist_items where user_id = v_uid)
                     + (select count(*) from public.clip_saves where user_id = v_uid),
      'cart_items',    (select count(*) from public.cart_items where user_id = v_uid)
    ),
    'retained', jsonb_build_object(
      'orders',          (select count(*) from public.orders where user_id = v_uid),
      'payments',        (select count(*) from public.payment_intents where user_id = v_uid),
      'donations',       (select count(*) from public.donations where donor_id = v_uid),
      'sessions',        (select count(*) from public.sessions where player_id = v_uid or coach_id = v_uid),
      'court_bookings',  (select count(*) from public.court_bookings where user_id = v_uid)
    )
  );
end;
$$;

comment on function public.account_deletion_preview() is
  'Read only. Returns the real removed/retained counts and any blocker for the CALLER only, so the in-app confirmation screen states facts rather than boilerplate.';

revoke all on function public.account_deletion_preview() from public, anon;
grant execute on function public.account_deletion_preview() to authenticated;

-- ============================================================================
-- delete_my_account(): the deletion itself
-- ============================================================================
-- SECURITY DEFINER and scoped hard to auth.uid(). There is no user id
-- parameter, by design: this function can only ever delete its own caller, so
-- no amount of client tampering reaches another account.

create function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_preview jsonb;
  v_blocker text;
  v_removed jsonb;
  v_retained jsonb;
  v_existing public.account_deletions;
  v_pi_before int;
  v_le_before int;
  v_le_orphan_before int;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: sign in required';
  end if;

  -- Idempotent. A user who already deleted, or whose client retried after a
  -- dropped response, gets the original receipt rather than an error.
  select * into v_existing from public.account_deletions where user_id = v_uid;
  if found then
    return jsonb_build_object(
      'status', 'already_deleted',
      'requested_at', v_existing.requested_at,
      'removed', v_existing.removed,
      'retained', v_existing.retained
    );
  end if;

  v_preview := public.account_deletion_preview();
  v_blocker := v_preview ->> 'blocker';
  if v_blocker is not null then
    raise exception 'DELETION_BLOCKED: %', v_blocker;
  end if;

  v_removed := v_preview -> 'removed';
  v_retained := v_preview -> 'retained';

  -- Financial invariant guard. Nothing below is allowed to change the number of
  -- payment intents, the number of ledger entries, or the number of ledger
  -- entries whose payment intent link is intact. Asserted after the writes.
  select count(*) into v_pi_before from public.payment_intents;
  select count(*) into v_le_before from public.ledger_entries;
  select count(*) into v_le_orphan_before from public.ledger_entries where payment_intent_id is null;

  -- --------------------------------------------------------------------
  -- 1. Delete the user's own data
  -- --------------------------------------------------------------------
  delete from public.push_tokens             where user_id = v_uid;
  delete from public.notifications           where user_id = v_uid;
  delete from public.notification_prefs      where user_id = v_uid;
  delete from public.cart_items              where user_id = v_uid;
  delete from public.product_wishlist_items  where user_id = v_uid;
  delete from public.clip_saves              where user_id = v_uid;
  delete from public.clip_likes              where user_id = v_uid;
  delete from public.addresses               where user_id = v_uid;
  delete from public.athlete_sports          where user_id = v_uid;
  delete from public.drill_completions       where user_id = v_uid;
  delete from public.user_milestones         where user_id = v_uid;
  delete from public.xp_events               where user_id = v_uid;
  delete from public.order_drafts            where user_id = v_uid;
  delete from public.donation_drafts         where donor_id = v_uid;
  delete from public.follows                 where follower_id = v_uid or followee_id = v_uid;
  delete from public.blocked_users           where blocker_id = v_uid;

  -- Videos of the user, and the coach's private notes about the user, are the
  -- user's personal data even though a coach uploaded them.
  delete from public.coach_trainee_videos    where player_id = v_uid;
  delete from public.coach_trainee_notes     where player_id = v_uid;

  -- Identity documents.
  delete from public.coach_certificates      where coach_id = v_uid;

  -- The user's own clips. clip_likes, clip_comments and clip_saves on them
  -- cascade, which is correct: the clip they belonged to is gone.
  delete from public.clips                   where owner_id = v_uid;

  -- Revoke every role. The next access token the custom_access_token_hook
  -- builds for this id carries an empty roles array.
  delete from public.user_roles              where user_id = v_uid;

  -- --------------------------------------------------------------------
  -- 2. Anonymise what a second party still reads
  -- --------------------------------------------------------------------
  -- ORDER MATTERS. The public.users scrub is deliberately the LAST write in
  -- this function, because setting deleted_at is what makes is_actor_active()
  -- return false, and 0096's restrictive `<table>_active_update` policies call
  -- it on every mutating table. This function is owned by `postgres`, which
  -- carries BYPASSRLS on Supabase, so those policies do not currently apply to
  -- it either way. Doing the scrub last means the function stays correct even
  -- if it is ever re-owned by a role without BYPASSRLS, instead of silently
  -- skipping the coach_profiles update (a table that really does carry two
  -- restrictive policies) and leaving a deleted coach's bio published.

  -- Coach profile row survives because sessions and training_groups cascade off
  -- it. Only the free text and the discoverable detail go.
  update public.coach_profiles set
    bio            = null,
    coaching_style = null,
    specialization = '{}'
  where user_id = v_uid;

  -- donor_display_name is a public display snapshot, not a money field. No
  -- amount, status, payment_intent_id or ledger row is touched anywhere here.
  update public.donations set
    donor_display_name = 'Deleted user'
  where donor_id = v_uid and donor_display_name is not null;

  -- Stop listing a deleted applicant's story. Donations already made against it
  -- are untouched.
  update public.upa_applications set
    status = 'deactivated'
  where applicant_user_id = v_uid and status <> 'deactivated';

  -- --------------------------------------------------------------------
  -- 3. Prove the financial invariant held, in the same transaction
  -- --------------------------------------------------------------------
  if (select count(*) from public.payment_intents) <> v_pi_before then
    raise exception 'FINANCIAL_INVARIANT: payment_intents count changed during account deletion';
  end if;

  if (select count(*) from public.ledger_entries) <> v_le_before then
    raise exception 'FINANCIAL_INVARIANT: ledger_entries count changed during account deletion';
  end if;

  if (select count(*) from public.ledger_entries where payment_intent_id is null) <> v_le_orphan_before then
    raise exception 'FINANCIAL_INVARIANT: ledger entries lost their payment intent link during account deletion';
  end if;

  if exists (
    select 1 from public.ledger_entries
    group by entry_group_id
    having coalesce(sum(amount) filter (where direction = 'debit'), 0)
        <> coalesce(sum(amount) filter (where direction = 'credit'), 0)
  ) then
    raise exception 'LEDGER_UNBALANCED: account deletion left an unbalanced entry group';
  end if;

  insert into public.account_deletions (user_id, removed, retained)
  values (v_uid, v_removed, v_retained);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, after, note)
  values (v_uid, 'account.deleted', 'users', v_uid,
          jsonb_build_object('removed', v_removed, 'retained', v_retained),
          'In app account deletion, Apple Guideline 5.1.1(v)');

  -- The scrub, last. This one statement is what anonymises chat_messages,
  -- clip_comments, sessions, court_bookings, group_memberships and orders: they
  -- all resolve their author through this row, and they all keep resolving,
  -- because the row is retained rather than deleted.
  update public.users set
    name               = 'Deleted user',
    phone              = null,
    dob                = null,
    avatar_url         = null,
    cover_url          = null,
    channel_name       = null,
    handle             = null,
    bio                = null,
    city               = null,
    state              = null,
    sports             = '{}',
    show_donor_name    = false,
    theme              = 'system',
    notification_prefs = '{"messages": false, "sessions": false, "promotions": false}'::jsonb,
    deleted_at         = now()
  where id = v_uid;

  return jsonb_build_object(
    'status', 'deleted',
    'requested_at', now(),
    'removed', v_removed,
    'retained', v_retained
  );
end;
$$;

comment on function public.delete_my_account() is
  'Apple Guideline 5.1.1(v) in-app account deletion. Takes no user id: it can only delete its own caller. Deletes the caller personal data, anonymises rows a second party still reads, and retains every financial record, asserting in-transaction that payment_intents, ledger_entries and ledger balance are unchanged.';

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ============================================================================
-- account_deletion_mark_auth_released(): called by the edge function only
-- ============================================================================

create function public.account_deletion_mark_auth_released(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.account_deletions
     set auth_released_at = now()
   where user_id = p_user_id;
end;
$$;

revoke all on function public.account_deletion_mark_auth_released(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_mark_auth_released(uuid) to service_role;
