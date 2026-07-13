# ATLITOS v2 — Real Product Build Plan (supersedes v1 prototype plan)

## Context

The v1 Expo prototype (mock services, emoji glyphs, basic styling) proved the flows. Now we build the real end-to-end superapp: real Supabase backend, real Razorpay (test mode), real video pipeline, and surfaces for ALL stakeholders — athlete, coach, court partner, admin back-office, UPA (Atlitos Life), sponsor, shopper. Goal: learn, buy, hire, book + social profile in one product, looking premium, zero emojis, fully autonomous multi-agent build with phase gates approved by a biased-approver agent.

## Decisions locked with founder (this session)

- **Platforms:** Expo consumer app + Next.js portals in ONE Turborepo/pnpm monorepo (synth-app pattern)
- **Backend:** new Supabase project (Postgres+RLS+Auth+Storage+Realtime+Edge Functions)
- **Payments:** Razorpay test mode now (orders + webhook + Route splits); real KYC + Apple dev ($99) deferred — founder does credential/payment steps when I hand off in the browser
- **Product vision:** consumer superapp (Vision A) absorbing a Learn module (drills/roadmap/XP) from the academy SRS; NOT WhatsApp-UPI-OCR
- **Atlitos Life:** web portal in monorepo, not a separate mobile app yet
- **Design:** NEW language synthesized from his projects — synth token discipline (packages/theme, zero hardcoded hex), warm off-white premium base + dark first-class, Atlitos orange accent (#FF4200 vs #E46136 decided at Phase 0 gate via token gallery), Inter + JetBrains Mono numerics, SRM uppercase-mono eyebrows, GMV shadcn dashboards for portals. lucide icons only. House copy rules: no emojis, no em-dashes/hyphens, concise
- **OSS:** react-native-reusables (mobile UI) · shadcn/ui (portals) · Refine.dev+Supabase (admin) · Cloudflare Stream + react-native-video-feed (Clutch) · Supabase Realtime (chat) · razorpay SDK + react-native-razorpay + Route · custom Supabase slot engine (not Cal.com — AGPL + overkill for windowed hourly slots) · zustand + @tanstack/react-query (state/server-state, the founder's standard stack per docs/design/TASTE.md; added at P1 gate after approver flagged the omission, pending founder ratification)

## Monorepo `~/dev/atlitos/` (new repo)

```
apps/ mobile (Expo) · portal-court (Next.js) · portal-life (Next.js) · admin (Refine)
packages/ theme · ui-native · ui-web · api (typed hooks + edge callers) · types · config
supabase/ migrations/ · functions/ · seed/
docs/ prd/ (7 PRDs) · design/DESIGN-LANGUAGE.md · architecture/ (SCHEMA, API-MAPPING, RLS, PAYMENTS, VIDEO) · agents/ (biased-approver.md, workflows.md) · phases/PHASE-N-STATUS.md
```

Reuse: v1 `src/types/models.ts` (state machines verbatim) → packages/types; v1 PLAN-2-3 HTTP contract → API-MAPPING.md (per endpoint: PostgREST read w/ RLS | Postgres RPC transition | Edge Function for money/video/fan-out); v1 fixtures → supabase/seed; brand SVGs from 04 Design & Brand.

## Schema domains (one migration each)
identity/roles (multi-role user_roles + JWT hook) · coaching (sessions + RPC-enforced state machine) · courts (venues, slots via UNIQUE(court_id,date,slot_start), pricing rules, checkins) · commerce (products/variants/stock, orders admin-driven) · clutch (clips uploading→processing→ready→published|rejected) · empower (upa_applications, wishlist, donations) · learn (drills, roadmaps, xp_events) · chat (Realtime) · notifications · payments (payment_intents, ledger_entries double-entry, payout_accounts, transfers, fee_config) · moderation/audit (verification_requests, moderation_queue, feature_flags, audit_log)

**Financial invariant:** clients never write money rows or state transitions — RPCs enforce machines (INVALID_TRANSITION), edge functions (service role) write ledgers, server re-prices (PRICE_MISMATCH preserved from v1).

## Edge functions
razorpay-create-order · razorpay-webhook · razorpay-route-onboard · razorpay-route-transfer · book-court · book-session · checkout (roundup line) · donate · stream-upload-url · stream-webhook · ai-search (v1 heuristic behind LLM-ready contract) · notify-dispatch · admin-order-advance · admin-order-refund (refund path, distinct from advance, added at architecture time, see PAYMENTS.md and PRD-04 open question 2) · stream-reconcile (pg_cron poll fallback for Stream webhook reliability, see VIDEO.md)

## Video pipeline
mobile → stream-upload-url (tus one-time URL) → Cloudflare Stream transcode → webhook → clip ready → moderation_queue → admin approve → published → HLS feed via react-native-video-feed.

## Jira (Atlassian MCP)
New project **ATL**, Kanban. 12 epics (Foundation, Design System, Athlete Core, Courts+Portal, Coaching, Commerce, Clutch, Empower+Life, Learn, Admin, Payments, Chat+Notifications). Stories cut from PRD acceptance criteria; build agents transition tickets via MCP; phase-close agent reconciles board vs PHASE-N-STATUS.md.

## Biased approver (founder-taste gatekeeper)
Prompt at docs/agents/biased-approver.md: no emojis/em-dashes, tokens-only styling, JetBrains Mono numerics, component discipline (extend with variants, never one-offs), BillSummary on every money surface, 4 states per screen, PRD-as-ceiling (unrequested feature = reject), no unapproved dependencies, no unguarded financial writes. Runs at every phase gate on: PRDs + diff summary + typecheck/build + deployed preview URLs + light/dark screenshots. APPROVE/REJECT with itemized ticket-referenced findings; max 2 fix cycles then escalate to founder.

## Phases (each ends: integrator typecheck/build/deploy → biased approver → phase-close agent updates docs + Jira; fresh agents each phase, shared state in repo docs only)

- **P0 Requirements + Accounts + Skeleton:** 7 PRDs · monorepo scaffold building green · DESIGN-LANGUAGE.md + packages/theme + token gallery · Supabase project (MCP, confirm cost) · Vercel projects · Jira ATL + epics · **browser hand-offs w/ founder: Razorpay test signup, Cloudflare Stream, Vercel hookup** · GATE: founder approves PRDs + design language + orange pick; approver prompt itself founder-reviewed
- **P1 Identity + Design System + Shells:** identity migrations, auth incl. guest, onboarding wizards, 42 components rebuilt on react-native-reusables (/dev/gallery), portal shells, Refine skeleton + verification queue · GATE: onboarding clickable on device, portals on Vercel previews, RLS advisor clean
- **P2 Vertical slice — Courts end-to-end (flagship demo):** courts+payments migrations, book-court + Razorpay test checkout on device, partner portal (inventory, pricing, live day-of ops on Realtime, earnings), admin venue verification · GATE: founder books a court with a test card on deployed stack; partner sees it live; ledger correct
- **P3 Coaching + Chat + Payouts:** sessions engine, Realtime chat, coach earnings, Route onboard+transfer on completion · GATE: v1 Journeys 2+3 with test payments + visible Route transfer
- **P4 Commerce:** catalog CRUD in admin, inventory, checkout w/ roundup stub, order lifecycle driver · GATE: Journey 4 incl. admin advancing order live
- **P5 Clutch:** Cloudflare pipeline, vertical feed, upload, creator profiles, moderation queue · GATE: founder uploads clip from device → approved → in feed
- **P6 Empower + Life portal:** UPA apply/verify/wishlist/gratitude portal, donate + roundup real, My Impact · GATE: Journey 5 end-to-end
- **P7 Learn + XP:** drills, roadmap, xp from real actions, lucide milestones, admin drill CRUD · GATE: roadmap progresses from real activity
- **P8 Search + Notifications + Hardening:** ai-search, push, states pass, RLS/advisor audit, 5-journey regression, perf, docs freeze · GATE: full sign-off → then Apple dev + TestFlight hand-off

**Agent model per phase:** planner (cuts Jira stories) → parallel builders per app/domain (opus-tier: schema/payments/RLS; sonnet-tier: screens/CRUD; haiku: mechanical) → integrator (build+deploy) → biased approver → phase-close. ScheduleWakeup loop keeps it autonomous between phases; founder pinged only at gates needing him (P0 accounts, P2 demo, disagreements).

## Risks
Razorpay Route test-mode limits (ledger = source of truth so KYC later is config) · slot concurrency (DB-enforced only) · react-native-reusables/Expo 57 compat (P1 week-1 spike; fallback plain StyleSheet on theme tokens) · Stream webhook reliability (idempotent + poll fallback) · RLS leaks on multi-role money data (advisor at every gate) · scope gravity across 7 stakeholders (PRD ceiling + approver) · no Apple account → Android device + iOS sim until P8.

## Verification
Every phase: pnpm turbo typecheck/build green, Vercel preview URLs live, RLS advisors clean, biased-approver APPROVE, Jira reconciled. P2/P5/P6 gates verified hands-on in browser/device by me (Chrome automation on portals, simulator for mobile) before founder demo. Final: all 5 SPEC journeys on deployed stack with Razorpay test payments.

## Kickoff on approval
1. Scaffold monorepo at ~/dev/atlitos + git init
2. Launch P0 workflow (PRD agents, theme agent, infra agent)
3. Supabase project via MCP (confirm cost with founder if >$0)
4. Jira ATL project + epics via Atlassian MCP
5. Browser session with founder for Razorpay test + Cloudflare (his credentials, my driving)
