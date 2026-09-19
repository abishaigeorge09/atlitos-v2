-- ATLITOS v2 — 0126_backfill_offer_retailer_keys.sql
-- Phase S4 (ship). The 17 production offers entered by hand before 0123 have
-- retailer_key null, so gear-recheck's nightly sweep (which only fetches an
-- offer against the hosts of its programme) would never check them. Match
-- each offer's affiliate_url host to a retailer_programmes url_pattern
-- (exact host or a subdomain of it, the same rule as hostMatchesPattern in
-- _shared/fetch-page.ts) and set the key. Idempotent; offers whose host
-- matches no programme stay null and are skipped by the sweep, not struck.
update public.product_offers o
set retailer_key = p.key
from public.retailer_programmes p,
     lateral unnest(p.url_patterns) as pat(pattern)
where o.retailer_key is null
  and p.active
  and (
    lower(substring(o.affiliate_url from '^https?://([^/:]+)')) = lower(pat.pattern)
    or lower(substring(o.affiliate_url from '^https?://([^/:]+)')) like '%.' || lower(pat.pattern)
  );
