# UI walkthrough, 2026-09-14

Native pass on the iPhone 17 Pro Max simulator (iOS 26.5), dev client `com.atlitos.app`, Metro on 8081, navigation by `atlitos://` deep links. Guest pass (16 light, 12 dark) and signed in pass as Demo Player (35 routes, light and dark). Contact sheets are in this folder; the full per screen PDFs (`atlitos-ui-screens.pdf`, `atlitos-ui-screens-signed-in.pdf`) were handed to the founder and are not committed because of size.

Drawing board: "Atlitos Uplift Board" design canvas, https://claude.ai/code/artifact/b921aaaa-7fe9-47a6-84c3-5ed301f43820 (before and after for Home, Clutch, Trainings, Bookings, plus the state sheet and component sheet).

Proposal: `docs/design/UI-UPLIFT-PROPOSAL.md`.

## Findings that block TestFlight screenshots

1. `NAV_BAR_INSET` is exported from `bottom-nav.tsx` and never used; every tab screen's last row runs under the floating pill.
2. `LoginGateModal` persists across deep link navigation, including over Login itself.
3. `chat_thread_previews()` and `user_blocks` are missing on the live project; migrations `0122` and `0124` are in the working tree, unapplied. Messages and Blocked accounts show raw Postgres errors.
4. `you`, `courts`, `courts/bookings` render blank white with no skeleton for 3 to 8 seconds on first open.
5. Player role can open coach only tabs (Earnings errors with "caller holds no coach profile").
6. iOS 26 `VideoView` leaks a native captions control through `nativeControls={false}` on the Home clutch preview.
7. `clutch/index.tsx` header scrim is a literal `rgba(0,0,0,0.35)`.

## What is now proven natively

Dark theme resolves on all 47 dark captures with no light leak. `expo-video` muted autoplay plays the seed clip on the Clutch tab and in the Home preview (P9 item 2, partial). Fonts, mono numerals and lucide icons resolve at real device width.
