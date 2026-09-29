-- ATLITOS: pre launch production clean up (launch runbook 6.3).
--
-- NOT A MIGRATION. A one off data fix, written by DEV, READ by a founder,
-- then run by that founder in the Supabase SQL editor for project
-- syzzfgaudpifwvbpycyi. Agents never run this (CLAUDE.md, DEBT.md 2026-08-11).
--
-- What it does, in one transaction:
--   1. Delists the seed affiliate products (active = false), but ONLY when at
--      least one non seed product is already active. Until real gear is
--      imported this step is a no op, so the shop is never emptied. No row is
--      deleted either way, so affiliate_clicks keep their target.
--   2. Hides the chat threads whose training group no longer exists: removes
--      their chat_thread_members rows so they drop out of every thread list.
--      The chat_threads row and every chat_messages row are KEPT.
--   3. Deletes the "RLS Matrix Probe Venue" rows left by the RLS matrix test:
--      status pending, zero courts, zero bookings, no ledger or payout link.
--      A venue that is verified, or has courts or bookings, is NEVER touched
--      (no delete, no status change). Those are listed as "founder decides".
--   4. Deletes fixture accounts that have NO money link of any kind. The
--      protection rules are listed in step 4 below and include indirect links
--      (a UPA application with donations or ledger rows, a coach whose
--      sessions or groups carry money, a venue with bookings, a payout
--      account). Protected accounts are listed with the reason.
--
-- Fail closed: before anything runs, every table and column the rules read
-- is checked in information_schema, and every foreign key into public.users,
-- auth.users and public.venues is checked against the list reviewed on
-- 2026-09-29. A missing column or an unreviewed foreign key aborts the run.
-- After the deletes, every money table row count is compared with its count
-- before; any change aborts the run.
--
-- HOW TO RUN
--   a. Run PART 0 on its own first. It only reads.
--   b. If anything in the candidate lists is a real person or a real venue,
--      add its id to the KEEP lists at the top of PART 1.
--   c. Run PART 1 as one script. It ends with ROLLBACK, so the first run is a
--      dry run. The SQL editor shows only the last result set, which is the
--      summary table just before the ROLLBACK: read every row of it.
--   d. COMMIT SWITCH: when the dry run summary is right, change the single
--      line `rollback;` at the very end of PART 1 to `commit;` and run PART 1
--      again. Change nothing else. Expected summary as of 2026-09-29: seed
--      delist skipped, 38 threads and 92 member rows, 6 probe venues deleted,
--      4 verified venues kept, 4 accounts deleted (3 UPA applications
--      cascade with them), 8 accounts protected, 1 admin skipped.

-- ===========================================================================
-- PART 0. Preview (read only)
-- ===========================================================================

-- 0.1 Seed delist gate: seed products are delisted only if non_seed_active >= 1.
select count(*) filter (where id::text like 'a0000000-0000-0000-0000-%' or title ilike 'Seed Shop %') as seed_active,
       count(*) filter (where not (id::text like 'a0000000-0000-0000-0000-%' or title ilike 'Seed Shop %')) as non_seed_active
  from public.affiliate_products
 where active;

-- 0.2 Group threads whose group is gone. Runbook expects 38 threads, 92 members.
select count(*) as orphaned_group_threads,
       (select count(*) from public.chat_thread_members m
         where exists (select 1 from public.chat_threads t
                        where t.id = m.thread_id
                          and t.context_type = 'group'
                          and not exists (select 1 from public.training_groups g where g.id = t.context_id))) as member_rows_to_remove
  from public.chat_threads t
 where t.context_type = 'group'
   and not exists (select 1 from public.training_groups g where g.id = t.context_id);

-- 0.3 Every venue, with what hangs off it. Only pending probe venues with no
--     courts and no bookings will be deleted.
select v.id, v.name, v.status, u.email as partner_email,
       (select count(*) from public.courts c where c.venue_id = v.id) as courts,
       (select count(*) from public.courts c join public.court_bookings b on b.court_id = c.id where c.venue_id = v.id) as bookings
  from public.venues v
  left join auth.users u on u.id = v.partner_user_id
 order by v.status, v.name;

-- 0.4 Fixture account candidates. Seed and e2e addresses only.
select u.id, u.email, u.created_at
  from auth.users u
 where u.email ilike '%@atlitos.dev'
    or u.email ilike 'e2e.%'
    or u.email ilike '%@example.com'
 order by u.created_at;

-- ===========================================================================
-- PART 1. The clean up (one transaction; dry run until ROLLBACK is changed)
-- ===========================================================================

begin;

-- Ids a person has decided to keep even though they match a fixture pattern.
create temp table keep_user_ids (id uuid primary key) on commit drop;
create temp table keep_venue_ids (id uuid primary key) on commit drop;
-- insert into keep_user_ids values ('00000000-0000-0000-0000-000000000000');
-- insert into keep_venue_ids values ('00000000-0000-0000-0000-000000000000');

-- Everything the summary reports is collected here.
create temp table cleanup_log (ord int, section text, item text, value text) on commit drop;

-- ---------------------------------------------------------------------------
-- 0. Guards (fail closed)
-- ---------------------------------------------------------------------------

-- 0a. Every column a rule below reads must exist. A renamed column would make
--     an EXISTS check silently match nothing, so a missing one aborts.
create temp table required_columns (tbl text, col text) on commit drop;
insert into required_columns values
  ('auth.users', 'id'), ('auth.users', 'email'),
  ('public.users', 'id'),
  ('public.user_roles', 'user_id'), ('public.user_roles', 'role'),
  ('public.affiliate_products', 'id'), ('public.affiliate_products', 'title'),
  ('public.affiliate_products', 'active'), ('public.affiliate_products', 'updated_at'),
  ('public.chat_threads', 'id'), ('public.chat_threads', 'context_type'), ('public.chat_threads', 'context_id'),
  ('public.chat_thread_members', 'thread_id'), ('public.chat_thread_members', 'user_id'),
  ('public.chat_messages', 'thread_id'),
  ('public.training_groups', 'id'), ('public.training_groups', 'coach_id'),
  ('public.venues', 'id'), ('public.venues', 'name'), ('public.venues', 'status'), ('public.venues', 'partner_user_id'),
  ('public.courts', 'id'), ('public.courts', 'venue_id'),
  ('public.court_bookings', 'court_id'), ('public.court_bookings', 'user_id'), ('public.court_bookings', 'created_by_staff_id'),
  ('public.payment_intents', 'user_id'), ('public.payment_intents', 'entity_id'),
  ('public.ledger_entries', 'account_ref'), ('public.ledger_entries', 'entity_id'),
  ('public.ledger_entries', 'direction'), ('public.ledger_entries', 'amount'),
  ('public.transfers', 'created_by'), ('public.transfers', 'payout_account_id'),
  ('public.donations', 'donor_id'), ('public.donations', 'upa_id'), ('public.donations', 'item_id'),
  ('public.orders', 'user_id'),
  ('public.order_timeline', 'actor_id'),
  ('public.sessions', 'player_id'), ('public.sessions', 'coach_id'),
  ('public.session_participants', 'player_id'),
  ('public.group_memberships', 'player_id'), ('public.group_memberships', 'group_id'),
  ('public.payout_accounts', 'id'), ('public.payout_accounts', 'owner_id'),
  ('public.payout_methods', 'payout_account_id'), ('public.payout_methods', 'verified_by'),
  ('public.upa_applications', 'id'), ('public.upa_applications', 'applicant_user_id'),
  ('public.upa_wishlist_items', 'id'), ('public.upa_wishlist_items', 'upa_id'),
  ('public.refunds', 'payment_intent_id');

do $$
declare missing text;
begin
  select string_agg(rc.tbl || '.' || rc.col, ', ') into missing
    from required_columns rc
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = split_part(rc.tbl, '.', 1)
        and c.table_name = split_part(rc.tbl, '.', 2)
        and c.column_name = rc.col);
  if missing is not null then
    raise exception 'required columns missing, nothing changed: %', missing;
  end if;
end $$;

-- 0b. Every foreign key into public.users, auth.users and public.venues must
--     be one reviewed on 2026-09-29. A new table that points at a user could
--     carry money the rules below do not know about, so an unreviewed one
--     aborts the run. (auth schema internals are excluded; they cascade.)
create temp table reviewed_fks (fk text primary key) on commit drop;
insert into reviewed_fks values
  ('public.users.id'), ('public.affiliate_clicks.user_id'), ('public.account_deletions.user_id'),
  ('public.addresses.user_id'), ('public.apple_sign_in_tokens.user_id'), ('public.athlete_sports.user_id'),
  ('public.audit_log.actor_id'),
  ('public.blocked_users.blocked_id'), ('public.blocked_users.blocker_id'), ('public.cart_items.user_id'),
  ('public.chat_messages.sender_id'), ('public.chat_thread_members.user_id'),
  ('public.chat_threads.participant_a'), ('public.chat_threads.participant_b'),
  ('public.clip_comments.user_id'), ('public.clip_likes.user_id'), ('public.clip_saves.user_id'),
  ('public.clips.owner_id'), ('public.coach_profiles.user_id'),
  ('public.coach_trainee_notes.player_id'), ('public.coach_trainee_videos.player_id'),
  ('public.court_bookings.created_by_staff_id'), ('public.court_bookings.user_id'),
  ('public.donation_drafts.donor_id'), ('public.donations.donor_id'), ('public.drill_completions.user_id'),
  ('public.follows.followee_id'), ('public.follows.follower_id'), ('public.group_memberships.player_id'),
  ('public.notification_prefs.user_id'), ('public.notifications.user_id'), ('public.order_drafts.user_id'),
  ('public.order_timeline.actor_id'), ('public.orders.user_id'), ('public.payment_intents.user_id'),
  ('public.payout_methods.verified_by'), ('public.product_wishlist_items.user_id'),
  ('public.push_tokens.user_id'), ('public.reports.resolved_by'), ('public.reports.reporter_id'),
  ('public.session_participants.player_id'), ('public.sessions.player_id'),
  ('public.support_tickets.submitter_id'), ('public.transfers.created_by'),
  ('public.upa_applications.applicant_user_id'), ('public.user_milestones.user_id'),
  ('public.user_roles.user_id'), ('public.venue_staff.user_id'), ('public.venues.partner_user_id'),
  ('public.verification_requests.reviewer_id'), ('public.xp_events.user_id'),
  ('public.courts.venue_id'), ('public.venue_photos.venue_id'), ('public.venue_staff.venue_id');

do $$
declare unreviewed text;
begin
  select string_agg(x.fk, ', ') into unreviewed
    from (
      select format('%s.%s.%s', sn.nspname, sc.relname, a.attname) as fk
        from pg_constraint c
        join pg_class sc on sc.oid = c.conrelid
        join pg_namespace sn on sn.oid = sc.relnamespace
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.contype = 'f'
         and sn.nspname not in ('auth', 'storage', 'realtime', 'supabase_functions', 'extensions', 'vault', 'graphql', 'net', 'pgsodium')
         and c.confrelid in ('public.users'::regclass, 'auth.users'::regclass, 'public.venues'::regclass)
    ) x
   where not exists (select 1 from reviewed_fks r where r.fk = x.fk);
  if unreviewed is not null then
    raise exception 'unreviewed foreign keys into users or venues, nothing changed: %', unreviewed;
  end if;
end $$;

-- 0c. Money table row counts before. Compared again at the end.
create temp table money_counts (tbl text primary key, before bigint, after bigint) on commit drop;
insert into money_counts (tbl, before) values
  ('payment_intents',      (select count(*) from public.payment_intents)),
  ('ledger_entries',       (select count(*) from public.ledger_entries)),
  ('refunds',              (select count(*) from public.refunds)),
  ('transfers',            (select count(*) from public.transfers)),
  ('payout_accounts',      (select count(*) from public.payout_accounts)),
  ('payout_methods',       (select count(*) from public.payout_methods)),
  ('donations',            (select count(*) from public.donations)),
  ('donations_with_upa',   (select count(*) from public.donations where upa_id is not null)),
  ('donations_with_item',  (select count(*) from public.donations where item_id is not null)),
  ('orders',               (select count(*) from public.orders)),
  ('court_bookings',       (select count(*) from public.court_bookings)),
  ('sessions',             (select count(*) from public.sessions)),
  ('group_memberships',    (select count(*) from public.group_memberships));

create temp table row_counts (tbl text primary key, before bigint, after bigint) on commit drop;
insert into row_counts (tbl, before) values
  ('auth.users',                 (select count(*) from auth.users)),
  ('public.users',               (select count(*) from public.users)),
  ('public.venues',              (select count(*) from public.venues)),
  ('public.upa_applications',    (select count(*) from public.upa_applications)),
  ('public.chat_thread_members', (select count(*) from public.chat_thread_members)),
  ('public.affiliate_products active', (select count(*) from public.affiliate_products where active));

-- ---------------------------------------------------------------------------
-- 1. Delist seed affiliate products, gated
-- ---------------------------------------------------------------------------
do $$
declare n_non_seed int; n int := 0;
begin
  select count(*) into n_non_seed
    from public.affiliate_products p
   where p.active
     and not (p.id::text like 'a0000000-0000-0000-0000-%' or p.title ilike 'Seed Shop %');

  if n_non_seed >= 1 then
    update public.affiliate_products
       set active = false, updated_at = now()
     where active
       and (id::text like 'a0000000-0000-0000-0000-%' or title ilike 'Seed Shop %');
    get diagnostics n = row_count;
    insert into cleanup_log values
      (10, '1 seed products', 'branch', 'DELISTED (' || n_non_seed || ' non seed products active)'),
      (11, '1 seed products', 'seed products delisted', n::text);
  else
    insert into cleanup_log values
      (10, '1 seed products', 'branch', 'SKIPPED, no non seed product is active, delisting would empty the shop'),
      (11, '1 seed products', 'seed products delisted', '0');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Hide orphaned group threads (threads and messages kept)
-- ---------------------------------------------------------------------------
create temp table orphan_threads on commit drop as
select t.id
  from public.chat_threads t
 where t.context_type = 'group'
   and not exists (select 1 from public.training_groups g where g.id = t.context_id);

do $$
declare n_threads int; n_members int; n_msgs int;
begin
  select count(*) into n_threads from orphan_threads;
  -- The runbook counted 38 on 2026-09-29. A very different number means the
  -- data moved since the audit; stop and look rather than guess.
  if n_threads > 60 then
    raise exception 'expected about 38 orphaned group threads, found %. Stop and review.', n_threads;
  end if;
  select count(*) into n_msgs
    from public.chat_messages cm
   where exists (select 1 from orphan_threads o where o.id = cm.thread_id);

  delete from public.chat_thread_members m
   where exists (select 1 from orphan_threads o where o.id = m.thread_id);
  get diagnostics n_members = row_count;

  insert into cleanup_log values
    (20, '2 orphan threads', 'threads hidden (kept)', n_threads::text),
    (21, '2 orphan threads', 'member rows removed', n_members::text),
    (22, '2 orphan threads', 'messages in them (kept)', n_msgs::text);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Probe venues. Never an update; only a delete of rows with nothing on them.
-- ---------------------------------------------------------------------------
create temp table doomed_venues on commit drop as
select v.id, v.name
  from public.venues v
 where v.status = 'pending'
   and v.name like 'RLS Matrix Probe Venue %'
   and exists (select 1 from auth.users u
                where u.id = v.partner_user_id
                  and (u.email ilike '%@atlitos.dev' or u.email ilike 'e2e.%' or u.email ilike '%@example.com'))
   and not exists (select 1 from keep_venue_ids k where k.id = v.id)
   and not exists (select 1 from public.courts c where c.venue_id = v.id)
   and not exists (select 1 from public.ledger_entries le where le.account_ref = v.id or le.entity_id = v.id)
   and not exists (select 1 from public.payment_intents p where p.entity_id = v.id)
   and not exists (select 1 from public.payout_accounts pa where pa.owner_id = v.id);

do $$
declare n int;
begin
  -- Belt and braces: the predicate above cannot pick these, but if it ever
  -- did, abort rather than delete a live venue.
  if exists (select 1 from doomed_venues d join public.venues v on v.id = d.id where v.status <> 'pending')
     or exists (select 1 from doomed_venues d join public.courts c on c.venue_id = d.id) then
    raise exception 'a doomed venue is not pending or has courts. Stop and review.';
  end if;
  if (select count(*) from doomed_venues) > 6 then
    raise exception 'expected at most 6 probe venues, found %. Stop and review.', (select count(*) from doomed_venues);
  end if;

  delete from public.venues v where exists (select 1 from doomed_venues d where d.id = v.id);
  get diagnostics n = row_count;
  insert into cleanup_log values (30, '3 venues', 'probe venues deleted', n::text);
end $$;

insert into cleanup_log
select 31, '3 venues', 'KEPT, founder decides: ' || v.name,
       v.status || ', ' ||
       (select count(*) from public.courts c join public.court_bookings b on b.court_id = c.id where c.venue_id = v.id) || ' bookings'
  from public.venues v
 where v.status = 'verified'
   and exists (select 1 from auth.users u
                where u.id = v.partner_user_id
                  and (u.email ilike '%@atlitos.dev' or u.email ilike 'e2e.%' or u.email ilike '%@example.com'));

-- ---------------------------------------------------------------------------
-- 4. Fixture accounts with no money link of any kind
-- ---------------------------------------------------------------------------
create temp table fixture_users on commit drop as
select u.id, u.email
  from auth.users u
 where (u.email ilike '%@atlitos.dev' or u.email ilike 'e2e.%' or u.email ilike '%@example.com')
   and not exists (select 1 from keep_user_ids k where k.id = u.id)
   -- Never an admin, whatever the address says.
   and not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin');

-- One row per (user, reason). Any row protects the user.
create temp table user_protection (user_id uuid, reason text) on commit drop;
insert into user_protection (user_id, reason)
select f.id, r.reason
  from fixture_users f
 cross join lateral (values
   -- Direct money references.
   ('payment_intents',        exists (select 1 from public.payment_intents x where x.user_id = f.id)),
   ('ledger_entries',         exists (select 1 from public.ledger_entries x where x.account_ref = f.id or x.entity_id = f.id)),
   ('transfers',              exists (select 1 from public.transfers x where x.created_by = f.id)),
   ('donations as donor',     exists (select 1 from public.donations x where x.donor_id = f.id)),
   ('orders',                 exists (select 1 from public.orders x where x.user_id = f.id)),
   ('order_timeline',         exists (select 1 from public.order_timeline x where x.actor_id = f.id)),
   ('court_bookings',         exists (select 1 from public.court_bookings x where x.user_id = f.id or x.created_by_staff_id = f.id)),
   ('sessions as player',     exists (select 1 from public.sessions x where x.player_id = f.id)),
   ('session_participants',   exists (select 1 from public.session_participants x where x.player_id = f.id)),
   ('group_memberships',      exists (select 1 from public.group_memberships x where x.player_id = f.id)),
   -- Payouts. payout_accounts.owner_id is polymorphic (owner_type): a coach
   -- user id, or a venue id for a court partner. Both are checked.
   ('payout_accounts',        exists (select 1 from public.payout_accounts pa
                                        where pa.owner_id = f.id
                                           or exists (select 1 from public.venues v where v.id = pa.owner_id and v.partner_user_id = f.id))),
   ('payout_methods',         exists (select 1 from public.payout_methods pm
                                        join public.payout_accounts pa on pa.id = pm.payout_account_id
                                        where pa.owner_id = f.id
                                           or exists (select 1 from public.venues v where v.id = pa.owner_id and v.partner_user_id = f.id))
                              or exists (select 1 from public.payout_methods pm where pm.verified_by = f.id)),
   -- UPA. ledger_entries.account_ref holds the application id for upa_fund
   -- rows; donations.upa_id and item_id are ON DELETE SET NULL, so deleting
   -- the applicant would silently unlink real donations.
   ('upa application with money', exists (
       select 1 from public.upa_applications a
        where a.applicant_user_id = f.id
          and (exists (select 1 from public.donations d where d.upa_id = a.id)
               or exists (select 1 from public.donations d
                            join public.upa_wishlist_items w on w.id = d.item_id
                           where w.upa_id = a.id)
               or exists (select 1 from public.ledger_entries le where le.account_ref = a.id or le.entity_id = a.id)
               or exists (select 1 from public.payment_intents p where p.entity_id = a.id)))),
   -- Coach. coach_profiles cascades to sessions and training_groups.
   ('coach sessions',         exists (select 1 from public.sessions s where s.coach_id = f.id)),
   ('coach groups with money', exists (
       select 1 from public.training_groups g
        where g.coach_id = f.id
          and (exists (select 1 from public.group_memberships m where m.group_id = g.id)
               or exists (select 1 from public.payment_intents p where p.entity_id = g.id)
               or exists (select 1 from public.ledger_entries le where le.entity_id = g.id)))),
   -- Venues. venues.partner_user_id cascades, so the owner of any venue that
   -- stays must stay too; a venue with bookings is money by itself.
   ('venue with bookings',    exists (select 1 from public.venues v
                                        join public.courts c on c.venue_id = v.id
                                        join public.court_bookings b on b.court_id = c.id
                                       where v.partner_user_id = f.id)),
   ('venue ledger',           exists (select 1 from public.venues v
                                        join public.ledger_entries le on le.account_ref = v.id
                                       where v.partner_user_id = f.id)),
   ('owns a venue that stays', exists (select 1 from public.venues v where v.partner_user_id = f.id))
 ) as r(reason, hit)
 where r.hit;

do $$
declare n int;
begin
  delete from auth.users u
   where exists (select 1 from fixture_users f where f.id = u.id)
     and not exists (select 1 from user_protection p where p.user_id = u.id);
  get diagnostics n = row_count;
  insert into cleanup_log values (40, '4 accounts', 'fixture accounts deleted', n::text);
end $$;

insert into cleanup_log
select 41, '4 accounts', 'deleted: ' || left(f.email, 5) || '***@' || split_part(f.email, '@', 2), ''
  from fixture_users f
 where not exists (select 1 from user_protection p where p.user_id = f.id);

insert into cleanup_log
select 42, '4 accounts', 'PROTECTED: ' || left(f.email, 5) || '***@' || split_part(f.email, '@', 2),
       string_agg(p.reason, ', ' order by p.reason)
  from fixture_users f
  join user_protection p on p.user_id = f.id
 group by f.email;

insert into cleanup_log
select 43, '4 accounts', 'admins skipped by rule', count(*)::text
  from auth.users u
 where (u.email ilike '%@atlitos.dev' or u.email ilike 'e2e.%' or u.email ilike '%@example.com')
   and exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin');

-- ---------------------------------------------------------------------------
-- 5. Verify. Money rows must be untouched; abort otherwise.
-- ---------------------------------------------------------------------------
update money_counts set after = case tbl
  when 'payment_intents'     then (select count(*) from public.payment_intents)
  when 'ledger_entries'      then (select count(*) from public.ledger_entries)
  when 'refunds'             then (select count(*) from public.refunds)
  when 'transfers'           then (select count(*) from public.transfers)
  when 'payout_accounts'     then (select count(*) from public.payout_accounts)
  when 'payout_methods'      then (select count(*) from public.payout_methods)
  when 'donations'           then (select count(*) from public.donations)
  when 'donations_with_upa'  then (select count(*) from public.donations where upa_id is not null)
  when 'donations_with_item' then (select count(*) from public.donations where item_id is not null)
  when 'orders'              then (select count(*) from public.orders)
  when 'court_bookings'      then (select count(*) from public.court_bookings)
  when 'sessions'            then (select count(*) from public.sessions)
  when 'group_memberships'   then (select count(*) from public.group_memberships)
end;

update row_counts set after = case tbl
  when 'auth.users'                 then (select count(*) from auth.users)
  when 'public.users'               then (select count(*) from public.users)
  when 'public.venues'              then (select count(*) from public.venues)
  when 'public.upa_applications'    then (select count(*) from public.upa_applications)
  when 'public.chat_thread_members' then (select count(*) from public.chat_thread_members)
  when 'public.affiliate_products active' then (select count(*) from public.affiliate_products where active)
end;

do $$
declare changed text; d numeric; c numeric;
begin
  select string_agg(tbl || ' ' || before || ' to ' || after, ', ') into changed
    from money_counts where after is distinct from before;
  if changed is not null then
    raise exception 'money rows changed, rolled back: %', changed;
  end if;
  select coalesce(sum(amount) filter (where direction = 'debit'), 0),
         coalesce(sum(amount) filter (where direction = 'credit'), 0)
    into d, c from public.ledger_entries;
  if d <> c then
    raise exception 'ledger does not balance after clean up: debits % credits %', d, c;
  end if;
end $$;

insert into cleanup_log
select 50, '5 row counts', tbl, before || ' to ' || after || ' (' || (after - before) || ')'
  from row_counts;
insert into cleanup_log
select 51, '5 money rows unchanged', string_agg(tbl, ', ' order by tbl), 'ok'
  from money_counts;
insert into cleanup_log
select 52, '5 invariants', 'payment intents without user',
       (select count(*) from public.payment_intents pi
         where pi.user_id is not null
           and not exists (select 1 from public.users u where u.id = pi.user_id))::text;

-- The summary. The SQL editor shows this last result set.
select section, item, value from cleanup_log order by ord, item;

-- COMMIT SWITCH: dry run by default. Change this one line to `commit;` only
-- after reading the summary above.
rollback;
