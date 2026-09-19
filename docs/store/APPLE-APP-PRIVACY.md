# Apple App Privacy answers (App Store Connect)

App: Atlitos, bundle `com.atlitos.app`, ASC app id `6793626237` (`apps/mobile/eas.json`).
Transcribe these into App Store Connect > your app > App Privacy > Edit.

Evidence for every answer is in `docs/store/DATA-INVENTORY.md`. The one line citation is repeated
here so the answer can be defended without opening a second file.

Apple's flow is: pick every data type you collect, then for each one answer three questions:
1. What is it used for (purposes, multi select)
2. Is it linked to the user's identity
3. Is it used for tracking

---

## Step 0. The gate question

> Do you or your third party partners collect data from this app?

**Yes.**

---

## Step 1. Data types to select

Select exactly these ten. Everything not listed is a deliberate "no", justified in section 3.

| Apple category | Data type | Select? |
|---|---|---|
| Contact Info | Name | Yes |
| Contact Info | Email Address | Yes |
| Contact Info | Phone Number | Yes |
| Contact Info | Physical Address | Yes |
| Financial Info | Purchase History | Yes |
| Location | Coarse Location | Yes |
| User Content | Photos or Videos | Yes |
| User Content | Audio Data | Yes |
| User Content | Customer Support | No |
| User Content | Other User Content | Yes |
| Identifiers | User ID | Yes |
| Identifiers | Device ID | Yes |
| Usage Data | Product Interaction | No, see section 3 |
| Diagnostics | Crash Data | Yes |
| Diagnostics | Performance Data | Yes |
| Diagnostics | Other Diagnostic Data | Yes |
| Search History | Search History | Yes |
| Health & Fitness, Sensitive Info, Browsing History, Contacts, Financial Info > Payment Info, Financial Info > Credit Info, Financial Info > Other Financial Info, Location > Precise Location | | No, see section 3 |

---

## Step 2. Per data type answers

For every row below, the answer to "Used for tracking" is **No**, for one reason that holds across
the whole app: there is no advertising identifier, no App Tracking Transparency prompt, no
attribution SDK and no ad network in the binary. Verified by grep over `apps/mobile` and
`packages` for `AppTrackingTransparency`, `expo-tracking-transparency`, `IDFA` and
`getAdvertisingId`, zero matches, with a positive control on `expo-location` to prove the grep
matched at all. Cross checked against the dependency list at `apps/mobile/package.json:24-69`.

### Contact Info > Name

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** collected at `apps/mobile/src/app/(auth)/register.tsx:84`, stored in `public.users.name` (`supabase/migrations/0001_identity.sql:65`), written by the signup trigger at `supabase/migrations/0073_signup_metadata.sql:43-53`.
- **Note:** the name is also passed to Razorpay as checkout prefill (`apps/mobile/src/app/(tabs)/courts/book/pay.tsx:102`), which is still App Functionality.

### Contact Info > Email Address

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** `apps/mobile/src/app/(auth)/register.tsx:85` into `client.auth.signUp({ email })` at `packages/api/src/hooks.ts:88-89`. It is the account key.
- **Note:** the app has no marketing email send. `notification_prefs.email_enabled` exists (`supabase/migrations/0002_notifications.sql:57-65`) but no marketing sender is wired. Do NOT tick "Developer's Advertising or Marketing" unless and until one ships.

### Contact Info > Phone Number

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** required field at `apps/mobile/src/app/(auth)/register.tsx:86`, validated at `:68`, carried in signup metadata at `packages/api/src/hooks.ts:94`, written to `public.users.phone` by `supabase/migrations/0073_signup_metadata.sql:26,43-53`. Also a login identifier at `packages/api/src/hooks.ts:73-74`.

### Contact Info > Physical Address

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** `public.addresses` (line1, line2, city, state, 6 digit pincode) at `supabase/migrations/0001_identity.sql:145-155`. Collected only when a user places a shop order.

### Financial Info > Purchase History

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** orders (`supabase/migrations/0031_commerce.sql`), court bookings (`0009_courts.sql`), coaching sessions (`0018_coaching.sql`), donations (`0048_empower_schema.sql`), and the ledger (`0010_payments_core.sql`).

### Financial Info > Payment Info: **DO NOT SELECT**

The app never touches a card, bank or UPI credential. Razorpay's native checkout sheet collects
them inside its own SDK and returns only opaque ids.

- **Evidence:** `apps/mobile/src/lib/razorpay-checkout.native.ts:17-25` passes only `key`, `amount`, `currency`, `order_id`, `name`, `description`, `prefill`. `:27-31` returns only `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`. There is no card field in the call or in `apps/mobile/src/lib/razorpay-checkout.types.ts`.
- If Razorpay's own SDK disclosure says it collects payment info, that is Razorpay's declaration on their SDK, not Atlitos collecting it through the app. See the UNRESOLVED row in `DATA-INVENTORY.md` section 11.

### Location > Coarse Location

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** `apps/mobile/src/store/location-store.ts:84-86` requests `Location.Accuracy.Balanced`, which is approximate, not precise. Foreground only (`:78`, `requestForegroundPermissionsAsync`), no background location declared anywhere in `apps/mobile/app.json`. Purpose string at `apps/mobile/app.json:50`.
- **Why "linked" even though nothing is stored:** the coordinates are sent to the backend inside an authenticated request (`apps/mobile/src/app/(tabs)/courts/index.tsx:90`, `apps/mobile/src/app/home/search.tsx:139-140`), so they arrive attached to a session. They are used for a haversine distance and discarded (`supabase/functions/ai-search/index.ts:231-235`); no migration defines a user location column. Apple's "linked" question is about the collection, not the retention, so Yes is the honest answer.

### Location > Precise Location: **DO NOT SELECT**

`Accuracy.Balanced` is the only accuracy the app ever asks for (`location-store.ts:84-86`).

Caveat the engineer must close first: `apps/mobile/app.json:29-30` declares
`ACCESS_FINE_LOCATION` on Android. That does not change the iOS answer (iOS accuracy is decided by
the `Accuracy` enum, not the manifest), but it should be dropped so the Android declaration is
consistent. Listed in `SUBMISSION-CHECKLIST.md`.

### User Content > Photos or Videos

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** clip video and thumbnail at `supabase/migrations/0041_clutch_schema.sql:62-82` (`storage_path`, `thumb_path`); avatar at `supabase/migrations/0001_identity.sql:68`; coach certificate documents uploaded from the app at `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx:19,142-161`. Permission strings at `apps/mobile/app.json:56-57`.

### User Content > Audio Data

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** microphone permission at `apps/mobile/app.json:58`, declared so an uploaded clip keeps its audio track. There is no standalone voice recorder in the app; audio only ever arrives as the audio track of a clip.

### User Content > Other User Content

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** clip captions (`supabase/migrations/0041_clutch_schema.sql:73`), clip comments (`:118-124`), chat messages (`supabase/migrations/0022_chat.sql:126-132`), group chat (`supabase/migrations/0078_group_chat_and_notes.sql`), reports (`supabase/migrations/0097_report_block.sql`).

### Identifiers > User ID

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** `public.users.id` is the auth user UUID (`supabase/migrations/0001_identity.sql:64`) and the foreign key on every owned row.

### Identifiers > Device ID

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** the Expo push token is a per device delivery identifier stored against the account. Table `public.push_tokens` at `supabase/migrations/0002_notifications.sql:47-53`; registered at `apps/mobile/src/hooks/use-push-registration.ts:69`; upserted at `packages/api/src/use-push.ts:47-48`; deleted on sign out at `packages/api/src/use-push.ts:64`.
- Collected only if the user grants notification permission, so it is optional in practice.

### Diagnostics > Crash Data

- **Purposes:** App Functionality
- **Linked to the user:** **No**
- **Used for tracking:** No
- **Evidence:** `apps/mobile/src/lib/sentry.ts:11-16`. `Sentry.setUser` is not called anywhere in the app, so no account identifier is attached to an event. DSN is baked into the production build profile (`apps/mobile/eas.json`, `EXPO_PUBLIC_SENTRY_DSN`), and `enabled: !__DEV__` means it is live in a store build.

### Diagnostics > Performance Data

- **Purposes:** App Functionality
- **Linked to the user:** No
- **Used for tracking:** No
- **Evidence:** `apps/mobile/src/lib/sentry.ts:14`, `tracesSampleRate: 0.1`, so one in ten sessions sends a performance trace.

### Diagnostics > Other Diagnostic Data

- **Purposes:** App Functionality
- **Linked to the user:** No
- **Used for tracking:** No
- **Evidence:** the Sentry React Native SDK attaches device model, OS version, app version, breadcrumbs and the client IP address by default. `sendDefaultPii` is not disabled at `apps/mobile/src/lib/sentry.ts:11-16`, so the default applies. Declaring this is the honest answer while that stays true.

### Search History

- **Purposes:** App Functionality
- **Linked to the user:** Yes
- **Used for tracking:** No
- **Evidence:** the free text search query is POSTed to the `ai-search` edge function (`apps/mobile/src/app/home/search.tsx:139`) and, because `ANTHROPIC_API_KEY` is set in production, forwarded to Anthropic's Messages API as the user message (`supabase/functions/ai-search/llm.ts:174`). Recent searches are additionally cached on device in AsyncStorage (`apps/mobile/src/app/home/search.tsx:104`), which is local only.
- The query is transmitted inside an authenticated request, hence Linked. No search query is written to any database table; there is no search log migration.

---

## Step 3. Data types deliberately NOT selected, and why

| Apple data type | Answer | Justification |
|---|---|---|
| Health & Fitness | Not collected | No HealthKit entitlement, no health SDK. Grep for `HealthKit`, `expo-health`, `react-native-health` over `apps/mobile` and `packages`: zero matches. The app's "training" features are bookings and drills, never body or fitness measurements |
| Contacts | Not collected | No contacts SDK. Grep for `expo-contacts`, `CNContact`, `READ_CONTACTS`: zero matches |
| Sensitive Info | Not collected **by the app** | Government ID proof and guardian consent documents exist as `public.upa_evidence` kinds (`supabase/migrations/0048_empower_schema.sql:122-129`) but the only surface that writes them is the web portal `apps/portal-life/src/app/(app)/apply/apply-wizard.tsx`. Confirmed no reference in `apps/mobile` or `packages`. **Reopen this answer the moment a UPA application flow lands in the app** |
| Browsing History | Not collected | The app has no web browser and logs no browsing |
| Usage Data > Product Interaction | Not collected | No product analytics SDK is installed. Sentry performance traces are declared under Diagnostics instead, which is where Apple puts them. If a product analytics SDK is added later, this answer changes |
| Usage Data > Advertising Data | Not collected | No ad network in the binary |
| Financial Info > Credit Info, Other Financial Info | Not collected | The app stores transaction records, not credit or bank data. Payout account references are created from the coach and partner portals, not the app |
| Identifiers > Advertising identifier | Not collected | No IDFA access, no ATT prompt. See the tracking justification in step 2 |
| Diagnostics > Precise Location within diagnostics | Not applicable | Covered under Location above |

---

## Step 4. The tracking declaration

> Do you use data for tracking purposes?

**No.** Nothing in this app links user or device data to third party data for advertising or
measurement, and nothing is shared with a data broker. There is no ATT prompt because there is
nothing that would require one. Anthropic, Sentry, Expo push, Razorpay and Supabase are all
service providers acting on Atlitos' instructions, which Apple does not count as tracking.

---

## Step 5. Related App Store Connect fields on the same screen

| Field | Value | Evidence |
|---|---|---|
| Privacy Policy URL | `https://www.atlitos.com/privacy` | HTTP 200 verified 2026-08-13 |
| Account deletion | See the note below. There is currently **no in app deletion path** | |
| Data collection disclosure for third party SDKs | Razorpay's SDK disclosure is UNRESOLVED, see `DATA-INVENTORY.md` section 11 | |

---

## Account deletion and Guideline 5.1.1(v): the honest position

Guideline 5.1.1(v) requires that an app which supports account creation must also let the user
**initiate account deletion from inside the app**.

What actually exists today:

- A live web page at `https://www.atlitos.com/delete-account` (HTTP 200 verified 2026-08-13) that describes a **request by email** mechanism: the user emails `support@elsheph.com` and Atlitos verifies ownership and actions the request within 30 days (`apps/landing/delete-account.html:53,74`).
- **No deletion entry point in the app at all.** The Settings surface is Appearance, Preferred sports, Location, Notifications, then an Account section holding only Edit profile, Become a coach and Sign out (`apps/mobile/src/components/organisms/settings/SettingsContent.tsx:256-401`). There is not even a link out to the deletion page.
- There is no deletion RPC. Grep for `delete_account` and `deleteAccount` over `apps/mobile`, `packages` and `supabase`: zero matches outside the landing page.

This is the single most likely cause of a first submission rejection. It is ranked and detailed in
`SUBMISSION-CHECKLIST.md`. The minimum viable fix is a Settings row that deep links to
`https://www.atlitos.com/delete-account`, which is a one screen change in `apps/mobile`, a path
this track does not own. A real in app deletion flow is the correct fix and pairs naturally with
the Sign in with Apple work in Phase 8, since Apple additionally requires Sign in with Apple
accounts to be revocable from the app.
