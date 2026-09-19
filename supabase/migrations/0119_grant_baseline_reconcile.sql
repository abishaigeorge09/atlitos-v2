-- ATLITOS v2 — 0119_grant_baseline_reconcile.sql
-- Domain: privileges. Makes the repo reproduce PRODUCTION's table grants.
--
-- THE DEFECT. Until this migration, the database's privilege state lived
-- OUTSIDE version control. Production received Supabase's default privileges
-- (grant all on new tables in public to anon, authenticated, service_role) at
-- table creation time, and the migrations then revoked selectively from there.
-- A from scratch replay never receives those defaults, so it produced a
-- database with almost none of them.
--
-- Measured 2026-08-22, production vs a clean `supabase db reset`, counting
-- tables in `public` with each privilege:
--
--            SELECT (prod -> clean replay)
--   anon           56 -> 11
--   authenticated  69 -> 15
--   service_role   76 ->  5
--
-- Concretely, `authenticated` had NO select on users, sessions, venues, courts
-- or chat_messages after a clean replay. The app cannot read its own home
-- screen against such a database. Production is UNAFFECTED and always has
-- been: this is a reproducibility defect, not a live one.
--
-- WHY IT MATTERED ANYWAY. "The migrations replay from a clean checkout" was
-- true and still not enough, because replaying produced a database that was
-- not equivalent to production. Every preview branch, every disaster recovery
-- restore, and every local proof run inherited the divergence. The account
-- deletion proof suite is what surfaced it: its "the other party can still
-- read their history" assertions failed on missing grants rather than on
-- deletion behaviour.
--
-- WHAT THIS IS. The grant set BELOW WAS GENERATED FROM PRODUCTION, not
-- hand written, so applying it to production is a no op by construction. It
-- is deliberately idempotent: `grant` on an already granted privilege is a
-- no op in Postgres.
--
-- WHAT THIS IS NOT. It is not an endorsement of the grants it encodes. Two of
-- them are far too broad and are recorded as a security finding rather than
-- silently tightened here, because narrowing a privilege is a behaviour change
-- that needs its own migration and its own proof:
--
--   grant delete, insert, select, update on public.users      to anon;
--   grant delete, insert, select, update on public.user_roles to anon;
--
-- Those are Supabase defaults that no migration ever withdrew. Today only RLS
-- stands between an anonymous client and a role escalation write. The house
-- pattern established in 0010 and 0032 is to withdraw the verbs outright for
-- anything security bearing so that a future permissive policy cannot produce
-- a client write, and that pattern was applied to the money tables but never
-- to identity. See docs/DEBT.md and the follow up task.
--
-- Verification: after this migration a clean replay reports the same
-- per role SELECT counts as production (56 / 69 / 76), and the account
-- deletion suite's cross party read assertions pass.

grant delete, insert, select on public.blocked_users to authenticated;
grant delete, insert, select on public.clip_comments to authenticated;
grant delete, insert, select on public.clip_saves to authenticated;
grant delete, insert, select on public.coach_trainee_notes to authenticated;
grant delete, insert, select on public.coach_trainee_videos to authenticated;
grant delete, insert, select on public.upa_wishlist_items to authenticated;
grant delete, insert, select, update on public.addresses to anon;
grant delete, insert, select, update on public.addresses to authenticated;
grant delete, insert, select, update on public.addresses to service_role;
grant delete, insert, select, update on public.affiliate_products to service_role;
grant delete, insert, select, update on public.ai_spend_daily to service_role;
grant delete, insert, select, update on public.athlete_sports to anon;
grant delete, insert, select, update on public.athlete_sports to authenticated;
grant delete, insert, select, update on public.athlete_sports to service_role;
grant delete, insert, select, update on public.audit_log to anon;
grant delete, insert, select, update on public.audit_log to authenticated;
grant delete, insert, select, update on public.audit_log to service_role;
grant delete, insert, select, update on public.blocked_users to service_role;
grant delete, insert, select, update on public.cart_items to service_role;
grant delete, insert, select, update on public.categories to authenticated;
grant delete, insert, select, update on public.categories to service_role;
grant delete, insert, select, update on public.chat_messages to service_role;
grant delete, insert, select, update on public.chat_thread_members to service_role;
grant delete, insert, select, update on public.chat_threads to service_role;
grant delete, insert, select, update on public.clip_comments to service_role;
grant delete, insert, select, update on public.clip_likes to service_role;
grant delete, insert, select, update on public.clip_saves to service_role;
grant delete, insert, select, update on public.clips to service_role;
grant delete, insert, select, update on public.coach_availability_windows to anon;
grant delete, insert, select, update on public.coach_availability_windows to authenticated;
grant delete, insert, select, update on public.coach_availability_windows to service_role;
grant delete, insert, select, update on public.coach_certificates to anon;
grant delete, insert, select, update on public.coach_certificates to authenticated;
grant delete, insert, select, update on public.coach_certificates to service_role;
grant delete, insert, select, update on public.coach_profiles to anon;
grant delete, insert, select, update on public.coach_profiles to authenticated;
grant delete, insert, select, update on public.coach_profiles to service_role;
grant delete, insert, select, update on public.coach_trainee_notes to service_role;
grant delete, insert, select, update on public.coach_trainee_videos to service_role;
grant delete, insert, select, update on public.court_availability_windows to anon;
grant delete, insert, select, update on public.court_availability_windows to authenticated;
grant delete, insert, select, update on public.court_availability_windows to service_role;
grant delete, insert, select, update on public.court_blackouts to anon;
grant delete, insert, select, update on public.court_blackouts to authenticated;
grant delete, insert, select, update on public.court_blackouts to service_role;
grant delete, insert, select, update on public.court_bookings to service_role;
grant delete, insert, select, update on public.court_pricing_rules to anon;
grant delete, insert, select, update on public.court_pricing_rules to authenticated;
grant delete, insert, select, update on public.court_pricing_rules to service_role;
grant delete, insert, select, update on public.courts to anon;
grant delete, insert, select, update on public.courts to authenticated;
grant delete, insert, select, update on public.courts to service_role;
grant delete, insert, select, update on public.donation_drafts to service_role;
grant delete, insert, select, update on public.donations to service_role;
grant delete, insert, select, update on public.drill_completions to service_role;
grant delete, insert, select, update on public.drills to anon;
grant delete, insert, select, update on public.drills to authenticated;
grant delete, insert, select, update on public.drills to service_role;
grant delete, insert, select, update on public.edge_rate_limits to service_role;
grant delete, insert, select, update on public.feature_flags to anon;
grant delete, insert, select, update on public.feature_flags to authenticated;
grant delete, insert, select, update on public.feature_flags to service_role;
grant delete, insert, select, update on public.fee_config to anon;
grant delete, insert, select, update on public.fee_config to authenticated;
grant delete, insert, select, update on public.fee_config to service_role;
grant delete, insert, select, update on public.follows to service_role;
grant delete, insert, select, update on public.gratitude_posts to service_role;
grant delete, insert, select, update on public.group_memberships to service_role;
grant delete, insert, select, update on public.milestones to anon;
grant delete, insert, select, update on public.milestones to authenticated;
grant delete, insert, select, update on public.milestones to service_role;
grant delete, insert, select, update on public.notification_prefs to anon;
grant delete, insert, select, update on public.notification_prefs to authenticated;
grant delete, insert, select, update on public.notification_prefs to service_role;
grant delete, insert, select, update on public.notifications to anon;
grant delete, insert, select, update on public.notifications to authenticated;
grant delete, insert, select, update on public.notifications to service_role;
grant delete, insert, select, update on public.order_drafts to service_role;
grant delete, insert, select, update on public.order_feedback to service_role;
grant delete, insert, select, update on public.order_items to service_role;
grant delete, insert, select, update on public.order_timeline to service_role;
grant delete, insert, select, update on public.orders to service_role;
grant delete, insert, select, update on public.payment_intents to service_role;
grant delete, insert, select, update on public.payout_accounts to service_role;
grant delete, insert, select, update on public.product_media to authenticated;
grant delete, insert, select, update on public.product_media to service_role;
grant delete, insert, select, update on public.product_offers to service_role;
grant delete, insert, select, update on public.product_variants to authenticated;
grant delete, insert, select, update on public.product_variants to service_role;
grant delete, insert, select, update on public.product_wishlist_items to authenticated;
grant delete, insert, select, update on public.product_wishlist_items to service_role;
grant delete, insert, select, update on public.products to authenticated;
grant delete, insert, select, update on public.products to service_role;
grant delete, insert, select, update on public.promo_banners to service_role;
grant delete, insert, select, update on public.push_tokens to anon;
grant delete, insert, select, update on public.push_tokens to authenticated;
grant delete, insert, select, update on public.push_tokens to service_role;
grant delete, insert, select, update on public.refunds to service_role;
grant delete, insert, select, update on public.reports to service_role;
grant delete, insert, select, update on public.roadmap_stages to anon;
grant delete, insert, select, update on public.roadmap_stages to authenticated;
grant delete, insert, select, update on public.roadmap_stages to service_role;
grant delete, insert, select, update on public.session_participants to service_role;
grant delete, insert, select, update on public.session_types to anon;
grant delete, insert, select, update on public.session_types to authenticated;
grant delete, insert, select, update on public.session_types to service_role;
grant delete, insert, select, update on public.sessions to service_role;
grant delete, insert, select, update on public.stock_reservations to service_role;
grant delete, insert, select, update on public.support_tickets to anon;
grant delete, insert, select, update on public.support_tickets to authenticated;
grant delete, insert, select, update on public.support_tickets to service_role;
grant delete, insert, select, update on public.sweep_failures to service_role;
grant delete, insert, select, update on public.training_groups to service_role;
grant delete, insert, select, update on public.transfers to service_role;
grant delete, insert, select, update on public.upa_applications to service_role;
grant delete, insert, select, update on public.upa_evidence to service_role;
grant delete, insert, select, update on public.upa_wishlist_items to service_role;
grant delete, insert, select, update on public.user_milestones to service_role;
grant delete, insert, select, update on public.user_roles to anon;
grant delete, insert, select, update on public.user_roles to authenticated;
grant delete, insert, select, update on public.user_roles to service_role;
grant delete, insert, select, update on public.users to anon;
grant delete, insert, select, update on public.users to authenticated;
grant delete, insert, select, update on public.users to service_role;
grant delete, insert, select, update on public.venue_photos to anon;
grant delete, insert, select, update on public.venue_photos to authenticated;
grant delete, insert, select, update on public.venue_photos to service_role;
grant delete, insert, select, update on public.venue_staff to anon;
grant delete, insert, select, update on public.venue_staff to authenticated;
grant delete, insert, select, update on public.venue_staff to service_role;
grant delete, insert, select, update on public.venues to anon;
grant delete, insert, select, update on public.venues to authenticated;
grant delete, insert, select, update on public.venues to service_role;
grant delete, insert, select, update on public.verification_requests to anon;
grant delete, insert, select, update on public.verification_requests to authenticated;
grant delete, insert, select, update on public.verification_requests to service_role;
grant delete, insert, select, update on public.webhook_events to service_role;
grant delete, insert, select, update on public.xp_events to service_role;
grant delete, select on public.cart_items to authenticated;
grant insert, select on public.chat_messages to anon;
grant insert, select on public.chat_messages to authenticated;
grant insert, select on public.chat_threads to anon;
grant insert, select on public.chat_threads to authenticated;
grant insert, select on public.clips to authenticated;
grant insert, select on public.drill_completions to authenticated;
grant insert, select on public.gratitude_posts to authenticated;
grant insert, select on public.ledger_entries to service_role;
grant insert, select on public.order_feedback to authenticated;
grant insert, select on public.reports to authenticated;
grant insert, select on public.upa_evidence to authenticated;
grant select on public.affiliate_products to anon;
grant select on public.affiliate_products to authenticated;
grant select on public.categories to anon;
grant select on public.chat_thread_members to anon;
grant select on public.chat_thread_members to authenticated;
grant select on public.clip_comments to anon;
grant select on public.clip_likes to anon;
grant select on public.clip_likes to authenticated;
grant select on public.clips to anon;
grant select on public.coach_trainee_notes to anon;
grant select on public.court_bookings to anon;
grant select on public.court_bookings to authenticated;
grant select on public.donations to authenticated;
grant select on public.follows to anon;
grant select on public.follows to authenticated;
grant select on public.gratitude_posts to anon;
grant select on public.group_memberships to anon;
grant select on public.group_memberships to authenticated;
grant select on public.ledger_entries to anon;
grant select on public.ledger_entries to authenticated;
grant select on public.order_items to anon;
grant select on public.order_items to authenticated;
grant select on public.order_timeline to anon;
grant select on public.order_timeline to authenticated;
grant select on public.orders to anon;
grant select on public.orders to authenticated;
grant select on public.payment_intents to anon;
grant select on public.payment_intents to authenticated;
grant select on public.payout_accounts to anon;
grant select on public.payout_accounts to authenticated;
grant select on public.product_media to anon;
grant select on public.product_offers to anon;
grant select on public.product_offers to authenticated;
grant select on public.product_variants to anon;
grant select on public.products to anon;
grant select on public.promo_banners to anon;
grant select on public.promo_banners to authenticated;
grant select on public.refunds to authenticated;
grant select on public.session_participants to anon;
grant select on public.session_participants to authenticated;
grant select on public.sessions to anon;
grant select on public.sessions to authenticated;
grant select on public.training_groups to anon;
grant select on public.training_groups to authenticated;
grant select on public.transfers to anon;
grant select on public.transfers to authenticated;
grant select on public.upa_applications to anon;
grant select on public.upa_applications to authenticated;
grant select on public.upa_wishlist_items to anon;
grant select on public.user_milestones to authenticated;
grant select on public.xp_events to authenticated;
