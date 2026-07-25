# Coach Trainings: Figma prototype screen inventory and gap analysis

Date: 2026-07-25. Source: Figma prototype "Atlitos App (Copy)" (file `on08qE5ahPOXBYekeQt9nk`), flow **Coach Profile** (start node `1047:11798`), walked view-only in the proto player with the flows sidebar. The prototype has 4 flows: Coach Profile, Atlitos Life 1, Guest Login & Profile Setup, Player Proile [sic]; only Coach Profile is in scope here.

Screenshots were captured to a local temp directory during the walkthrough (`/var/folders/7r/.../claude-chrome-screenshots-O72jpW/screenshot-*.jpg`); the four groups-critical ones are also copied to the session scratchpad under `figma-coach-trainings/`. Filenames below are the temp-dir basenames. Figma node ids are given so any screen can be reopened directly with `?node-id=<id>` on the proto URL.

## Design screen inventory (Coach Profile flow)

The flow enters through the shared app Home and the coach five-tab Trainings shell: **Stats, Trainees, Earnings, Chat, Analytics**. 19 distinct Trainings screens/states were found (the flow also passes 4 marketplace screens: Home, Football Gears list, My Cart, Order Summary with the "Support a Rising Athlete" upsell, which are out of scope here).

Not wired in the prototype (hotspots exist visually but do nothing): the trainee list filter chips, the chat rows to a conversation, Reschedule/Cancel Session, End Session, Upload Clip, the video upload FAB, and the card 3-dot menus.

| # | Design screen (node id) | Key elements | Built status | Screenshot |
|---|---|---|---|---|
| 1 | Coach dashboard "Your Coaching Stats" (`1047:13282`) | 6 stat tiles (Players Coached 32, Avg Rating 4.2/5, Total Sessions 100, Sessions This Month 24, Total Earnings 25,000, Earnings This Month 10,000); Upcoming Sessions carousel + View All; Session Requests inline with Decline/Accept + View All; Milestones and Rewards (badges + View More) | PARTIAL. `(shell)/index.tsx` has 4 tiles (no Total Sessions / Total Earnings), upcoming list, requests preview with accept/decline. Milestones rail exists only on the athlete branch, not the coach dashboard. | `screenshot-1784979673074-13.jpg`, `-53.jpg`, `-54.jpg` |
| 2 | My Trainees (`1047:13612`) | Filter chips All / 1-on-1 Trainees / Group Trainees / Online (chips not wired in proto); 1-on-1 cards (Total Sessions till date, Next Session) interleaved with Group/Team cards (Group Name, Total Sessions, Next Session); 3-dot menu per card | PARTIAL. `(shell)/trainees.tsx` is a flat 1-on-1 list (avatar, session count, last session, Active chip). No filter chips, no Next Session field, no group cards, no online distinction. | `screenshot-1784979694566-20.jpg` (also scratchpad `my-trainees-all-with-group-card.jpg`) |
| 3 | Player Profile, Overview tab (`1047:13934`) | Tabs Overview/Sessions/Payments/Notes/Video Analytics; player card (Role, Batting Style, Bowling Style, Skill Level, Playing Frequency, Experience, DOB, Gender, State, Location); Total Sessions + Attendance Rate 76% tiles | PARTIAL. `trainee/[id].tsx` is a single-screen session history with a Message button. No tab set, no player attribute card, no attendance rate. Sport attributes exist on `users`/profile so this is mostly UI. | `screenshot-1784979852899-33.jpg` |
| 4 | Player Profile, Sessions tab (`1047:14312`) | Upcoming Sessions + All Sessions, rows with Session Type "1-on-1 session", Focus Area, Location, Status (Completed) | BUILT (different shape). `trainee/[id].tsx` shows full history with status pills; no upcoming/all split. | `screenshot-1784979543719-0.jpg` |
| 5 | Player Profile, Payments tab | Per-trainee payment rows (date, amount, Status: Due) | MISSING as a per-trainee view. Money data exists (sessions + ledger) so this is pure UI, but note the design implies a "Due" state; in the built model payment is captured before `requested`, so "Due" contradicts the payments invariant and should be dropped, not built. | `screenshot-1784979723974-23.jpg` |
| 6 | Player Profile, Notes tab (`1047:16548`) | Free-text coach notes with timestamps, add-note FAB | MISSING. No coach-notes table exists (`sessions.remarks` is the only free text). Needs a small `coach_trainee_notes` table (coach_id, player_id, text, created_at) + RLS; UI itself is trivial. | `screenshot-1784979735622-25.jpg` |
| 7 | Add Notes composer (`1047:16709`) | Full-screen composer, X/confirm | MISSING (same blocker as #6). | `screenshot-1784979751564-28.jpg` |
| 8 | Player Profile, Video Analytics tab (`1047:16588`) | Empty state "No Data Found", upload FAB | MISSING. Per-trainee video review is not built; needs video storage/link rows scoped coach-to-player (VIDEO.md pipeline exists for other domains). Empty state is pure UI. | `screenshot-1784979804451-31.jpg` |
| 9 | Group/Team Profile, Overview (`1047:14094`) | Same tab set as player profile; group card (Total Players: 6, Skill Level, Playing Frequency, Experience...); Total Sessions + Attendance Rate tiles; **Team Members list (6 members, name + role)** | MISSING. Schema blocker: no groups/teams tables at all. | `screenshot-1784979852899-33.jpg`, `screenshot-1784979868015-36.jpg` (scratchpad `group-profile-team-members.jpg`) |
| 10 | Group/Team Profile, Sessions tab (`1047:14630`) | Upcoming + All sessions with Session Type "Group session", statuses Completed / Cancelled / Rescheduled | MISSING. Schema blocker: `sessions` has a single `player_id`; a group session has no representation. | `screenshot-1784979886881-37.jpg`, `-38.jpg` |
| 11 | Session Requests screen (`1047:14952`) | Filter chips All / 1-on-1 / Group / Online; request cards of all three types (player 1-on-1, Team/Group "Group Session", player "Online Session"), each Decline/Accept | PARTIAL. `requests.tsx` exists (list + accept/decline, no filters). Online filter is representable today (`session_types.name` can be "online"); the Group chip and group request cards are schema-blocked. | `screenshot-1784980130492-58.jpg`, `-59.jpg` (scratchpad `session-requests-group-online.jpg`) |
| 12 | Upcoming Sessions screen (`1047:15461`) | Same All / 1-on-1 / Group / Online chips; mixed upcoming session cards | PARTIAL. Coach upcoming renders only as the dashboard section; no dedicated filtered list screen. 1-on-1/Online list is pure UI; Group is schema-blocked. | `screenshot-1784980172720-61.jpg`, `-62.jpg` |
| 13 | Session Details, pre-session (`1047:15925`) | Group session summary (Session Duration field) + Start Session / Reschedule Session / Cancel Session | PARTIAL. `session/[id].tsx` covers reschedule (slot recompute) and cancel with reason for 1-on-1 sessions. There is no "Start Session" concept: the session state machine has no in-progress state. Group variant schema-blocked. | `screenshot-1784980217083-64.jpg` |
| 14 | Start Group Session, attendance (`1047:16031`) | **Per-member presence toggles for all 6 members + Mark Attendance CTA** | MISSING. Schema blocker: no session participants table and no attendance table, so there is nothing to toggle. | `screenshot-1784980264106-68.jpg`, `-69.jpg` (scratchpad `start-group-session-attendance.jpg`) |
| 15 | Session Details, in-session (`1047:15978`) | End Session / Upload Clip / Add Notes | MISSING. Needs the in-progress state (state machine change via RPC, never client), clip upload (video infra), notes (#6 table). Built flow goes straight to Mark Complete via `complete-session`. | `screenshot-1784980288129-71.jpg` |
| 16 | My Earnings (`1047:15107`) | Earnings Overview 40000.00, Send + Transfer actions, This Month, Pending Payments, transactions grouped by month (One-time / Monthly) | BUILT. `(shell)/earnings.tsx` + `earnings/transfer.tsx` + `earnings/payout-setup.tsx`: wallet balance from ledger, Send=payout setup, Transfer flow, month-grouped filterable list. Pending Payments tile not shown but the underlying reads exist. | `screenshot-1784979996327-45.jpg`, `-46.jpg` |
| 17 | Chats list | 1:1 threads with unread badge + **group thread "Cric Squad"** ("Rohan: Okay, let's shortlist a date first...") | PARTIAL. `(shell)/chat.tsx` + ChatThreadList + `chat-thread/[id]` cover 1:1 fully. Group chat is schema-blocked: `chat_threads` is hard-shaped 2-party (`participant_a < participant_b`, unique pair). | `screenshot-1784980428574-79.jpg` |
| 18 | Video Analytics tab (coach) (`1047:15394`) | "Review trainee videos" intro, No Data Found, upload FAB | DIVERGED. Built `(shell)/analytics.tsx` is numeric coach analytics (sessions/hours/earnings/rating trends, PRD-02 FR-32/33), not video. Video review remains MISSING (same blocker as #8). | `screenshot-1784980027074-50.jpg` |
| 19 | Home entry (`1047:11798`) | App home with bottom tab Trainings entry | BUILT (module entry exists; visual differences out of scope). | `screenshot-1784979563383-1.jpg` |

Built screens with no counterpart in this prototype flow (not gaps, additions): `availability.tsx` (FR-23), `verification.tsx` + CoachVerificationStatus gating, `(shell)/payments.tsx` and `(shell)/coaches.tsx` (athlete-role tabs), `booking/[id]`, `coach/[id]`.

## What MISSING requires

**Pure UI (no schema change), buildable now**

- Trainee filter chips for All / 1-on-1 / Online on Trainees, Requests, and a new coach Upcoming Sessions list screen (`session_types.name` already distinguishes "online").
- Player Profile tabbed layout: Overview attribute card (profile data exists), Sessions tab split (upcoming/all), per-trainee Payments tab (read from existing player-scoped session rows; drop the design's "Due" status, payment precedes `requested`).
- Dashboard parity: Total Sessions + Total Earnings tiles, Milestones rail on the coach branch.
- Attendance Rate tile for 1-on-1 trainees can be derived today as completed/(completed+cancelled) if the founder accepts that definition; true attendance needs the attendance table below.

**Needs new schema, no group dependency**

- Coach notes (#6, #7): new `coach_trainee_notes` table + RLS (coach-owned, athlete never reads unless product says so). Small migration.
- Trainee video review (#8, #18): storage bucket + a `coach_trainee_videos` (or reuse of the existing video pipeline) linking table.

**Blocked on the groups schema (the big one: #2 group cards, #9, #10, #11 group requests, #13 group variant, #14, #17 group chat)**

Today `sessions` is strictly 1:1 (`coach_id` + single `player_id`); there are no group, membership, capacity, participants, or attendance tables, and `chat_threads` is constrained to exactly two participants. Minimum schema to unblock the group screens:

1. `training_groups` (id, coach_id, name, sport, skill_level, capacity, active) and `training_group_members` (group_id, player_id, joined_at, unique pair).
2. Session participation: either `sessions.group_id` nullable FK plus a `session_participants` (session_id, player_id, attendance_status) table, or keep `sessions.player_id` for 1:1 and require `session_participants` for group rows. Money invariant: a group session's price/total per participant must stay RPC-written; the booking state machine RPCs (`session_transition`, `complete-session`) need group-aware variants.
3. Attendance (#14): `session_participants.attendance_status` (present/absent, marked_at) written by an RPC at session start; Attendance Rate then becomes a real read for both player and group profiles.
4. Group chat (#17): `chat_threads` cannot express it; either a new `chat_thread_members` table with the pair constraint relaxed for `context_type='group'`, or a parallel group-thread table. Realtime publication and RLS both need rework; this is the largest chat change and is explicitly blocked on the 1:1 `chat_threads` shape.
5. In-progress session state (#13/#15 Start/End Session): new `session_status` value(s) + transitions added to `SESSION_TRANSITIONS` and the transition RPC. Without it, Start Group Session has nothing to transition to even after participants exist.

## Top 5 gaps (ranked)

1. Groups do not exist end to end: no group entity, membership, or group session representation (blocks 7 of 19 design screens).
2. Attendance: no participants/attendance tables, so Start Group Session and both Attendance Rate tiles are unbuildable as designed.
3. Trainee segmentation UX: no All/1-on-1/Group/Online filters on Trainees, Requests, or Upcoming (the 1-on-1/Online half is pure UI, buildable now).
4. Player Profile depth: design's 5-tab trainee profile (overview attributes, notes, per-trainee payments, video analytics) vs built single session-history screen; notes and video need small new tables.
5. Group chat: "Cric Squad" style threads are impossible on the 2-party `chat_threads` schema.
