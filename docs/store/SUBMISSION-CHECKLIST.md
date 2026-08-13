# Atlitos store submission checklist

Everything still outstanding before either store will accept a build. Split by who can actually
do it: an engineer with repo access, or the founder, who alone holds the console credentials,
signs the agreements and taps Submit.

Status verified 2026-08-13 on branch `phase-11/p6-store`.

Companion documents: `DATA-INVENTORY.md` (the evidence base), `APPLE-APP-PRIVACY.md`,
`GOOGLE-DATA-SAFETY.md`, `LISTING-COPY.md`.

---

# Part A. Rejection risks, ranked

Ranked by probability of causing an actual rejection or takedown, highest first. Each one names
what was checked so the finding can be re verified rather than trusted.

## 1. In app account deletion. RESOLVED in `phase-11/p6-account-deletion`

Apple Guideline 5.1.1(v) requires an app supporting account creation to let the user **initiate
deletion from inside the app**. Google's account deletion policy expects an in app path alongside
a web accessible one.

What exists: a live page at `https://www.atlitos.com/delete-account` (HTTP 200 verified) offering a
**request by email** flow to `support@elsheph.com`, actioned within 30 days
(`apps/landing/delete-account.html:53,74`).

What does not exist: any deletion entry point in the app. The Settings Account section holds Edit
profile, Become a coach and Sign out and nothing else
(`apps/mobile/src/components/organisms/settings/SettingsContent.tsx:387-401`). There is no
deletion RPC anywhere: grep for `delete_account` and `deleteAccount` across `apps/mobile`,
`packages` and `supabase` matches only the landing page.

Minimum viable fix: a Settings row that opens `https://www.atlitos.com/delete-account`. Even that
is missing today. Correct fix: a real in app deletion flow, which pairs with the Sign in with
Apple work in Phase 8, since Apple additionally requires an Apple ID sign in to be revocable from
the app.

### Status: built, and here is the reviewer answer

Shipped on `phase-11/p6-account-deletion` (migration `0098_account_deletion.sql`, edge function
`delete-account`, `packages/api/src/use-account-deletion.ts`, and
`apps/mobile/src/app/profile/delete-account.tsx`).

**Where the reviewer finds it:** Settings, Account section, **Delete account**. Settings is
reachable from three entry points (the You bottom tab, the Profile page, and the Trainings tab).
The row opens a confirmation screen; nothing is deleted until the reviewer types `DELETE` exactly,
so it cannot be triggered by accident.

**Answer for App Review notes, use verbatim:**

> Account deletion is in the app at Settings, Account, Delete account. The screen lists exactly
> what is removed and what is kept, then requires the word DELETE to be typed before the
> destructive button enables. On success the account is deleted, the user is signed out, and the
> email address is released so it can be used to register again. Payment, order, booking and
> donation records are retained for Indian tax and accounting obligations, with the user's name
> removed from them. This retention is disclosed at https://www.atlitos.com/privacy.

**Google Play Data Safety, the deletion URL field:** `https://www.atlitos.com/delete-account`.
That page stays live and is still the required web accessible route for someone who cannot open
the app. It is no longer the only route, which is what closed this risk.

**What the reviewer can verify without an account of their own:** the demo reviewer account (risk
6, F2) can walk to the screen and read the confirmation copy without completing it. Do not have
the reviewer complete the deletion on the demo account, since re-seeding it costs a cycle.

**Retention answer if Apple asks why anything survives:** `delete_my_account()` retains
`payment_intents`, `ledger_entries`, `refunds`, `orders`, `donations`, `sessions` and
`court_bookings`, and anonymises the author on each rather than orphaning the row. Apple's
guideline permits retaining data a legal obligation requires. The full table by table decision is
in `docs/architecture/SCHEMA.md`, "Account deletion (migration `0098`)".

**Still open on this risk:** the deletion is available to a signed in user of the mobile app only.
Sign in with Apple lands in Phase 8; when it does, verify the Apple token revocation requirement
separately, because releasing the GoTrue email does not by itself revoke an Apple ID grant.

## 2. The production build ships a Razorpay TEST key. BLOCKER

`apps/mobile/eas.json`, the `build.production` profile, sets
`EXPO_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_TCwxkMaUz54BPH"`.

An App Review reviewer will attempt a booking. With a test key, either the checkout fails outright
or it completes without a real charge, and both outcomes are a rejection: Apple rejects on
"unable to complete the primary flow", and a store build that transacts against a test gateway is
a live payments defect regardless of review.

The server side `RAZORPAY_KEY_ID` secret exists on the project but the secret listing only exposes
a digest, so the server's mode could not be established from here. Either the server is also on
test, in which case nothing charges, or the two disagree, in which case order creation fails.

Owner: founder must supply the live key id and secret; engineer swaps `eas.json` and the Supabase
secrets. Verify by completing one real low value booking on the release build before submitting.

## 3. The marketing site advertises subscription tiers the app does not have. HIGH

`apps/landing/index.html:344-401` runs a scrolling strip and a pricing band offering
`Pro` at 199 per month and `Elite` at 499 per month, with a "MOST PICKED" flag on Pro.

The app has no subscription of any kind. There is no StoreKit product, no Play Billing product,
and no subscription table. Grep for `expo-in-app-purchases`, `react-native-iap`, `StoreKit` and
`subscription` as a product concept across `apps/mobile`, `packages` and `supabase/migrations`
returns nothing but realtime channel subscriptions and the per group monthly membership
(`packages/api/src/use-groups.ts:9-12`), which is a Razorpay paid membership to a coached training
group, not an app tier.

Two problems. Apple reviewers open the marketing URL, and metadata that advertises functionality
the binary does not have is a 2.3.1 rejection. Separately, "MOST PICKED" is an unevidenced
popularity claim with no data behind it.

Correction to the dispatch brief: these tiers are **not** in `docs/PLAN.md`. Grep for `199`, `499`
and `Phase 6` in `docs/PLAN.md` returns zero matches. They exist only on the landing page.

Fix: remove the strip and the pricing band, or move them behind a clearly labelled roadmap. Do not
submit with the marketing URL pointing at a page selling tiers that do not exist.

Owner: engineer, in `apps/landing/**`, which this track does not own. Founder decides whether the
tiers are being dropped or deferred.

## 4. Support URL returns 404. BLOCKER for Apple

`https://www.atlitos.com/support` returns **404** (verified 2026-08-13). Apple requires a working
support URL in App Store Connect and rejects a dead one. There is no `support.html` in
`apps/landing/`.

Fix options are in `LISTING-COPY.md` section 8. Adding a small `support.html` is the right answer.

Owner: engineer, in `apps/landing/**`.

## 5. Privacy policy does not match what the Data Safety form must declare. HIGH

Play compares the Data Safety form against the linked privacy policy and treats a mismatch as a
policy violation, which is a common cause of both rejection and post launch takedown.

Two real gaps in `apps/landing/privacy.html`:

- **Phone number is never disclosed.** The Account and profile section lists email, password, name, sports, city, state and photo (`privacy.html:53-54`). Phone is collected as a **required** signup field (`apps/mobile/src/app/(auth)/register.tsx:86`, written by `supabase/migrations/0073_signup_metadata.sql:26,43-53`) and the Data Safety form must say so.
- **Sentry is not disclosed at all.** The service provider list names Supabase, Razorpay, Expo and Anthropic (`privacy.html:102-105`). Sentry is absent and there is no crash or diagnostics section, yet crash logs, performance traces and the client IP are collected in every release build (`apps/mobile/src/lib/sentry.ts:11-16`, DSN baked into `apps/mobile/eas.json`).

Two smaller omissions worth fixing in the same pass: coach certificate document upload, and the
optional date of birth field.

Owner: engineer, in `apps/landing/**`.

## 6. No demo reviewer account exists. BLOCKER for Apple

Every meaningful surface is behind sign in, so App Review needs credentials.

`docs/qa/SECURITY-LOCKDOWN.md:187-189,211-213` records explicitly that seed password rotation and
reviewer account setup were **deferred to Phase 6**, and
`supabase/migrations/0089_security_lockdown_phase1.sql:3-4` repeats it in the migration header.
So no reviewer account has been created, and the seed accounts are on their pre lockdown state
pending rotation.

The account needs: a verified player role, at least one completed booking or session in history so
the history screens are not empty, and a state that lets the reviewer see Clutch, Courts, Coaching
and Shop without hitting an empty state. It should not be an admin.

Owner: founder creates it (it is a real signup, and this track is under a hard no production write
gate). Engineer can seed its content afterwards.

## 7. UGC obligations: report and block SHIPPED, EULA and in app contact MISSING. MEDIUM

Good news, verified rather than assumed. Apple Guideline 1.2 and Play's UGC policy require a
filtering method, a reporting mechanism, blocking, and published contact.

- Report: `supabase/migrations/0097_report_block.sql`, UI at `apps/mobile/src/components/organisms/moderation/ModerationSheet.tsx:161-234`, reachable from a clip (`apps/mobile/src/app/(tabs)/clutch/post/[id].tsx:792`), a comment (`:531`), a chat message (`apps/mobile/src/app/(tabs)/chat/[id].tsx:370`) and a creator profile (`apps/mobile/src/app/(tabs)/clutch/creator/[id].tsx:94`).
- Block: `public.blocked_users` at `0097_report_block.sql:28-53`, with the blocked party's content filtered out of the blocker's own reads.
- Admin moderation queue: `supabase/migrations/0003_moderation_audit.sql` plus the `apps/admin` surface.
- Clips are moderated before publication: `public.clip_status` with a published state gating the feed (`0041_clutch_schema.sql:75`, `0043_clutch_state_machine.sql`).

What is missing:

- **No terms of use or EULA anywhere.** `https://www.atlitos.com/terms` returns **404**, there is no `terms.html` in `apps/landing/`, and grep for `terms`, `EULA` and `objectionable` across `apps/mobile/src` finds only unrelated commerce wording. Guideline 1.2 expects an agreement stating there is no tolerance for objectionable content or abusive users.
- **No published contact inside the app.** Grep for `support@`, `privacy` and `atlitos.com` across `apps/mobile/src` returns zero matches. The app links to nothing: no privacy policy, no terms, no support.

Fix: a `terms.html` on the landing site, and a Legal section in Settings linking to privacy, terms,
support and account deletion. That single Settings section also closes risk 1's minimum fix.

Owner: engineer, across `apps/landing/**` and `apps/mobile/**`.

## 8. `ACCESS_FINE_LOCATION` is declared but never used. MEDIUM

`apps/mobile/app.json:29-30` declares both `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`.
The code only ever requests `Location.Accuracy.Balanced`
(`apps/mobile/src/store/location-store.ts:84-86`), which is approximate.

Play scans the manifest during review. A fine location permission next to an "approximate only"
Data Safety declaration is a mismatch flag, and Play separately requires a justification for
declaring a location permission the app does not need.

Fix: drop `ACCESS_FINE_LOCATION` from `app.json`. Then the Play declaration is clean and truthful.
If it stays, `GOOGLE-DATA-SAFETY.md` must be changed to tick Precise location.

Owner: engineer, in `apps/mobile/**`.

## 9. The marketing site's testimonial wall is placeholder text. LOW

`apps/landing/index.html:426-449` renders twelve quote cards reading "Quote from a Bengaluru
badminton regular goes here" with names like "ATHLETE NAME, BENGALURU".

To its credit this is handled honestly: every card carries a visible `SAMPLE` tag and the section
intro says "Sample cards below. Real words from athletes, coaches, and court partners land here at
launch" (`index.html:431,435`). So it is not a fabricated endorsement and it does not breach the
no invented testimonials rule.

It is still placeholder copy on a page an App Review reviewer may open. Either fill it with real,
attributable quotes or remove the section until there are some.

Owner: founder decides, engineer implements.

## 10. Empower donations under Apple's payment rules. NEEDS A LEGAL READ, not a code fix

Atlitos lets a user fund a specific need for a specific athlete, paid through Razorpay rather than
in app purchase (`apps/mobile/src/app/home/donate/[id].tsx`, `supabase/functions/donate/`).

The fact that helps: **Atlitos takes no cut of a donation.**
`supabase/functions/_shared/finalize-donation-payment.ts:20` states there is no platform fee leg,
unlike courts, and a read only query of production `fee_config` confirms it. The table carries
`courts.platform_fee_flat`, `sessions.platform_fee_flat` and three `commerce` rows, and for
`donations` carries only `min_amount = 10`. Apple's concern with person to person money movement
is a platform taking a commission outside in app purchase, and that is not happening here.

The fact that needs a decision: donations go to individual athletes through an Atlitos held fund,
not to a registered charitable organisation. Apple treats fundraising for approved nonprofits and
person to person gifting under different rules, and the recipient's legal status matters.

Do not guess this in the App Review notes. Get the founder or counsel to state the position, then
write it into the notes explicitly, alongside the zero fee fact, which is the strongest thing to
lead with.

## 11. Export compliance is already handled. NO ACTION

Noted here so nobody re opens it. `apps/mobile/app.json:15` sets
`ITSAppUsesNonExemptEncryption: false` in the iOS `infoPlist`. That is the correct declaration for
an app whose only cryptography is standard HTTPS, and it stops App Store Connect asking on every
upload. Confirmed that no custom crypto exists in the app.

---

# Part B. What an engineer can do

Paths in `apps/mobile/**`, `apps/landing/**` and `supabase/**` are not owned by this track. Each
item names its home so the right builder picks it up.

| # | Task | Path | Closes risk |
|---|---|---|---|
| B1 | Add a Settings Legal section linking to privacy, terms, support and account deletion | `apps/mobile/**` | 1, 7 |
| B2 | ~~Build a real in app account deletion flow plus the deletion RPC~~ DONE on `phase-11/p6-account-deletion`: migration `0098`, edge function `delete-account`, Settings row and confirmation screen | `apps/mobile/**`, `supabase/**` | 1 |
| B3 | Swap the production Razorpay key id in the build profile once the founder supplies the live key | `apps/mobile/eas.json` | 2 |
| B4 | Remove or relabel the Pro and Elite pricing band and the scrolling tier strip | `apps/landing/index.html:344-401` | 3 |
| B5 | Add `support.html` with contact email, response expectation and links to privacy, terms and deletion | `apps/landing/**` | 4 |
| B6 | Add phone number, Sentry, coach certificate uploads and optional date of birth to the privacy policy | `apps/landing/privacy.html` | 5 |
| B7 | Add `terms.html`, including the no tolerance for objectionable content clause Guideline 1.2 expects | `apps/landing/**` | 7 |
| B8 | Drop `ACCESS_FINE_LOCATION` from the Android permission list | `apps/mobile/app.json:29-30` | 8 |
| B9 | Decide `sendDefaultPii` for Sentry, then make it explicit rather than relying on the SDK default | `apps/mobile/src/lib/sentry.ts` | Data Safety accuracy |
| B10 | Fix the stale comment naming `atlitos-landing.vercel.app` as the store deletion URL, now `www.atlitos.com` | `apps/landing/delete-account.html:7` | Tidiness |
| B11 | Capture the screenshot set, see Part D | `apps/mobile/**` plus tooling | Store requirement |
| B12 | Produce the 1024x500 Play feature graphic and the 1024x1024 iOS icon export | design assets | Store requirement |
| B13 | Seed the reviewer account with booking, session, order and clip history once the founder has created it | `scripts/**` | 6 |
| B14 | Run a real end to end paid booking on a release build against the live Razorpay key and record the evidence | verification | 2 |

---

# Part C. What only the founder can do

None of this can be done by an agent. Every item needs a credential, a legal signature, or a tap
in a console.

| # | Task | Console or party |
|---|---|---|
| F1 | Supply the live Razorpay key id and key secret, and confirm the account is activated for live mode | Razorpay dashboard |
| F2 | Create the demo reviewer account with a real email and password, and hand the credentials over for the App Review notes | the app itself |
| F3 | Accept the Apple Developer Program License Agreement and any pending agreement updates | App Store Connect |
| F4 | Complete Apple's Paid Apps agreement, banking and tax forms if any paid capability is ever added. Not needed while the app is free with external payments, confirm rather than assume | App Store Connect |
| F5 | Complete the Apple age rating questionnaire using the inputs in `LISTING-COPY.md` section 9 | App Store Connect |
| F6 | Complete the Google Play IARC content rating questionnaire using the same inputs | Play Console |
| F7 | Complete Play's Target Audience and Content declaration, including the age assurance question. Note the app has no age gate at all, see `LISTING-COPY.md` section 9 | Play Console |
| F8 | Complete Play's Ads declaration. The honest answer is that the app contains no ads. Affiliate click outs are commerce, not advertising, but the founder should confirm the position | Play Console |
| F9 | Complete Play's Financial Features declaration, given court, session, membership, gear and donation payments | Play Console |
| F10 | Complete Play's News, Health and Government app declarations, all no | Play Console |
| F11 | Transcribe the App Privacy answers from `APPLE-APP-PRIVACY.md` | App Store Connect |
| F12 | Transcribe the Data Safety answers from `GOOGLE-DATA-SAFETY.md` | Play Console |
| F13 | Read Razorpay's SDK data disclosure and close the UNRESOLVED row in `DATA-INVENTORY.md` section 11 before submitting Data Safety | Razorpay documentation |
| F14 | Decide the Empower donation position under Apple's rules, risk 10, and supply the wording for the App Review notes | founder or counsel |
| F15 | Decide whether the Pro and Elite tiers are dropped or deferred, risk 3 | founder |
| F16 | Upload the screenshot and graphic assets to both consoles | both |
| F17 | Confirm the Play Console account and the app entry. `apps/mobile/eas.json` names the Android submit track as `internal` and expects `apps/mobile/google-service-account.json`. That file is gitignored (`apps/mobile/.gitignore:47`) and is **not present in the checkout**, so whoever runs `eas submit` needs the founder to place it first | Play Console |
| F18 | Set the App Store Connect pricing to Free and pick availability territories | App Store Connect |
| F19 | Final Submit for Review on both stores | both |

Already in place, so not on the list: ASC app id `6793626237` and Apple team id `4U493SXP52`
(`apps/mobile/eas.json`), EAS project id `5976cc18-8fc3-4a97-9a3d-c767ad542d69`
(`apps/mobile/app.json:79`), the Android `google-services.json` file, and the Play org account
context recorded in the founder's own notes.

---

# Part D. Assets still to produce

None of these exist in the repo today. `find . -ipath "*store*" -name "*.md"` outside
`docs/store/` returns nothing, and there is no screenshot directory.

## iOS

| Asset | Requirement | Status |
|---|---|---|
| 6.7 inch iPhone screenshots | 1290x2796 portrait, minimum 3, maximum 10 | Not captured |
| 6.5 inch iPhone screenshots | Only needed if the 6.7 inch set is not accepted for the chosen device families. Confirm in ASC | Not captured |
| 12.9 inch iPad screenshots | **Required**, because `apps/mobile/app.json:12` sets `supportsTablet: true`. Either capture them or set `supportsTablet` to false and ship iPhone only | Not captured, and this is easy to miss |
| App icon | 1024x1024 PNG, no alpha, no rounded corners | Source exists at `apps/mobile/assets/expo.icon`, needs the flat export |
| App preview video | Optional | Skip for v1 |

Suggested six screens, in the order that tells the story: Courts list with prices, court detail
with a slot picker, a coach profile, the Clutch feed, the Shop compare prices view, the Empower
athlete detail. Capture in both light and dark, submit the stronger set.

Note the iPad requirement. `supportsTablet: true` is currently on. Nothing in the QA record shows
the app has been laid out or tested on an iPad, so the cheaper and more honest option is to set
`supportsTablet: false` and submit iPhone only. That is an `apps/mobile/**` change.

## Android

| Asset | Requirement | Status |
|---|---|---|
| Phone screenshots | Minimum 2, maximum 8, 16:9 or 9:16, each side between 320 and 3840 px | Not captured |
| 7 inch and 10 inch tablet screenshots | Only if tablet form factors are opted into in Play Console | Decide, then capture |
| Feature graphic | **1024x500 PNG or JPG, mandatory**, no alpha | Not produced |
| App icon | 512x512 32 bit PNG with alpha | Source at `apps/mobile/assets/images/android-icon-foreground.png`, needs the composited export |

The feature graphic is mandatory and Play will not let the listing be submitted without it. It is
the single most commonly forgotten Play asset.

---

# Part E. The order to do this in

1. Founder decisions first, because they change the code: F1 the live Razorpay key, F15 the tiers, F14 the Empower position.
2. Engineer closes the blockers: B1 and B2 deletion, B3 the live key, B4 the tiers, B5 support page, B6 privacy policy, B7 terms, B8 fine location.
3. Founder creates the reviewer account, F2. Engineer seeds it, B13.
4. Engineer runs the real paid booking proof on a release build, B14. Do not skip this. A test key that reaches review is a wasted cycle and a live payments defect.
5. Capture assets, B11 and B12, Part D.
6. Founder transcribes the two questionnaires and completes the console declarations, F5 to F12.
7. Paste the listing copy from `LISTING-COPY.md`.
8. Submit, F19.

Nothing above should be marked done on the basis of it looking done. Each closed item wants the
same treatment the findings got: the command that proves it, and its output.
