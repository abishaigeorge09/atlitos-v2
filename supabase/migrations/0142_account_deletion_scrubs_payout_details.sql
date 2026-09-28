-- ATLITOS v2 - 0142_account_deletion_scrubs_payout_details.sql
--
-- Account deletion (0098) predates payout_methods (0132), so a coach or court
-- partner who deleted their account left their full bank account number, UPI
-- ID, PAN and account holder name behind in public.payout_methods. This file
-- redefines delete_my_account() with the IDENTICAL signature, security,
-- search_path and grants, keeps every existing step exactly as it was, and
-- adds two things.
--
-- ============================================================================
-- 1. Payout details are masked, never deleted
-- ============================================================================
-- Owner model (0132 _resolve_my_payout_owner): a coach's payout account is
-- (owner_type 'coach', owner_id = the coach's user id); a court partner's is
-- (owner_type 'court_partner', owner_id = a venue id) for every venue whose
-- partner_user_id is the caller. Both are scoped explicitly below, never by an
-- unscoped read.
--
-- The rows are NOT deleted. transfers.payout_account_id cascades off
-- payout_accounts, and the retained transfer and ledger history has to keep
-- saying where each payout went. So the row stays and only the identifying
-- detail goes:
--
--   account_number       every digit but the last four becomes X
--                        (123456789012 -> XXXXXXXX9012). Last four plus the
--                        IFSC is what reconciles a past payout against a bank
--                        statement, and is not enough to pay anyone.
--   ifsc                 KEPT. It identifies a bank branch, not a person.
--   vpa                  the part before @ becomes XXXX, the PSP handle is kept
--                        (riya.s@okicici -> XXXX@okicici). It cannot be nulled:
--                        the 0132 table check requires vpa on a 'upi' row, and
--                        loosening that check would weaken the live write path
--                        to protect a deleted one. XXXX@psp is the UPI
--                        equivalent of last four plus IFSC.
--   pan                  null (nullable, optional in 0132).
--   account_holder_name  'Deleted user'. It cannot be nulled: the 0132 column is
--                        NOT NULL with a 2 to 100 character check.
--   verification_status  'rejected', verified_by and verified_at cleared, and a
--                        note saying why. _record_payout_core refuses a manual
--                        payout unless the method is 'verified', so nothing can
--                        be paid to masked details. 'rejected' rather than
--                        'unverified' so the admin payouts list does not
--                        present the row as waiting for verification.
--
-- The masks are fixed points (masking a masked value returns it unchanged), so
-- the step is safe to run twice. The only trigger on payout_methods is
-- set_updated_at, which just stamps updated_at. payout_accounts, transfers and
-- ledger_entries are not written, and the in-transaction financial invariant
-- checks from 0098 still run after this step.
--
-- No audit_log row carries the scrubbed values: the account.deleted row gains
-- a payout_methods_masked COUNT only.
--
-- ============================================================================
-- 2. venue_photos rows for the caller's venues are deleted
-- ============================================================================
-- The delete-account edge function now removes the caller's venue-media
-- objects (path `{venue_id}/...`, 0014). The venue row itself is retained
-- (0098), and venue_photos rows naming removed objects would render as broken
-- images wherever the venue is still listed, so the rows go with the bytes.
-- venue_photos is not money bearing and nothing references it. The edge
-- function reads the paths BEFORE calling this function.

create or replace function public.delete_my_account()
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
  v_payout_methods_masked int := 0;
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

  -- 0142: photo rows for venues the caller owns. The delete-account edge
  -- function removes the venue-media objects they name, so the rows go too.
  -- Scoped by ownership, never by an unscoped venue read.
  delete from public.venue_photos vp
   using public.venues v
   where vp.venue_id = v.id
     and v.partner_user_id = v_uid;

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

  -- 0142: payout details. Masked in place, never deleted, because retained
  -- transfers hang off the payout account. See the file header for each
  -- column. Owned by the caller as a coach, or by a venue the caller is the
  -- partner on. payout_accounts, transfers and ledger_entries are not written.
  update public.payout_methods pm set
    account_holder_name = 'Deleted user',
    account_number      = case
      when pm.account_number is null then null
      else repeat('X', greatest(char_length(pm.account_number) - 4, 0))
           || right(pm.account_number, 4)
    end,
    vpa                 = case
      when pm.vpa is null then null
      when position('@' in pm.vpa) > 0 then 'XXXX@' || split_part(pm.vpa, '@', 2)
      else 'XXXX'
    end,
    pan                 = null,
    verification_status = 'rejected',
    verification_note   = 'Owner deleted their account. Details masked, payout history retained.',
    verified_by         = null,
    verified_at         = null
  from public.payout_accounts pa
  where pa.id = pm.payout_account_id
    and (
      (pa.owner_type = 'coach' and pa.owner_id = v_uid)
      or (
        pa.owner_type = 'court_partner'
        and pa.owner_id in (select v.id from public.venues v where v.partner_user_id = v_uid)
      )
    );
  get diagnostics v_payout_methods_masked = row_count;

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

  -- A count only. The masked or original payout values are never written here.
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after, note)
  values (v_uid, 'account.deleted', 'users', v_uid,
          jsonb_build_object('removed', v_removed, 'retained', v_retained,
                             'payout_methods_masked', v_payout_methods_masked),
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
  'Apple Guideline 5.1.1(v) in-app account deletion. Takes no user id: it can only delete its own caller. Deletes the caller personal data, anonymises rows a second party still reads, masks payout details to the last four digits plus IFSC (0142), and retains every financial record, asserting in-transaction that payment_intents, ledger_entries and ledger balance are unchanged.';

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
