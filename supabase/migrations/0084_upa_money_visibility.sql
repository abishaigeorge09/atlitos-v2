-- 0084: UPA money-in visibility, supporters, and reviews (read-only).
--
-- QA audit (#1 backlog item) found money-in incoherent across the three UPA
-- surfaces for the SAME upa_id:
--   * portal-life dashboard "Total raised" read upa_fund_balance (ledger,
--     credit - debit). Correct where it ran, but the per-item and consumer
--     surfaces disagreed.
--   * upa_wishlist_items.funded_amount is a denormalized CACHE that has drifted
--     from the real donations (SQL-verified: cache sum 9900 vs donations 6725
--     for the verified cricket UPA; item "First aid kit" cache=2500 but 0
--     attributed donations). Trusting the cache renders "Funded 100% + 0
--     donations", the exact contradiction the audit flagged.
--
-- Fix, entirely READ-SIDE and inside the financial invariant (no client writes,
-- no money rows, no status writes, everything SECURITY DEFINER server-side):
--
-- 1. public_upa_profile (0056) is rebuilt so each item's funded_amount is
--    DERIVED from donations grouped by item_id, never the drift-prone cache
--    column. total_raised stays ledger-derived via upa_fund_balance (the
--    canonical source of a fund total, SCHEMA.md / PAYMENTS.md). It also now
--    carries donor_count, supporters (donor_display_name snapshots, "A Sponsor"
--    when null per FR-17), and published gratitude posts, so the consumer public
--    profile and the portal preview render the same coherent numbers.
--
-- 2. upa_money_summary(p_upa_id) is the portal-life read source: total_raised
--    (ledger), donor_count (distinct donor_id), per-item derived funded map,
--    supporters, and gratitude. Scoped inside the definer to OWNER
--    (applicant_user_id = auth.uid()) OR any VERIFIED upa, so the UPA reads its
--    own and a sponsor reads any verified athlete, and nothing else resolves.
--
-- Both derive money from donations/ledger server-side. Neither reads
-- funded_amount as a money total (PHASE-6 trap 5). Grants mirror 0056.

-- ---------------------------------------------------------------------------
-- 1. Rebuild public_upa_profile: derived per-item funding + supporters +
--    gratitude. Signature, null-for-unverified guard, and grants unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.public_upa_profile(p_upa_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when a.id is null then null else jsonb_build_object(
    'id', a.id,
    'story_headline', a.story_headline,
    'story_body', a.story_body,
    'sport', a.sport,
    'region', a.region,
    'state', a.state,
    'photo_url', a.photo_url,
    'total_raised', public.upa_fund_balance(a.id),
    'donor_count', (
      select count(distinct d.donor_id) from public.donations d where d.upa_id = a.id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'title', i.title,
        'cost', i.cost,
        -- DERIVED per-item funding: sum of donations attributed to this item,
        -- not the drift-prone funded_amount cache column.
        'funded_amount', coalesce((
          select sum(d.amount) from public.donations d where d.item_id = i.id
        ), 0),
        'status', i.status
      ) order by i.created_at)
      from public.upa_wishlist_items i
      where i.upa_id = a.id
    ), '[]'::jsonb),
    'supporters', coalesce((
      select jsonb_agg(s.obj order by s.obj->>'last_at' desc) from (
        select jsonb_build_object(
          'display_name', max(d.donor_display_name),
          'amount', sum(d.amount),
          'last_at', max(d.created_at)
        ) as obj
        from public.donations d
        where d.upa_id = a.id
        group by d.donor_id
      ) s
    ), '[]'::jsonb),
    'gratitude', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'body', g.body,
        'photo_url', g.photo_url,
        'wishlist_item_id', g.wishlist_item_id,
        'item_title', wi.title,
        'created_at', g.created_at
      ) order by g.created_at desc)
      from public.gratitude_posts g
      left join public.upa_wishlist_items wi on wi.id = g.wishlist_item_id
      where g.upa_id = a.id and g.status = 'published' and g.deleted_at is null
    ), '[]'::jsonb)
  ) end
  from (select 1) one
  left join public.upa_applications a
    on a.id = p_upa_id and a.status = 'verified';
$function$;

grant execute on function public.public_upa_profile(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. upa_money_summary: the portal-life money-in read source.
-- ---------------------------------------------------------------------------
create or replace function public.upa_money_summary(p_upa_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when a.id is null then null else jsonb_build_object(
    'upa_id', a.id,
    -- Ledger-derived fund total (credit - debit), the canonical money-in figure.
    'total_raised', public.upa_fund_balance(a.id),
    'donor_count', (
      select count(distinct d.donor_id) from public.donations d where d.upa_id = a.id
    ),
    -- Per-item derived funding, keyed by item id, for the wishlist bars.
    'items', coalesce((
      select jsonb_object_agg(x.item_id::text, x.funded) from (
        select d.item_id, sum(d.amount) as funded
        from public.donations d
        where d.upa_id = a.id and d.item_id is not null
        group by d.item_id
      ) x
    ), '{}'::jsonb),
    'supporters', coalesce((
      select jsonb_agg(s.obj order by s.obj->>'last_at' desc) from (
        select jsonb_build_object(
          'display_name', max(d.donor_display_name),
          'amount', sum(d.amount),
          'last_at', max(d.created_at)
        ) as obj
        from public.donations d
        where d.upa_id = a.id
        group by d.donor_id
      ) s
    ), '[]'::jsonb),
    'gratitude', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'body', g.body,
        'photo_url', g.photo_url,
        'wishlist_item_id', g.wishlist_item_id,
        'item_title', wi.title,
        'created_at', g.created_at
      ) order by g.created_at desc)
      from public.gratitude_posts g
      left join public.upa_wishlist_items wi on wi.id = g.wishlist_item_id
      where g.upa_id = a.id and g.status = 'published' and g.deleted_at is null
    ), '[]'::jsonb)
  ) end
  from (select 1) one
  left join public.upa_applications a
    on a.id = p_upa_id
   and (a.applicant_user_id = auth.uid() or a.status = 'verified');
$function$;

grant execute on function public.upa_money_summary(uuid) to anon, authenticated, service_role;
