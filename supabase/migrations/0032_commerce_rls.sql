-- ATLITOS v2 — 0032_commerce_rls.sql
-- Domain: commerce. Epic P4, story AT-66.
-- Requirements: PRD-07 FR-1, FR-7, FR-8, FR-27, FR-28.
--
-- Policies for every table 0031_commerce.sql created, following RLS.md's
-- "commerce" table. RLS was enabled by 0031 with no policies at all, so until
-- this migration ran the whole catalog returned zero rows to every client.
--
-- ============================================================================
-- PERMISSIVE-OR WARNING. READ THIS BEFORE WRITING ANY COMMERCE QUERY.
--
-- This is the highest risk configuration of the shape CLAUDE.md records FOUR
-- incidents for, because commerce is the first domain where a PUBLIC table and
-- an OWNER SCOPED table sit inside the same joined query on the same screen.
--
-- Postgres combines multiple permissive policies for the same role and command
-- with OR. Two families exist side by side here:
--
--   PUBLIC BROWSE (returns EVERYONE's rows, by design):
--     categories, products, product_media, product_variants
--
--   OWNER SCOPED (must return only the caller's rows):
--     cart_items, product_wishlist_items, orders, order_items,
--     order_timeline, order_feedback, addresses
--
-- The failure mode is NOT that the catalog is public. That is intended. The
-- failure mode is a cart or checkout query that joins the two families and
-- carries a filter on the CATALOG side only, so the owner scoped side comes
-- back unfiltered. It does not error. It silently returns other shoppers'
-- rows. That is exactly how P2 lost two reject cycles on venues.
--
-- THE APP CODE CONTRACT, which is a requirement and not a suggestion:
--
--   Every read of an owner scoped table above carries its OWN explicit owner
--   filter in the query itself, `.eq("user_id", user.id)`, regardless of what
--   RLS would have done. That applies to app code in apps/* and packages/api,
--   to supabase/seed, and to every test harness and verification script.
--
-- Concretely, for the screens Track C is about to build:
--   cart (FR-8):            .eq("user_id", user.id) on cart_items
--   wishlist (FR-28):       .eq("user_id", user.id) on product_wishlist_items
--   my orders (FR-27):      .eq("user_id", user.id) on orders
--   order detail (FR-24/25): .eq("user_id", user.id) on orders, and reach
--                           order_items/order_timeline THROUGH that order id,
--                           never by a bare select on the child table
--   address book (FR-30):   .eq("user_id", user.id) on addresses
--
-- RLS here is an authorization ceiling, not a scoping mechanism.
--
-- P2'S COROLLARY, which is how AT-62 was caught: a test written against an
-- unscoped query does not fail, it PASSES FOR THE WRONG REASON. When you write
-- an isolation assertion, assert that the two parties' ids actually differ
-- before trusting the result. An assertion run twice as the same user, or
-- against a row that party already owns, proves nothing.
-- ============================================================================

-- ============================================================================
-- categories
--
-- SCHEMA.md gives categories no `active` column, so RLS.md's "active = true"
-- phrasing for the catalog family has no referent here (see 0031's header).
-- Categories are public reference content with no per-user data, the same
-- class as `drills` and `roadmap_stages` in RLS.md's guest read surface, so
-- the browse policy is a plain public select. Writes are admin only.
-- ============================================================================

create policy categories_select_public on public.categories
  for select to anon, authenticated
  using (true);

create policy categories_write_admin on public.categories
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ============================================================================
-- products. Public browse is `active = true` (PRD-07 FR-1, RLS.md's guest read
-- surface). An admin additionally reads inactive rows, because PRD-04 FR-13's
-- catalog list has to show a deactivated product in order to reactivate it.
-- ============================================================================

create policy products_select_public on public.products
  for select to anon, authenticated
  using (active);

create policy products_select_admin on public.products
  for select to authenticated
  using (public.has_role('admin'));

create policy products_write_admin on public.products
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ============================================================================
-- product_media and product_variants. Both hang off products.active rather
-- than carrying their own flag, so the public predicate is an EXISTS through
-- the parent. Note the lesson from AT-63: an EXISTS subquery in a policy is
-- itself subject to the subquery target's RLS, and if the parent has no policy
-- the predicate silently evaluates false for everyone. `products` gets its
-- public select policy above, in this same migration, so the parent really is
-- readable by the roles named here. That was the exact defect AT-63 fixed for
-- session_types, and it is why these two policies are written after products'.
-- ============================================================================

create policy product_media_select_public on public.product_media
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_media.product_id
        and p.active
    )
  );

create policy product_media_select_admin on public.product_media
  for select to authenticated
  using (public.has_role('admin'));

create policy product_media_write_admin on public.product_media
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

create policy product_variants_select_public on public.product_variants
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and p.active
    )
  );

create policy product_variants_select_admin on public.product_variants
  for select to authenticated
  using (public.has_role('admin'));

-- Admin stock adjustment (PRD-04 FR-17) writes product_variants.stock
-- directly, which is legitimate: raw stock is an inventory fact an admin owns,
-- not a money column and not a state machine. What no client may ever do is
-- decrement it as part of a sale; that is consume_reservation's job under
-- service role (0033). The distinction is deliberate and is recorded in
-- SCHEMA.md.
create policy product_variants_write_admin on public.product_variants
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- ============================================================================
-- product_wishlist_items. Own rows, full CRUD (PRD-07 FR-6, FR-28). The
-- toggle_product_wishlist RPC (0034) exists for atomicity, not because the
-- direct write is forbidden; a wishlist row carries no money and no state.
-- ============================================================================

create policy product_wishlist_items_select_own on public.product_wishlist_items
  for select to authenticated
  using (user_id = auth.uid());

create policy product_wishlist_items_write_own on public.product_wishlist_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================================
-- cart_items. Own rows for SELECT and DELETE only.
--
-- There is deliberately NO insert or update policy for authenticated, and the
-- grants below withdraw those verbs as well. PRD-07 FR-9 requires that adding
-- to cart or changing a quantity revalidates live AVAILABLE stock server side
-- and caps rather than rounds up. If a client could reach this table with a
-- PostgREST upsert, FR-9 would be decorative: the cap would live in the UI and
-- nowhere else. add_to_cart and update_cart_item (0034) are therefore the only
-- write paths, which is also what PHASE-4-STATUS.md trap 3 states in so many
-- words ("Cart adds go through add_to_cart, not a PostgREST upsert").
--
-- DELETE stays a direct own-row policy because removing a line needs no stock
-- check (FR-10), exactly as RLS.md says.
-- ============================================================================

create policy cart_items_select_own on public.cart_items
  for select to authenticated
  using (user_id = auth.uid());

create policy cart_items_delete_own on public.cart_items
  for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- orders, order_items, order_timeline.
--
-- SELECT only for authenticated, scoped to the caller's own orders, plus an
-- admin read for PRD-04 FR-20's Order List. NO insert, update or delete policy
-- exists for authenticated or anon on any of the three, and the grants below
-- withdraw those verbs too, so this is enforced twice.
--
-- This is CLAUDE.md's financial invariant in the schema. `orders` carries five
-- money columns and a status that gates a ledger group. Its only writers are
-- the finalize handler under service role (which creates the row) and
-- order_transition (0035), which is itself service_role only per AT-61's rule.
-- The shopper app never writes a lifecycle transition (PRD-07 FR-24) and the
-- admin app advances an order through the admin-order-advance edge function,
-- never by setting the column.
-- ============================================================================

create policy orders_select_own on public.orders
  for select to authenticated
  using (user_id = auth.uid());

create policy orders_select_admin on public.orders
  for select to authenticated
  using (public.has_role('admin'));

create policy order_items_select_own on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id = auth.uid()
    )
  );

create policy order_items_select_admin on public.order_items
  for select to authenticated
  using (public.has_role('admin'));

create policy order_timeline_select_own on public.order_timeline
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_timeline.order_id
        and o.user_id = auth.uid()
    )
  );

create policy order_timeline_select_admin on public.order_timeline
  for select to authenticated
  using (public.has_role('admin'));

-- ============================================================================
-- order_feedback. Own row, INSERT once, no UPDATE and no DELETE for anyone.
--
-- PRD-07 FR-26's two halves are both enforced here rather than in the UI:
--   "only once an order reaches delivered"  -> the insert policy's status test
--   "a one time action per order"           -> UNIQUE(order_id) from 0031
-- AC-E4's read only view then follows from the row existing, and a second
-- submit is a unique violation, not a silent overwrite. That is also why no
-- UPDATE policy is created: a shopper cannot revise a rating after the fact.
-- ============================================================================

create policy order_feedback_select_own on public.order_feedback
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_feedback.order_id
        and o.user_id = auth.uid()
    )
  );

create policy order_feedback_select_admin on public.order_feedback
  for select to authenticated
  using (public.has_role('admin'));

create policy order_feedback_insert_own on public.order_feedback
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_feedback.order_id
        and o.user_id = auth.uid()
        and o.status = 'delivered'
    )
  );

-- ============================================================================
-- GRANTS. The second lock, independent of policy.
--
-- Supabase's default privileges hand anon and authenticated full DML on every
-- new table in `public`, so a table with no policy is protected by RLS alone.
-- 0010_payments_core.sql established the house pattern of withdrawing the
-- verbs outright for anything money bearing, so that a future migration that
-- accidentally adds a permissive policy still cannot produce a client write.
-- The same reasoning applies to every table below.
--
-- service_role is unaffected throughout: it bypasses RLS and keeps the DML it
-- needs for the checkout and finalize paths.
-- ============================================================================

-- Money and state machine tables: no client write, ever, by either mechanism.
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
revoke insert, update, delete on public.order_timeline from anon, authenticated;

-- Cart: RPC-only add and update, direct own-row delete (see the cart_items
-- block above for why the upsert path is closed).
revoke insert, update on public.cart_items from anon, authenticated;
revoke all on public.cart_items from anon;

-- Feedback: insert once and never revise.
revoke update, delete on public.order_feedback from anon, authenticated;
revoke all on public.order_feedback from anon;

-- Wishlist is authenticated-only (a guest wishlist is client side per FR-7).
revoke all on public.product_wishlist_items from anon;

-- Catalog: anon browses, never writes. authenticated KEEPS its DML grants
-- here because the admin app authenticates as `authenticated` with an admin
-- role claim, and the *_write_admin policies above are what gate it.
revoke insert, update, delete on public.categories from anon;
revoke insert, update, delete on public.products from anon;
revoke insert, update, delete on public.product_media from anon;
revoke insert, update, delete on public.product_variants from anon;
