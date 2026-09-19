-- ATLITOS v2 — 0122_app_config_owned_shop_flag.sql
-- Domain: shop search (PRD-07 FR-53). Phase S1, Track A.
--
-- A single flag, `shop.owned_enabled`, false at launch, that hides the owned
-- shop (cart, checkout, orders, owned product results) without a deploy
-- (FR-53). `app_config` is a small generic key/value/public table rather than
-- a one-off boolean column so a second flag later reuses the same shape.
--
-- Enforcement is server side (ADR-011 D5): `checkout` reads this table under
-- the service role and refuses before any pricing when the flag is not true
-- (AC-11-5). Mobile hiding the owned routes is defense in depth, not the
-- boundary.
--
-- No client write, ever: the only write path is `admin_set_app_config`,
-- audited, admin only. Reads are public ONLY for rows marked `public = true`,
-- matching the `promo_banners` public-reference-content shape CLAUDE.md's
-- docs-duty section points at for this class of table.

create table public.app_config (
  key text primary key,
  value jsonb not null,
  public boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.app_config is
  'Generic key/value config, e.g. shop.owned_enabled. Rows marked public=true are readable by anon/authenticated via get_app_config or a direct select on the public column; every other row is admin/service-role only. Writes only through admin_set_app_config (audited). See PRD-07 FR-53, ADR-011 D5.';

create trigger app_config_set_updated_at
  before update on public.app_config
  for each row execute function public.set_updated_at();

alter table public.app_config enable row level security;

-- Public rows are readable by anon and authenticated; non public rows are
-- invisible to both (there are none of that shape planned yet, but the column
-- exists so a future admin-only config row does not need a second table).
create policy app_config_select_public on public.app_config
  for select to anon, authenticated
  using (public = true);

-- No insert/update/delete policy for anon/authenticated: DML denied by RLS
-- default-deny. Grants below are the second, independent lock.
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;
grant all on public.app_config to service_role;

-- ---------------------------------------------------------------------------
-- get_app_config: returns the value for a PUBLIC row only, null otherwise
-- (never distinguishes "does not exist" from "exists but private" to a
-- caller with no role, since a fine-grained 404 is not needed here and would
-- reveal the existence of a private key by its distinct null shape).
-- security definer only so it can be called before RLS makes that
-- distinction irrelevant; it re-derives `public = true` itself rather than
-- relying on the caller's own row visibility.
-- ---------------------------------------------------------------------------
create or replace function public.get_app_config(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from public.app_config where key = p_key and public = true;
$$;

comment on function public.get_app_config(text) is
  'Reads one app_config value, public rows only. Used by checkout and ai-search under the service role, and available to authenticated clients that prefer an RPC to a direct select.';

revoke all on function public.get_app_config(text) from public;
grant execute on function public.get_app_config(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_set_app_config: the only write path. SECURITY DEFINER, has_role
-- checked INSIDE (0061/0120 pattern), one audit_log row per call with
-- before/after. entity_id on audit_log is uuid not null (0003), and
-- app_config's key is text, so entity_id is a deterministic uuid derived
-- from the key: the same key always maps to the same entity_id, so its audit
-- history groups under one entity_id the way every other table's does.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_app_config(p_key text, p_value jsonb)
returns public.app_config
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.app_config;
  v_after public.app_config;
  v_entity_id uuid;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_key is null or btrim(p_key) = '' then
    raise exception 'VALIDATION: a config key is required';
  end if;
  if p_value is null then
    raise exception 'VALIDATION: a config value is required';
  end if;

  v_entity_id := ('00000000-0000-0000-0000-' || right(md5(btrim(p_key)), 12))::uuid;

  select * into v_before from public.app_config where key = btrim(p_key) for update;

  insert into public.app_config (key, value)
  values (btrim(p_key), p_value)
  on conflict (key) do update
    set value = excluded.value
  returning * into v_after;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(), 'app_config.set', 'app_config', v_entity_id,
    case when v_before.key is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after)
  );

  return v_after;
end;
$$;

comment on function public.admin_set_app_config(text, jsonb) is
  'The only write path onto app_config. admin only (checked inside, not by grant alone), one audit_log row per call. Flipping shop.owned_enabled through this is a config change, not a deploy (FR-53).';

revoke all on function public.admin_set_app_config(text, jsonb) from public;
revoke execute on function public.admin_set_app_config(text, jsonb) from anon;
grant execute on function public.admin_set_app_config(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: shop.owned_enabled = false at launch (FR-53).
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, public)
values ('shop.owned_enabled', 'false'::jsonb, true)
on conflict (key) do nothing;
