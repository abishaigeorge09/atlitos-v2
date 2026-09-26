-- ATLITOS v2 — 0134_gear_full_text_recall.sql
--
-- Gear search recall that survives a real catalogue.
-- docs/PLAN-PAYOUTS-CLICKS-SEARCH.md Track 4.
--
-- WHY. ai-search's keyword path read the first 50 active affiliate products in
-- no particular order and only THEN scored them. With 8 products that is every
-- product. With 500 it is an arbitrary tenth of the catalogue, so a product
-- that exactly matches the query is simply never looked at, and the shopper is
-- told nothing matches. Performance is a correctness property at the 10,000
-- user target (CLAUDE.md); this was correct only while the catalogue was tiny.
--
-- NOW. A stored, weighted full text vector over title and brand (weight A)
-- and description (weight C), a GIN index, and a function that recalls the
-- best ranked products for the query's meaningful terms. Recall only: the
-- existing scoring and honesty gate in ai-search still decide what is shown,
-- and the Voyage vector recall still adds what words alone miss.
--
-- TERMS ARE OR'ED AND PREFIX MATCHED. "babolat racket" should recall every
-- Babolat product AND every racket, then let scoring and the brand hard
-- constraint pick; an AND query would recall nothing for a brand the
-- catalogue has under a slightly different noun. English stemming makes
-- "rackets" find "racket" and "shoes" find "shoe". Sport is NOT in the vector:
-- it is an enum filtered exactly, and an enum to text cast is not immutable,
-- which a generated column requires.

alter table public.affiliate_products
  add column if not exists search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(brand, '')), 'A')
    || setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored;

create index if not exists idx_affiliate_products_search_tsv
  on public.affiliate_products using gin (search_tsv);

-- Security DEFINER, with the public read rule restated inside. Clients are
-- granted affiliate_products column by column (the embedding is withheld), so
-- they cannot read search_tsv, and widening that grant would ship a tsvector
-- to every client for no reason. Instead this function reads it with its own
-- privileges and applies exactly the public policy's filter, `active`, itself,
-- returning nothing but ids and ranks. Found when the invoker version was
-- refused with "permission denied for table affiliate_products".
create or replace function public.search_affiliate_product_ids(
  p_terms text[],
  p_sport public.sport default null,
  p_limit int default 50
)
returns table (id uuid, rank real)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query tsquery;
  v_term text;
  v_clean text;
begin
  foreach v_term in array coalesce(p_terms, '{}') loop
    -- Only letters and digits reach to_tsquery, so no input can be read as
    -- tsquery syntax.
    v_clean := lower(regexp_replace(coalesce(v_term, ''), '[^A-Za-z0-9]', '', 'g'));
    if char_length(v_clean) >= 2 then
      v_query := case
        when v_query is null then to_tsquery('english', v_clean || ':*')
        else v_query || to_tsquery('english', v_clean || ':*')
      end;
    end if;
  end loop;

  if v_query is null then
    return;
  end if;

  return query
  select p.id, ts_rank_cd(p.search_tsv, v_query)
  from public.affiliate_products p
  where p.active
    and p.search_tsv @@ v_query
    and (p_sport is null or p.sport = p_sport)
  order by ts_rank_cd(p.search_tsv, v_query) desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

revoke all on function public.search_affiliate_product_ids(text[], public.sport, int) from public;
grant execute on function public.search_affiliate_product_ids(text[], public.sport, int) to anon, authenticated;
