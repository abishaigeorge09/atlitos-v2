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

Rewritten 2026-09-30. **The label must equal the privacy manifest**, `ios.privacyManifests.NSPrivacyCollectedDataTypes`
in `apps/mobile/app.json`, because Apple compares the two. The manifest that ships is the one on
`launch/release/ios-compliance` (commit `f9c07a5`), which is this branch's manifest plus App
Functionality on Product Interaction. It declares exactly **17 types**, the same 17 published in App
Store Connect on 2026-09-27. Select these 17 and nothing else.

| # | Apple category | Data type | Manifest key (`NSPrivacyCollectedDataType...`) | Linked | Tracking | Purposes |
|---|---|---|---|---|---|---|
| 1 | Contact Info | Name | `Name` | Yes | No | App Functionality |
| 2 | Contact Info | Email Address | `EmailAddress` | Yes | No | App Functionality |
| 3 | Contact Info | Phone Number | `PhoneNumber` | Yes | No | App Functionality |
| 4 | Contact Info | Physical Address | `PhysicalAddress` | Yes | No | App Functionality |
| 5 | Location | Coarse Location | `CoarseLocation` | Yes | No | App Functionality |
| 6 | User Content | Photos or Videos | `PhotosorVideos` | Yes | No | App Functionality |
| 7 | User Content | Emails or Text Messages | `EmailsOrTextMessages` | Yes | No | App Functionality |
| 8 | User Content | Other User Content | `OtherUserContent` | Yes | No | App Functionality |
| 9 | Financial Info | Payment Info | `PaymentInfo` | Yes | No | App Functionality |
| 10 | Purchases | Purchase History | `PurchaseHistory` | Yes | No | App Functionality |
| 11 | Identifiers | User ID | `UserID` | Yes | No | App Functionality |
| 12 | Usage Data | Product Interaction | `ProductInteraction` | Yes | No | App Functionality, Analytics |
| 13 | Search History | Search History | `SearchHistory` | **No** | No | App Functionality |
| 14 | Diagnostics | Crash Data | `CrashData` | **No** | No | App Functionality |
| 15 | Diagnostics | Performance Data | `PerformanceData` | **No** | No | App Functionality |
| 16 | Diagnostics | Other Diagnostic Data | `OtherDiagnosticData` | **No** | No | App Functionality |
| 17 | Other Data | Other Data Types | `OtherDataTypes` | Yes | No | App Functionality |

Linked: 13 types. Not linked: 4 types (Search History and the three Diagnostics). Tracking: No for
all 17, and `NSPrivacyTracking` is `false` with an empty `NSPrivacyTrackingDomains`.

**Not selected** (not in the manifest; reasons in step 3): Device ID, Audio Data, Customer Support,
Precise Location, Health, Fitness, Sensitive Info, Contacts, Browsing History, Advertising Data,
Other Usage Data, Credit Info, Other Financial Info, Gameplay Content, Advertising identifier.

How to check the two still agree before submitting:

```
python3 -c 'import json; t=json.load(open("apps/mobile/app.json"))["expo"]["ios"]["privacyManifests"]["NSPrivacyCollectedDataTypes"]; k="NSPrivacyCollectedDataType"; [print(x[k].replace(k,""), "linked" if x[k+"Linked"] else "NOT linked", "tracking" if x[k+"Tracking"] else "no tracking", [p.replace(k+"Purpose","") for p in x[k+"Purposes"]]) for x in t]; print(len(t), "types")'
```

If a row here and a row in the manifest ever differ, change both in the same commit.

---

## Step 2. Per data type answers

For every type the answer to "Used for tracking" is **No**, for one reason that holds across the
whole app: there is no advertising identifier, no App Tracking Transparency prompt, no attribution
SDK and no ad network in the binary. Verified by grep over `apps/mobile` and `packages` for
`AppTrackingTransparency`, `expo-tracking-transparency`, `IDFA` and `getAdvertisingId`, zero
matches, with a positive control on `expo-location` to prove the grep matched at all.

### 1. Contact Info > Name

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** collected at sign up (`apps/mobile/src/app/(auth)/register.tsx`), stored in `public.users.name` (`supabase/migrations/0001_identity.sql:65`), written by the signup trigger (`0073_signup_metadata.sql`). Also sent to Razorpay as checkout prefill for coaching and group payments, which is still App Functionality.

### 2. Contact Info > Email Address

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** the account key, `client.auth.signUp({ email })` in `packages/api/src/hooks.ts`. Sign in with Apple may supply a private relay address instead.
- **Note:** there is no marketing email send. Do NOT tick "Developer's Advertising or Marketing" unless one ships.

### 3. Contact Info > Phone Number

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** required at sign up, written to `public.users.phone` (`0073_signup_metadata.sql`); also a sign in identifier.

### 4. Contact Info > Physical Address

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** `public.addresses` (line1, line2, city, state, pincode), `0001_identity.sql:145-155`, saved from `apps/mobile/src/app/account/addresses.tsx`. The owned shop is off (`shop.owned_enabled` false), so nothing is shipped, but a user can still save an address, so it stays declared.

### 5. Location > Coarse Location

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** `apps/mobile/src/store/location-store.ts` requests `Location.Accuracy.Balanced`, foreground only (`requestForegroundPermissionsAsync`); coordinates sent to `ai-search` are rounded to 2 decimals on the device. They arrive inside an authenticated request, used for a distance sort and discarded (`supabase/functions/ai-search/index.ts`); no migration defines a user location column. Apple's "linked" is about collection, not retention, so Yes.

### 6. User Content > Photos or Videos

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** clip video and thumbnail (`0041_clutch_schema.sql:62-82`), avatar (`0001_identity.sql:68`), coach certificate files (`apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`). Everything arrives through the system photo picker, so only the item the user picks is shared. A clip's soundtrack travels inside the video file and is covered here, which is why Audio Data is not a separate type.

### 7. User Content > Emails or Text Messages

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** in app chat, one to one and group: `public.chat_messages` (`supabase/migrations/0022_chat.sql`) and group chat (`0078_group_chat_and_notes.sql`). Added to the manifest in `4ad911a`.

### 8. User Content > Other User Content

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** clip captions (`0041_clutch_schema.sql:73`), clip comments (`:118-124`), reports filed (`0097_report_block.sql`), profile bio text.

### 9. Financial Info > Payment Info

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** coaches and venue partners register payout details for manual payouts: account holder name, bank account number, IFSC, UPI ID and PAN (`supabase/migrations/0132_payout_methods_manual_payouts.sql`). Owners only ever see the last four digits; admin reveals write an `audit_log` row. Added to the manifest in `4ad911a`.
- **What it is not:** the app never touches an athlete's card, bank or UPI credential. Razorpay's checkout sheet collects those inside its own SDK and returns only opaque ids (`apps/mobile/src/lib/razorpay-checkout.native.ts` passes `key`, `amount`, `currency`, `order_id`, `name`, `description`, `prefill` and receives `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`). Payment references and amounts are Purchase History, below.

### 10. Purchases > Purchase History

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** coaching sessions (`0018_coaching.sql`), group memberships (`0076_training_groups.sql`), the payment and ledger records (`0010_payments_core.sql`), and any donation history from Android or the web, which an iOS user still sees in My Impact. Courts are booked on the venue's own website, so no court purchase is recorded.

### 11. Identifiers > User ID

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** `public.users.id`, the auth user UUID (`0001_identity.sql:64`), the foreign key on every owned row.

### 12. Usage Data > Product Interaction

- **Purposes:** App Functionality, Analytics. **Linked:** Yes. **Tracking:** No.
- **Evidence:** `0133_affiliate_click_tracking.sql`: every Buy tap on a retailer offer is recorded in `affiliate_clicks` against the signed in user, to open the right retailer link (App Functionality) and to measure the shop and settle retailer commissions (Analytics). The retailer only ever receives a random click id. No third party analytics SDK is installed.

### 13. Search History (NOT linked)

- **Purposes:** App Functionality. **Linked:** **No**. **Tracking:** No.
- **Evidence:** the search text is sent to the `ai-search` edge function and, when smart search is on, to Anthropic and Voyage AI to interpret and embed it. The only server side copy is `query_embedding_cache` (`0121_gear_search_vectors.sql:72-76`), keyed by a sha256 hash of the normalised query with its embedding, kept 10 minutes, with **no user id**, and the providers receive the text with no user identifier. The per user spend guard (`supabase/functions/ai-search/spend-guard.ts`) counts calls per user but stores no query text. Hence Not Linked, as the manifest says. Recent searches are also kept on the device in AsyncStorage, which never leaves it.

### 14. Diagnostics > Crash Data (NOT linked)

- **Purposes:** App Functionality. **Linked:** **No**. **Tracking:** No.
- **Evidence:** `apps/mobile/src/lib/sentry.ts`. `Sentry.setUser` is never called, so no account identifier is attached. `enabled: !__DEV__`, DSN baked into the production profile.

### 15. Diagnostics > Performance Data (NOT linked)

- **Purposes:** App Functionality. **Linked:** **No**. **Tracking:** No.
- **Evidence:** `apps/mobile/src/lib/sentry.ts`, `tracesSampleRate: 0.1`.

### 16. Diagnostics > Other Diagnostic Data (NOT linked)

- **Purposes:** App Functionality. **Linked:** **No**. **Tracking:** No.
- **Evidence:** the Sentry SDK attaches device model, OS version, app version, breadcrumbs and the client IP address by default; `sendDefaultPii` is not disabled.

### 17. Other Data > Other Data Types

- **Purposes:** App Functionality. **Linked:** Yes. **Tracking:** No.
- **Evidence:** profile facts that fit no other Apple type: the sports you play (`public.users.sports`, `public.athlete_sports` from 0088), the city and state you type into Settings (`public.users.city`, `state`, `0001_identity.sql:70-72`), an optional date of birth (`public.users.dob`, `0001_identity.sql:67`), and the qualification details a coach submits for verification.

---

## Step 3. Data types deliberately NOT selected, and why

None of these is in the manifest. If any answer changes, add the type to the manifest and the
label together.

| Apple data type | Answer | Justification |
|---|---|---|
| Identifiers > Device ID | Not selected | The only per device value stored is the Expo push token (`public.push_tokens`, `0002_notifications.sql:47-53`), a rotating delivery address for notifications, not a hardware or advertising identifier, and only present if the user allows notifications. It is not in the manifest. If the founder decides to treat it as a Device ID, add `NSPrivacyCollectedDataTypeDeviceID` to the manifest and select it here in the same change |
| User Content > Audio Data | Not selected | The app never records audio. The microphone usage string exists in the binary only because a linked library references the API (see the permissions note below); the app never requests it. A clip's soundtrack is part of the video file, declared under Photos or Videos |
| User Content > Customer Support | Not selected | Support is by email to support@elsheph.com. The app has no in app support form; `support_tickets` is not written from `apps/mobile` or `packages/api` |
| Location > Precise Location | Not selected | `Accuracy.Balanced` is the only accuracy the app requests |
| Health, Fitness | Not collected | No HealthKit entitlement, no health SDK. Grep for `HealthKit`, `expo-health`, `react-native-health`: zero matches. The motion usage string exists only because `expo-location` links the motion API; the app never requests it |
| Contacts | Not collected | No contacts SDK. Grep for `expo-contacts`, `CNContact`, `READ_CONTACTS`: zero matches |
| Sensitive Info | Not collected **by the app** | Government ID and guardian consent documents exist as `public.upa_evidence` kinds (`0048_empower_schema.sql:122-129`) but only the web portal `apps/portal-life` writes them. **Reopen this the moment a UPA application flow lands in the app** |
| Browsing History | Not collected | Venue booking pages, retailer pages and legal pages open in the in app browser, and nothing about what the person does there is logged |
| Usage Data > Advertising Data, Other Usage Data | Not collected | No ad network. Product Interaction above covers the only usage event recorded |
| Financial Info > Credit Info, Other Financial Info | Not collected | Transaction records and payout details only, declared above |
| Identifiers > Advertising identifier | Not collected | No IDFA access, no ATT prompt |

**Permissions note (ITMS-90683).** `NSCameraUsageDescription`, `NSMicrophoneUsageDescription` and
`NSMotionUsageDescription` must be present in the binary because linked libraries
(`expo-image-picker`, `expo-location`) reference those APIs, and App Store Connect rejects the upload
(ITMS-90683) if a referenced API has no purpose string. The strings are being restored on
`launch/release/ios-compliance` for that reason. The app never requests camera, microphone or motion
access, so none of them adds a data type. Photos arrive through the system photo picker, so no photo
library prompt appears either.

---

## Step 4. The tracking declaration

> Do you use data for tracking purposes?

**No.** Nothing in this app links user or device data to third party data for advertising or
measurement, and nothing is shared with a data broker. There is no ATT prompt because there is
nothing that would require one. Anthropic, Sentry, Expo push, Razorpay and Supabase are all
service providers acting on Atlitos' instructions, which Apple does not count as tracking. Voyage AI
(search embeddings) is in the same position.

---

## Step 5. Related App Store Connect fields on the same screen

| Field | Value | Evidence |
|---|---|---|
| Privacy Policy URL | `https://www.atlitos.com/privacy` | HTTP 200 verified 2026-08-13 |
| Account deletion | In app: Settings, Account, Delete account (type DELETE). Immediate | `apps/mobile/src/app/profile/delete-account.tsx`, `delete-account` edge function, `delete_my_account()` (0098) |
| Data collection disclosure for third party SDKs | Razorpay's SDK disclosure is UNRESOLVED, see `DATA-INVENTORY.md` section 11 | |

---

## Account deletion and Guideline 5.1.1(v)

Resolved. The app lets a person delete their account from inside the app: Settings, then Account,
then Delete account, confirmed by typing DELETE. Deletion is immediate
(`delete_my_account()` in 0098, called by the `delete-account` edge function, which also releases
the sign in, removes stored files and, as of 0139, revokes the Sign in with Apple token so the app
disappears from the person's Apple ID settings). `https://www.atlitos.com/delete-account` describes
the same flow and keeps email as the fallback for someone who can no longer sign in.
