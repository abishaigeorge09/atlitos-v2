# UAT readiness: what design partners can be handed, and what they cannot

Written 2026-08-14. The founder's goal is "at the end I'll be giving it to design
partners for UAT". This is the honest statement of where that stands, including
the parts that are not ready, because a partner who hits a known wall stops
trusting everything else they are shown.

---

## 1. What is now proven, and how

Every journey below ran on an iPhone 16 Pro Max Release build against the local
Supabase stack, and every one was verified in the DATABASE rather than by a
passing assertion. That distinction is load bearing: three separate flows went
green tonight while creating nothing at all, and only a SQL check caught them.

| Journey | Flow | Proof |
|---|---|---|
| Coach creates a session type | `coach-session-type-create` | `session_types`: Powerplay batting, 45 min, Rs 1,200 |
| Coach creates a group | `coach-group-create` | `training_groups`: Evening Cricket Squad, cap 16, Rs 3,000 |
| Coach schedules, starts, marks attendance, ends | `groups-coach` | session `completed`, 3 of 3 present, ZERO ledger rows |
| Athlete joins a group, chats | `groups-athlete` | real render, 5 members, message sent |
| Athlete books a session | `athlete-book-session-funnel` | CTA flips to "Continue, Rs 500" |
| Athlete uploads a clip | `athlete-clip-upload` | `clips` row + storage objects, correct mime types |
| Comments at real length | `clutch-comments-overflow` | 36 comments, scrolls to the last, composer clear of the home indicator |

**Cross role, the strongest single result:** the group a coach creates appears on
the athlete's view of that coach as "Evening Cricket Squad, Rs 3,000/mo, 16 of 16
spots left, Join, month 1". Coach creates, athlete sees and can join. Nothing had
ever demonstrated that loop end to end.

Plus the 16 pre-existing flows, green against the local stack.

## 2. What partners MUST NOT be pointed at yet

**Do not let a partner touch a payment.** `0107`, `0108` and `0109` are applied,
so new damage is prevented, but 73 captured payments (Rs 81,000 across 5 demo
payers) are still stranded from their entity and THERE IS NO REFUND PATH for the
session case. A partner who pays and then cancels reproduces the exact condition
that is already open as task #40.

**Do not promise notifications.** Measured tonight: 15 of 15 notifications have
never been pushed, because the push sweep needs `pg_net` and two vault secrets
that only a human can add in the dashboard (task #37). A coach starting a session
notifies nobody. If a partner expects a push, they will conclude the app is
broken, and they will be right.

**Do not point them at the UPA photo on portal-life.** `0117` made that bucket
private to close a real leak, and the display needs signed URLs (task #44). One
image is currently broken there, deliberately.

## 3. Things a partner WILL notice, that are known

- **Courts shows "Finding your location..." indefinitely** on a simulator and on
  any device where location is slow, denied or unavailable. No terminal state.
- **A creator's clip grid stops at 24** with no continuation.
- **Dark mode does not apply to a running app.** Change appearance while the app
  is foregrounded and nothing happens; a cold relaunch renders correctly.
- **The Clutch comments sheet and the Session types screen are invisible to
  VoiceOver** (task #45). If any partner uses a screen reader, do not include
  those surfaces.
- **One verified coach in production is not bookable at all** (no session type,
  no availability), so they appear in browse and dead-end.

## 4. What partners should actually be asked to do

The journeys in section 1 are the ones with proof behind them. A useful UAT
script walks exactly those, in this order, because each depends on the last:

1. Coach: sign in, create a session type, set availability, create a group.
2. Coach: schedule a session for that group, start it, mark attendance, end it.
3. Athlete: sign in, find that coach, join the group, send a message in it.
4. Athlete: pick a session type, date and time, and stop AT the payment screen.
5. Athlete: post a clip, then open its comments.

Ask them to report anything that differs from what they expected, but tell them
in advance about section 3, so their feedback is about the product rather than
about a list we already have.

## 5. Environment, and why it is not production

UAT should run against a NON PRODUCTION project. Production carries fixture
pollution across five tables from a seed generator that defaulted to production
(now refused, `scripts/lib/guard-target.mjs`), and its remaining test rows are
not yet purged (task #39, needs founder authorisation because deletion is
destructive). Partners writing into that same dataset makes the cleanup harder,
not easier.

The local stack reproduces production faithfully enough to be the reference:
118 migrations from scratch, all 7 seed files, and `reset-local-fixtures.sh`
to restore state between runs. Minimum Supabase CLI is **2.114.0**; on 2.75
every authenticated edge function 401s and half the app silently fails.
