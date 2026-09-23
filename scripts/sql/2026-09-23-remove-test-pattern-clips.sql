-- ATLITOS: take down the 12 test-pattern clips in the production Clutch feed.
--
-- NOT A MIGRATION. A one-off data fix, run by a human against production
-- after reading it (SQL editor, or the Supabase MCP execute_sql). Found by the
-- 2026-09-23 iOS release audit.
--
-- Every published clip on 2026-09-23 was a synthetic ffmpeg test video
-- ("ATLITOS 0N <SPORT>" over TV noise, colour bars, a Mandelbrot fractal or
-- testsrc), including the two with real-sounding captions. Decoded on a Mac
-- with QuickLook, so this is the file content, not a simulator rendering bug.
-- A reviewer opening Clutch sees nothing but static.
--
-- 'removed' is the moderation takedown state (0041): terminal, and already
-- excluded from every feed read and every playback URL mint.
--
-- After this the feed is EMPTY. Upload real clips (founder or partner
-- athletes) before capturing screenshots or submitting.

begin;

-- 1. Preview. Expect exactly these 12 rows, all status = published.
select id, status, caption, created_at
  from public.clips
 where id in (
   'b8c0c76e-ca27-48de-8fcf-98b6ee040dc8', -- Husband s                       (04 BADMINTON, noise)
   'db5d71ba-668b-474f-9762-d8b4efb68682', -- e2e CL-10 f5386a70              (04 BADMINTON, noise)
   'd18cf904-d553-42ad-905d-708022fc9fda', -- e2e CL-10 c0a6b0d6              (02 FOOTBALL, fractal)
   '690516e5-759b-4816-b135-482bce95f16f', -- e2e CL-10 76177102              (05 SPORTS, colour bars)
   '03c6ae85-ea57-4d1e-8f6d-b44ec144dcdb', -- e2e CL-10 aa8d3117              (04 BADMINTON, noise)
   'bd8b4f7d-058a-4915-a1e3-47548060f4fb', -- e2e CL-10 e37d41fb              (03 TENNIS, pattern)
   'e0fb7284-d287-4779-9331-ed32db95f481', -- e2e CL-10 0f55036a              (02 FOOTBALL, fractal)
   '6d0a88b3-d236-4600-9395-e3021e633c5e', -- Hi                              (01 CRICKET, testsrc)
   '1e0e1559-a62a-445a-9755-740d176ab65a', -- Track F scripted proof clip     (05 SPORTS, colour bars)
   '04651620-3d76-4e65-b38b-1919fb6b778f', -- mod-url real-bytes ready probe  (04 BADMINTON, noise)
   '535154a7-fc90-4331-868d-9b4386ea01af', -- Crosscourt backhand winner...   (02 FOOTBALL, fractal)
   'f481b1d4-9e8e-41ea-b074-fac927948cc0'  -- Perfect volley finish in rain.. (01 CRICKET, testsrc)
 )
 order by created_at;

-- 2. Take them down. Aborts the whole transaction unless exactly 12 change.
do $$
declare n int;
begin
  update public.clips
     set status = 'removed'
   where status = 'published'
     and id in (
       'b8c0c76e-ca27-48de-8fcf-98b6ee040dc8', 'db5d71ba-668b-474f-9762-d8b4efb68682',
       'd18cf904-d553-42ad-905d-708022fc9fda', '690516e5-759b-4816-b135-482bce95f16f',
       '03c6ae85-ea57-4d1e-8f6d-b44ec144dcdb', 'bd8b4f7d-058a-4915-a1e3-47548060f4fb',
       'e0fb7284-d287-4779-9331-ed32db95f481', '6d0a88b3-d236-4600-9395-e3021e633c5e',
       '1e0e1559-a62a-445a-9755-740d176ab65a', '04651620-3d76-4e65-b38b-1919fb6b778f',
       '535154a7-fc90-4331-868d-9b4386ea01af', 'f481b1d4-9e8e-41ea-b074-fac927948cc0'
     );
  get diagnostics n = row_count;
  if n <> 12 then
    raise exception 'expected 12 clips taken down, got %', n;
  end if;
end $$;

-- 3. Verify: this should return zero rows.
select id, caption from public.clips where status = 'published';

commit;

-- NOT covered here, decide by hand (see the audit, section 7):
--   * venue 'Onboarding Demo Turf': hide it (check for bookings first).
--   * test profiles: 176 named 'Guest', plus 'P2 Verify Partner',
--     'P2 Verify Athlete', 'evidence-partner', 'A', 'H', 'An', 'The', 'High'.
--     These are auth users; delete through the dashboard or the
--     delete-account path, never a raw delete on public.users.
