# Google Play Data Safety answers (Play Console)

App: Atlitos, package `com.atlitos.app` (`apps/mobile/app.json:19`).
Transcribe into Play Console > App content > Data safety.

Google's taxonomy is not Apple's. This file is written in Google's categories and Google's order,
derived independently from the same evidence, not copied from `APPLE-APP-PRIVACY.md`.

Play enforces a **match between this form and your privacy policy**. Section 6 lists two places
where `apps/landing/privacy.html` does not yet match what this form must say. Fix the policy
before submitting, or the form becomes a false statement.

Evidence base: `docs/store/DATA-INVENTORY.md`.

---

## Section 1. Data collection and security (the four global questions)

| Question | Answer | Evidence |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | See section 3 |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Every backend call is HTTPS to `https://syzzfgaudpifwvbpycyi.supabase.co` (`apps/mobile/eas.json` production `EXPO_PUBLIC_SUPABASE_URL`). Sentry posts to `https://...ingest.us.sentry.io` (same file). Anthropic is `https://api.anthropic.com/v1/messages` (`supabase/functions/ai-search/llm.ts:27`). Razorpay checkout is HTTPS inside its own SDK. There is no cleartext endpoint anywhere in the app. The privacy policy already asserts encryption in transit (`apps/landing/privacy.html:120`) |
| Do you provide a way for users to request that their data is deleted? | **Yes** | `https://www.atlitos.com/delete-account`, HTTP 200 verified 2026-08-13 |
| Data deletion URL | `https://www.atlitos.com/delete-account` | `apps/landing/delete-account.html` |

### Honest qualification on the deletion answer

Google's question asks whether users can request deletion, and the answer is a truthful Yes: the
page exists, it is reachable, and it names a mechanism.

But the mechanism is **request by email only**. The user emails `support@elsheph.com`, Atlitos
verifies ownership, and actions the request within 30 days
(`apps/landing/delete-account.html:53,74`). There is no self serve deletion, no in app button, and
no deletion RPC (grep for `delete_account` and `deleteAccount` across `apps/mobile`, `packages`
and `supabase` returns matches only in the landing page). The Settings screen offers Edit profile,
Become a coach and Sign out, and nothing else, in its Account section
(`apps/mobile/src/components/organisms/settings/SettingsContent.tsx:387-401`).

Google's account deletion policy expects apps that support in app account creation to offer an in
app deletion path **as well as** a web accessible one. Apple's Guideline 5.1.1(v) is stricter and
wants deletion initiated in app. Both are open. Ranked in `SUBMISSION-CHECKLIST.md`.

---

## Section 2. Which data types to declare

Answer Yes to exactly these. Everything else is No, with the justification in section 5.

```
Location
  [x] Approximate location
  [ ] Precise location                (read the ACCESS_FINE_LOCATION caveat in section 5 first)

Personal info
  [x] Name
  [x] Email address
  [x] User IDs
  [x] Address
  [x] Phone number
  [ ] Race and ethnicity
  [ ] Political or religious beliefs
  [ ] Sexual orientation
  [ ] Other info

Financial info
  [ ] User payment info               (read the Razorpay SDK caveat in section 3 first)
  [x] Purchase history
  [ ] Credit score
  [ ] Other financial info

Health and fitness
  [ ] Health info
  [ ] Fitness info

Messages
  [ ] Emails
  [ ] SMS or MMS
  [x] Other in-app messages

Photos and videos
  [x] Photos
  [x] Videos

Audio files
  [ ] Voice or sound recordings
  [ ] Music files
  [x] Other audio files

Files and docs
  [x] Files and docs

Calendar
  [ ] Calendar events

Contacts
  [ ] Contacts

App activity
  [ ] App interactions
  [x] In-app search history
  [ ] Installed apps
  [x] Other user-generated content
  [ ] Other actions

Web browsing
  [ ] Web browsing history

App info and performance
  [x] Crash logs
  [x] Diagnostics
  [ ] Other app performance data

Device or other IDs
  [x] Device or other IDs
```

---

## Section 3. Per data type answers

For every type Play asks four things: Collected or Shared, Processed ephemerally, Required or
Optional, and Purposes.

"Shared" in Google's definition means transferred to a third party. Google explicitly excludes
transfers to a **service provider processing on your behalf** from "shared". Supabase, Sentry,
Expo push and Razorpay are service providers under contract, so those transfers are collection,
not sharing. **Anthropic is also a processor under Atlitos' API contract**, so search queries are
likewise declared as collected, not shared. If the founder's legal read differs, the affected row
is `In-app search history` and only that row.

| Data type | Collected | Shared | Processed ephemerally | Required or Optional | Purposes | Evidence |
|---|---|---|---|---|---|---|
| **Approximate location** | Yes | No | **Yes, ephemeral** | Optional | App functionality | `apps/mobile/src/store/location-store.ts:84-86` requests `Accuracy.Balanced`. Sent to the backend in the request body (`apps/mobile/src/app/(tabs)/courts/index.tsx:90`, `apps/mobile/src/app/home/search.tsx:139-140`), used for a haversine distance and discarded (`supabase/functions/ai-search/index.ts:231-235`). No migration defines a user location column, so nothing is retained. Held in memory only on device (`location-store.ts:56`, plain zustand with no persist middleware) |
| **Name** | Yes | No | No | **Required** | App functionality | `apps/mobile/src/app/(auth)/register.tsx:84`, stored at `supabase/migrations/0001_identity.sql:65` |
| **Email address** | Yes | No | No | **Required** | App functionality, Account management | `register.tsx:85`, `packages/api/src/hooks.ts:88-89` |
| **Phone number** | Yes | No | No | **Required** | App functionality, Account management | `register.tsx:86`, validated `:68`, written by `supabase/migrations/0073_signup_metadata.sql:26,43-53` into `public.users.phone` (`0001_identity.sql:66`). Also a login identifier (`packages/api/src/hooks.ts:73-74`) |
| **Address** | Yes | No | No | Optional | App functionality | `public.addresses` at `supabase/migrations/0001_identity.sql:145-155`. Only collected when placing a shop order |
| **User IDs** | Yes | No | No | Required | App functionality | `public.users.id`, the auth UUID (`0001_identity.sql:64`) |
| **Purchase history** | Yes | No | No | Optional | App functionality | orders `0031_commerce.sql`, bookings `0009_courts.sql`, sessions `0018_coaching.sql`, donations `0048_empower_schema.sql` |
| **User payment info** | **No** | No | | | | The app never receives a card, bank or UPI credential. `apps/mobile/src/lib/razorpay-checkout.native.ts:17-25` sends only `key`, `amount`, `currency`, `order_id`, `name`, `description`, `prefill`; `:27-31` receives back only `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`. **But see the Razorpay SDK caveat below** |
| **Other in-app messages** | Yes | No | No | Optional | App functionality | `public.chat_messages` at `supabase/migrations/0022_chat.sql:126-132`, group chat at `0078_group_chat_and_notes.sql` |
| **Photos** | Yes | No | No | Optional | App functionality | Avatar (`0001_identity.sql:68`), clip thumbnail (`0041_clutch_schema.sql:72`). Permission strings at `apps/mobile/app.json:56-57` |
| **Videos** | Yes | No | No | Optional | App functionality | Clip video, `supabase/migrations/0041_clutch_schema.sql:68` (`storage_path`, private bucket) |
| **Other audio files** | Yes | No | No | Optional | App functionality | The audio track of an uploaded clip. Microphone permission at `apps/mobile/app.json:58`. There is no standalone recorder, so this is not "Voice or sound recordings" |
| **Files and docs** | Yes | No | No | Optional | App functionality | Coach certificate documents, uploaded from the app at `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx:19,142-161`, into `public.coach_certificates` (`0001_identity.sql:211-214`). Only coaches, only during coach onboarding |
| **In-app search history** | Yes | No | **Yes, ephemeral** | Optional | App functionality, Personalization | Query POSTed at `apps/mobile/src/app/home/search.tsx:139`, forwarded to Anthropic as the user message at `supabase/functions/ai-search/llm.ts:174` (the key is confirmed set in production). No search log table exists in any migration. Recent searches are cached on device only, in AsyncStorage (`apps/mobile/src/app/home/search.tsx:104`), which Google does not count as collection |
| **Other user-generated content** | Yes | No | No | Optional | App functionality | Clip captions (`0041_clutch_schema.sql:73`), clip comments (`:118-124`), reports (`0097_report_block.sql`) |
| **Crash logs** | Yes | No | No | Optional | App functionality, Analytics | `apps/mobile/src/lib/sentry.ts:11-16`, `enabled: !__DEV__` so it is live in a release build. DSN baked in at `apps/mobile/eas.json` |
| **Diagnostics** | Yes | No | No | Optional | App functionality, Analytics | `apps/mobile/src/lib/sentry.ts:14`, `tracesSampleRate: 0.1`. The Sentry SDK also attaches device model, OS version, app version and the client IP by default; `sendDefaultPii` is not disabled |
| **Device or other IDs** | Yes | No | No | Optional | App functionality | Expo push token, `public.push_tokens` at `supabase/migrations/0002_notifications.sql:47-53`, registered at `apps/mobile/src/hooks/use-push-registration.ts:69`, deleted on sign out at `packages/api/src/use-push.ts:64`. Only collected if notification permission is granted |

### Razorpay SDK caveat, must be closed before submitting

Google requires you to declare data collected by **third party SDKs bundled in your app**, not only
data your own code touches. `react-native-razorpay@^2.3.0` (`apps/mobile/package.json:50`) is a
compiled native module; what it collects internally cannot be established from this repo.

Action: read Razorpay's published SDK data disclosure and, if it states that the SDK collects
payment info or a device identifier, tick those rows as collected by a third party SDK. Do not
guess either way. This is the UNRESOLVED item in `DATA-INVENTORY.md` section 11.

---

## Section 4. Data retention and deletion, per Play's follow up

Play asks, for the whole app, whether users can request deletion. Answered Yes in section 1.

Useful supporting detail, taken from the live page (`apps/landing/delete-account.html:57-74`):

- Deleted on request: profile (name, sports, city and state, avatar, personalization and notification preferences), created content (clips, comments, chat messages, posts), uploaded media, saved shipping addresses, push notification tokens.
- Retained: financial and transaction records, for the period tax and accounting law requires, disassociated from the profile where possible.
- Timeline: verified requests actioned within 30 days.

---

## Section 5. Data types deliberately declared as NOT collected

| Play type | Answer | Justification |
|---|---|---|
| **Precise location** | No | Only `Accuracy.Balanced` is ever requested (`apps/mobile/src/store/location-store.ts:84-86`). **Caveat:** `apps/mobile/app.json:29-30` declares `ACCESS_FINE_LOCATION` in the manifest. Play's pre review scans the manifest, and a fine location permission next to an approximate only declaration invites a mismatch flag. Drop `ACCESS_FINE_LOCATION` from `app.json` before building, then this No is clean. Until it is dropped, either drop it or tick Precise location. Do not ship the mismatch |
| **SMS or MMS** | No | The app has no SMS read or send capability. Supabase Auth may send an OTP SMS (`packages/api/src/hooks.ts:134`), but sending an SMS to a phone number you already collected is not collecting SMS content |
| **Emails (Messages)** | No | The app does not read a user's email |
| **Health info, Fitness info** | No | No HealthKit, Google Fit or health SDK. Grep over `apps/mobile` and `packages` for `HealthKit`, `expo-health`, `react-native-health`: zero matches, with a positive control proving the grep matched a term that does exist. The training features are bookings and drills, never body measurements |
| **Contacts** | No | No contacts SDK. Grep for `expo-contacts`, `CNContact`, `READ_CONTACTS`: zero matches |
| **Calendar** | No | No calendar SDK. Grep for `expo-calendar`, `READ_CALENDAR`: zero matches |
| **App interactions, Other actions** | No | No product analytics SDK is installed. Sentry performance data is declared under Diagnostics |
| **Installed apps** | No | Nothing queries the installed package list |
| **Web browsing history** | No | There is no in app browser |
| **Race and ethnicity, Political or religious beliefs, Sexual orientation, Other info** | No | Not collected. Government ID proof and guardian consent documents exist as `public.upa_evidence` kinds (`supabase/migrations/0048_empower_schema.sql:122-129`) but the only writing surface is the web portal `apps/portal-life/src/app/(app)/apply/apply-wizard.tsx`, confirmed by grep to have no reference in `apps/mobile` or `packages`. **Reopen this row if a UPA application flow ships in the app** |
| **Credit score, Other financial info** | No | Not collected. Payout account references are created from the coach and partner portals, not the app |
| **Music files** | No | Not collected |

---

## Section 6. Privacy policy mismatches to fix BEFORE submitting

Play compares this form against the privacy policy and treats a mismatch as a policy violation.
Two real gaps exist in `apps/landing/privacy.html` today.

| Gap | What the policy says | What this form must say | Fix |
|---|---|---|---|
| **Phone number is not disclosed** | The Account and profile section lists "email address and password" and "name, sports you play, city and state, and a profile photo" (`apps/landing/privacy.html:53-54`). Phone is never mentioned as collected | Phone number, **Required**, collected at signup | Add phone number to the Account and profile list in the privacy policy |
| **Sentry is not disclosed** | The "Who we share it with" list names Supabase, Razorpay, Expo and Anthropic (`apps/landing/privacy.html:102-105`). Sentry is absent, and there is no crash or diagnostics section at all | Crash logs and Diagnostics collected, including device metadata and client IP | Add a crash and diagnostics section and add Sentry to the service provider list |

Two smaller gaps worth closing at the same time:

- Coach certificate document upload is not mentioned in the policy, though the form declares Files and docs.
- Date of birth is not mentioned. It is optional and rarely present (8 of 209 production `public.users` rows carry one), but the profile can still collect it (`packages/api/src/hooks.ts:243`).

These are edits to `apps/landing/**`, which this track does not own. They are listed in
`SUBMISSION-CHECKLIST.md` as engineer work.
