-- 0062_advisor_initplan_subselect.sql
-- AT-140: auth_rls_initplan burn-down (100 WARN -> 0).
-- Wrap each direct auth.uid()/auth.jwt()/auth.role() call in a scalar
-- subselect (select ...) so the planner evaluates it ONCE per query
-- instead of once per row. ALTER POLICY changes ONLY the expression;
-- roles, command, and permissive/restrictive are preserved verbatim, so
-- the access set is provably unchanged (performance-only, per Supabase
-- lint 0003 remediation). No policy is dropped or recreated here.

alter policy "addresses_delete_own" on public.addresses
  using ((user_id = (select auth.uid())));
alter policy "addresses_insert_own" on public.addresses
  with check ((user_id = (select auth.uid())));
alter policy "addresses_select_own" on public.addresses
  using ((user_id = (select auth.uid())));
alter policy "addresses_update_own" on public.addresses
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "athlete_sports_delete_own" on public.athlete_sports
  using ((user_id = (select auth.uid())));
alter policy "athlete_sports_insert_own" on public.athlete_sports
  with check ((user_id = (select auth.uid())));
alter policy "athlete_sports_select_own" on public.athlete_sports
  using ((user_id = (select auth.uid())));
alter policy "athlete_sports_update_own" on public.athlete_sports
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "cart_items_delete_own" on public.cart_items
  using ((user_id = (select auth.uid())));
alter policy "cart_items_select_own" on public.cart_items
  using ((user_id = (select auth.uid())));
alter policy "chat_messages_insert_participant" on public.chat_messages
  with check (((sender_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM chat_threads t
  WHERE ((t.id = chat_messages.thread_id) AND ((t.participant_a = (select auth.uid())) OR (t.participant_b = (select auth.uid()))))))));
alter policy "chat_messages_select_participant" on public.chat_messages
  using ((EXISTS ( SELECT 1
   FROM chat_threads t
  WHERE ((t.id = chat_messages.thread_id) AND ((t.participant_a = (select auth.uid())) OR (t.participant_b = (select auth.uid())))))));
alter policy "chat_threads_insert_participant" on public.chat_threads
  with check ((((participant_a = (select auth.uid())) OR (participant_b = (select auth.uid()))) AND (participant_a < participant_b) AND (context_type = 'coaching'::text) AND session_links_pair(context_id, participant_a, participant_b)));
alter policy "chat_threads_select_participant" on public.chat_threads
  using (((participant_a = (select auth.uid())) OR (participant_b = (select auth.uid()))));
alter policy "clip_comments_delete_own" on public.clip_comments
  using ((user_id = (select auth.uid())));
alter policy "clip_comments_insert_own" on public.clip_comments
  with check (((user_id = (select auth.uid())) AND (NOT is_guest()) AND (EXISTS ( SELECT 1
   FROM clips c
  WHERE ((c.id = clip_comments.clip_id) AND (c.status = 'published'::clip_status))))));
alter policy "clip_comments_select_own_clip" on public.clip_comments
  using ((EXISTS ( SELECT 1
   FROM clips c
  WHERE ((c.id = clip_comments.clip_id) AND (c.owner_id = (select auth.uid()))))));
alter policy "clips_insert_own" on public.clips
  with check (((owner_id = (select auth.uid())) AND (status = 'uploading'::clip_status)));
alter policy "clips_select_own" on public.clips
  using ((owner_id = (select auth.uid())));
alter policy "coach_availability_windows_select_own" on public.coach_availability_windows
  using ((coach_id = (select auth.uid())));
alter policy "coach_availability_windows_write_own" on public.coach_availability_windows
  using ((has_role('coach'::text) AND (coach_id = (select auth.uid()))))
  with check ((has_role('coach'::text) AND (coach_id = (select auth.uid()))));
alter policy "coach_certificates_delete_own" on public.coach_certificates
  using (((coach_id = (select auth.uid())) AND has_role('coach'::text)));
alter policy "coach_certificates_insert_own" on public.coach_certificates
  with check (((coach_id = (select auth.uid())) AND has_role('coach'::text)));
alter policy "coach_certificates_select_own" on public.coach_certificates
  using ((coach_id = (select auth.uid())));
alter policy "coach_profiles_insert_own" on public.coach_profiles
  with check (((user_id = (select auth.uid())) AND has_role('coach'::text)));
alter policy "coach_profiles_select_own" on public.coach_profiles
  using ((user_id = (select auth.uid())));
alter policy "coach_profiles_update_own" on public.coach_profiles
  using (((user_id = (select auth.uid())) AND has_role('coach'::text)))
  with check (((user_id = (select auth.uid())) AND has_role('coach'::text)));
alter policy "court_availability_windows_select_own" on public.court_availability_windows
  using ((EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_availability_windows.court_id) AND (v.partner_user_id = (select auth.uid()))))));
alter policy "court_availability_windows_write_own" on public.court_availability_windows
  using ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_availability_windows.court_id) AND (v.partner_user_id = (select auth.uid())))))))
  with check ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_availability_windows.court_id) AND (v.partner_user_id = (select auth.uid())))))));
alter policy "court_blackouts_select_own" on public.court_blackouts
  using ((EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_blackouts.court_id) AND (v.partner_user_id = (select auth.uid()))))));
alter policy "court_blackouts_write_own" on public.court_blackouts
  using ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_blackouts.court_id) AND (v.partner_user_id = (select auth.uid())))))))
  with check ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_blackouts.court_id) AND (v.partner_user_id = (select auth.uid())))))));
alter policy "court_bookings_select" on public.court_bookings
  using ((is_court_partner_or_staff(court_id) OR (user_id = (select auth.uid()))));
alter policy "court_pricing_rules_select_own" on public.court_pricing_rules
  using ((EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_pricing_rules.court_id) AND (v.partner_user_id = (select auth.uid()))))));
alter policy "court_pricing_rules_write_own" on public.court_pricing_rules
  using ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_pricing_rules.court_id) AND (v.partner_user_id = (select auth.uid())))))))
  with check ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM (courts c
     JOIN venues v ON ((v.id = c.venue_id)))
  WHERE ((c.id = court_pricing_rules.court_id) AND (v.partner_user_id = (select auth.uid())))))));
alter policy "courts_delete_own" on public.courts
  using ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = courts.venue_id) AND (v.partner_user_id = (select auth.uid())))))));
alter policy "courts_insert_own" on public.courts
  with check ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = courts.venue_id) AND (v.partner_user_id = (select auth.uid())))))));
alter policy "courts_select_own" on public.courts
  using ((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = courts.venue_id) AND (v.partner_user_id = (select auth.uid()))))));
alter policy "courts_update_own" on public.courts
  using ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = courts.venue_id) AND (v.partner_user_id = (select auth.uid())))))))
  with check ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = courts.venue_id) AND (v.partner_user_id = (select auth.uid())))))));
alter policy "donations_select_own_donor" on public.donations
  using ((donor_id = (select auth.uid())));
alter policy "donations_select_own_upa" on public.donations
  using (((upa_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = donations.upa_id) AND (a.applicant_user_id = (select auth.uid())))))));
alter policy "drill_completions_insert_own" on public.drill_completions
  with check ((user_id = (select auth.uid())));
alter policy "drill_completions_select_own" on public.drill_completions
  using ((user_id = (select auth.uid())));
alter policy "gratitude_posts_insert_own" on public.gratitude_posts
  with check (((status = 'published'::text) AND (EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = gratitude_posts.upa_id) AND (a.applicant_user_id = (select auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM upa_wishlist_items i
  WHERE ((i.id = gratitude_posts.wishlist_item_id) AND (i.upa_id = gratitude_posts.upa_id) AND (i.status = ANY (ARRAY['funded'::upa_wishlist_item_status, 'delivered'::upa_wishlist_item_status]))))) AND (NOT (EXISTS ( SELECT 1
   FROM gratitude_posts g
  WHERE (g.wishlist_item_id = gratitude_posts.wishlist_item_id))))));
alter policy "gratitude_posts_select_own" on public.gratitude_posts
  using ((EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = gratitude_posts.upa_id) AND (a.applicant_user_id = (select auth.uid()))))));
alter policy "gratitude_posts_update_own_softdelete" on public.gratitude_posts
  using ((EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = gratitude_posts.upa_id) AND (a.applicant_user_id = (select auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = gratitude_posts.upa_id) AND (a.applicant_user_id = (select auth.uid()))))));
alter policy "ledger_entries_select_own" on public.ledger_entries
  using ((((account_type = 'coach'::ledger_account_type) AND (account_ref = (select auth.uid()))) OR ((account_type = 'user'::ledger_account_type) AND (account_ref = (select auth.uid()))) OR ((account_type = 'court_partner'::ledger_account_type) AND (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = ledger_entries.account_ref) AND (v.partner_user_id = (select auth.uid()))))))));
alter policy "notification_prefs_delete_own" on public.notification_prefs
  using ((user_id = (select auth.uid())));
alter policy "notification_prefs_insert_own" on public.notification_prefs
  with check ((user_id = (select auth.uid())));
alter policy "notification_prefs_select_own" on public.notification_prefs
  using ((user_id = (select auth.uid())));
alter policy "notification_prefs_update_own" on public.notification_prefs
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "notifications_select_own" on public.notifications
  using ((user_id = (select auth.uid())));
alter policy "notifications_update_own" on public.notifications
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "order_feedback_insert_own" on public.order_feedback
  with check ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_feedback.order_id) AND (o.user_id = (select auth.uid())) AND (o.status = 'delivered'::order_status)))));
alter policy "order_feedback_select_own" on public.order_feedback
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_feedback.order_id) AND (o.user_id = (select auth.uid()))))));
alter policy "order_items_select_own" on public.order_items
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = (select auth.uid()))))));
alter policy "order_timeline_select_own" on public.order_timeline
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_timeline.order_id) AND (o.user_id = (select auth.uid()))))));
alter policy "orders_select_own" on public.orders
  using ((user_id = (select auth.uid())));
alter policy "payment_intents_select_own" on public.payment_intents
  using ((user_id = (select auth.uid())));
alter policy "payout_accounts_select_own" on public.payout_accounts
  using ((((owner_type = 'coach'::text) AND (owner_id = (select auth.uid()))) OR ((owner_type = 'court_partner'::text) AND (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = payout_accounts.owner_id) AND (v.partner_user_id = (select auth.uid()))))))));
alter policy "product_wishlist_items_select_own" on public.product_wishlist_items
  using ((user_id = (select auth.uid())));
alter policy "product_wishlist_items_write_own" on public.product_wishlist_items
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "push_tokens_delete_own" on public.push_tokens
  using ((user_id = (select auth.uid())));
alter policy "push_tokens_insert_own" on public.push_tokens
  with check ((user_id = (select auth.uid())));
alter policy "push_tokens_select_own" on public.push_tokens
  using ((user_id = (select auth.uid())));
alter policy "push_tokens_update_own" on public.push_tokens
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "refunds_select_payer" on public.refunds
  using ((EXISTS ( SELECT 1
   FROM payment_intents pi
  WHERE ((pi.id = refunds.payment_intent_id) AND (pi.user_id = (select auth.uid()))))));
alter policy "reports_insert_own" on public.reports
  with check (((reporter_id = (select auth.uid())) AND (NOT is_guest())));
alter policy "reports_select_own" on public.reports
  using ((reporter_id = (select auth.uid())));
alter policy "session_types_select_own" on public.session_types
  using ((coach_id = (select auth.uid())));
alter policy "session_types_write_own" on public.session_types
  using ((has_role('coach'::text) AND (coach_id = (select auth.uid()))))
  with check ((has_role('coach'::text) AND (coach_id = (select auth.uid()))));
alter policy "sessions_select_coach" on public.sessions
  using ((has_role('coach'::text) AND (coach_id = (select auth.uid()))));
alter policy "sessions_select_player" on public.sessions
  using ((player_id = (select auth.uid())));
alter policy "support_tickets_insert_own" on public.support_tickets
  with check ((submitter_id = (select auth.uid())));
alter policy "support_tickets_select_own" on public.support_tickets
  using ((submitter_id = (select auth.uid())));
alter policy "transfers_select_own" on public.transfers
  using ((EXISTS ( SELECT 1
   FROM payout_accounts pa
  WHERE ((pa.id = transfers.payout_account_id) AND (((pa.owner_type = 'coach'::text) AND (pa.owner_id = (select auth.uid()))) OR ((pa.owner_type = 'court_partner'::text) AND (EXISTS ( SELECT 1
           FROM venues v
          WHERE ((v.id = pa.owner_id) AND (v.partner_user_id = (select auth.uid())))))))))));
alter policy "upa_applications_select_own" on public.upa_applications
  using ((applicant_user_id = (select auth.uid())));
alter policy "upa_evidence_insert_own" on public.upa_evidence
  with check ((EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = upa_evidence.application_id) AND (a.applicant_user_id = (select auth.uid()))))));
alter policy "upa_evidence_select_own" on public.upa_evidence
  using ((EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = upa_evidence.application_id) AND (a.applicant_user_id = (select auth.uid()))))));
alter policy "upa_wishlist_items_delete_own_open" on public.upa_wishlist_items
  using (((status = 'open'::upa_wishlist_item_status) AND (funded_amount = (0)::numeric) AND (EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = upa_wishlist_items.upa_id) AND (a.applicant_user_id = (select auth.uid())))))));
alter policy "upa_wishlist_items_insert_own" on public.upa_wishlist_items
  with check (((status = 'open'::upa_wishlist_item_status) AND (funded_amount = (0)::numeric) AND (EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = upa_wishlist_items.upa_id) AND (a.applicant_user_id = (select auth.uid())))))));
alter policy "upa_wishlist_items_select_own" on public.upa_wishlist_items
  using ((EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = upa_wishlist_items.upa_id) AND (a.applicant_user_id = (select auth.uid()))))));
alter policy "upa_wishlist_items_update_own_open" on public.upa_wishlist_items
  using (((status = 'open'::upa_wishlist_item_status) AND (funded_amount = (0)::numeric) AND (EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = upa_wishlist_items.upa_id) AND (a.applicant_user_id = (select auth.uid())))))))
  with check (((status = 'open'::upa_wishlist_item_status) AND (funded_amount = (0)::numeric) AND (EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = upa_wishlist_items.upa_id) AND (a.applicant_user_id = (select auth.uid())))))));
alter policy "user_milestones_select_own" on public.user_milestones
  using ((user_id = (select auth.uid())));
alter policy "user_roles_select_own" on public.user_roles
  using ((user_id = (select auth.uid())));
alter policy "users_select_own" on public.users
  using ((id = (select auth.uid())));
alter policy "users_update_own" on public.users
  using ((id = (select auth.uid())))
  with check ((id = (select auth.uid())));
alter policy "venue_photos_delete_own" on public.venue_photos
  using ((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_photos.venue_id) AND (v.partner_user_id = (select auth.uid()))))));
alter policy "venue_photos_insert_own" on public.venue_photos
  with check ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_photos.venue_id) AND (v.partner_user_id = (select auth.uid())))))));
alter policy "venue_photos_select_own" on public.venue_photos
  using ((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_photos.venue_id) AND (v.partner_user_id = (select auth.uid()))))));
alter policy "venue_photos_update_own" on public.venue_photos
  using ((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_photos.venue_id) AND (v.partner_user_id = (select auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_photos.venue_id) AND (v.partner_user_id = (select auth.uid()))))));
alter policy "venue_staff_insert_partner" on public.venue_staff
  with check ((has_role('court_partner'::text) AND (EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_staff.venue_id) AND (v.partner_user_id = (select auth.uid())))))));
alter policy "venue_staff_select_own" on public.venue_staff
  using ((user_id = (select auth.uid())));
alter policy "venue_staff_select_partner" on public.venue_staff
  using ((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_staff.venue_id) AND (v.partner_user_id = (select auth.uid()))))));
alter policy "venues_insert_own" on public.venues
  with check ((has_role('court_partner'::text) AND (partner_user_id = (select auth.uid()))));
alter policy "venues_select_own" on public.venues
  using ((partner_user_id = (select auth.uid())));
alter policy "venues_update_own" on public.venues
  using ((has_role('court_partner'::text) AND (partner_user_id = (select auth.uid()))))
  with check ((has_role('court_partner'::text) AND (partner_user_id = (select auth.uid()))));
alter policy "verification_requests_insert_own_coach" on public.verification_requests
  with check (((applicant_type = 'coach'::applicant_type) AND (applicant_id = (select auth.uid())) AND has_role('coach'::text)));
alter policy "verification_requests_select_own_coach" on public.verification_requests
  using (((applicant_type = 'coach'::applicant_type) AND (applicant_id = (select auth.uid()))));
alter policy "verification_requests_select_own_upa" on public.verification_requests
  using (((applicant_type = 'upa'::applicant_type) AND (EXISTS ( SELECT 1
   FROM upa_applications a
  WHERE ((a.id = verification_requests.applicant_id) AND (a.applicant_user_id = (select auth.uid())))))));
alter policy "xp_events_select_own" on public.xp_events
  using ((user_id = (select auth.uid())));
