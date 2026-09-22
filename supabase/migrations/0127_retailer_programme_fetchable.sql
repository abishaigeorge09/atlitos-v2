-- ATLITOS v2 - 0127_retailer_programme_fetchable.sql
-- Phase A3 of the admin UX rebuild (docs/PLAN-ADMIN-UX.md, A3-T2).
--
-- `fetchable` records, as data, whether gear-ingest can read a retailer's
-- product pages from the server. Amazon India answers the edge runtime's
-- fetch with a 503 bot wall (observed 2026-09-18, docs/qa/CURRENT-STATE.md),
-- so a pasted amazon.in link could never prefill the form; the admin saw
-- NO_PRODUCT_FOUND after a round trip and concluded "the link does not really
-- add in". With the flag the client says so before any request, and the URL
-- is kept as the offer link while the admin fills the fields by hand.
--
-- Nothing here is about any retailer's policy. It is the observed answer of
-- their server to ours, and it flips back to true the day it changes.

alter table public.retailer_programmes
  add column if not exists fetchable boolean not null default true;

comment on column public.retailer_programmes.fetchable is
  'Whether gear-ingest can fetch this retailer''s product pages from the edge runtime. False when the retailer answers automated fetches with a bot wall (amazon_in, 503 as of 2026-09-18). The admin form reads it to skip the round trip and keep the pasted URL as the offer link.';

update public.retailer_programmes set fetchable = false where key = 'amazon_in';
