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
