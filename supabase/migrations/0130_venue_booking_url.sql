-- ATLITOS v2 — 0120_venue_booking_url.sql
-- Release task 5 (Oct 8 plan): courts become an affiliate click out.
--
-- A venue that carries `booking_url` is booked on the partner's own site
-- (Playo, Hudle, the venue's page), not in the app. The court detail screen
-- swaps the date/slot pickers for one "Book on <site>" action that opens
-- this URL; the in-app booking flow and its routes are hidden behind
-- `COURT_IN_APP_BOOKING_ENABLED` in apps/mobile/src/lib/feature-flags.ts.
--
-- `image_url` lets an imported venue show a photo without a storage upload.
-- It is read ahead of `venue_photos` when present, so partner uploaded
-- galleries keep working unchanged.
--
-- Both columns are nullable and additive: every existing venue, policy, RPC
-- and screen behaves exactly as before until a row sets them. No RLS change,
-- the columns ride the existing `venues_select_public` (status = verified)
-- read and the service role import path (scripts/import-courts.mjs) writes
-- them, never a client.

alter table public.venues
  add column if not exists booking_url text,
  add column if not exists image_url text;

alter table public.venues
  drop constraint if exists venues_booking_url_is_http;
alter table public.venues
  add constraint venues_booking_url_is_http
  check (booking_url is null or booking_url ~ '^https?://');

alter table public.venues
  drop constraint if exists venues_image_url_is_http;
alter table public.venues
  add constraint venues_image_url_is_http
  check (image_url is null or image_url ~ '^https?://');

comment on column public.venues.booking_url is
  'Release task 5. Outbound booking page for the venue. When set, the app books through this link and hides its own slot picker for the venue.';
comment on column public.venues.image_url is
  'Release task 5. External cover photo for an imported venue, shown ahead of venue_photos when present.';
