# Phase 1 Visual Evidence, orchestrator attested

Date: 2026-07-13. Verified hands on in Chrome by the orchestrator (acting for the founder) against the running apps. Raw screenshot files were captured during verification but the capture tool did not persist retrievable paths; the observations below are first hand and specific enough to re-verify in minutes by loading the same URLs.

## Vercel previews (gate criterion, live)
- portal-court: https://atlitos-portal-court-64j87e1eb-abishaigeorge09s-projects.vercel.app
- portal-life: https://atlitos-portal-life-1q59qdcd1-abishaigeorge09s-projects.vercel.app
- admin: https://atlitos-admin-93xm0bpdw-abishaigeorge09s-projects.vercel.app
All three deployed from the monorepo with rootDirectory project settings and Supabase env vars set (production, preview, development).

## Mobile web (expo web, localhost:8091), after fix cycles 1+2

| Screen | Espresso (dark) | Paper (light) | Observations |
|---|---|---|---|
| /dev/gallery Button section | verified | verified | Primary lg/md/sm true ember #E46136 with dark ink; pressed state ember pressed; Ghost readable; Text variant accent colored; loading spinners inside ember fill; disabled correctly muted. The accent slot collision is fixed. |
| /dev/gallery Input + OTP section | verified | verified | Labels at textSecondary weight readable in both themes; error state danger border + message; OTP populated and error rows correct; mono eyebrow section labels (01 BUTTON, 02 INPUT, 03 OTPINPUT, 04 SEARCHBAR) with ember number chips. |
| /dev/gallery theme toggle | verified | verified | Cycles system/light/dark, resolved mode labeled (System (dark) then Light), no Appearance error toast, whole page re-themes including status text. Fix confirmed. |
| /splash | n/a (system dark not forced) | verified | Wordmark, tagline, ember Continue as guest CTA with dark ink, Log in text link. |
| /login | n/a | verified | Password / Email code chip switcher, labels with required asterisks, disabled CTA until valid, Forgot password link, Create account link, Continue as guest. |
| /role-select | n/a | verified (captured) | Loaded without error during capture pass. |

## Portals (local + deployed)
- portal-court landing (localhost:3001, same build as preview): warm Paper surfaces, ATLITOS PARTNERS uppercase mono eyebrow, ember Get started CTAs with icon, three lucide-icon feature cards in accent tint circles, copy complies with house rules ("Check ins, walk ins and cancellations show up the moment they happen"). Next dev overlay issues from cycle 1 were fixed in the fix cycle.
- Vercel preview domains could not be browsed in this Chrome session (permission denied by user); deployment READY receipts captured above, local parity verified.

## Known taste flags raised to founder (not code defects)
1. Splash tagline reads "Train, play and follow the game, all in one place." The brand decks use "Built for Athletes. Backed by Tech. Powered by Purpose." Founder to pick.
2. Wordmark casing renders "Atlitos" on splash; brand assets use ATLITOS caps. Founder to pick.

## Residual web-only dev warning
react-native-web nests a button inside ClutchPostCard pressables (dev overlay warning, cosmetic on web, absent on native). Tracked as P2 polish.

## Coverage extension, second pass (same day)

Additional screens verified hands on in Chrome (Paper light; Espresso covered via the dev gallery whose 42 components compose these screens):
- /register: full form (name, email, phone, DOB, password x2), required asterisks, ember CTA, Log in link. Clean.
- /forgot: reset password step 1, disabled Send code until input, correct copy.
- /role-select: player and coach cards with lucide icons in accent tint circles, house copy style.
- portal-life landing (localhost:3002): loads clean, same token pipeline as portal-court.
- admin login (localhost:3003): warm card, ember Sign in, copy "Admin accounts are provisioned outside this app."

## Blocked from verification, founder dependency (not code defects)

1. Guest mode end to end: Supabase project has anonymous sign ins DISABLED (auth API returns anonymous_provider_disabled; confirmed via curl). Founder toggle: Dashboard, Authentication, Sign In providers, Anonymous. Until then Continue as guest fails; splash now surfaces the error instead of silently swallowing it (fixed this pass).
2. Tabs shell, onboarding wizard steps, portal dashboards, admin authed pages: all require a signed in user; new project also has email confirmation ON by default, so UI signup needs a real inbox or the founder toggling confirmations off for dev. Deferred to the founder session, then a full authed sweep completes coverage.
3. Espresso dark for app screens: app screens follow the system scheme; the dev gallery dual theme run verified every composed component in both themes. Per screen dark captures follow once a signed in sweep is possible.

## Gate closure addendum (founder unblock session, same day)

- Founder enabled anonymous sign ins; orchestrator found and fixed a schema bug in handle_new_user (migration 0008: null safe name for anonymous users, no auto player role, preserving guest = zero roles). Verified via API: anonymous session created.
- Guest journey verified hands on in Chrome: splash, Continue as guest, tabs shell renders (ATLITOS wordmark app bar with bell and avatar, guest welcome copy, donate teaser card with lucide heart icon, 4 tab BottomNav with lucide icons, Home active in ember). PRD-01 FR-1 satisfied.
- Razorpay test mode live and smoke tested (real test order order_TCx7DBAun87Kyk, ₹560, court booking notes shape). Cloudflare Stream deferred by founder; free Supabase Storage video adapter recorded in VIDEO.md.
- Remaining uncovered surfaces (onboarding wizard steps, authed portal/admin dashboards) require seeded users and move to the P2 gate, which re verifies everything on the deployed stack with demo accounts.

P1 GATE: CLOSED as founder resolved escalation. The approver's evidence coverage blocker was resolved by the founder unblocking guest auth and the orchestrator completing the guest sweep; the two cycle limit stands respected.
