# Accessibility and house rules, static sweep of `apps/mobile/src`

Lane: accessibility and house rules, statically, across `apps/mobile/src`.
Branch: `integration/p6-audit-fixes` @ `4793ce4`.
Date: 2026-08-14.
Scope: 215 `.ts`/`.tsx` files under `apps/mobile/src`. No device, no emulator, no Metro. No DB writes.

---

## How this sweep was made trustworthy

CURRENT-STATE.md records nine instances of the same failure: reasoning from an absence instead of
checking the artifact. A grep that cannot match returns the same empty set as a clean tree. So
**every check in this document was born red before it was believed.**

A canary file `apps/mobile/src/__grep_canary__.tsx` was planted containing a deliberate instance of
each violation class, every check was run against it, and only checks that actually fired on the
canary were kept. The canary was then deleted and each check re-run against the real tree. `git
status --porcelain` is clean apart from this `docs/qa/verify/` directory.

| Check | Canary fired | Evidence |
|---|---|---|
| Emoji | yes | matched a rocket and a check glyph in a comment, and a target glyph in JSX text |
| Em dash / en dash | yes | matched `Well done, you did it`, and caught a real hit the same run |
| Hyphen in user-visible copy | yes | matched `Coach-led training` and `state-of-the-art coaching` |
| Hardcoded hex | yes | matched `#FF00AA` and `#0B0B0B` |
| `rgba()` literal | yes | matched `rgba(12,34,56,0.5)` |
| Icon-only unlabelled control | yes | matched the `ChevronRight`-only Pressable |
| Touch target < 44pt | **no, on the first attempt** | see below |
| Numeric readout not in mono | yes | matched `₹1,250` |

**The touch-target check failed its own negative test and had to be fixed.** The canary's small
Pressable had no `onPress`, so the checker skipped it as non-interactive and the check reported
zero. Had it been trusted, "no small touch targets" would have been recorded as a clean result from
a check that never ran. That is disguise four from CURRENT-STATE.md: an absence that PASSES. The
canary was corrected, the check re-run, and it then fired at 24pt + 2x hitSlop(4) = 32pt.

**Two other checks were corrected after verifying their output against the source**, which is why
their false positives are listed in the ruled-out section rather than reported as findings:

1. The role check only looked for `accessibilityRole` and missed React Native's `role` prop, which
   made `CalendarPicker` and `AdBannerCarousel` look worse than they are.
2. The touch-target check only measured explicit `width`/`height` and so missed every icon button
   sized by its child glyph. Adding intrinsic icon sizing surfaced the destructive `Trash2` buttons
   in coach onboarding, but it also produced false positives it cannot see through (flex sizing,
   style-object padding). Every survivor below was confirmed by reading the file.

**Known blind spot, stated rather than hidden.** The precision copy corpus (1,528 user-visible
strings) binds strings to copy positions such as `<Text>` children and `title=`/`label=` props. It
does **not** see copy built inside a ternary. That is exactly how the one real em dash escaped it,
and it was caught only by the wide regex net. Both nets were therefore run for every copy rule, and
the hyphen residue was triaged by hand down to zero. A future rule should be enforced on the wide
net, not the corpus.

---

## Result summary

| House rule | Verdict | Count |
|---|---|---|
| No emojis anywhere | **CLEAN** | 0 |
| No em dashes in user-visible copy | **1 violation** | 1 |
| No hyphens in user-visible copy | **1 arguable** | 1 |
| Tokens only, no hardcoded colour | **CLEAN** | 0 |
| Numeric readouts in JetBrains Mono | 15 render in the sans face | 15 |
| Numeric readouts with tabular figures | 21 non tabular, systemic but low visual impact | 21 |
| lucide icon names only | **CLEAN** | 0 |
| Interactive elements labelled | 11 icon-only controls unlabelled | 11 |
| Touch targets >= 44pt | 10 below 44pt | 10 |
| Selected state not colour-only | 4 controls | 4 |
| Images with alt semantics | 1 informative gallery unlabelled | 1 |

---

## THE WORST FIVE, by user impact

A note on how these were ranked, because my own first draft got it wrong. The missing tabular-figures
setting (now finding 6, below the five) produces the longest list in this document, 21 rows touching
every price in the app, and I initially ranked it first. That was ranking by row count, not by user
impact. **JetBrains Mono is a monospaced face, so every digit already has a uniform advance width and
`fontVariant: ['tabular-nums']` is close to a visual no-op on it.** The house rule is genuinely
breached, but almost nobody will see it. It is reported in full and it is not in the worst five.

### 1. P1. The near-black-glyph-on-a-photo bug is fixed in one place and still live in another

`ClutchProfileView.tsx:173-182` carries a detailed docblock for the B5 fix: `colors.textInverse` is
`#14100B` in dark mode (confirmed at `packages/theme/src/colors.ts:143`), so painting it on an
arbitrary video thumbnail with no scrim reads as a near invisible glyph. The fix, a `colors.overlay`
pill behind the icon, is correctly applied at `ClutchProfileView.tsx:198-210`.

**The same shape is unfixed inside the component that screen renders.**
`components/molecules/ClutchPostCard.tsx:119-125`, the `variant === 'thumb'` branch:

```
{thumbSource ? (
  <Image source={{ uri: thumbSource }} className="absolute inset-0 h-full w-full" resizeMode="cover" />
) : null}
<View className="absolute bottom-xs left-xs flex-row items-center gap-xs">
  <Heart size={16} strokeWidth={2} color={colors.textInverse} fill={colors.textInverse} />
  <Text className="font-mono text-xs text-text-inverse">{clip.likes}</Text>
</View>
```

The heart and its like count sit directly on the thumbnail with **no scrim**, in `textInverse`.
`ClutchProfileView.tsx:162` renders exactly this component with `variant="thumb"`. The B5 fix was
applied to the sibling options button overlaid on the tile and not to the content inside the tile.
In dark mode, on any dark thumbnail, every clip tile on every profile grid loses its like count.

Note the feed variant of the same file is fine: `ClutchPostCard.tsx:148-150` lays a `colors.overlay`
scrim over the bottom 45 percent before drawing the caption and action rail.

### 2. P1. Three destructive buttons in coach onboarding are unnamed and undersized

`app/(onboarding)/coach-setup/[step].tsx:393`, `:430`, `:488`. Each is a `Trash2` icon-only
`Pressable` with `accessibilityRole="button"`, `hitSlop={8}`, no explicit size, and **no
`accessibilityLabel`**:

- `:393` removes an uploaded certificate
- `:430` removes a session type
- `:488` removes an availability window

Two defects at once. A screen reader announces only "button", three times in a row on the same
screen, with nothing to distinguish which row is being deleted. And the touch target is the glyph's
intrinsic 18pt plus 2x hitSlop(8) = **34pt, below the 44pt minimum**, for an irreversible action.

This lands on the coach creation layer that CURRENT-STATE.md lists as the newly built path on which
everything a coach offers depends.

### 3. P2. The cart quantity stepper cannot be operated by a screen reader

`components/ui/product-card.tsx:162` and `:182`, the `variant === 'cartLine'` branch. Both are
icon-only `Pressable`s, both carry `accessibilityRole="button"`, and **neither has an
`accessibilityLabel`**. One contains `<Minus size={16} />` and the other `<Plus size={16} />`.

A screen reader user on the cart screen hears "button" and "button" with no way to tell decrease
from increase, on the control that changes what they are about to be charged. Touch targets are fine
here (`h-11 w-11` = 44pt).

### 4. P2. Selected state is conveyed by colour alone on four hand-rolled controls

The shared `Chip` gets this right: `components/ui/chip.tsx:33-34` sets
`accessibilityState={{ selected, disabled }}`. Four controls re-implement a selectable pill and drop
it, so the selection is visible only as a background or border colour:

| File:line | Control | State expressed as |
|---|---|---|
| `app/profile/index.tsx:352` | Profile tab bar | `borderBottomColor: active ? colors.accent : 'transparent'` |
| `components/organisms/DonationSheet.tsx:93` | Preset donation amount | `backgroundColor: active ? colors.accent : colors.surfaceMuted` |
| `components/organisms/SearchResults.tsx:68` | Search segment | `backgroundColor: active ? colors.accent : colors.surfaceMuted` |
| `app/(tabs)/trainings/trainee/[id].tsx:314` | Sessions filter | background ternary |

`trainee/[id].tsx:314` is the worst of the four: it is **also** 32pt tall with no hitSlop, **and**
has neither `accessibilityLabel` nor `accessibilityRole`. It fails three separate rules in one
element.

`DonationSheet.tsx:93` is a money control: a donor cannot confirm which preset amount is armed.

### 5. P2. Prices and counts rendered in Inter instead of JetBrains Mono

Unlike the tabular-figures breach, this one is plainly visible: the number is in the wrong typeface
entirely, so it does not match every other number in the app. 15 readouts, listed in full below. The
three that matter most are money:

- `app/(tabs)/coaching/coach/[id].tsx:456`, `` `Continue, ${formatINR(sessionType!.price)}` `` on the
  primary booking CTA, the last price an athlete sees before paying
- `components/organisms/DonationSheet.tsx:127`, `The minimum donation is {formatINR(minAmount)}.`
- `app/home/donate/[id].tsx:282`, the same minimum-donation message on the donate screen

The codebase's own correct pattern for a number inline in a sentence is at `app/learn/roadmap.tsx:172`:
`<Text style={textStyle('numericSm')}>{home.xpTotal}</Text> XP total`.

---

### 6. P3. Numeric readouts carry no tabular-figures setting (house rule breach, low visual impact)

The house rule is "Numeric readouts render in JetBrains Mono with tabular figures, EVERYWHERE, no
exceptions." The codebase has two parallel styling systems and **only one of them can express the
second half of that rule.**

- The token path, `apps/mobile/src/theme/text-style.ts:40-42`, sets
  `style.fontVariant = ['tabular-nums']` when the variant declares `tabularNums`. Correct.
- The className path resolves through `apps/mobile/tailwind.config.js:116-117`, which defines
  `mono: ["JetBrainsMono_500Medium"]` and `"mono-semibold": ["JetBrainsMono_600SemiBold"]` and
  **nothing else**. A Tailwind `fontFamily` entry cannot carry `fontVariant`.

Verified there is no fallback anywhere: `apps/mobile/src/components/ui/text.tsx:22-24` is a plain
`RNText` with a className and no `fontVariant`. `packages/ui-native/src/ThemedText.tsx:42,60` does
apply tabular figures, but `apps/mobile` never imports it (`rg 'ThemedText|@atlitos/ui-native'
apps/mobile/src` returns zero rows).

So all 21 readouts styled `className="font-mono"` are JetBrains Mono **without** tabular figures:

| File:line | Readout |
|---|---|
| `components/molecules/BillSummary.tsx:50` | `{formatINR(row.amount)}` |
| `components/molecules/BillSummary.tsx:72` | `{formatINR(donationRow.amount)}` |
| `components/molecules/BillSummary.tsx:80` | `{formatINR(total)}` |
| `components/molecules/TransactionRow.tsx:48` | `{isCredit ? '+' : '-'} {formatINR(...)}` |
| `components/ui/product-card.tsx:57` | `{formatINR(price)}` |
| `components/ui/product-card.tsx:63` | `{formatINR(originalPrice)}` |
| `components/ui/product-card.tsx:175` | `{quantity}` |
| `components/ui/coach-card.tsx:69` | `{rating.toFixed(1)}` |
| `components/ui/coach-card.tsx:79` | `From {formatINR(priceFrom)}` |
| `components/ui/court-card.tsx:119` | `{distanceKm.toFixed(1)} km` |
| `components/ui/upa-card.tsx:87` | `{formatINR(raisedAmount)} raised` |
| `components/ui/upa-card.tsx:93` | `of {formatINR(goalAmount)}` |
| `components/ui/star-rating.tsx:62` | `{value.toFixed(1)}/{max}` |
| `components/molecules/ClutchPostCard.tsx:124,206,215` | likes, likes, comment count |
| `components/organisms/chat/ChatThreadList.tsx:236` | member count |
| `app/(tabs)/chat/[id].tsx:232` | member count |
| `app/(tabs)/clutch/upload.tsx:180` | `{caption.length}/{MAX_CAPTION}` |
| `app/(tabs)/clutch/post/[id].tsx:808,819` | likes, comment count |

`BillSummary` is the component `CLAUDE.md` mandates for every screen showing a money total, so this
reaches every money surface in the app.

**Severity honestly stated.** The obvious claim to make here is digit jitter on values that change
in place, the cart total as quantity steps or a caption counter as the user types. That claim would
be wrong. JetBrains Mono is monospaced, so its digits already share a uniform advance width and
`fontVariant: ['tabular-nums']` changes little or nothing on this face. The rule is breached in
letter and the fix is worth making, because the rule exists so that a future face swap cannot
silently reintroduce jitter, but this is not a defect a user will notice today. Ranked P3 for that
reason. One systemic fix, not 21 edits: route the mono readouts through `textStyle` via a shared
component or variant, the way `PriceText` already does.

---

## Full findings by rule

### No emojis anywhere, CLEAN

Zero hits across `apps/mobile/src` for U+1F000-1FAFF, U+2600-27BF, U+2B00-2BFF, U+FE0F,
U+1F1E6-1F1FF, U+2190-21FF. Check proven red on the canary first.

### No em dashes in user-visible copy: 1 violation

`app/(tabs)/trainings/trainee/[id].tsx:303`

```
<StatTile label="Attendance rate" value={attendanceRate !== undefined ? `${attendanceRate}%` : ','} />
```

An em dash (U+2014) as the empty-value placeholder, rendered to the coach whenever a trainee has no
attendance rate yet. This is the only em dash or en dash in the entire mobile source. It was missed
by the copy corpus and caught by the wide net, because it lives inside a ternary.

### No hyphens in user-visible copy: 1 arguable

Both nets agree the tree is otherwise clean. The wide net produced 6 residue rows after excluding
Tailwind soup, of which 2 were comment-stripper artifacts and 3 were template-literal classNames.

The one real hit is `app/profile/edit.tsx:318`:

```
<Input type="pincode" label="Date of birth" placeholder="YYYY-MM-DD" ... />
```

Judgment call, flagged rather than asserted: it renders in the product and contains hyphens, but it
is a date input mask rather than prose. Worth a founder or designer decision, not an automatic fix.

Explicitly NOT violations, checked and dismissed: `'Trainings - home'`
(`app/(tabs)/trainings/(shell)/index.tsx:73`) and `'player - training'`
(`(shell)/payments.tsx:23`, `(shell)/coaches.tsx:33`, `MySportsCard.tsx:13`) are Figma frame names
inside docblocks, never rendered.

### Tokens only, no hardcoded colour, CLEAN

- Hex literals in code: **0**. The only three `#` matches in `apps/mobile/src` are inside comments
  (`product-card.tsx:78`, `court-card.tsx:70`, `ClutchProfileView.tsx:173`), each explaining a token
  decision rather than hardcoding one.
- `rgba()`/`hsl()` literals: **0**. `AuthScene.tsx:52-57` defines an `rgba()` helper, but every call
  site feeds it a token (`rgba(colors.surface, 0.62)` at `:262`, `rgba(colors.borderStrong, 0.6)` at
  `:265`), so the output is token-derived.
- Named colour literals in colour positions: **0**, apart from `'transparent'` at
  `app/profile/index.tsx:361`, which is an absence of colour rather than a palette value.

This rule is in genuinely good shape.

### Dark mode: colours that will not flip

Because there are no hardcoded colours, there is no colour that fails to flip. Every colour resolves
through `useThemeColors()` (`theme/use-theme-colors.ts:25-28`), which reads nativewind's resolved
scheme, or through a Tailwind semantic class.

The dark-mode defect that does exist is not a missing flip but a **token used correctly and rendered
illegibly**: finding 2 above, `textInverse` (`#14100B` dark) on an unscrimmed photo. Both themes
resolve it exactly as designed; the value is simply wrong against arbitrary media without a scrim.

Class sweep for that shape, since one instance is never the whole story. All other `textInverse`
usages over media are backed by a `colors.overlay` scrim and are fine:

- `ClutchPostCard.tsx:163-237`, scrim at `:148-150` (`top: '55%'`)
- `app/(tabs)/clutch/post/[id].tsx:763-850`, two scrims at `:742` and `:744`
- `home/PromoCarousel.tsx:97-99`, scrim at `:93-94`
- `WishlistGrid.tsx:145`, `colors.overlay` pill at `:142`
- `app/profile/edit.tsx:259-260`, `colors.overlay` chip at `:254`
- `app/profile/index.tsx:436-438`, `colors.overlay` at `:434`
- `ClutchProfileView.tsx:209`, `colors.overlay` pill at `:206`, the B5 fix

Every other `textInverse` usage is on an accent or danger fill, which is what the token is for.
**`ClutchPostCard.tsx:123-124` is the single unscrimmed instance.**

### lucide icon names only, CLEAN

113 distinct icon names imported, every one from `lucide-react-native`. Zero imports of
`@expo/vector-icons`, `react-native-vector-icons`, or any other icon library.

All 113 names were checked **against the installed package artifact**, not assumed. An initial scan
reported `CheckCircle2`, `Home`, `ImageIcon`, `X` and `XCircle` as missing; that was a false negative
from an incomplete scan of my own, not a real absence. All five are present in the alias export block
at `node_modules/.pnpm/lucide-react-native@1.24.0.../dist/types/lucide-react-native.d.ts:22767`.
Minor note only: `CheckCircle2`, `XCircle` and `ImageIcon` are legacy aliases (current names
`CircleCheckBig`, `CircleX`, `Image`). They resolve correctly at 1.24.0.

### Numeric readouts rendered in the sans face, 15

Distinct from finding 1. These use neither `font-mono` nor a numeric `textStyle`, so they render in
Inter. Several sit inline in a sentence, where the codebase's own correct pattern is to wrap just the
number, as `app/learn/roadmap.tsx:172` does with `<Text style={textStyle('numericSm')}>{home.xpTotal}</Text>`.

Money, highest impact of this group:

- `app/(tabs)/coaching/coach/[id].tsx:456`, `` `Continue, ${formatINR(sessionType!.price)}` `` on the primary booking CTA
- `components/organisms/DonationSheet.tsx:127`, `The minimum donation is {formatINR(minAmount)}.`
- `app/home/donate/[id].tsx:282`, same minimum-donation message

Counts and durations:

- `app/home/upa/[id].tsx:192`, `{profile.donorCount}`
- `app/(tabs)/trainings/group/schedule.tsx:188`, `{activeMembers}`
- `app/(tabs)/trainings/group-session/[id].tsx:212`, `Session duration: {duration}`
- `app/(tabs)/trainings/group-session/[id].tsx:238`, `{presentCount} of {participants.length} present`
- `app/(tabs)/trainings/(shell)/trainees.tsx:238`, `{activeMembers}`
- `app/(tabs)/trainings/(shell)/trainees.tsx:277`, `{sessionCount}`
- `app/(tabs)/trainings/trainee/[id].tsx:233`, `{totalSessions}`
- `app/(tabs)/coaching/coach/[id].tsx:375`, `{type.durationMinutes} min`
- `app/shop/affiliate/[id].tsx:127`, `across {inStockOffers.length} retailers`
- `components/molecules/ClutchPostCard.tsx:180`, `View all {clip.commentCount} comments`
- `components/organisms/CoachProfileSheet.tsx:96`, `{session.duration}`
- `components/organisms/learn/LearnHomeContent.tsx:176`, `{earnedCount} of {home.milestones.length} earned`

### Interactive elements with no accessible name, 11

Icon-only controls with no `accessibilityLabel` and no text child. A screen reader announces the role
and nothing else. Each was confirmed by reading the source.

| File:line | Control |
|---|---|
| `app/(onboarding)/coach-setup/[step].tsx:331` | Avatar photo picker |
| `app/(onboarding)/coach-setup/[step].tsx:393` | Remove certificate (destructive) |
| `app/(onboarding)/coach-setup/[step].tsx:430` | Remove session type (destructive) |
| `app/(onboarding)/coach-setup/[step].tsx:488` | Remove availability window (destructive) |
| `app/(onboarding)/player-setup/[step].tsx:191` | Avatar photo picker |
| `components/ui/product-card.tsx:162` | Cart quantity decrease |
| `components/ui/product-card.tsx:182` | Cart quantity increase |
| `components/molecules/CalendarPicker.tsx:71` | Previous month |
| `components/molecules/CalendarPicker.tsx:77` | Next month |
| `components/molecules/AdBannerCarousel.tsx:47` | Promo banner (its only child is an unlabelled `Image`, so the control is entirely silent) |
| `app/(tabs)/trainings/trainee/[id].tsx:314` | Sessions filter (also no role, also 32pt) |

`CalendarPicker.tsx:71,77` deserve a note: the month chevrons are the only way to reach another
month, and they are unnamed. Both are correctly sized at `h-11 w-11`.

### Touch targets below 44pt, 10

Effective size is the rendered box plus 2x `hitSlop`. Every row below was confirmed against the
source; heuristic-only hits were discarded.

| File:line | Effective | Control |
|---|---|---|
| `app/(tabs)/index.tsx:172` | 32pt | Dismiss the finish-setup card |
| `app/(tabs)/trainings/trainee/[id].tsx:314` | 32pt (height) | Sessions filter chip |
| `app/(onboarding)/coach-setup/[step].tsx:393` | 34pt | Remove certificate (destructive) |
| `app/(onboarding)/coach-setup/[step].tsx:430` | 34pt | Remove session type (destructive) |
| `app/(onboarding)/coach-setup/[step].tsx:488` | 34pt | Remove availability window (destructive) |
| `components/ui/input.tsx:79` | 36pt (height) | Password show/hide |
| `app/(tabs)/trainings/group-session/[id].tsx:332` | 36pt | Add notes for a participant |
| `app/(tabs)/trainings/my-videos.tsx:180` | 40pt | Close video modal |
| `components/organisms/trainings/TraineeVideoAnalytics.tsx:291` | 40pt | Close video modal |
| `app/(tabs)/trainings/trainee/[id].tsx:510` | 40pt | Close note composer |

`components/ui/chip.tsx:26-27` documents the correct handling of exactly this problem: 36pt height
compensated to 52pt with `hitSlop={8}`. The rows above are the cases where that compensation was not
applied or was insufficient.

### Images without alt semantics: 1 informative, 21 benign

22 `<Image>` elements carry no `accessibilityLabel`, `alt`, or explicit hiding. React Native does not
expose `Image` to screen readers by default, so a decorative image without alt semantics is correct
behaviour, not a defect. Reporting all 22 would be the kind of false positive that teaches people to
ignore the check.

Only images that are informative **and** not inside a labelled ancestor are genuine:

- `app/shop/product/[id].tsx:368`, the product photo gallery. A paging `ScrollView` of product
  images, none labelled, not wrapped in a labelled control. A screen reader user shopping a product
  gets nothing from the gallery.

Ruled out by inspection: `components/ui/app-bar.tsx:123` (inside a Pressable labelled "Profile"),
`ClutchPostCard.tsx:120` (inside a Pressable labelled ``Open clip, ${clip.likes} likes``), and the
card thumbnails in `coach-card`, `court-card`, `product-card`, `upa-card`, `WishlistGrid`,
`SearchResults`, whose parent Pressables carry names.

---

## Ruled out, with the reason

Recorded so the next agent does not re-investigate them.

1. **`components/ui/price-text.tsx:36` is NOT a sans-face price.** It was flagged because the sweep
   looked for the literal `textStyle('numericBase')`, while the file writes
   `textStyle(SIZE_VARIANT[size])` at `:39` with the lookup table at `:16-20`. This is precisely the
   "absence of the literal string is not absence of the thing" trap from CURRENT-STATE.md, met and
   avoided by reading the file. `PriceText` is correct: mono, tabular, via the token path.
2. **`components/ui/button.tsx:104` is not an unlabelled control.** It has
   `accessibilityRole="button"`, and its name comes from `{children}` plus `{...props}`, which lets
   any consumer pass `accessibilityLabel`. Flagged only because `{children}` is not literal text.
3. **`components/ui/chip.tsx:33` is correct.** `accessibilityState={{ selected, disabled }}`,
   `accessibilityRole`, and `hitSlop={8}` lifting 36pt to 52pt. It is the reference implementation
   the four controls in finding 5 should copy.
4. **`app/(onboarding)/player-setup/[step].tsx:191` is not a 14pt target.** The heuristic took the
   smallest child icon; the Pressable is actually sized by `<Avatar size={80} />` at `:196`. It is
   still genuinely unlabelled, so it stays in the naming table and is dropped from the size table.
5. **`app/profile/index.tsx:352` is not a 22pt target.** It is a `flex: 1` tab cell with
   `paddingVertical: spacing.md`. It remains a finding for colour-only selection, not for size.
6. **`CalendarPicker.tsx:71,77` and `AdBannerCarousel.tsx:47` do have a role.** They use React
   Native's `role="button"` rather than `accessibilityRole`. The first version of the check did not
   know about `role` and reported them falsely.
7. **The three `#RRGGBB` matches in the tree are comments**, not hardcoded colours.
8. **`'Trainings - home'` and `'player - training'` are Figma frame names in docblocks**, not copy.
9. **The five "missing" lucide names were a false negative in my own scan.** All present at
   `dist/types/lucide-react-native.d.ts:22767`.
10. **The B5 near-black glyph in `ClutchProfileView.tsx` is already fixed** on this branch
    (`:198-210`). The live instance is its sibling `ClutchPostCard.tsx:123`, found only by sweeping
    the class rather than checking the reported instance.

---

## Unresolved

1. **Contrast ratios were not computed.** Token pairs such as `textTertiary` on `surfaceMuted` were
   not measured against WCAG AA. That needs a real render or a colour-maths pass; it is provable
   without a device but was out of this lane's time budget.
2. **`placeholder="YYYY-MM-DD"` needs a human decision**, not an automatic fix.
3. **Dynamic Type and font scaling were not checked.** No `allowFontScaling` audit was performed, and
   fixed `height` values such as the 32pt chip at `trainee/[id].tsx:314` will clip at large text
   sizes. Static analysis can find the fixed heights; confirming the clipping needs a render.
4. **The exact visual delta of the missing tabular setting is unconfirmed.** The reasoning that it is
   near zero on a monospaced face is sound but was not proven by a render, which this lane could not
   do. If someone later has a screenshot pass available, one dark-mode capture of the cart total
   would settle it. The rule breach itself is proven from `tailwind.config.js:116-117` and needs no
   render.
