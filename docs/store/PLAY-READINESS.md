# Play Store readiness

What stands between today and Atlitos being live on Google Play. Written 24 September 2026, and
every line marked verified was checked on that date rather than carried over from an earlier doc.

Companion documents: `SUBMISSION-CHECKLIST.md` (both stores, ranked rejection risks, verified
2026-08-13), `GOOGLE-DATA-SAFETY.md`, `LISTING-COPY.md`, `DATA-INVENTORY.md`.

## The account this ships under

The existing organisation account, not a new one: **ELSHEPH SYSTEMS INDIA PRIVATE LIMITED**,
developer id `8696807675061268676`, Google account `/u/3`, the same one that shipped
BelieversDiary. Because it is an organisation account with a live app, the 20 tester and 14 day
closed testing requirement does not apply, so Atlitos can go straight to production review.

## Verified today

| Thing | State | How it was checked |
|---|---|---|
| Android package | `com.atlitos.app` | `apps/mobile/app.json` |
| Version | `1.0.0`, `autoIncrement` on the production profile | `app.json`, `eas.json` |
| EAS submit profile | exists, track `internal` | `eas.json` |
| In app account deletion | present, Settings row routes to `/profile/delete-account` | `SettingsContent.tsx:403` |
| Privacy policy URL | live | `https://www.atlitos.com/privacy` returns 200 |
| Terms URL | live | `https://www.atlitos.com/terms` returns 200 |
| Refund, delivery, contact pages | live as of 24 Sep | `/refund-policy`, `/shipping`, `/contact` all 200 |
| Operator named on every legal page | ELSHEPH SYSTEMS INDIA PRIVATE LIMITED | fetched and read, no Synth Sports reference remains |

## Blockers, in the order they bite

### 1. The Play submit credential is the wrong service account. VERIFIED BROKEN.

`eas.json` points `serviceAccountKeyPath` at `apps/mobile/google-service-account.json`, which is a
**Firebase admin SDK** key (`firebase-adminsdk-fbsvc@atlitos-6aa21.iam.gserviceaccount.com`).
Firebase and Google Play are different products with different authorisation.

Proven rather than assumed: the key mints an OAuth token for the `androidpublisher` scope
successfully, then `POST /androidpublisher/v3/applications/com.atlitos.app/edits` answers
**403 PERMISSION_DENIED**. So `eas submit --platform android` fails at the last step, after a full
build has been spent.

Two causes are consistent with that 403 and both need fixing:

- The app record for `com.atlitos.app` may not exist yet in the Play Console under developer
  `8696807675061268676`. An edits call against an app that does not exist is a 403, not a 404.
- The service account is not granted access in the Play Console, or is granted release only
  permissions. `reference_believersdiary_play` records this exact trap: release only permissions
  return a masked 403 on `edits().commit()`. The grant needs **both** "Edit and delete draft apps"
  and "Manage store presence".

Fix: create the app record, then in Play Console under Users and permissions invite the service
account email with those two permissions, then re run the check in
`scripts/verify-play-credentials.sh` until it returns 200.

### 2. No Android build has been produced from this configuration.

There is no native `android/` directory (managed workflow, which is correct) and no record in this
repo of a successful `eas build --platform android`. `LAUNCH-PHASE-5-STATUS.md` lists the native
compile risks that have never been exercised on Android: razorpay, reanimated 4.5, expo-video, svg,
nativewind, SDK 57 edge to edge, hardware back during payment. The first build is where those
surface, and none of them can be predicted from the iOS build.

### 3. Play billing policy on the subscription that was just announced.

The landing page now says "Subscription, coming soon", and names the AI features as what it will
be built on. That matters for Play:

- **Court bookings and coaching sessions are real world services**, which Play policy explicitly
  exempts from Play Billing. Taking those through Razorpay is fine.
- **Atlitos Life donations** are permitted outside Play Billing.
- **A subscription that unlocks in app digital features, such as AI search, is digital content**,
  and Play requires Google Play Billing for it, with Google's cut. Shipping that through Razorpay
  is a policy violation and a removal risk.

Nothing is broken today, because the subscription does not exist. It is recorded here so the
decision is made deliberately when the tier is designed, not discovered at review.

### 4. Data safety form has not been re checked since Google sign in landed.

`GOOGLE-DATA-SAFETY.md` predates the Google and Apple sign in work and the admin allowlist. The
declaration must match what the app actually collects. Re read it against `DATA-INVENTORY.md`
before filling the console form.

## The order to do it in

1. Founder: create the `com.atlitos.app` record in the Play Console under developer
   `8696807675061268676`.
2. Founder: grant the submit service account "Edit and delete draft apps" and "Manage store
   presence". Either grant the existing Firebase service account, or make a dedicated Play
   publisher service account and repoint `eas.json`, which is the cleaner of the two.
3. Engineer: run `scripts/verify-play-credentials.sh`. It must print 200 before a build is spent.
4. Engineer: `eas build --platform android --profile production`, then work the native failures.
5. Engineer: Android emulator QA over the parity risks in `LAUNCH-PHASE-5-STATUS.md`, with the
   payment flow and hardware back during payment done by hand.
6. Founder and engineer: data safety form, store listing from `LISTING-COPY.md`, screenshots at
   2:1 or narrower, content rating questionnaire.
7. Submit to production review.

## The one thing that would waste the most time

Spending a build before step 3. The 403 is silent in the sense that it arrives only at submit, so
the loop is build, wait, fail, fix permissions, build again. The credential check takes seconds and
is the whole reason `scripts/verify-play-credentials.sh` exists.
