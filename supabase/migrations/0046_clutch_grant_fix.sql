-- ATLITOS v2 — 0046_clutch_grant_fix.sql
-- Domain: clutch. Epic AT-7, story AT-90 (grant correction).
--
-- 0042 over-revoked: `revoke all ... from anon` on clips, clip_likes, follows
-- and clip_comments stripped anon's SELECT as well as its writes. That broke the
-- guest-browsable published feed (FR-42/FR-3: guest gating is on ACTIONS, not
-- viewing) and creator_stats (a security_invoker view over follows/clips, which
-- needs the invoker, including anon, to hold SELECT on the underlying tables).
--
-- This restores the intended surface: anon and authenticated KEEP select on the
-- publicly browsable tables; only the write verbs are withdrawn. The RLS
-- policies from 0042 then do the scoping (clips: published only for the feed;
-- clip_likes/follows: public true; clip_comments: published/own/admin). Idempotent
-- and safe to replay on a fresh database where 0042 already carries the fix.

-- Restore anon SELECT where 0042's `revoke all` removed it, then re-assert the
-- write revokes so the end state is unambiguous regardless of prior state.
grant select on public.clips to anon, authenticated;
grant select on public.clip_likes to anon, authenticated;
grant select on public.follows to anon, authenticated;
grant select on public.clip_comments to anon, authenticated;

-- clips: no client status write; anon never inserts, authenticated inserts own
-- uploading rows (policy clips_insert_own).
revoke insert, update, delete on public.clips from anon;
revoke update, delete on public.clips from authenticated;

-- Likes and follows: RPC-only writes.
revoke insert, update, delete on public.clip_likes from anon, authenticated;
revoke insert, update, delete on public.follows from anon, authenticated;

-- Comments: authenticated insert/own-delete, never update; anon read-only.
revoke insert, update, delete on public.clip_comments from anon;
revoke update on public.clip_comments from authenticated;

-- Reports: authenticated own-row insert, resolution is RPC only; anon has no
-- report surface.
revoke update, delete on public.reports from anon, authenticated;
revoke all on public.reports from anon;
