-- ATLITOS v2 — 0120_admin_data_entry.sql
-- Domain: admin (PRD-04). Data entry for the launch catalog.
--
-- Before launch two team members enter the real gear catalog and the real court
-- listings by hand. Neither had a write path: affiliate_products / product_offers
-- are service-role only (0086) and venues are created only by a court partner
-- from the court portal (0009). This migration gives the admin app an audited,
-- validated RPC for each, in the exact shape of admin_upsert_drill (0061):
-- SECURITY DEFINER, has_role('admin') checked INSIDE, one audit_log row per
-- accepted mutation, readable VALIDATION: refusals the form can show.
--
-- Courts, for the time being, are an affiliate link (founder decision recorded
-- in the launch tracker, 9 Sep): a venue can carry a `booking_url` that points
-- at the venue's own booking site. The app's click-out on that link is a
-- separate change; this migration only makes the data enterable.
--
-- Admin-created venues are owned by the admin who entered them
-- (partner_user_id = auth.uid(), the column is NOT NULL) and are `verified` by
-- construction: an admin entering a listing is the verification.

-- ---------------------------------------------------------------------------
-- venues.booking_url: the external booking link (affiliate model for courts)
-- ---------------------------------------------------------------------------
alter table public.venues add column if not exists booking_url text;

comment on column public.venues.booking_url is
  'External booking link for the venue (affiliate model). When set, the app sends the athlete to this URL instead of the in-app slot picker.';

-- ---------------------------------------------------------------------------
-- affiliate_products: admins may read the whole catalog, including inactive
-- rows (0086 only exposed active = true to authenticated). Same shape as
-- venues_select_admin (0009). Writes stay RPC-only.
-- ---------------------------------------------------------------------------
create policy affiliate_products_select_admin on public.affiliate_products
  for select to authenticated
  using (public.has_role('admin'));

create policy product_offers_select_admin on public.product_offers
  for select to authenticated
  using (public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- admin_upsert_affiliate_product: create (p_id null) or edit one gear item
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_affiliate_product(
  p_id uuid,
  p_title text,
  p_brand text,
  p_sport public.sport,
  p_category_id uuid,
  p_skill_level text,
  p_age_range text,
  p_description text,
  p_image_url text
)
returns public.affiliate_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.affiliate_products;
  v_after public.affiliate_products;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'VALIDATION: a product title is required';
  end if;
  if p_category_id is not null and not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'VALIDATION: unknown category';
  end if;

  if p_id is null then
    insert into public.affiliate_products
      (title, brand, sport, category_id, skill_level, age_range, description, image_url)
    values (
      btrim(p_title),
      nullif(btrim(coalesce(p_brand, '')), ''),
      p_sport,
      p_category_id,
      nullif(btrim(coalesce(p_skill_level, '')), ''),
      nullif(btrim(coalesce(p_age_range, '')), ''),
      nullif(btrim(coalesce(p_description, '')), ''),
      nullif(btrim(coalesce(p_image_url, '')), '')
    )
    returning * into v_after;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
    values (auth.uid(), 'affiliate_product.create', 'affiliate_product', v_after.id, null, to_jsonb(v_after));
    return v_after;
  end if;

  select * into v_before from public.affiliate_products where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: product % does not exist', p_id;
  end if;

  update public.affiliate_products
  set title = btrim(p_title),
      brand = nullif(btrim(coalesce(p_brand, '')), ''),
      sport = p_sport,
      category_id = p_category_id,
      skill_level = nullif(btrim(coalesce(p_skill_level, '')), ''),
      age_range = nullif(btrim(coalesce(p_age_range, '')), ''),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      image_url = nullif(btrim(coalesce(p_image_url, '')), '')
  where id = p_id
  returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'affiliate_product.update', 'affiliate_product', p_id, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end;
$$;

revoke all on function public.admin_upsert_affiliate_product(uuid, text, text, public.sport, uuid, text, text, text, text) from public;
revoke execute on function public.admin_upsert_affiliate_product(uuid, text, text, public.sport, uuid, text, text, text, text) from anon;
grant execute on function public.admin_upsert_affiliate_product(uuid, text, text, public.sport, uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_set_affiliate_product_active: list or delist, never delete
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_affiliate_product_active(p_id uuid, p_active boolean)
returns public.affiliate_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.affiliate_products;
  v_after public.affiliate_products;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  select * into v_before from public.affiliate_products where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: product % does not exist', p_id;
  end if;
  update public.affiliate_products set active = p_active where id = p_id returning * into v_after;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    case when p_active then 'affiliate_product.activate' else 'affiliate_product.deactivate' end,
    'affiliate_product', p_id,
    jsonb_build_object('active', v_before.active),
    jsonb_build_object('active', v_after.active)
  );
  return v_after;
end;
$$;

revoke all on function public.admin_set_affiliate_product_active(uuid, boolean) from public;
revoke execute on function public.admin_set_affiliate_product_active(uuid, boolean) from anon;
grant execute on function public.admin_set_affiliate_product_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_upsert_product_offer: one retailer price + link on a gear item.
-- (affiliate_product_id, retailer) is unique (0086), so re-entering the same
-- retailer updates the price in place rather than creating a duplicate.
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_product_offer(
  p_affiliate_product_id uuid,
  p_retailer text,
  p_price numeric,
  p_affiliate_url text,
  p_in_stock boolean default true,
  p_currency text default 'INR'
)
returns public.product_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.product_offers;
  v_after public.product_offers;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if not exists (select 1 from public.affiliate_products where id = p_affiliate_product_id) then
    raise exception 'NOT_FOUND: product % does not exist', p_affiliate_product_id;
  end if;
  if p_retailer is null or btrim(p_retailer) = '' then
    raise exception 'VALIDATION: a retailer name is required';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'VALIDATION: price must be zero or more';
  end if;
  if p_affiliate_url is null or btrim(p_affiliate_url) !~ '^https?://' then
    raise exception 'VALIDATION: the affiliate link must start with http:// or https://';
  end if;

  select * into v_before
  from public.product_offers
  where affiliate_product_id = p_affiliate_product_id and retailer = btrim(p_retailer)
  for update;

  insert into public.product_offers
    (affiliate_product_id, retailer, price, currency, affiliate_url, in_stock, last_checked_at)
  values
    (p_affiliate_product_id, btrim(p_retailer), p_price, coalesce(nullif(btrim(p_currency), ''), 'INR'),
     btrim(p_affiliate_url), coalesce(p_in_stock, true), now())
  on conflict (affiliate_product_id, retailer) do update
    set price = excluded.price,
        currency = excluded.currency,
        affiliate_url = excluded.affiliate_url,
        in_stock = excluded.in_stock,
        last_checked_at = now()
  returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    case when v_before.id is null then 'product_offer.create' else 'product_offer.update' end,
    'product_offer', v_after.id,
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after)
  );
  return v_after;
end;
$$;

revoke all on function public.admin_upsert_product_offer(uuid, text, numeric, text, boolean, text) from public;
revoke execute on function public.admin_upsert_product_offer(uuid, text, numeric, text, boolean, text) from anon;
grant execute on function public.admin_upsert_product_offer(uuid, text, numeric, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_delete_product_offer: an offer is a price row, not a record of anything
-- that happened, so removing a wrong retailer line is allowed (audited).
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_product_offer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.product_offers;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  delete from public.product_offers where id = p_id returning * into v_before;
  if not found then
    raise exception 'NOT_FOUND: offer % does not exist', p_id;
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'product_offer.delete', 'product_offer', p_id, to_jsonb(v_before), null);
end;
$$;

revoke all on function public.admin_delete_product_offer(uuid) from public;
revoke execute on function public.admin_delete_product_offer(uuid) from anon;
grant execute on function public.admin_delete_product_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_create_venue: one venue plus its courts in one transaction.
-- p_courts is a JSON array of {sport, name, capacity, base_price_per_hour}.
-- At least one court is required because the Courts tab lists courts, not
-- venues: a venue with no court is invisible to every athlete.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_venue(
  p_name text,
  p_address text,
  p_city text,
  p_pincode text,
  p_lat double precision,
  p_lng double precision,
  p_description text,
  p_booking_url text,
  p_courts jsonb
)
returns public.venues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue public.venues;
  v_court jsonb;
  v_sport public.sport;
  v_court_name text;
  v_price numeric;
  v_capacity int;
  v_count int := 0;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'VALIDATION: a venue name is required';
  end if;
  if p_address is null or btrim(p_address) = '' then
    raise exception 'VALIDATION: an address is required';
  end if;
  if p_city is null or btrim(p_city) = '' then
    raise exception 'VALIDATION: a city is required';
  end if;
  if p_pincode is null or btrim(p_pincode) !~ '^[0-9]{6}$' then
    raise exception 'VALIDATION: pincode must be six digits';
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'VALIDATION: latitude and longitude go together';
  end if;
  if p_lat is not null and (p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180) then
    raise exception 'VALIDATION: latitude or longitude out of range';
  end if;
  if p_booking_url is not null and btrim(p_booking_url) <> '' and btrim(p_booking_url) !~ '^https?://' then
    raise exception 'VALIDATION: the booking link must start with http:// or https://';
  end if;
  if p_courts is null or jsonb_typeof(p_courts) <> 'array' or jsonb_array_length(p_courts) = 0 then
    raise exception 'VALIDATION: add at least one court';
  end if;

  insert into public.venues
    (partner_user_id, name, address, city, pincode, lat, lng, description, status, booking_url)
  values (
    auth.uid(), btrim(p_name), btrim(p_address), btrim(p_city), btrim(p_pincode), p_lat, p_lng,
    nullif(btrim(coalesce(p_description, '')), ''), 'verified',
    nullif(btrim(coalesce(p_booking_url, '')), '')
  )
  returning * into v_venue;

  for v_court in select * from jsonb_array_elements(p_courts) loop
    v_court_name := nullif(btrim(coalesce(v_court->>'name', '')), '');
    if v_court_name is null then
      raise exception 'VALIDATION: every court needs a name';
    end if;
    begin
      v_sport := (v_court->>'sport')::public.sport;
    exception when others then
      raise exception 'VALIDATION: court "%" has an unknown sport', v_court_name;
    end;
    v_price := (v_court->>'base_price_per_hour')::numeric;
    if v_price is null or v_price < 0 then
      raise exception 'VALIDATION: court "%" needs a price per hour of zero or more', v_court_name;
    end if;
    v_capacity := nullif(v_court->>'capacity', '')::int;
    insert into public.courts (venue_id, sport, name, capacity, base_price_per_hour)
    values (v_venue.id, v_sport, v_court_name, v_capacity, v_price);
    v_count := v_count + 1;
  end loop;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(), 'venue.admin_create', 'venue', v_venue.id, null,
    to_jsonb(v_venue) || jsonb_build_object('courts', v_count)
  );
  return v_venue;
end;
$$;

revoke all on function public.admin_create_venue(text, text, text, text, double precision, double precision, text, text, jsonb) from public;
revoke execute on function public.admin_create_venue(text, text, text, text, double precision, double precision, text, text, jsonb) from anon;
grant execute on function public.admin_create_venue(text, text, text, text, double precision, double precision, text, text, jsonb) to authenticated;
