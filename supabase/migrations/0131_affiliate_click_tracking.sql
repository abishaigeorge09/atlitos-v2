-- ATLITOS v2 — 0131_affiliate_click_tracking.sql
--
-- Records every outbound Buy tap on an affiliate offer.
-- docs/PLAN-PAYOUTS-CLICKS-SEARCH.md Track 2.
--
-- WHY. The shop is an affiliate marketplace: the monetised action is the
-- shopper leaving for the retailer. Until now that action was one line,
-- `Linking.openURL(offer.affiliateUrl)`, and nothing recorded it. So there was
-- no way to say how many shoppers were sent where, which products pull, or to
-- reconcile a retailer's commission report against anything Atlitos holds.
-- The revenue model was unmeasurable, not merely unmeasured.
--
-- HOW. The app no longer opens the stored URL itself. It calls
-- `record_affiliate_click(offer)`, which writes one row and returns the URL to
-- open. When the retailer's programme has a subid parameter configured, the
-- returned URL carries this click's id in it, so a line in the retailer's
-- report can be matched to exactly one row here. Recording must never block a
-- shopper: the client opens the plain URL if this call fails.
--
-- SUBID PARAMETERS ARE NOT SEEDED. No retailer programme is approved yet
-- (every `affiliate_tag_template` is null), and each programme names its subid
-- parameter differently. Set `retailer_programmes.subid_param` from the
-- programme's own documentation once approved; until then clicks are still
-- recorded, just without a subid in the URL.
--
-- PRIVACY AND ABUSE. The table has RLS on, zero policies and no client grant.
-- Only the definer function writes it and only admins read aggregates. A call
-- with no session at all records nothing and returns the plain URL, so the
-- anon key alone cannot fill the table. Every app visitor has at least an
-- anonymous session, so real browsing is still counted. A repeat tap on the
-- same offer by the same user within 10 seconds returns the same click rather
-- than a second row, so double taps do not inflate counts.

alter table public.retailer_programmes
  add column if not exists subid_param text
    check (subid_param is null or subid_param ~ '^[A-Za-z0-9_]{1,40}$');

comment on column public.retailer_programmes.subid_param is
  'Query parameter the programme reports back per click (set from the programme''s own docs once approved). Null means clicks are recorded without a subid.';

create table public.affiliate_clicks (
  -- This id IS the subid appended to the outbound URL.
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.product_offers (id) on delete cascade,
  affiliate_product_id uuid not null references public.affiliate_products (id) on delete cascade,
  retailer_key text,
  user_id uuid references auth.users (id) on delete set null,
  surface text not null check (surface in ('compare', 'search', 'home')),
  target_url text not null,
  subid_applied boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.affiliate_clicks is
  'One row per outbound Buy tap. Written only by record_affiliate_click; read only through admin aggregates. RLS on, zero policies.';

create index idx_affiliate_clicks_product_created on public.affiliate_clicks (affiliate_product_id, created_at desc);
create index idx_affiliate_clicks_created on public.affiliate_clicks (created_at desc);
create index idx_affiliate_clicks_user_offer_created on public.affiliate_clicks (user_id, offer_id, created_at desc)
  where user_id is not null;

alter table public.affiliate_clicks enable row level security;
revoke all on table public.affiliate_clicks from public, anon, authenticated;
grant select, insert, update, delete on table public.affiliate_clicks to service_role;

-- Append `param=value` to a URL, before any fragment, with the right joiner.
create or replace function public._url_with_param(p_url text, p_param text, p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_base text := split_part(p_url, '#', 1);
  v_fragment text := case when position('#' in p_url) > 0 then substr(p_url, position('#' in p_url)) else '' end;
begin
  return v_base
    || case when position('?' in v_base) > 0 then (case when right(v_base, 1) in ('?', '&') then '' else '&' end) else '?' end
    || p_param || '=' || p_value
    || v_fragment;
end;
$$;

create or replace function public.record_affiliate_click(p_offer_id uuid, p_surface text default 'compare')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.product_offers;
  v_param text;
  v_click public.affiliate_clicks;
  v_id uuid := gen_random_uuid();
  v_url text;
begin
  if p_surface not in ('compare', 'search', 'home') then
    raise exception 'VALIDATION: surface must be compare, search or home';
  end if;

  select o.* into v_offer
  from public.product_offers o
  join public.affiliate_products p on p.id = o.affiliate_product_id and p.active
  where o.id = p_offer_id;

  if v_offer.id is null then
    raise exception 'NOT_FOUND: that offer is no longer listed';
  end if;

  -- No session at all: send the shopper on, record nothing.
  if v_uid is null then
    return jsonb_build_object('click_id', null, 'url', v_offer.affiliate_url, 'recorded', false);
  end if;

  select * into v_click from public.affiliate_clicks
  where user_id = v_uid and offer_id = p_offer_id and created_at > now() - interval '10 seconds'
  order by created_at desc
  limit 1;
  if v_click.id is not null then
    return jsonb_build_object('click_id', v_click.id, 'url', v_click.target_url, 'recorded', true);
  end if;

  select subid_param into v_param from public.retailer_programmes where key = v_offer.retailer_key;
  v_url := case when v_param is null then v_offer.affiliate_url
                else public._url_with_param(v_offer.affiliate_url, v_param, v_id::text) end;

  insert into public.affiliate_clicks (id, offer_id, affiliate_product_id, retailer_key, user_id, surface, target_url, subid_applied)
  values (v_id, v_offer.id, v_offer.affiliate_product_id, v_offer.retailer_key, v_uid, p_surface, v_url, v_param is not null)
  returning * into v_click;

  return jsonb_build_object('click_id', v_click.id, 'url', v_click.target_url, 'recorded', true);
end;
$$;

-- Admin aggregate: clicks per product and retailer over the last N days.
create or replace function public.admin_affiliate_click_stats(p_days int default 30)
returns table (
  affiliate_product_id uuid,
  title text,
  retailer_key text,
  clicks bigint,
  shoppers bigint,
  with_subid bigint,
  last_click_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'VALIDATION: days must be between 1 and 365';
  end if;

  return query
  select c.affiliate_product_id, p.title, c.retailer_key,
         count(*)::bigint,
         count(distinct c.user_id)::bigint,
         count(*) filter (where c.subid_applied)::bigint,
         max(c.created_at)
  from public.affiliate_clicks c
  join public.affiliate_products p on p.id = c.affiliate_product_id
  where c.created_at > now() - make_interval(days => p_days)
  group by c.affiliate_product_id, p.title, c.retailer_key
  order by count(*) desc, max(c.created_at) desc;
end;
$$;

revoke all on function public._url_with_param(text, text, text) from public, anon, authenticated;
grant execute on function public._url_with_param(text, text, text) to service_role;
revoke all on function public.record_affiliate_click(uuid, text) from public;
grant execute on function public.record_affiliate_click(uuid, text) to anon, authenticated;
revoke all on function public.admin_affiliate_click_stats(int) from public, anon;
grant execute on function public.admin_affiliate_click_stats(int) to authenticated;
