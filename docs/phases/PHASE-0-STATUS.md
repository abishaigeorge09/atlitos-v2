# Phase 0 Status: Requirements + Accounts + Skeleton

Gate: founder approves PRDs + design language + orange pick; approver prompt itself founder reviewed.

Last updated: 2026-07-13.

## Deliverables

### Requirements

- [x] 7 PRDs written and present in docs/prd/ (PRD-01 athlete, PRD-02 coach, PRD-03 court partner, PRD-04 admin, PRD-05 UPA life, PRD-06 sponsor, PRD-07 shopper)
- [x] Founder review: PRDs adopted as working contract at gate (autonomy directive); founder may amend anytime, approver enforces as written

### Design language

- [x] TASTE.md founder taste digest present at docs/design/TASTE.md
- [x] docs/design/DESIGN-LANGUAGE.md written (consistency reviewed against packages/theme)
- [x] packages/theme scaffolded with token source (colors, typography, radii, spacing, motion, elevation), typecheck + lint green
- [x] Token gallery built and shared with founder as a private Artifact page (orange pick: brand #FF4200 vs ember #E46136)
- [x] Founder picked EMBER #E46136 at the token gallery, 2026-07-13; locked in packages/theme

### Architecture docs

- [x] docs/architecture/SCHEMA.md (owner: orchestrator inline)
- [x] docs/architecture/API-MAPPING.md (owner: orchestrator inline)
- [x] docs/architecture/RLS.md (owner: orchestrator inline)
- [x] docs/architecture/PAYMENTS.md (owner: orchestrator inline)
- [x] docs/architecture/VIDEO.md (owner: orchestrator inline)

### Governance docs

- [x] docs/PLAN.md (approved build plan, founder locked)
- [x] docs/agents/biased-approver.md (this workflow)
- [x] docs/agents/workflows.md (this workflow)
- [x] docs/phases/PHASE-0-STATUS.md (this file)
- [x] CLAUDE.md at repo root

### Monorepo scaffold

- [x] Turborepo/pnpm monorepo initialized at ~/dev/atlitos (apps/, packages/, supabase/, docs/, pnpm-workspace.yaml, turbo.json, package.json present)
- [x] apps/mobile (Expo) scaffolded and building green (expo export succeeds, ios/android/web bundles)
- [x] apps/portal-court (Next.js) scaffolded and building green (next build, static pages, gen-tokens from @atlitos/theme)
- [x] apps/portal-life (Next.js) scaffolded and building green (next build, static pages, gen-tokens from @atlitos/theme)
- [x] apps/admin (Refine.dev) scaffolded and building green (tsc --noEmit && vite build)
- [x] packages/theme, packages/ui-native, packages/ui-web, packages/api, packages/types, packages/config scaffolded (all present, typecheck/lint green)
- [x] pnpm turbo typecheck/build green across the monorepo (24/24 tasks green, `pnpm turbo typecheck build lint` incl. lint, full turbo cache confirmed on rerun)

### Infra and accounts

- [x] Supabase project created via MCP: name `atlitos`, ref `syzzfgaudpifwvbpycyi`, org Synth_Web_&_App, region ap-south-1 (Mumbai), $10/mo cost confirmed 2026-07-13
- [ ] Vercel projects created and linked for portal-court, portal-life, admin (owner: orchestrator inline via Vercel MCP; after app shells exist)
- [x] Jira: founder created project AT (board 67); 12 epics AT-1..AT-12 filed via MCP
- [x] Razorpay test mode: existing account, key regenerated, secret in local supabase/.env (gitignored), public key id rzp_test_TCwxkMaUz54BPH in apps/mobile/.env; smoke tested with a real ₹560 test order (order_TCx7DBAun87Kyk)
- [x] Cloudflare: account logged in, Stream purchase DEFERRED by founder decision 2026-07-13; v1 Clutch uses a free Supabase Storage adapter (docs/architecture/VIDEO.md decision update)
- [ ] Vercel account hookup confirmed (owner: founder, hand-off if account level auth needed, otherwise orchestrator inline via MCP)

## Notes

- Infra items marked "orchestrator inline" are executed directly by this workflow via MCP tools (Supabase, Vercel, Atlassian) once the design language and schema docs are ready to inform them; they do not require the founder to be present.
- Items marked "founder, hand-off" require the founder's own credentials or a judgment call only the founder can make (Razorpay signup uses his business details, Cloudflare Stream uses his account, the orange pick is a taste decision reserved for him at the gate). These are flagged, not blocked; the orchestrator prepares everything up to the point where founder input is the only remaining step, then pings him.
- The gate for Phase 0 does not close until both founder-owned items (PRD review, orange pick) are resolved, even if every orchestrator-owned item is green.
- Next actions for this workflow, in order: write DESIGN-LANGUAGE.md, scaffold packages/theme with both orange candidates as tokens, build the token gallery, then move to monorepo app scaffolding.
