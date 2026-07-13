# Phase 1 Status: Identity + Design System + Shells

Gate: onboarding clickable on device, portals on Vercel previews, RLS advisor clean. Epic AT-2 (Design System), AT-1 (Foundation/Identity), AT-10 (Admin).

Last updated: 2026-07-13.

## Deliverables

### Spike (blocking prerequisite)

- [x] nativewind 4.2.6 + hand-adapted react-native-reusables verified on Expo SDK 57 / RN 0.86 (docs/phases/PHASE-1-SPIKE.md, RESOLVED). Pattern all mobile component work followed this wave.

### Identity + auth (Supabase)

- [x] `supabase/migrations/0001_identity.sql`: users, user_roles, athlete_sports, coach_profiles, coach_certificates, addresses, custom_access_token_hook, has_role(), public_profiles view, coach_profiles_public view
- [x] `0002_notifications.sql`, `0003_moderation_audit.sql` (verification_requests, audit_log, moderation_queue)
- [x] `0004_player_and_coach_setup_rpc.sql`: complete_player_setup, submit_coach_verification RPCs
- [x] `0005_tighten_rpc_grants.sql`: closes the anon-executable gap Supabase's default privilege grant leaves on new functions
- [x] `0006_storage_buckets.sql`: avatars bucket
- [x] `0007_admin_verification_rpcs.sql` (renamed/reapplied during this integration pass, see Deviations): admin_approve_verification_request, admin_reject_verification_request
- [x] Guest auth path, onboarding wizards (role-select, player-setup, coach-setup) built on mobile
- [ ] Deferred to later phases: courts, coaching, commerce, clutch, empower, learn, payments schema domains (by design, see docs/PLAN.md phase sequencing)

### Design system: mobile (react-native-reusables / nativewind)

- [x] 44 components total: 24 in `src/components/ui/` (button, card, text, input, chip, avatar, app-bar, bottom-nav, court-card, coach-card, session-card, product-card, upa-card, search-bar, location-bar, star-rating, stat-tile, status-pill, stepper, otp-input, price-text, divider, skeleton, trainings-sub-nav), 8 molecules (BillSummary, CalendarPicker, ClutchPostCard, MilestoneChip, OrderTimeline, RequestSupportForm, SlotPicker, TransactionRow, AdBannerCarousel), 12 organisms (BookingConfirmation, CoachProfileSheet, CommentsSheet, DonationSheet, EarningsHeader, EmptyState, LoginGateModal, LoginGateSheet, ProfileWizard, RateReviewForm, SearchResults, WishlistGrid). Close to PLAN.md's "42 components" target.
- [x] `/dev/gallery`, `/dev/tokens`, `/dev/showcase` routes for visual QA against DESIGN-LANGUAGE.md
- [x] Onboarding flow screens: `(auth)/login`, `(auth)/register`, `(auth)/forgot/*`, `(auth)/splash`, `(onboarding)/role-select`, `(onboarding)/player-setup/[step]`, `(onboarding)/coach-setup/[step]`
- [x] Tab shell: `(tabs)/index`, `(tabs)/clutch`, `(tabs)/courts`, `(tabs)/trainings`
- [x] Token pipeline verified real end to end (spike): `apps/mobile/scripts/gen-tokens.ts` -> `global.css` + `tailwind.config.js`, both regenerated on every build, never hand edited

### Design system: portals (shadcn pattern)

- [x] `apps/portal-court`: signin/signup, dashboard shell + venues, slots-pricing, earnings, live-today pages
- [x] `apps/portal-life`: signin/signup, dashboard shell + verification, wishlist, gratitude pages
- [x] `packages/ui-web`: shared `Eyebrow` component (SRM-influenced uppercase mono overline), consumed by both portals via their generated `globals.css` token set

### Admin (Refine.dev)

- [x] `apps/admin`: Shell layout, login page, users list, verification list + show (approve/reject actions wired to Supabase RPCs)
- [x] `gen-tokens.ts` for admin's token CSS, mirrors the portal pattern

### packages/api

- [x] `useAuth`, `useProfile` fully implemented (register, login, guest, profile read/update, player setup, coach verification submit)
- [x] `useSearch`, `useCoaches`, `useSessions`, `useCourts`, `useShop`, `useWishlist`, `useClutch`, `useEmpower`, `useWallet` deliberately stubbed (`throw new Error(...)` with a `TODO(PN)` comment pointing at API-MAPPING.md), each tagged with the phase that implements it. Not accidental gaps, do not "fill these in" without a schema domain landing first.

## Integration pass results (this pass)

- `pnpm turbo typecheck build lint`: 24/24 tasks green (2 full runs, before and after fixes below)
- `npx expo export --platform ios` in `apps/mobile`: succeeds standalone (Hermes bundle, 6.5MB, 57 assets)
- Emoji grep (apps/, packages/, all source + doc extensions): zero hits
- Hex color grep (apps/, packages/, excluding packages/theme and generated global.css/globals.css/tailwind.config.js/tokens.css): one violation found and fixed (see Deviations)
- Lucide imports: only `lucide-react-native` (mobile) and `lucide-react` (portals/admin) used anywhere in the repo, no other icon library; every import resolves (would fail `tsc --noEmit` under strict mode otherwise, confirmed green)
- Supabase security advisor: re-run after the RPC fix below, no new findings introduced; pre-existing findings documented in Deviations

## Deviations found and fixed during this pass

1. **Hex color literal outside token scope**: `packages/ui-web/src/Eyebrow.css` had two hardcoded hex fallbacks in `var(--color-text-tertiary, #8c8072)` / `var(--color-accent, #ff4200)`. The repo's eslint no-hex rule only inspects JS/TS AST literals, it does not lint `.css` files at all, so this slipped past `pnpm turbo lint`. Fixed by removing both hex fallbacks (every consuming app's generated globals.css always defines these vars, so no fallback is needed). Flagging the eslint gap itself for Phase 2: the no-hex rule has a blind spot on `.css` files, the grep gate is currently the only real enforcement there.
2. **Migration version collision, RPCs never reached the database**: two migration files were both authored with prefix `0004` by parallel builder tracks (`0004_admin_verification_rpcs.sql` and `0004_player_and_coach_setup_rpc.sql`). Only the latter was ever pushed to the remote Supabase project; `admin_approve_verification_request` and `admin_reject_verification_request` did not exist remotely even though `apps/admin/src/pages/verification/show.tsx` already called them via `supabaseClient.rpc(...)`, so the admin verification approve/reject flow was silently broken. Confirmed via `pg_proc` query returning zero rows before the fix. Fixed: applied the migration directly via the Supabase MCP under a new non-colliding version (`0007_admin_verification_rpcs.sql`), renamed the local file to match, and closed an anon-execute gap in the same statement (Supabase's default privilege grant gives `anon` EXECUTE at function creation time regardless of an in-migration `revoke ... from public`, the same pattern `0005_tighten_rpc_grants.sql` already had to fix for the sibling RPCs; added explicit `revoke ... from anon` this time instead of needing a follow-up migration). Updated the three stale file-path references (`docs/architecture/API-MAPPING.md`, `apps/admin/src/pages/verification/show.tsx`, `apps/admin/src/pages/verification/list.tsx`). Verified post-fix: `has_function_privilege` shows `anon=false, authenticated=true` on both functions; security advisor no longer flags them as anon-executable.
3. No other cross-agent prop mismatches found; `pnpm turbo typecheck build lint` was already fully green on first run before any fixes, meaning builder tracks coordinated cleanly through packages/types and packages/theme as intended.

## Known debt, non-blocking (flagged, not fixed this pass, out of integration-pass scope)

- Supabase performance advisor: ~30 INFO/WARN findings, all pre-existing since the 0001-0006 identity migrations, none introduced this pass. Categories: `auth_rls_initplan` (RLS policies re-evaluate `auth.uid()`/`has_role()` per row instead of `(select auth.uid())`, on `users`, `user_roles`, `addresses`, `coach_profiles`, `coach_certificates`, `athlete_sports`, `notifications`, `push_tokens`, `notification_prefs`, `verification_requests`, `support_tickets`), `multiple_permissive_policies` (own-row + admin-read policies stack instead of consolidating with `OR`), `unused_index` (expected, zero production rows yet), two `unindexed_foreign_keys`. None are data-leak risks, all are query-plan efficiency items that matter at scale, not at current row counts. Recommend a dedicated RLS performance pass before Phase 2's Courts vertical slice puts real query volume through `coach_profiles`/`verification_requests`.
- `security_definer_view` ERROR-level findings on `public_profiles` and `coach_profiles_public`: intentional, documented design (RLS.md lines 119, 128, "a definer-style view filtered to status='verified' that bypasses the base table's owner/admin-only RLS by design"). Advisor will always flag these; do not "fix" by converting to invoker views, that breaks public coach discovery.
- `function_search_path_mutable` WARN on 7 functions (`custom_access_token_hook`, `set_updated_at`, `is_admin`, `is_moderator`, `is_guest`, `lock_notification_fields`, `lock_coach_sport_after_submission`, `lock_coach_profile_admin_fields`): pre-existing since their respective migrations, not hardened with `set search_path = public`. Low risk (no dynamic SQL in any of them) but cheap to fix, good Phase 2 cleanup migration.
- Admin bundle size: `apps/admin` vite build emits a 636KB / 187KB gzip single chunk, over Vite's 500KB warning threshold. Not a build failure, flagged for a future code-splitting pass, not phase-1 scope (Refine.dev + all resource pages currently load eagerly).
- `apps/mobile/src/components/ui/button.tsx`'s 48px primary CTA height uses Tailwind's native `h-12` because 48 is not a `packages/theme` spacing step (scale jumps 40 -> 56, see PHASE-1-SPIKE.md "Token gap found"). Numerically correct, not name-traceable to a token. Suggested Phase 2 fix: add a `sizing.buttonHeight` dimension token to `packages/theme` rather than stretching the spacing scale for a component-specific dimension.

## Handoff notes for Phase 2 planner

- **What exists and is real**: identity/auth/roles schema fully migrated and RLS'd; guest auth path; mobile onboarding (role-select, player-setup, coach-setup) and tab shell navigable; 44 mobile UI components on the react-native-reusables/nativewind pattern (follow PHASE-1-SPIKE.md's "pattern component builders must follow" section for any new component, it is still the source of truth); both portal shells (portal-court, portal-life) with auth pages and dashboard navigation; admin Refine skeleton with a working, RPC-backed verification approve/reject flow (fixed this pass).
- **What is stubbed, do not assume implemented**: every `packages/api` hook except `useAuth`/`useProfile` throws `Error("... not implemented yet")` on call. `useCourts` (Phase 2's own vertical slice), `useSessions`/`useCoaches` (Phase 3), `useShop`/`useWishlist` (Phase 4), `useClutch` (Phase 5), `useEmpower` (Phase 6), `useSearch` (Phase 8), `useWallet` (Phase 3/8). Each has a `TODO(PN)` comment citing the exact API-MAPPING.md section, read that before scaffolding the real hook.
- **Schema domains not yet migrated**: courts, coaching/sessions, commerce, clutch, empower/upa_applications, learn, payments (payment_intents/ledger_entries/payout_accounts/transfers/fee_config). This is by design per docs/PLAN.md's phase sequencing, not an oversight. `0004_admin_verification_rpcs.sql`'s header already documents that its venue/upa applicant_type branches are no-ops until `public.venues`/`public.upa_applications` exist; whoever builds the courts/empower migrations in their respective phases must revisit those two no-op branches and wire the entity-status mirroring, this was flagged at authoring time and is not forgotten, just sequenced later.
- **Migration numbering caution**: this pass hit a real collision (two `0004_*.sql` files from parallel builder tracks, one silently never reached the remote database, see Deviations #2). Phase 2's planner should either serialize migration authoring through one track per phase, or have the integrator check `list_migrations` against local file count before declaring the schema wave done, not just check that `pnpm turbo build` is green (build does not touch the remote Supabase project at all, so a missing-migration bug like this is invisible to the standard gate).
- **RLS advisor status**: no ERROR-level ungated findings (the two `security_definer_view` ERRORs are intentional/documented). All WARN/INFO findings are pre-existing performance-tuning debt (see Known debt above), not correctness or leak issues. Phase 2's Courts vertical slice will be the first surface with real query volume against `coach_profiles`/`verification_requests`, worth doing the `auth_rls_initplan` `(select auth.uid())` wrapping pass before or alongside that work rather than after.
- **Design token gap**: `packages/theme` has no component-dimension tokens (only spacing/radius/color/type scales), the 48px button height gap (see Known debt) is the first instance. If Phase 2 hits more of these (e.g. input height, tab bar height), consider adding a `sizing` token category to `packages/theme` rather than accumulating more untracked `h-*` overrides.
- **Vercel preview deploys**: not run as part of this integration pass (out of scope for the task given to this pass; PHASE-0-STATUS.md still shows Vercel project linkage as a founder/orchestrator hand-off item, unresolved). Phase 1's own gate criterion ("portals on Vercel previews") needs an explicit deploy step before the biased approver reviews this phase, this status doc alone does not satisfy it, `next build` succeeding locally is necessary but not sufficient.
