-- ATLITOS v2 — 0056_empower_read_layer.sql
-- Domain: empower / payments. Epic AT-8, story AT-114 (Track B, ledger-derived reads).
-- Requirements: PRD-05 FR-18, FR-23; PRD-06 FR-3, FR-4, FR-12, FR-13, FR-14.
--
-- The read layer for every displayed empower money number. THE binding rule
-- (CLAUDE.md, SCHEMA.md line 961, PHASE-6-STATUS.md line 22): a fund's balance
-- and an athlete's My Impact totals derive from sum(credit) - sum(debit) per
-- account_ref, NEVER a denormalized balance column. upa_wishlist_items.
-- funded_amount stays per-item progress and the race guard only; it is never
-- the source of a displayed fund total.
--
-- These are SECURITY DEFINER because the ledger aggregate spans every UPA's
-- account_ref, which ledger_entries RLS (own-account only) would otherwise hide
-- from an ordinary caller. Each function exposes only an aggregate or an
-- explicitly caller-scoped / verified-only projection, never another user's raw
-- rows, so definer is safe here (the same pattern get_my_transactions uses).

-- ============================================================================
-- upa_fund_balance: the ONE derivation everything else composes. Balance of any
-- upa_fund account_ref (a specific UPA's application id, or the General Fund
-- anchor) = credits minus debits. Coalesced to 0.00 so a fund with no ledger
-- rows reads as zero rather than null.
-- ============================================================================

create function public.upa_fund_balance(p_account_ref uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount) filter (where direction = 'credit'), 0)
       - coalesce(sum(amount) filter (where direction = 'debit'), 0)
  from public.ledger_entries
  where account_type = 'upa_fund'
    and account_ref = p_account_ref;
$$;

revoke all on function public.upa_fund_balance(uuid) from public;
grant execute on function public.upa_fund_balance(uuid) to anon, authenticated, service_role;

comment on function public.upa_fund_balance(uuid) is
  'Ledger-derived balance of a upa_fund account_ref (a UPA application id, or general_fund_account_ref()): sum(credit) - sum(debit). The single source of every displayed empower fund total; never a denormalized column (AT-114).';

-- ============================================================================
-- general_fund_balance: the platform General Fund pool (checkout roundups),
-- the same derivation at the reserved anchor.
-- ============================================================================

create function public.general_fund_balance()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public.upa_fund_balance(public.general_fund_account_ref());
$$;

revoke all on function public.general_fund_balance() from public;
grant execute on function public.general_fund_balance() to anon, authenticated, service_role;

-- ============================================================================
-- get_empower_stats: the hub aggregate banner (PRD-06 FR-3), platform wide,
-- all time, computed live from the ledger. Guest visible, so anon may call it.
--   total_raised       every upa_fund credit minus debit, across all account_refs
--                       (specific UPAs plus the General Fund)
--   general_fund        the General Fund pool alone
--   athletes_supported  verified UPAs whose own fund balance is positive
--   items_funded        wishlist items that reached funded or delivered
-- ============================================================================

create function public.get_empower_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_raised', (
      select coalesce(sum(amount) filter (where direction = 'credit'), 0)
           - coalesce(sum(amount) filter (where direction = 'debit'), 0)
      from public.ledger_entries
      where account_type = 'upa_fund'
    ),
    'general_fund', public.general_fund_balance(),
    'athletes_supported', (
      select count(*)
      from public.upa_applications a
      where a.status = 'verified'
        and public.upa_fund_balance(a.id) > 0
    ),
    'items_funded', (
      select count(*)
      from public.upa_wishlist_items
      where status in ('funded', 'delivered')
    )
  );
$$;

revoke all on function public.get_empower_stats() from public;
grant execute on function public.get_empower_stats() to anon, authenticated, service_role;

-- ============================================================================
-- get_my_impact_summary: the donor's My Impact (PRD-06 FR-12, FR-13, FR-14),
-- scoped to auth.uid(). Reads only the caller's own donations (the empower
-- ledger-of-record table) and the empower tables, never another user's rows and
-- never a client-side sum. A never-donated caller gets zeros and empty arrays
-- (the caller renders the empty state; this returns structure, not null).
--   total_given         sum of the caller's own donation amounts
--   athletes_supported  distinct UPAs the caller donated to (excludes General Fund)
--   items_funded        distinct items the caller donated to that are now funded
--   donations           every donation, item ones carrying the UPA headline,
--                       the roundup as General Fund (upa_id null)
-- ============================================================================

create function public.get_my_impact_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select jsonb_build_object(
    'total_given', (
      select coalesce(sum(amount), 0) from public.donations where donor_id = v_uid
    ),
    'athletes_supported', (
      select count(distinct upa_id)
      from public.donations
      where donor_id = v_uid and upa_id is not null
    ),
    'items_funded', (
      select count(distinct d.item_id)
      from public.donations d
      join public.upa_wishlist_items i on i.id = d.item_id
      where d.donor_id = v_uid and i.status in ('funded', 'delivered')
    ),
    'donations', coalesce((
      select jsonb_agg(row_to_json(t) order by t.created_at desc)
      from (
        select
          d.id,
          d.amount,
          d.method,
          d.upa_id,
          case when d.upa_id is null then 'General Fund' else a.story_headline end as upa_name,
          d.item_id,
          i.title as item_title,
          d.created_at
        from public.donations d
        left join public.upa_applications a on a.id = d.upa_id
        left join public.upa_wishlist_items i on i.id = d.item_id
        where d.donor_id = v_uid
      ) t
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_my_impact_summary() from public;
revoke execute on function public.get_my_impact_summary() from anon;
grant execute on function public.get_my_impact_summary() to authenticated, service_role;

-- ============================================================================
-- public_upa_profile: the verified-only public projection a consumer sees
-- (PRD-06 FR-4). Returns NULL for any application that is not verified, so an
-- unverified or deactivated UPA is unresolvable by direct id (the isolation
-- gate, AT-128). total_raised is ledger-derived; each item carries its
-- funded_amount progress (the legitimate per-item use of that column).
-- ============================================================================

create function public.public_upa_profile(p_upa_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when a.id is null then null else jsonb_build_object(
    'id', a.id,
    'story_headline', a.story_headline,
    'story_body', a.story_body,
    'sport', a.sport,
    'region', a.region,
    'state', a.state,
    'photo_url', a.photo_url,
    'total_raised', public.upa_fund_balance(a.id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'title', i.title,
        'cost', i.cost,
        'funded_amount', i.funded_amount,
        'status', i.status
      ) order by i.created_at)
      from public.upa_wishlist_items i
      where i.upa_id = a.id
    ), '[]'::jsonb)
  ) end
  from (select 1) one
  left join public.upa_applications a
    on a.id = p_upa_id and a.status = 'verified';
$$;

revoke all on function public.public_upa_profile(uuid) from public;
grant execute on function public.public_upa_profile(uuid) to anon, authenticated, service_role;
