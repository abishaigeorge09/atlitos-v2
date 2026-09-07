# Atlitos athlete app — UX, navigation and consolidated bug report

Senior review across three lenses: information architecture and navigation, UI and visual quality, and engineering. Evidence is the 80-route tree in `apps/mobile/src/app`, 27 captured screens, and the source.

**Status: nothing committed, nothing pushed, nothing deployed.**

**Update, same day: 11 of the 14 UI/UX defects are now fixed and verified on device. See Part 6.**

---

## Part 1 — What has been fixed so far

Be clear about the split: **security work is code-complete but not live, and no UI bug has been fixed yet.**

### Fixed in the working tree (10 items, none deployed)

| ID | Severity | Issue | Fix |
|---|---|---|---|
| SEC-F1 | P0 | Any authenticated user could read **any object in the private clips bucket** by pointing their own clip's `thumb_path` at it | Prefix guard at the write, plus a required `requiredPrefix` argument on the shared mint so no call site can forget it |
| SEC-F2 | P0 | A captured payment whose downstream work failed was **never retried** and stayed broken forever | `payment_intents.finalized_at` + gate re-entry (`0088`), courts ledger idempotency guard, reconciliation arm on the cron sweep |
| SEC-F3 | P1 | A coach could inject an arbitrary `storage_path` and fake trainee links via a direct insert | Policy requires `storage_path is null` and a real `sessions` link (`0089`); mint re-derives the prefix |
| SEC-F4 | P1 | `users.status` was read by **nothing**, so suspension did not suspend anyone | Three layers (`0090`): token hook denial, `getAuthenticatedUser` refusal, restrictive RLS on 12 tables. Plus `admin_suspend_user` / `admin_reinstate_user` and the admin UI, which did not exist |
| SEC-F5 | P1 | Audit rows could diverge from the mutation, and `before.status` was fabricated from a lookup | Audit folded into `order_transition`'s transaction, reading the real prior status (`0091`) |
| SEC-F6 | P1 | Production EAS profile shipped a **test-mode Razorpay key** | Env block stripped; `check-release-config.sh` fails the build if it returns, wired into `pnpm lint` |
| SEC-F7 | P2 | Postgres and storage error text leaked to clients on 5xx | Sanitised at `errorResponse`, the single choke point; correlation id to the log |
| SEC-F10 | P3 | Service-role key compared with `!==` | Constant-time compare, reusing the existing helper |
| SEC-F11 | P1 | **`0027` had stray tool-call XML committed**, so the migration chain could not replay from scratch | Removed; `verify-migrations-local.sh` now replays all 91 migrations as a guard |
| — | — | No way to execute migrations without live credentials | Local harness: shim + 91 migrations + 30 assertions, zero credentials |

Verified by `./scripts/verify-migrations-local.sh` (30/30 assertions, negative control confirmed), `turbo typecheck` 12/12, and `deno check` on every touched function.

### Not fixed

| ID | Why |
|---|---|
| SEC-F8 | Supabase dashboard setting, not code |
| SEC-F9 | LLM abuse budget. P3, and it needs a product decision on the quota |
| **BUG-01 to BUG-11** | **All 11 UI/UX defects are open. None have been fixed.** |

---

## Part 2 — Navigation and information architecture

### What is genuinely good

Worth stating, because it is unusual to get right:

- **Back affordances are consistent.** Every pushed screen renders its own back control (all layouts set `headerShown: false` deliberately). Payment screens included: `courts/book/pay`, `coaching/book/pay` and `GroupMembershipPayScreen` all carry `AppBar variant="backTitle"` with a working back, so a user can always abandon a payment.
- **`order-success` correctly blocks back-to-payment** and offers two forward paths (View order, Continue shopping) via `router.replace`. Textbook.
- **No copy-paste duplication.** Routes that look duplicated are re-exports or shared organisms: `you.tsx` renders `ProfileScreen asTab`, `trainings/coach/[id]` is `export { default } from '../../coaching/coach/[id]'`, both chat screens use the same `ChatThreadList`. The engineering here is clean.
- **Guest gating is coherent.** Read surfaces browse freely, mutations open the gate (PRD-01 FR-1/FR-3).

### NAV-01 (P1) — the entire Shop has no primary navigation entry

The bottom bar is **Home, Trainings, Clutch, Courts, You**. Shop is not there. Neither is Cart.

PRD-07 is a full commerce domain: 14 products, categories, wishlist, cart, addresses, checkout, orders, order tracking, feedback. In the live data this account has **24 orders and a populated cart**. All of it is reachable only by scrolling Home to the Shop rail and tapping "See all", or by deep link.

A user with an item in their cart has no persistent way back to it. There is no cart badge anywhere in the tab bar.

**Suggestion.** Two options, in order of preference:

1. Make Shop the fifth tab and move `You` into the Home AppBar avatar (which already navigates to the profile). This is what the avatar is for, and it frees a tab for a revenue surface.
2. Keep five tabs but add a **persistent cart affordance** to the Home AppBar with an item-count badge, matching the one already inside Shop.

Either way the cart must be reachable from outside Shop, because that is where abandoned carts are recovered.

### NAV-02 (P2) — the "You" tab uses a filters icon

`bottom-nav.tsx:24` sets the You tab icon to lucide **`SlidersHorizontal`** — three horizontal sliders, the universal icon for filters or settings. The tab opens a social **profile** (avatar, handle, followers, clip grid).

Users read icons before labels. A sliders icon next to "You" says "settings", so the profile, follower list and clip grid sit behind an icon that promises adjustment controls.

**Suggestion.** Use `User` or `CircleUser`. Better still, render the member's own avatar in the tab when signed in, which is the pattern Instagram and X use and which this app already computes for the profile screen.

### NAV-03 (P2) — the same feature has two entry points with different framing

Shared code, duplicated information architecture:

| Feature | Entry A | Entry B |
|---|---|---|
| Chat thread list | `(tabs)/chat` | Trainings shell, Chat sub-tab |
| Coach browse | `(tabs)/coaching` | Trainings shell, Coaches sub-tab |
| Session detail | `coaching/booking/[id]` | `trainings/booking/[id]` |
| Own profile | You tab | Home AppBar avatar, and Clutch profile |

Technically fine. The user cost is that "where do I find my messages" has two answers, and the back stack differs depending on which door you came through, so the same screen exits to two different places.

**Suggestion.** Pick one canonical home per feature and make the other a link, not a duplicate surface. Messages in particular should live in one place; the Trainings sub-tab is the odd one out, since chat is not training-specific.

### NAV-04 (P3) — tab bar inside a tab bar

Trainings renders its own top tab bar (Stats, Coaches, Payments, Chat, Analytics, plus Earnings and Trainees for coaches) inside the bottom tab bar. Two levels of persistent horizontal navigation on one screen, and the inner row already scrolls horizontally, so items are cut off ("Analyti…" in capture 19).

**Suggestion.** Cap the inner row at four items and move the rest behind the existing gear icon, or convert Stats into a dashboard with cards that push to full screens. Horizontally scrolling tabs hide their own contents.

---

## Part 3 — UI and visual quality

### UI-01 — imagery is the single biggest visual problem

Across Home, Shop, Courts, Empower and the clip grid, media renders as **flat colour blocks and circles** that overflow their containers:

- Shop cards: solid orange, green, grey and black circles bulging past the card's top edge
- Courts: a solid black rectangle and a green blob with distorted, non-rectangular edges
- Home carousel: a grey slab across the banner, sitting **over** the headline and body copy and reducing contrast
- Empower campaign card: blank white space where the UPA photo belongs
- Profile clip grid: nine completely empty tiles

This one class of problem makes an otherwise well-composed app look broken. Two distinct causes: BUG-02 (thumbnails can never resolve, since `mapClipRow` only accepts http URLs but `thumb_path` is always a private storage path) and BUG-06 (placeholder rendering and overflow).

**Suggestion.** Fix BUG-02 by minting through `get-clip-playback-url`, which already returns `thumbUrl`. For placeholders, clip to the card bounds with `overflow: hidden` and use a neutral skeleton rather than a saturated brand colour, so a missing image reads as "loading", not "broken". Never overlay the promo banner's own copy.

### UI-02 — status vocabulary misleads

A moderator-**rejected** clip is labelled **"Cancelled"** (`profile/index.tsx:37-38`), which reads as something the user did. An **unrated** coach shows **"★0.0"**, visually identical to a coach rated zero.

**Suggestion.** "Rejected" and "Removed" for clips, with the reason if one exists. "New" or no stars at all for an unrated coach.

### UI-03 — identity is inconsistent across the shell

The Home AppBar shows a hardcoded letter **"A"** for every user (`app-bar.tsx:126`) while the profile screen correctly derives "DP". A signed-in member looks identical to a guest in the header.

### UI-04 — layering and truncation

The Clutch header title overlaps the clip's own title overlay, both rendered white on video with no scrim. The Trainings sub-tab row truncates mid-word.

**Suggestion.** A gradient scrim behind the Clutch top bar, and let the clip title start below it.

### UI-05 — a half-filled required pair

Settings shows City "Hyderabad" and **State empty** for an otherwise complete profile, under a single Save location button.

### What is well done

Genuinely strong, and worth protecting during fixes: numeric readouts use JetBrains Mono with tabular figures everywhere, exactly as CLAUDE.md mandates; empty states are specific and helpful ("No upcoming sessions. Accepted sessions and scheduled group sessions will show up here."); status pills are colour-coded consistently; the Learn roadmap's locked/current/complete states are immediately legible; spacing and type hierarchy are consistent across 27 screens.

---

## Part 4 — Open bugs

None of these have been fixed.

| ID | Sev | Area | Summary |
|---|---|---|---|
| BUG-01 | P1 | Shell | No timeout or retry when the JS bundle cannot load. Indefinite splash. Hits real users on poor networks, not only developers |
| BUG-02 | P2 | Clutch | Clip thumbnails can never render. `mapClipRow` requires an http URL; `thumb_path` is always a private storage path |
| BUG-03 | P2 | Courts | Venues 13,486 km away shown as bookable. Courts uses device GPS while Search and Coaches use the profile city |
| NAV-01 | P1 | IA | Shop and Cart have no primary navigation entry |
| NAV-02 | P2 | IA | You tab uses a filters icon for a profile |
| NAV-03 | P2 | IA | Chat, coach browse and session detail each have two entry points |
| NAV-04 | P3 | IA | Nested tab bars, inner row truncates |
| BUG-04 | P3 | Clutch | Header overlaps the clip title |
| BUG-05 | P3 | Clutch | Rejected and removed clips both labelled "Cancelled" |
| BUG-06 | P3 | Global | Media renders as colour blocks overflowing their cards; banner overlay obscures copy |
| BUG-08 | P2 | Shell | Header avatar is a hardcoded "A" |
| BUG-09 | P3 | Coaching | Unrated coaches show ★0.0 |
| BUG-10 | P2 | Settings | State field blank beside a populated City |
| BUG-11 | P3 | Chat | Six group threads all titled "Group" |

Withdrawn after verification, do not chase: a suspected crash on `trainings/*` (my harness artifact, all routes render correctly in isolation), BUG-07 Trainings stat coherence (the definitions are deliberate and documented), and a suspected My Impact money discrepancy (the figure is server-derived by a SECURITY DEFINER RPC).

---

## Part 5 — Recommended order

**First, because they cost users money or trust**

1. **BUG-01** dead splash. Any user on a weak connection sees a frozen app.
2. **NAV-01** surface Shop and Cart. There are 24 orders and a live cart on this account with no way back to them.
3. **BUG-02 + BUG-06** imagery. One coherent pass makes the app stop looking broken.

**Then, cheap wins with high visibility**

4. **BUG-08** avatar initials, one line. **NAV-02** tab icon, one line. **BUG-05** and **BUG-09** status vocabulary, a few lines each.
5. **BUG-03** decide one location source, add a distance bound and a real empty state.
6. **BUG-10**, **BUG-11**.

**Then, structural**

7. **NAV-03** choose a canonical home per feature.
8. **NAV-04** flatten the Trainings sub-tabs.

**Separately, and blocking release**

9. Deploy the security work. All ten fixes are inert until `supabase db push` and `supabase functions deploy` run. Production still has every P0 the audit found.


---

## Part 6 — Fixes applied, 2026-09-05

All verified running on the simulator against the live backend. `turbo typecheck` 12/12 green. Mobile lint unchanged at the same 14 pre-existing `react-hooks/exhaustive-deps` rule-registration errors, none introduced here.

| ID | Fix | File | Verified |
|---|---|---|---|
| BUG-01 | Splash now has a 5s deadline and shows the app in fallback fonts rather than waiting forever on `useFonts` | `app/_layout.tsx` | typecheck |
| BUG-02 | Grid tiles mint their own signed poster via `get-clip-playback-url`. This is the "signed-thumb seam" `hooks.ts` was waiting for | `ClutchPostCard.tsx` | **thumbnails now render** |
| BUG-03 | Results bounded to `MAX_NEARBY_KM = 150`; beyond that the real empty state shows | `(tabs)/courts/index.tsx` | **"No courts near you yet"** |
| BUG-04 | Non-interactive gradient scrim behind the feed header, full-bleed preserved | `(tabs)/clutch/index.tsx` | typecheck |
| BUG-05 | `rejected` and `removed` are now their own pills, no longer both "Cancelled" | `status-pill.tsx`, `profile/index.tsx`, `ClutchProfileView.tsx` | **"Removed" renders** |
| BUG-06 | Promo scrim renders only when there is an image behind it | `PromoCarousel.tsx` | **grey slab gone** |
| BUG-08 | Header avatar derives real initials, "A" only for a guest | `app-bar.tsx`, `(tabs)/index.tsx` | **"DP" renders** |
| BUG-09 | Unrated coaches show "New" instead of a filled star and 0.0 | `coach-card.tsx` | **"New" renders** |
| BUG-10 | Settings fields seed from `me` once it loads, keyed on user id so edits are never clobbered | `SettingsContent.tsx` | typecheck |
| BUG-11 | Group threads fall back to "Group chat" rather than a bare "Group" | `use-chat.ts` | typecheck |
| NAV-01 | Cart button with a live count badge in the brand header, refreshed on focus | `app-bar.tsx`, `(tabs)/index.tsx` | **badge shows 2** |
| NAV-02 | You tab icon is `CircleUser`, not `SlidersHorizontal` | `bottom-nav.tsx` | **person icon renders** |

### Deliberately not changed

**NAV-03 and NAV-04** are information-architecture decisions, not defects. Collapsing the duplicate entry points, or flattening the Trainings sub-tabs, changes where members expect to find things and which back stack they land in. Those are product calls with a migration cost for existing users, and they should not be made unilaterally inside a bug-fix pass. The analysis in Part 2 stands as the recommendation.

**BUG-06, image half.** The coloured circles in Shop and the blocks in Courts are the seeded image ASSETS themselves, not a rendering fault: `product-card.tsx` already uses `resizeMode="cover"` inside an `overflow-hidden` card, and it clips correctly. Replacing the seed art is a content task, not a code fix. Only the promo scrim half was a real code bug, and that is fixed.

**BUG-11 root cause.** The honest fallback is a patch over a server-side gap: `training_groups` is readable only by group members, so 9 of this account's 10 group chat threads cannot resolve their own name. The proper fix is to let a chat member read the name of the group whose thread they are in, which means widening a SELECT policy. That is a security change and was not made unilaterally for a cosmetic label. Flagged for a decision.

### Two things worth knowing about BUG-01

The version a real user hits, a font load stalling on a bad connection, is now bounded. The version I originally observed, a debug build whose Metro bundler is unreachable, **cannot be fixed from JavaScript**, because no JavaScript runs at all in that state. Release builds embed their bundle and are not affected, so that case is developer-only. Both are now documented in the code.
