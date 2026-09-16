# UI Uplift Proposal: 90 moves, prioritised

Status: proposal for founder review, 2026-09-14. Written from a full native walkthrough (70 screens, light and dark, guest and signed in as Demo Player) on the iPhone 17 Pro Max simulator. Evidence: `docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/`. Companion drawing board: the "Atlitos Uplift Board" design canvas linked from the same folder.

The base is not up for debate here: Urbanist + JetBrains Mono, logo orange `#FF4D00`, white ink on accent, neutral white and `#141414` surfaces, lucide icons, tokens only. Everything below extends that vocabulary. Nothing below invents a second accent, a gradient wash, or a new font.

Priority key. **P0** ships before TestFlight screenshots, it is either broken or embarrassing. **P1** is the difference between "works" and "premium", do it in the first uplift pass. **P2** is polish once P0 and P1 land.

---

## Lens 1: the designer (composition, hierarchy, rhythm)

### P0

1. **One vertical rhythm.** Today Home stacks sections at 20 to 24 gaps but Trainings uses 12 to 16 and Learn uses 32. Lock it: `3xl` (32) between sections, `lg` (16) between a section title and its first card, `md` (12) between cards. Every scroll screen gets the same skeleton.
2. **Section headers become a system.** Every list section uses the same anatomy: `overline` mono eyebrow (optional), `h2` title, right aligned `label` link in accent. Today "Recently viewed / See all", "Donate to Empower / See all", "Drills / See all", "Upcoming sessions" each set their own size and weight.
3. **Home hero banner needs a real image or no banner.** The grey scrim over a beige and orange blob reads as a broken asset. Either commission three real hero photos (season gear, coach, court at dusk) with a bottom to top scrim, or cut the carousel and let the categories row breathe.
4. **Clutch preview on Home is a 4:5 box; it should be 9:16 cropped to 4:5 with the caption OUTSIDE the video.** Caption under the frame, in `callout`, avatar plus channel plus time in one row, so the video never carries text and the rail never overlaps it.
5. **Kill the "Built for Athletes. Backed by Tech. Powered by Purpose." footer on Home.** It is marketing copy on a utility screen and currently half hidden under the nav. Move it to Splash and Login only.
6. **The Trainings stat tiles are four boxes with one line each; give them a hierarchy.** Big mono numeral (`numericDisplay` 40), `caption` label above it in `textTertiary`, delta or context under it ("2 this month" becomes "2 this month, up from 1"). Two tiles wide, not four thin ones.
7. **Empower cards: hero photo or a deterministic cover.** The blank white 180pt box above every campaign is the single most unfinished looking thing in the app. If no photo, render a cover built from the sport icon at 48 on `accentTint`, deterministic per campaign id.
8. **Fix the Empower card title duplication.** Title and description are identical strings on every card in the seed. Design wise the card should never show a description that starts with the title; truncate description to a different field (city, organiser) when they match.

### P1

9. **Introduce a single "hero stat" moment per tab.** Trainings: hours trained this month. Courts: your next booking countdown. Learn: XP to next milestone. Impact: total given. One mono numeral at 40, everything else quieter. Premium apps have one number per screen you remember.
10. **Cards drop their hairline border in light mode when they sit on `surface`.** White card on `#F9F9F9` with `#E5E5E5` border plus shadow is double separation. Pick one per context: border on `bg` (white on white), shadow on `surface`.
11. **Coach and court cards get a leading visual, always.** The letter avatar in a grey circle is fine as fallback but it is currently the only state. Cards with photos look like a product; cards with initials look like a directory.
12. **Rating and price on the same baseline.** On Coaches, "4.6" sits top right and "From 1,000" bottom left. Put price bottom right in `numericBase`, rating inline after the name. The eye reads name, rating, sport, price in one Z.
13. **Status chips: one scale.** "Accepted", "Expired", "Cancelled", "Under review", "Removed", "Rejected", "Active", "New" currently vary in size and casing. One `label` 12 chip, pill, tint bg plus base text, sentence case, 24pt tall.
14. **Tab strip inside Trainings (Stats, Coaches, Payments, Chat, Analytics) is a text row with an underline. Make it a segmented control.** Five tabs at 13pt with an orange underline reads as a website. Use a pill segmented control on `surfaceMuted` with the active segment in `card` plus `elevation.sm`, or reduce to three tabs plus an overflow.
15. **My bookings list: group by day.** "2026-08-12, 06:00 to 07:00" repeated eight times is a spreadsheet. Sticky day headers in `overline`, then rows show only the time range and turf name.
16. **Dates and times in a human format.** "2026-09-09" becomes "Tue 9 Sep", "11:30 to 12:30" stays. ISO strings are for logs.
17. **Empty states get one illustration style.** Today every empty state is a grey circle with a lucide icon at 32. Keep the icon language but draw it at 40 inside a 96pt `accentTint` circle for primary empties (No trainees, No bookings) and keep the grey version for secondary empties (No pending requests).
18. **Login screen: remove the "ATLITOS" text wordmark and use the logo mark.** The wordmark in `label` size at the top left is the weakest element on the strongest screen.
19. **Register form: group fields.** Seven stacked inputs with red asterisks is a tax form. Group into "About you" (name, DOB), "Contact" (email, phone), "Security" (password, confirm) with `overline` eyebrows and 24 between groups.
20. **Availability screen: seven identical rows with "+ Add window" is a config page.** Show a week strip at the top (Mon to Sun chips, filled when a window exists), rows only for days that have windows, and one "Add window" CTA at the bottom.

### P2

21. **Numeric alignment in lists.** Prices right aligned on a common column, tabular figures already do the digit work; the containers need `align-items: baseline`.
22. **The shop product tile keeps its 1:1 image but drops the 100pt colored blob for a real cutout on `surface`.** Placeholder blobs are fine in dev; ship with product cutouts.
23. **Milestones: earned versus locked needs more than tint.** Earned cards get the icon filled in accent and a small mono date; locked cards go to 60 percent opacity with a lock glyph, not a duplicate icon.
24. **Learn roadmap: the progress bar is 4pt tall and reads as a divider.** Make it 8pt, pill, with the XP numeral sitting on the bar end.
25. **Cart line item: quantity stepper and delete are the same visual weight as the price.** Price gets `numericLg`, stepper drops to 32pt ghost buttons, delete becomes a swipe action.
26. **Search screen: the suggestion chips should be a 2 column grid, not a wrap.** Four chips wrapping unevenly looks accidental.
27. **Notifications: unread rows use `accentTint` fill; read rows are plain.** Today every clip notification is tinted, so tint means nothing.
28. **Address card: "Edit / Set default / Delete" as three inline text links is a table row.** Overflow menu (ellipsis) with the three actions; "Default" as a chip on the card.
29. **Clutch profile grid: the "Under review" and "Removed" labels are blue pills on grey; make them the status chip system from item 13 and dim the tile.**
30. **Splash to Home: the app boots straight into Home as guest. Add a 480ms wordmark reveal on cold start** so the first frame is the brand, not a half loaded list.

---

## Lens 2: the developer (usability, states, resilience)

### P0

1. **Pad every scrollable for the floating nav.** `NAV_BAR_INSET` (64) is exported and unused. Every `FlatList` and `ScrollView` under `(tabs)` takes `contentContainerStyle={{ paddingBottom: NAV_BAR_INSET + insets.bottom }}`. Fixes Home footer, Trainings stats, Payments, both bookings lists, Clutch caption.
2. **Loading state on every screen, no exceptions.** `you`, `courts`, `courts/bookings` render blank white for 3 to 8 seconds on first open. Each screen renders its `Skeleton` layout that mirrors the loaded layout (same card heights), not a spinner.
3. **`LoginGateModal` closes on navigation.** It is a root portal keyed to screen state; a deep link, push tap or Android back leaves it stacked over the next screen, including over Login. `usePathname()` in the modal, `onClose()` on change.
4. **Apply the missing migrations or hide the features.** `chat_thread_previews` and `user_blocks` are not on the live project; Messages and Blocked accounts show raw Postgres errors. Either apply `0122` and `0124` or gate the entry points behind a feature flag until they land. Raw "schema cache" text must never reach a user.
5. **Role aware Trainings.** A player opening Earnings gets "caller holds no coach profile" from the RPC. Earnings, Availability, Verification, Trainees and Requests are coach only; hide the tabs and routes for players, or show a role appropriate state ("Coach tools unlock when you set up a coach profile").
6. **Error state component with three tiers.** Inline (a row failed, retry that row), section (a card failed, retry the card), screen (nothing loaded, full empty state with retry). Today Blocked, Earnings and Chat all use the screen tier for section problems, and the copy is the exception message.
7. **Offline banner.** Chat shows a "Disconnected" pill; nothing else does. One app level banner under the app bar, `warningTint`, "You are offline, showing what we have", dismisses itself on reconnect.
8. **Pending states on money actions.** After "Proceed to buy", "Donate", "Book", the button must go to a pending state (spinner in the button, disabled, label "Confirming") and the screen must block a second tap until the RPC returns. The failure path (dismissed Razorpay sheet) returns the button to idle with a toast, never a silent nothing.

### P1

9. **Skeletons match final layout.** A skeleton that is one grey card when the real screen is a stat grid plus a list causes a layout jump. Author one skeleton per screen family: stats plus list, card grid, chat list, detail page.
10. **Pull to refresh on every list.** Home has it; Bookings, Notifications, Coaches, Courts, Impact do not.
11. **Optimistic updates with rollback.** Like already does this. Wishlist heart, Add to cart badge, Mark all read, Accept request should too. The rollback shows a toast ("Could not save, try again"), never reverts silently.
12. **Toast system, one implementation.** Success, info, error variants, bottom anchored ABOVE the nav pill, 3 seconds, one at a time, swipe to dismiss. Today feedback is a mix of `Alert.alert`, inline text and nothing.
13. **Under review state on a clip is an active state, design it.** The uploader sees their clip with a shimmer border and "Reviewing, usually under an hour" under it; the grid tile shows a clock glyph. "Removed" and "Rejected" tiles show the reason on tap.
14. **Pagination states.** Lists that page (Notifications, Bookings, Clutch grid) show a 48pt footer skeleton while fetching the next page and a "You are up to date" row at the end. No infinite spinner.
15. **Form validation timing.** Validate on blur, show the error under the field in `caption` danger, put the field outline in danger. Never validate on every keystroke, never only on submit.
16. **Keyboard avoidance on every form.** Login, Register, Forgot, Upload caption, Chat composer, Address. `KeyboardAvoidingView` with the CTA pinned above the keyboard; the sim pass could not raise a keyboard so this is unverified today.
17. **Destructive confirms use `ConfirmSheet`, not `Alert.alert`.** Delete address, Remove from cart, Cancel booking, Block user. The sheet names the consequence ("This cancels your 9 Sep slot, the refund lands in 5 to 7 days").
18. **Disabled state that explains itself.** "Send code" is disabled at 40 percent opacity with no reason. Disabled CTAs carry a `caption` helper under them ("Enter your email to continue").
19. **Retry with backoff and a counter.** Retry buttons that fail again should say "Still could not load" and offer "Go back" after the second failure.
20. **Deep links land on the right stack.** `atlitos://trainings/earnings` opened for a player; `atlitos://notifications` as guest bounced to Login with no return. Guard routes by role and return the user after auth (PRD-01 FR-4 is only satisfied for the modal path today).

### P2

21. **Haptics map.** Light on primary press, selection on segmented and chips, success notification on payment confirmed, warning on validation error. One helper, not per call site.
22. **Reduce motion respected.** Skeleton shimmer, list stagger and the nav pill scale all check `AccessibilityInfo.isReduceMotionEnabled`.
23. **Dynamic type.** Test at the two largest iOS text sizes; the four thin stat tiles and the five tab labels break first.
24. **Every image has a fallback in code, not just in seed.** `Image` with `onError` swaps to the deterministic cover from designer item 7.
25. **Stale while revalidate on the Home rails.** Cache last Home payload in AsyncStorage; render it instantly on cold start, refresh in the background.
26. **A11y labels on the stat tiles** read "Total sessions, 22" not "22".
27. **The `rgba(0,0,0,0.35)` scrim in `clutch/index.tsx` becomes a token** (`overlaySoft`). Same for any other literal found by a grep for `rgba(` under `src/app`.
28. **Long press on a clip tile opens a preview sheet** (peek) rather than navigating; navigation on tap.
29. **Chat composer: pending message shows a clock glyph and grey text until acked, failed message gets a red retry glyph.**
30. **Version and environment stamp** in Settings (build number, env) in `overline` mono, so bug reports carry it.

---

## Lens 3: premium (materials, motion, detail)

### P0

1. **Nav pill gets a real material.** Today it is a flat grey capsule that hides content. Make it `card` at 92 percent with a background blur (expo-blur), `elevation.lg` warm shadow, hairline `border` at 60 percent. Content scrolling under a translucent pill is the single biggest "premium" tell on iOS.
2. **Remove the second floating circle on Home.** The native `VideoView` captions button leaking through the clutch preview looks like a bug because it is one. `allowsPictureInPicture={false}` and check `VideoView` props for the iOS 26 control overlay.
3. **The orange CTA is right; the orange is everywhere else too.** Active tab, active chip, links, progress bars, badges, "See all", stat deltas, the rating star. Cut accent usage by half: links become `text` with an underline on press, the rating star becomes `warning`, progress bars stay accent, "See all" becomes `textSecondary` with a chevron.
4. **Type contrast.** Urbanist at 400 for body on `#5D5D5D` is too light in dark mode and too grey in light. Body at 500, secondary at 400, tertiary only for timestamps.
5. **Shadows are grey on white; make them warm and soft.** `elevation.sm` at `rgba(13,13,13,0.06)` 0 2 8, `elevation.md` at `0 6 20` 0.08. One shadow ramp, no hard 1px drop shadows.

### P1

6. **Motion signature: the `easing.srm` snap on three moments only.** Press scale on primary CTAs, stat numerals counting up on first render (400ms), chip selection. Everything else uses `standard` at 200ms. Restraint is the premium move.
7. **List reveal stagger** at 40ms per item for the first 8 items on screen entry, fade plus 8pt rise, once per mount, never on refresh.
8. **Sheet enter at 320ms decelerate with a drag handle** (36 by 4, `borderStrong`, pill) on every bottom sheet: LoginGate, Confirm, variant picker, report.
9. **Card press feedback.** The pressable overlay pattern removed it. Restore it with a `Reanimated` scale to 0.985 on the card container driven by the overlay's press state (the overlay reports, the container animates). Cards that do nothing on press feel dead.
10. **Mono numerals earn a display moment.** Prices on product cards at `numericBase` are fine; the cart subtotal, the booking price, the donation total, the Impact total go to `numericLg` or `numericDisplay`. A premium app lets the number be the hero on money screens.
11. **Hairline dividers between rows, not gaps.** Transactions, bookings, notifications: 1pt `border` between rows inside one card, instead of eight separate cards with 12pt gaps. Fewer edges, calmer screen.
12. **Icon weight consistency.** Lucide at `strokeWidth` 1.75 everywhere; some screens ship 2 (cart, heart) and some 1.5. One value in the icon wrapper.
13. **Avatar treatment.** Letter avatars get the sport tint (`accentTint` for the default), Urbanist 600, and a 1pt inner ring in `border`. Photo avatars get the same ring. Currently three different avatar sizes and two fill colors.
14. **Photography direction for the seed and screenshots.** Warm, natural light, motion blur allowed, no stock smiles. Courts at golden hour, coaches mid demonstration, gear on concrete. This matters more than any token.
15. **Image loading: blur up.** Every remote image renders a 20px blurred thumb (or the deterministic cover) and cross fades to the full image in 200ms. No white pop in.
16. **Status bar and app bar.** App bar background is `bg` with a hairline that appears only after 8pt of scroll (animated opacity). Large title collapses to the small title on scroll on Trainings, Courts, Coaches, Learn.
17. **Splash.** Logo mark on `bg`, 480ms, then the wordmark slides 8pt and settles, then Home fades in under it. No progress bar, no "Loading".
18. **Selection states on chips: fill, not outline.** Active chip is `accent` fill with white `label`; inactive is `surfaceMuted` with `text`. The current outline plus tinted text active state is the weaker of the two and reads as disabled.
19. **Buttons: three sizes, consistent.** 52 primary, 44 secondary and inline, 36 compact (in cards). Today "Add to cart" in cards is 40, "Donate" is 48, the login CTA is 56.
20. **Under review clip tile: shimmer border** in accent at 30 percent, 1.6 second loop, replaces the blue text pill.

### P2

21. **Clutch feed: the header scrim becomes a top to bottom gradient token,** 0 to 0.45 over 120pt, and the caption gets the mirror at the bottom sized to the caption height plus nav inset.
22. **Empower progress bar: two tone.** Raised in accent, a 4pt lighter "this week" segment at the leading edge in `accentTint`, and the goal numeral pinned right.
23. **Analytics bars: rounded caps, 8pt, a 1pt lighter track,** month label in `overline`. The two bars per month (sessions, hours) get accent and `info` rather than accent and blue at random.
24. **Impact screen: the total given is the hero; donation history rows carry the campaign cover at 32.**
25. **Rating: the star is filled `warning`, the numeral is mono, "New" for unrated becomes a `surfaceMuted` chip.**
26. **Search: the sparkle icon in the field is the AI signal; keep it, but the field gets a 1pt `border` and 48 height, and results animate in from the field, not the bottom.**
27. **Learn drill rows: the tick for completed drills becomes a filled circle in `success` with a white check;** an outline tick reads as "not done yet".
28. **Booking card: the time range becomes a two line block, big time in mono, date in caption,** with the status chip top right and price bottom right.
29. **Empty cart and wishlist: the icon sits in an `accentTint` circle and the CTA is secondary, not primary.** A primary CTA on an empty screen shouts.
30. **Dark mode: cards lose their border and gain `elevation.sm` at 0.5 opacity black.** Today dark cards are flat `#1C1C1C` on `#141414` with a `#2E2E2E` border, which reads as wireframe.

---

## State matrix, every screen family

The uplift is only real if every state is designed. This is the checklist the biased approver runs.

| Family | Idle | Loading | Empty | Error | Pending | Offline |
|---|---|---|---|---|---|---|
| Home | rails | skeleton rails, cached last payload | not possible, always has categories | section tier, per rail | none | banner |
| Clutch feed | video | poster then video | "No clips yet" plus Post CTA | screen tier | upload progress card at top | banner, cached feed |
| Clutch upload | form | thumbnail generating | none | inline on caption or file | progress bar plus "Reviewing" | blocked with reason |
| Trainings stats | tiles plus list | tile skeletons | "No sessions yet" plus Find a coach | section tier per tile group | none | banner |
| Coaches, Courts browse | cards | 3 card skeletons | "No coaches near you" plus change city | screen tier | none | banner, cached list |
| Booking flow | form | slot loading | no slots that day | inline per field | button pending, screen locked | blocked, explain |
| Bookings list | grouped rows | 4 row skeletons | "Nothing booked" plus Browse | screen tier | cancellation pending chip | banner |
| Chat list | rows | 5 row skeletons | "Chat opens after a session" | section tier, retry | none | banner |
| Chat thread | messages | none, use cache | first message prompt | inline retry per message | message clock glyph | queue and send later |
| Cart, checkout | items plus BillSummary | skeleton items | "Your cart is empty" plus Browse | inline per line | button pending, Razorpay sheet | blocked |
| Notifications | rows | 6 row skeletons | "You are up to date" | screen tier | none | cached |
| Profile, You | header plus grid | header skeleton | "Post your first clip" | section tier | avatar upload progress | cached |
| Learn | hero stat plus list | skeleton | "Pick a sport" | section tier | none | cached |
| Empower, Impact | cards | 2 card skeletons | "No campaigns yet" | screen tier | donate button pending | banner |
| Auth forms | fields | button pending | none | inline per field plus top summary | code sent countdown | blocked, explain |
| Coach tools (earnings, availability, verification) | data | skeleton | role appropriate empty | section tier | payout pending chip | banner |

Rules that fall out of the matrix:

- Loading is always a skeleton that matches the idle layout. Spinners only live inside buttons.
- Empty has an icon, a one line title, a one line reason, and at most one CTA.
- Error copy is written for a person: what happened, what to do. Never an exception string.
- Pending is visible on the control that caused it and blocks a second submit.
- Offline is one banner, and any screen that can show cached data does.

---

## Execution order

1. Developer P0 items 1 to 8 (one ticket each, they are bugs).
2. Premium P0 1 to 5 plus Designer P0 1, 2, 5, 6 (the "calm the screen" pass, one ticket, touches theme and shared components only).
3. Designer P0 3, 4, 7, 8 (content and media, needs the founder's photos).
4. The state matrix as a component sheet: Skeleton per family, ErrorState three tiers, EmptyState two tiers, Toast, OfflineBanner, pending Button. One ticket, then every screen adopts.
5. P1 by lens, alternating designer and developer so each screen gets both.
6. P2 as polish tickets after the TestFlight screenshots are locked.

Every item above traces to PRD-01 FR-3 (guest gating), FR-4 (return after auth), and the cross cutting quality bars in `docs/PLAN.md`; none adds product scope.
