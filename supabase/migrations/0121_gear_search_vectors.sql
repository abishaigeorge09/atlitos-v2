-- ATLITOS v2 — 0121_gear_search_vectors.sql
-- Domain: shop search (PRD-07 section 11, FR-40, FR-43). Phase S1, Track A.
--
-- Installs pgvector, adds the embedding column that D2 (gear-embed) writes and
-- D1 (ai-search hybrid ranking) reads via `match_affiliate_products`. Also adds
-- the service-role-only query embedding cache D1 needs to bound Voyage cost.
-- See docs/architecture/ADR-011-shop-search-ingest-health.md D1, D2, D6.
--
-- Nothing here is a client write path: `embedding` is written only by
-- `gear-embed` under the service role (AC-11-7), and this migration itself
-- narrows the client SELECT grant on `affiliate_products` to exclude the
-- column, rather than trusting client discipline (CLAUDE.md, RLS is a floor).

-- ---------------------------------------------------------------------------
-- pgvector
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- affiliate_products.embedding: the one new column this migration adds to an
-- existing table (0086). Nullable: `embedding is null` IS the pending queue
-- (D2), not a separate flag column.
-- ---------------------------------------------------------------------------
alter table public.affiliate_products
  add column embedding extensions.vector(1024);

comment on column public.affiliate_products.embedding is
  'Voyage embedding, 1024 dims. Written only by gear-embed under service_role (AC-11-7). Null means not yet embedded; the keyword search path still serves the row. Excluded from every client select via column-level grant, never via a public view.';

-- HNSW index, cosine ops, per ADR D1. A missing/not-yet-built index leaves
-- match_affiliate_products correct via seq scan, only slower, never wrong.
create index idx_affiliate_products_embedding_hnsw
  on public.affiliate_products
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- match_affiliate_products: vector recall, service-role only. Called from
-- ai-search (Track B) after it embeds the query. Exact shape from ADR D1.
-- ---------------------------------------------------------------------------
create or replace function public.match_affiliate_products(
  query_embedding extensions.vector(1024),
  match_threshold float,
  match_count int
)
returns table(id uuid, similarity float)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select id, 1 - (embedding <=> query_embedding) as similarity
  from public.affiliate_products
  where active and embedding is not null
    and 1 - (embedding <=> query_embedding) >= match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_affiliate_products(extensions.vector(1024), float, int) is
  'Vector recall over affiliate_products.embedding, HNSW-backed, cosine similarity. service_role only: it is called from inside ai-search and gear-embed sweep paths, never directly by a client. See ADR-011 D1.';

revoke all on function public.match_affiliate_products(extensions.vector(1024), float, int) from public;
revoke execute on function public.match_affiliate_products(extensions.vector(1024), float, int) from anon, authenticated;
grant execute on function public.match_affiliate_products(extensions.vector(1024), float, int) to service_role;

-- ---------------------------------------------------------------------------
-- query_embedding_cache: sha256(lower(trim(query))) -> embedding, 10 minute
-- TTL enforced by the caller (ai-search), not here. Service role only: no
-- anon/authenticated grant at all (D6), RLS enabled with zero policies so the
-- table is fail-closed even if a grant is ever added by mistake.
-- ---------------------------------------------------------------------------
create table public.query_embedding_cache (
  query_hash text primary key,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now()
);

comment on table public.query_embedding_cache is
  'Cached Voyage query embeddings, keyed by sha256(lower(trim(query))). Service role only, no client grant, RLS enabled with zero policies. Bounds Voyage cost the way ai_spend_daily already bounds Claude cost. See ADR-011 D1, D6.';

alter table public.query_embedding_cache enable row level security;
-- No policies: default-deny for every role RLS applies to. Grants below are
-- the second, independent lock (defense in depth, matching stock_reservations
-- in RLS.md).
revoke all on public.query_embedding_cache from anon, authenticated, public;
grant all on public.query_embedding_cache to service_role;

-- ---------------------------------------------------------------------------
-- Column-level grant on affiliate_products: exclude `embedding` from every
-- client select (D6, AC-11-6, AC-11-7). Table policies are UNCHANGED
-- (0086's affiliate_products_select_public, 0120's affiliate_products_select_
-- admin both stay); this narrows the GRANT, which is what column privileges
-- actually gate, RLS policies do not see individual columns.
--
-- A separate affiliate_products_public view was rejected in ADR-011 D6: one
-- more object to keep in sync with every future column. This grant is
-- re-asserted, not merely hoped to survive, by the standing
-- embedding-column-grant check in scripts/security-invariants.sh.
-- ---------------------------------------------------------------------------
revoke select on public.affiliate_products from anon, authenticated;
grant select (
  id, title, brand, sport, category_id, skill_level, age_range,
  description, image_url, active, created_at, updated_at
) on public.affiliate_products to anon, authenticated;
