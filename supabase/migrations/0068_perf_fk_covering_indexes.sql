-- ATLITOS v2 — 0068_perf_fk_covering_indexes.sql
-- Domain: infra / performance. Epic AT-1, story AT-151 (Track F, perf pass).
-- Requirements: PLAN.md P8 "perf". Advisor: unindexed_foreign_keys (26 INFO).
--
-- WHAT. Adds a covering B-tree index for every foreign key on public tables
-- that lacked one (26 constraints, all single-column). An FK with no covering
-- index forces a sequential scan of the CHILD table on every parent-side
-- DELETE/UPDATE (to enforce the constraint) and cannot use an index for the
-- join direction child->parent, so the hot-path reads and the cascade checks
-- both degrade as data grows. Adding an index is behaviour-neutral and fully
-- reversible (DROP INDEX), so per the advisor's own remediation every FK gets
-- its covering index. No query returns different rows; only plans change.
--
-- SCOPE. Money/entity joins (donations, ledger_entries, sessions, court_bookings
-- payment_intent_id; order_items/cart_items product_variant_id), owner/actor FKs
-- (order_drafts.user_id, chat_messages.sender_id, clip_comments.user_id,
-- product_wishlist_items.product_id, reports.reporter_id/resolved_by,
-- support_tickets.submitter_id, order_timeline.actor_id), and lookup joins
-- (xp_events/drill_completions.drill_id, user_milestones.milestone_id,
-- sessions.session_type_id, verification_requests.reviewer_id,
-- donation_drafts.donor_id/item_id/upa_id, donations.item_id/order_id,
-- order_drafts.address_id, court_bookings.created_by_staff_id).
--
-- IF NOT EXISTS on each so the migration is idempotent. Naming: idx_<table>_<col>.

-- commerce
create index if not exists idx_cart_items_product_variant_id on public.cart_items (product_variant_id);
create index if not exists idx_order_items_product_variant_id on public.order_items (product_variant_id);
create index if not exists idx_order_drafts_user_id on public.order_drafts (user_id);
create index if not exists idx_order_drafts_address_id on public.order_drafts (address_id);
create index if not exists idx_order_timeline_actor_id on public.order_timeline (actor_id);
create index if not exists idx_product_wishlist_items_product_id on public.product_wishlist_items (product_id);

-- money / ledger
create index if not exists idx_ledger_entries_payment_intent_id on public.ledger_entries (payment_intent_id);
create index if not exists idx_sessions_payment_intent_id on public.sessions (payment_intent_id);
create index if not exists idx_sessions_session_type_id on public.sessions (session_type_id);
create index if not exists idx_court_bookings_payment_intent_id on public.court_bookings (payment_intent_id);
create index if not exists idx_court_bookings_created_by_staff_id on public.court_bookings (created_by_staff_id);

-- empower / donations
create index if not exists idx_donations_item_id on public.donations (item_id);
create index if not exists idx_donations_order_id on public.donations (order_id);
create index if not exists idx_donations_payment_intent_id on public.donations (payment_intent_id);
create index if not exists idx_donation_drafts_donor_id on public.donation_drafts (donor_id);
create index if not exists idx_donation_drafts_item_id on public.donation_drafts (item_id);
create index if not exists idx_donation_drafts_upa_id on public.donation_drafts (upa_id);

-- clutch / chat
create index if not exists idx_chat_messages_sender_id on public.chat_messages (sender_id);
create index if not exists idx_clip_comments_user_id on public.clip_comments (user_id);

-- learn
create index if not exists idx_drill_completions_drill_id on public.drill_completions (drill_id);
create index if not exists idx_xp_events_drill_id on public.xp_events (drill_id);
create index if not exists idx_user_milestones_milestone_id on public.user_milestones (milestone_id);

-- admin / ops
create index if not exists idx_reports_reporter_id on public.reports (reporter_id);
create index if not exists idx_reports_resolved_by on public.reports (resolved_by);
create index if not exists idx_support_tickets_submitter_id on public.support_tickets (submitter_id);
create index if not exists idx_verification_requests_reviewer_id on public.verification_requests (reviewer_id);
