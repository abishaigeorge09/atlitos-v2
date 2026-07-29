# Proposal: coach discovery + academy enrollment IA (FB-005)

Status: PROPOSAL for founder review. Not approved, not built. Founder prompt: "the coach searching logic doesn't make sense, there is no search tab and it still opens its own tab. Think about how if someone is enrolled in an academy how would that logic work."

## The problem today
- The home search bar navigates to its own screen (`/home/search`), so "search" is a mode you enter, not a tab. Coach discovery is tangled up in this global search with no clear "find a coach" intent.
- There is no first-class notion of being ENROLLED with a coach/academy. Coaching today is per-session booking. So a player who has an ongoing relationship (an academy, a regular coach) has nowhere that models "these are MY coaches / MY academy" vs "coaches I could discover."
- Result: discovery and belonging are conflated. An enrolled player should not be "searching" for the coach they already train with; they should land in their academy.

## Core idea: separate BELONGING from DISCOVERY
A player is in exactly one of two states per coaching relationship, and the app should make the state obvious:

1. ENROLLED (has an academy / ongoing coach): the Trainings tab is their home base. It shows their academy, their coach(es), their program/batch, upcoming sessions, and progress. No search needed to reach their own coach. Discovery is secondary ("find another coach / add a sport").
2. NOT ENROLLED (free browsing): the Trainings tab shows a discovery surface, "Find a coach or academy", powered by the existing AI search scoped to coaches/academies (sport, level, location, budget), plus one-off session booking. Enrolling is the conversion.

## The academy entity (recommended model)
Model an ACADEMY as a first-class thing a player enrolls in, distinct from a one-off session:
- An academy is run by a verified coach or org; it has programs/batches (e.g. "U12 Tennis, Tue/Thu 5pm"), a roster of enrolled members, and possibly multiple coaches.
- ENROLLMENT is a membership relationship (player -> academy/program) with a lifecycle: apply/request -> coach or academy approves -> active member -> can lapse/leave. This mirrors the coach-approval and group-subscription patterns already in the codebase (reuse, do not reinvent).
- Reconcile with the existing "groups" concept: today's coaching groups/subscriptions may already be 80% of an academy (a coach + members + recurring). Recommendation: extend groups into academies (add program/batch + a clear enrolled-home surface) rather than a parallel entity. VALIDATE against the current coaching/groups schema before building.

## IA / navigation fix
- Trainings tab = the single home for the coaching relationship. Enrolled -> your academy dashboard; not enrolled -> discovery. This removes the "search opens its own tab" confusion: coach discovery lives IN Trainings, not in a floating global-search mode.
- Keep the home global search bar for cross-surface search (gear, courts, athletes, and coaches), but "find a coach to train with / enroll" is a deliberate entry inside Trainings, not the only path.
- A coach's public profile gets an "Enroll" / "Request to join" CTA (in addition to "Book a session"), which starts the enrollment lifecycle.

## Flows
- Discover: Trainings (not enrolled) -> "Find a coach or academy" -> AI search (sport/level/location/budget) -> coach/academy profile -> Book one-off OR Enroll.
- Enroll: Enroll -> request -> academy/coach approves -> player becomes a member -> Trainings now shows the academy home (program, schedule, coaches, progress).
- Belong: enrolled player opens Trainings -> lands directly on their academy, sessions, and coach chat. No searching for their own coach.

## Open questions for the founder (decide before build)
1. Is an "academy" a new entity, or do we extend the existing coaching GROUPS into academies? (Recommend: extend groups.)
2. Can a player be enrolled in MORE THAN ONE academy / sport at once? (Affects Trainings being single-home vs a list.)
3. Who approves enrollment, the coach, an academy admin, or Atlitos? (Recommend: the coach/academy, mirroring coach-approval.)
4. Does enrollment carry money (a subscription/fee) or is it free to join and pay-per-session? (Affects Razorpay + the financial invariant.)
5. Should the home global search still surface coaches at all, or should ALL coach discovery route through Trainings to avoid the "two search entries" confusion?

## Next step
Founder reviews + answers the 5 questions. Then a focused build phase: extend the schema (academy/program + enrollment lifecycle), rework the Trainings tab into enrolled-home vs discovery, and wire enroll CTAs. Validate every assumption here against the current coaching/groups code first.
