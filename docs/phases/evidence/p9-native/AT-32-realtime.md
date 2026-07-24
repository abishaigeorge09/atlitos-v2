# AT-32 closed: realtime instant push observed on a live socket (P9, 2026-07-24)

Advisory AT-32 (from PHASE-2-STATUS cycle 3): the partner Live Today board
claimed Realtime, but a booking was only ever seen as rendered state a day
later. Rendered state proves persistence, not push. Nobody had watched a socket
receive an event at the moment of the write.

Settled by running `scripts/verify-realtime.mjs` (the AT-59 harness) against the
live project `syzzfgaudpifwvbpycyi`, anon key only, real sign-ins, no
service-role shortcut. Observed on the socket:

- Chat `postgres_changes` INSERT delivered to subscriber A after **269.5 ms**
  (second sample 585.2 ms). Non-participant C received **0** on both the same
  channel name and the unfiltered inbox channel, so the per-subscriber SELECT
  policy is evaluated before delivery.
- `court_bookings` (the exact Live Today board domain): INSERT push after
  **1657.9 ms** (via the `book-court` edge function), UPDATE push (check-in)
  after **506.8 ms** with the full row carried in `payload.new`. Cross-partner
  probes (partner B on A's exact channel+filter, and an unfiltered project-wide
  probe) each received **0**.

Not a defect, carried as owed: Part 4 (sessions channel UPDATE) did not run
because the fixture session was already in terminal state `rated`, so
`session_transition` correctly returned `INVALID_TRANSITION` before any write.
The push mechanism is identical to the two channels proven above. Re-exercise
the sessions channel with an `accepted` fixture only if that specific channel
needs its own witnessed push.

Jira: AT-32 transitioned Backlog to Done with this evidence.
