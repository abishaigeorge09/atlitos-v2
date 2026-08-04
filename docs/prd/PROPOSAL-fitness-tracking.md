# PROPOSAL: Self-directed fitness tracking (phase-2 epic)

Status: Proposal for founder review. NOT scheduled. Phase-2 epic.
Owner surface: `apps/mobile` (Expo), athlete/player role
Relates to: PRD-01 athlete (Learn, Trainings), PRD-02 coach (coach-authored plans)
Schema domain (new): `fitness` (workouts, sets, metrics), see section 4

---

## 0. Why this is a separate proposal, not part of the current phase

The founder chose "both, phased." Phase 11 surfaced the existing Learn journey
(roadmap, drills, XP, milestones) as a first-class Trainings tab, tied to the
player's primary sport. That work is coaching-centric: the content is authored
by the platform and the player follows it to level up a skill ladder.

This proposal is the other half: real, self-directed fitness tracking, where the
player logs their own activity (a run, a gym session, reps, distance, time),
sees metrics and trends over time, and can follow a day-to-day plan a coach
wrote for them. It introduces new write-heavy schema and a new daily-logging
surface. It is deliberately deferred so Learn ships first and this lands on top
of a consistent primary-sport model rather than racing it.

This document is intentionally concise: enough to scope the epic and surface the
decisions the founder needs to make before it is planned. It is not a full PRD.

---

## 1. Problem

Today the app measures a player only through coaching sessions (hours trained,
sessions this month, payments) and Learn XP. Nothing lets a player record what
they actually did on their own: the 5 km they ran this morning, the squats they
hit at the gym, the 30-minute skills session with no coach present. So:

- Progress feels tied to spending money on coaches, not to daily effort.
- A coach cannot hand a player a structured week ("Mon: intervals, Tue: rest,
  Wed: strength") and see whether the player followed it.
- There is no trend data, so neither the player nor a coach can see improvement
  in distance, pace, volume, or consistency over weeks.

## 2. Who it is for

- **Player (primary):** logs their own workouts, watches their own trends, and
  optionally follows a plan a coach assigned. Self-directed by default.
- **Coach (secondary):** authors a plan (a sequence of prescribed workouts by
  day) and assigns it to a trainee, then sees adherence. Authoring lives in the
  coach surface (PRD-02), not here; this proposal only covers the player
  following it and the coach reading results.

## 3. Scope

### In scope (the epic)

1. Log a workout: type (run, gym, skills, mobility, other), date, duration,
   and type-appropriate detail (distance and pace for a run, exercises with
   sets/reps/weight for gym, free notes otherwise).
2. A player fitness log: reverse-chronological list of logged workouts, edit
   and delete own entries.
3. Metrics and trends: per-metric charts over time (weekly volume, run distance,
   total minutes, streak/consistency), all derived server side from the log,
   never a client-held counter (same discipline as Learn XP).
4. Coach-authored plans a player follows: a coach assigns a plan; the player
   sees today's prescribed workout and marks it done, which creates a linked
   log entry; the coach sees adherence.
5. Surface hooks: a "This week" summary on the Trainings dashboard and an entry
   point from the Learn tab, so tracking sits beside the coaching spine rather
   than as a disconnected module.

### Explicitly out of scope (guardrails)

- No wearable, Apple Health, Google Fit, or GPS integration in v1. Manual entry
  only. Device sync is its own later decision (open question Q4).
- No social feed of workouts, no leaderboards. Clutch stays the social surface.
- No money. Plans are part of the existing coaching relationship; assigning or
  following a plan never creates a charge here (a coach monetizes through
  sessions/groups, PRD-01/02). Financial invariant untouched.
- No nutrition, sleep, or bodyweight/measurement tracking in v1 (open question).

## 4. New schema (sketch, `fitness` domain)

Additive, owner-scoped, RLS a floor not a scope (CLAUDE.md). Names indicative.

- `workout_logs` — one row per logged/completed workout. `user_id` owner,
  `workout_type`, `performed_on` (date), `duration_minutes`, `notes`,
  `source` (self vs plan), optional `plan_day_id` link, timestamps.
- `workout_sets` — child rows for strength/interval detail: `workout_log_id`,
  `exercise`, `set_index`, `reps`, `weight`, `distance`, `time_seconds`. Nullable
  by type so a run row uses distance/time and a lift row uses reps/weight.
- `workout_metrics` — a read layer, not a store: metrics/trends are DERIVED at
  read time from `workout_logs`/`workout_sets` via a `get_fitness_summary()`
  SECURITY DEFINER RPC (the `get_learn_home` house pattern), so totals and
  streaks are un-forgeable and there is no denormalized counter to drift.
- `training_plans` and `plan_days` — a coach-authored plan and its per-day
  prescribed workouts. A player is linked through an assignment row scoped to an
  existing coach/trainee relationship; following a plan day writes a
  `workout_logs` row with `source = 'plan'` and the `plan_day_id` set.

Every per-user read carries an explicit `user_id = auth.uid()` (or the
relationship join for coach reads), not RLS alone. Writes that cross the
coach/player boundary (assigning a plan, a coach reading a trainee's adherence)
go through SECURITY DEFINER RPCs that verify the relationship, mirroring the
existing coaching RPCs.

## 5. Rough shape of the work

- Schema domain migration for `fitness` + RLS + the `get_fitness_summary` read
  RPC and the plan-assignment/adherence RPCs.
- `apps/mobile`: a Log workout flow, a fitness log list, a trends screen (charts
  from the summary RPC), and a "today's prescribed workout" card when a plan is
  assigned. Reuses existing tokens, StatTile, chart primitives.
- `apps/mobile` coach surface + PRD-02: plan authoring and an adherence read on
  the trainee detail.
- Docs: new `fitness` sections in SCHEMA.md, RLS.md, API-MAPPING.md, and PRD-01
  FR additions plus PRD-02 FR additions for the coach half.

## 6. Open questions for the founder

1. **Plan authoring depth.** v1 minimum is a coach assigning a simple day-by-day
   plan. Is a reusable plan template library (author once, assign to many) in
   scope for the first cut, or a fast-follow?
2. **Metrics that matter.** Which trends are worth charting first for Indian
   student athletes: run distance/pace, gym volume, total active minutes,
   consistency streak? Pick the 2 to 3 that motivate, rather than build all.
3. **Sport-specificity.** Should logging adapt per primary sport (a cricket net
   session vs a runner's intervals), or stay a small fixed set of generic types
   in v1 with sport only as a tag?
4. **Device sync later.** Is manual-only acceptable indefinitely for the target
   user, or is Apple Health / Google Fit / a wearable a known phase-3 need we
   should shape the schema around now (e.g. a `source` and external-id column)?
5. **Relationship to Learn XP.** Should completing a logged workout or a plan day
   award Learn XP (unifying the two progress systems), or do fitness trends and
   Learn XP stay separate scores so coaching skill progress is not diluted by
   raw activity volume?
6. **Privacy.** Is a player's fitness log visible to any assigned coach by
   default, only to a coach whose plan they are following, or strictly private
   until the player shares it?
