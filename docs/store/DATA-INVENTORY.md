# Atlitos data inventory (the evidence base for both store questionnaires)

Scope: `apps/mobile` (bundle `com.atlitos.app`, the binary submitted to both stores) and the
backend it talks to. Web portals (`portal-life`, `portal-court`, `admin`) are separate products
and are called out explicitly where a data type exists only there.

Both store questionnaires are legal declarations. Every row below is traced to a file and line.
Where evidence could not be established the row says UNRESOLVED and names what was tried.

Verified on 2026-08-13 against branch `phase-11/p6-store` (branched from `phase-11/launch-p4`).

---

## 1. Account and identity

| Data | Collected? | Where the code proves it | Linked to identity | Tracking | Required |
|---|---|---|---|---|---|
| Email address | Yes | `apps/mobile/src/app/(auth)/register.tsx:85` collects it, passed to `client.auth.signUp({ email })` at `packages/api/src/hooks.ts:88-89` | Yes, it is the account key | No | Required to register. Guest browsing needs no account (`supabase/migrations/0008_anonymous_user_support.sql`) |
| Password | Yes | `apps/mobile/src/app/(auth)/register.tsx` password fields, `packages/api/src/hooks.ts:88` | Yes | No | Required |
| Name | Yes | `register.tsx:84`, written to `public.users.name` by `supabase/migrations/0073_signup_metadata.sql:43-53`. Column at `supabase/migrations/0001_identity.sql:65` | Yes | No | Required |
| Phone number | Yes | `register.tsx:86` (`normalizePhone`, 10 digit validation at `register.tsx:68`), carried in signup metadata `packages/api/src/hooks.ts:94`, written by the trigger at `supabase/migrations/0073_signup_metadata.sql:26,43-53`. Column `public.users.phone` at `supabase/migrations/0001_identity.sql:66` | Yes | No | **Required at signup.** Also usable as a login identifier (`packages/api/src/hooks.ts:73-74`) |
| Date of birth | Optional only | Removed from signup (commit `24bb65a`). `grep -c dob apps/mobile/src/app/(auth)/register.tsx` returns **0**. Still a nullable column `public.users.dob` (`supabase/migrations/0001_identity.sql:67`) and an optional profile patch field (`packages/api/src/hooks.ts:243,395`). Production check: 8 of 209 `public.users` rows have a non null `dob` | Yes | No | **Optional.** Collected only if a user volunteers it on the profile |
| City and state | Yes, user entered | `public.users.city` / `.state` (`supabase/migrations/0001_identity.sql:70-71`), edited in Settings (`apps/mobile/src/components/organisms/settings/SettingsContent.tsx:339-352`) | Yes | No | Optional |
| Sports played, skill level | Yes | `public.users.sports` (`0001_identity.sql:72`), `public.athlete_sports` (same migration) | Yes | No | Optional |
| Profile photo (avatar) | Yes | `public.users.avatar_url` (`0001_identity.sql:68`), uploaded via `uploadAvatar` in `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx:19` and the player setup wizard | Yes | No | Optional |
| Creator channel name | Yes | `public.users.channel_name` (`0001_identity.sql:69`) | Yes | No | Optional |

## 2. Payments

**The app never sees card, bank or UPI credentials.** Razorpay's own native checkout sheet
collects them inside its SDK.

| Fact | Evidence |
|---|---|
| The app hands Razorpay only a server created order id and display fields | `apps/mobile/src/lib/razorpay-checkout.native.ts:17-25`: `key`, `amount`, `currency`, `order_id`, `name`, `description`, `prefill`. No card field exists in the call or in the type (`apps/mobile/src/lib/razorpay-checkout.types.ts`) |
| The app receives back only opaque ids | `razorpay-checkout.native.ts:27-31` returns `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` only |
| The app sends the user's name and phone to Razorpay as prefill | `apps/mobile/src/app/(tabs)/courts/book/pay.tsx:102`, `apps/mobile/src/app/(tabs)/coaching/book/pay.tsx:117`, `apps/mobile/src/app/shop/checkout/index.tsx:158`, `apps/mobile/src/app/home/donate/[id].tsx:126`, `apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx:106`. Email is explicitly passed as `undefined` in four of the five |
| Atlitos stores transaction records, not instruments | `supabase/migrations/0010_payments_core.sql` (`payment_intents`, `ledger_entries`); ledger writes are service role only (`CLAUDE.md` financial invariant) |
| Purchase history exists | orders, bookings, sessions, donations tables across `0009`, `0018`, `0031`, `0048` |

So: **payment info is handled by a third party, not collected by the app.** Purchase history IS
collected by the app.

## 3. Location

| Fact | Evidence |
|---|---|
| Foreground permission only, requested at the Courts screen and Home search | `apps/mobile/src/store/location-store.ts:78` `requestForegroundPermissionsAsync()`. No background permission is declared anywhere in `apps/mobile/app.json` |
| Precision requested | `location-store.ts:84-86`, `Location.Accuracy.Balanced`. This is approximate location (roughly 100 m class), not the highest precision tier |
| Android manifest permissions | `apps/mobile/app.json:28-31`, `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`. FINE is declared even though the code asks for `Balanced`; see the note below |
| iOS purpose string | `apps/mobile/app.json:50`, "Atlitos uses your location to show courts near you and sort them by distance." |
| Held in memory only, never persisted on device | `location-store.ts:56` plain zustand `create`, no `persist` middleware, no AsyncStorage write of coordinates anywhere in the file |
| Coordinates ARE sent to the server in request bodies | `apps/mobile/src/app/(tabs)/courts/index.tsx:90` (`listCourts({ near: coords })`), `apps/mobile/src/app/(tabs)/courts/court/[id].tsx:71`, `apps/mobile/src/app/home/search.tsx:139-140` (`lat`, `lng` into `ai-search`) |
| The server uses them transiently for distance sorting and does not store them | `supabase/functions/ai-search/index.ts:113-114` parses `lat`/`lng`, `:216,231-235` uses them for a haversine distance only. No insert or update of a coordinate anywhere in that function. There is no user location column in any migration (`grep` over `supabase/migrations` finds `lat`/`lng` only on `venues`) |
| Denial is handled gracefully | `location-store.ts:66-75`, falls back to the profile city with no coordinates |

Net: approximate location is **used in session, transmitted to the backend and to the AI search
function, and not stored**. Both stores treat "transmitted off device" as collected, so it must be
declared, with "not stored" reflected in the Google retention answer.

Note for the engineer: `ACCESS_FINE_LOCATION` is declared but the code only ever requests
`Accuracy.Balanced`. Dropping FINE from `app.json` would let the Play declaration say approximate
only, which is both simpler and more defensible. Until it is dropped, Play sees a fine location
permission and the declaration must cover precise location. This is a code change in
`apps/mobile/**`, which this track does not own; it is listed in `SUBMISSION-CHECKLIST.md`.

## 4. Camera, photos, microphone

| Permission | Declared string | Evidence | What it is for |
|---|---|---|---|
| Photo library | "Atlitos uses your photo library to upload clutch clips and profile photos." | `apps/mobile/app.json:56` | Clip upload, avatar, coach certificates |
| Camera | "Atlitos uses your camera to capture clutch clips and profile photos." | `apps/mobile/app.json:57` | Clip capture, avatar |
| Microphone | "Atlitos needs microphone access so uploaded video clips keep their sound." | `apps/mobile/app.json:58` | Audio track of an uploaded clip |

Provided by `expo-image-picker` (`apps/mobile/package.json:35`). There is no standalone audio
recorder in the app.

Uploaded media that leaves the device:
- Clip video and thumbnail, into a private `clips` bucket. `supabase/migrations/0041_clutch_schema.sql:62-82` (`storage_path`, `thumb_path`, `caption`).
- Avatar image. `public.users.avatar_url`, `supabase/migrations/0001_identity.sql:68`.
- Coach certificate documents, uploaded from inside the mobile app. `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx:19` (`uploadCoachCertificate`), `:142-161` (picker plus upload loop). Table `public.coach_certificates` at `supabase/migrations/0001_identity.sql:211-214`.

## 5. Contacts, calendar, health, advertising identifiers: CONFIRMED NOT USED

Negative result, with a positive control so the grep itself is trusted.

```
grep -rn "expo-contacts|expo-calendar|Contacts|HealthKit|expo-health|react-native-health|
          CNContact|READ_CONTACTS|READ_CALENDAR|expo-tracking-transparency|
          AppTrackingTransparency|IDFA|getAdvertisingId"
     apps/mobile packages --include=*.ts --include=*.tsx --include=*.json
  -> zero matches

positive control, same command shape, term "expo-location"
  -> apps/mobile/app.json:48, apps/mobile/package.json:37, apps/mobile/src/store/location-store.ts:1
```

Cross checked against the dependency list at `apps/mobile/package.json:24-69`: no contacts,
calendar, health, advertising, attribution or analytics SDK is installed. `@sentry/react-native`
is the only third party telemetry SDK in the app.

Consequence: **there is no App Tracking Transparency prompt and no IDFA access, so Atlitos does
not "track" under Apple's definition.** Every Apple answer below therefore says "not used for
tracking".

## 6. User generated content

| Type | Table | Evidence |
|---|---|---|
| Clip video, thumbnail, caption, sport | `public.clips` | `supabase/migrations/0041_clutch_schema.sql:62-82` |
| Comments on clips | `public.clip_comments` | `supabase/migrations/0041_clutch_schema.sql:118-124`. 13 rows in production |
| Chat messages, one to one and group | `public.chat_messages` | `supabase/migrations/0022_chat.sql:126-132`. 210 rows in production. Group threads at `supabase/migrations/0078_group_chat_and_notes.sql` |
| UPA story text and photo | `public.upa_applications` | `supabase/migrations/0048_empower_schema.sql:75-94`. Authored in `portal-life`, not in the mobile app |
| Reports filed against content or users | `public.reports` | `supabase/migrations/0097_report_block.sql`, UI at `apps/mobile/src/components/organisms/moderation/ModerationSheet.tsx` |
| Block list | `public.blocked_users` | `supabase/migrations/0097_report_block.sql:28-53`. 0 rows in production (nobody has blocked anyone yet) |

## 7. Identifiers and diagnostics

| Data | Collected? | Evidence | Linked | Tracking |
|---|---|---|---|---|
| Expo push token | Yes, when notifications are enabled | `public.push_tokens` at `supabase/migrations/0002_notifications.sql:47-53`; registered at `apps/mobile/src/hooks/use-push-registration.ts:69`, upserted at `packages/api/src/use-push.ts:47-48`; deleted on sign out (`use-push-registration.ts:26-31`, `use-push.ts:64`) | Yes, row carries `user_id` | No |
| User id (UUID) | Yes | `public.users.id`, foreign key on every owned row | Yes | No |
| Advertising id | **No.** See section 5 | | | |
| Crash and performance data | Yes, in release builds | `apps/mobile/src/lib/sentry.ts:11-16`. `tracesSampleRate: 0.1`, `enabled: !__DEV__`. DSN is baked into the production build profile at `apps/mobile/eas.json` (`EXPO_PUBLIC_SENTRY_DSN`) | Sentry's default is device and OS metadata plus IP. `setUser` is not called anywhere in the app, so no explicit user id is attached | No |
| Server side error reports | Yes | `supabase/functions/_shared/sentry.ts:44-60`, invoked from `supabase/functions/_shared/http.ts:46` and `supabase/functions/razorpay-webhook/index.ts:397,439,520`. `SENTRY_DSN` is confirmed set in production (`supabase secrets list --project-ref syzzfgaudpifwvbpycyi`) | Context is `{ fn: <name> }` plus the error message and stack | No |

Sentry default behaviour note: the React Native SDK sends device model, OS version, app version,
breadcrumbs and the client IP address with each event unless `sendDefaultPii` is disabled. It is
not disabled here. IP address must therefore be declared as diagnostics/device data collected.

## 8. Shipping and commerce

| Data | Evidence |
|---|---|
| Shipping address (line1, line2, city, state, 6 digit pincode) | `public.addresses`, `supabase/migrations/0001_identity.sql:145-155`. 4 rows in production |
| Order history and order status | `supabase/migrations/0031_commerce.sql`, `0035_order_state_machine.sql` |
| Cart and wishlist | `supabase/migrations/0034_cart_wishlist_rpcs.sql`, `0088_clip_saves.sql` |
| Affiliate click outs to external retailers | `supabase/migrations/0086_affiliate_marketplace.sql:1-34`. Browse plus compare plus click out only, no cart, no stock, no in app payment |

## 9. Third parties that receive data

| Recipient | What it receives | Evidence | Confirmed live? |
|---|---|---|---|
| Supabase | Everything above. Database, auth, storage, edge functions | `apps/mobile/eas.json` production `EXPO_PUBLIC_SUPABASE_URL` | Yes |
| Razorpay | Order id, amount, currency, and the payer's name and phone as prefill. Plus whatever its own SDK collects to take the card, which Atlitos never sees | `apps/mobile/src/lib/razorpay-checkout.native.ts:17-25`; prefill call sites in section 2 | Yes |
| Expo push service | The device push token and the notification payload | `apps/mobile/src/hooks/use-push-registration.ts`, `supabase/functions/notify-dispatch` | Yes |
| Sentry | Crash and performance events, device and OS metadata, client IP | `apps/mobile/src/lib/sentry.ts:11-16`, `supabase/functions/_shared/sentry.ts` | Yes. Mobile DSN in `eas.json`, edge `SENTRY_DSN` confirmed in the secret list |
| Anthropic | The free text search query, and the candidate list for reranking (entity id, type, title, subtitle, price) | Query: `supabase/functions/ai-search/llm.ts:174` (`messages: [{ role: "user", content: query }]`). Candidates: `llm.ts:250-256`. **No coordinates, no user id and no auth token are in either payload**, verified by reading both request bodies | **Yes.** `ANTHROPIC_API_KEY` is present in `supabase secrets list --project-ref syzzfgaudpifwvbpycyi` (2026-08-13) |

Anthropic caveat worth stating plainly in the privacy policy (it already is, at
`apps/landing/privacy.html:105`): a user can type anything into search, so free text search
queries must be treated as potentially containing personal information.

## 10. Not in the mobile app (do not declare on the app's questionnaires)

| Data | Where it actually lives |
|---|---|
| Government ID proof, guardian consent documents | `public.upa_evidence` kinds `id_proof` and `guardian_consent`, `supabase/migrations/0048_empower_schema.sql:122-129`. The only surface that writes them is the web portal `apps/portal-life/src/app/(app)/apply/apply-wizard.tsx`. Confirmed by grep: no reference in `apps/mobile` or `packages`. 4 rows in production |
| Payout bank account references | `razorpay-route-onboard` edge function, driven from the coach and partner portals |

If a UPA application flow is ever added to the mobile app, both questionnaires must be reopened.
Government ID and a minor's guardian consent are the most sensitive data this platform holds.

## 11. UNRESOLVED

| Question | What was tried | Who can close it |
|---|---|---|
| Exactly what the Razorpay Android and iOS SDK collects on its own (device fingerprint, advertising id, SDK level analytics) | Read every call site and the type definition; the app passes no such data. The SDK is a compiled native module (`react-native-razorpay@^2.3.0`), so its internal collection cannot be established from this repo | Founder, from Razorpay's own SDK privacy disclosure. Google requires SDK collection to be declared even when the app itself does not collect it |
| Whether Sentry's `sendDefaultPii` should be turned off before launch | Confirmed it is not configured either way at `apps/mobile/src/lib/sentry.ts:11-16`, so the SDK default applies | Engineer, one line change in `apps/mobile`, which this track does not own |
| Whether the production Razorpay key is test or live | `apps/mobile/eas.json` production profile carries `rzp_test_TCwxkMaUz54BPH`. The server side `RAZORPAY_KEY_ID` secret exists but its value is hashed in the secret listing | Founder. See rejection risk 2 in `SUBMISSION-CHECKLIST.md` |
