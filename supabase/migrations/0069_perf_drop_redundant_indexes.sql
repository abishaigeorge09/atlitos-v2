-- ATLITOS v2 — 0069_perf_drop_redundant_indexes.sql
-- Domain: infra / performance. Epic AT-1, story AT-151 (Track F, perf pass).
-- Requirements: PLAN.md P8 "perf". Advisor: unused_index (14 INFO), reviewed.
--
-- DELIBERATELY NARROW. The unused_index advisor flags 13 indexes. This project
-- has no production traffic yet, so "unused" mostly means "the query path that
-- needs it has not run", NOT "no query needs it". Dropping those would be a
-- mistake: e.g. idx_clip_likes_user_id is exactly the index the Clutch feed's
-- per-viewer likes lookup (clip_likes.user_id = auth.uid()) will use, and the
-- *_status / *_trgm indexes back admin filters and gear search that simply have
-- not been exercised. Those are all KEPT and documented in RLS.md-adjacent notes;
-- see PHASE-8-STATUS.md AT-151 disposition.
--
-- This migration drops ONLY the two indexes that are genuinely REDUNDANT, i.e.
-- an exact duplicate of another index on the identical single column, so the
-- surviving index serves every lookup the dropped one could. Both dropped
-- indexes are plain B-trees shadowed by a UNIQUE-constraint index on the same
-- column; the planner already prefers the unique index, so no plan and no
-- behaviour changes:
--   1. idx_payment_intents_razorpay_order_id  -- shadowed by the UNIQUE
--      constraint index payment_intents_razorpay_order_id_key (same column).
--   2. idx_users_phone                          -- shadowed by the UNIQUE
--      constraint index users_phone_key (same column). Also flagged unused.
-- The other flagged duplicates (product_media, upa_applications) pair a full
-- index with a PARTIAL unique index and are NOT redundant, so they are kept.

drop index if exists public.idx_payment_intents_razorpay_order_id;
drop index if exists public.idx_users_phone;
