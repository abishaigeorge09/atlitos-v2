# App Store submission pack

Everything App Store Connect asks for, filled in from what the app actually
does. Copy the blocks marked COPY straight into the form.

## Identity

| Field | Value |
|---|---|
| Bundle identifier | `com.atlitos.app` (registered, cannot be changed later) |
| Apple team id | `4U493SXP52` |
| App Store Connect app id | `6793626237` |
| Version | 1.0.0 |
| Primary category | Sports |
| Export compliance | `ITSAppUsesNonExemptEncryption: false`, already declared in `app.json`. Standard HTTPS only |

## Age rating

Answer the questionnaire for what the app **can** produce (launch runbook 9.3):

- **User generated content:** **Yes**, with the content rules, a word filter, reporting, blocking and moderation
- **Messaging and chat:** **Yes**, one to one and group chat
- **Unrestricted web access:** **Yes**. Book on a court opens the venue's own site and Buy on gear opens a retailer's site, in the in app browser. Answering No here is a near certain rejection
- Realistic violence, sexual content, profanity, gambling, drugs: **None**

Accept whatever rating the console calculates. Separately, the app is for people 18 and over
(terms, privacy policy, and the consent line on sign up and sign in).

## Sign in with Apple

**Offered, and required.** The app has its own accounts (email or phone, with a
password or a one time code) AND Sign in with Google (browser OAuth), so
guideline 4.8 applies: Sign in with Apple ships alongside it, native sheet via
`expo-apple-authentication` (`apps/mobile/src/lib/oauth.ts`). Both providers
are enabled on production (docs/qa/evidence/oauth/README.md).

Before submitting: the Google consent screen must be **In production**, not
Testing, or a reviewer's Google account is refused. Updated 2026-09-23.

## Privacy nutrition label

The full answer sheet, type by type with evidence, is `docs/store/APPLE-APP-PRIVACY.md`. It
equals the privacy manifest that ships (`apps/mobile/app.json` on
`launch/release/ios-compliance`): 17 types, none used for tracking.

The app carries **no analytics, advertising or tracking SDK**, so answer
"Used for Tracking" **No** for every item, and do not add an App Tracking
Transparency prompt. Declare all of these as **Linked to the user**, used for
**App Functionality**:

Name, Email Address, Phone Number, Physical Address, Coarse Location,
Photos or Videos, Other User Content, Purchase History, User ID, Other Data,
Payment Info (coach and venue bank or UPI details for payouts, 0132),
Emails or Text Messages (in app chat).

Product Interaction: **Linked**, used for **App Functionality** and **Analytics**, not tracking. Buy taps
are recorded against the signed in user (0133 `affiliate_clicks`); the retailer
only ever receives a random click id.

**Not linked to the user**, not used for tracking, App Functionality: Search
History (the ai-search cache keeps query text with no user id), and, for
Sentry, Crash Data, Performance Data, Other Diagnostic Data.

Published in App Store Connect on 2026-09-27 with exactly these 17 types. The ios-compliance
manifest adds App Functionality to Product Interaction, so tick that purpose in App Store Connect
too before submitting.

Not declared, deliberately: Device ID, Audio Data, Customer Support, Precise Location.

This matches `ios.privacyManifests` in `app.json` exactly. If you change one,
change the other, because Apple compares them.

## Review notes

Rewritten 2026-10-01 for appointment mode (no payments in the iOS app; see
PAYMENTS.md "Coach appointments"). Source of truth: `apps/mobile/store.config.json`,
pushed with `eas metadata:push`. COPY:

```
Atlitos is a sports app for athletes in India: find courts, book
appointments with verified coaches, post and watch sports clips, and
compare gear prices across retailers.

DEMO ACCOUNT
The sign in details are in the Sign-In Information fields of this
submission.
It has an upcoming coaching appointment, a chat with the coach, approved
clips and a completed profile. You can also browse as a guest with no
account.

HOW THINGS WORK
- Courts: tap a venue, then Book. This opens the venue's own booking
  website. Atlitos does not take payment for courts.
- Coaching: the athlete requests an appointment with a coach in the app
  and the coach accepts or declines it. The session is paid directly to
  the coach in person; there is no payment in the app. In-app payment for
  these in person services may come in a later version under guideline
  3.1.3(e).
- Gear: Atlitos compares prices across retailers. Buy opens the retailer's
  website. No gear is sold in the app.
- There are no payments of any kind in this version of the iOS app. No
  digital goods or content are sold. Drills and training content are
  free. Donations are turned off on iOS.

USER GENERATED CONTENT (guideline 1.2)
- Before a first clip, comment or chat message, the user agrees to our
  content rules: no tolerance for objectionable content or abusive users.
  A server side word filter refuses listed words in comments and messages.
- REPORT A CLIP: tap the vertical dots on the right of the video, then
  "Report this clip", type a reason, "Submit report".
- REPORT A COMMENT: open comments, press and hold the comment (or tap its
  flag), "Report this comment", type a reason, "Submit report".
- REPORT A CHAT MESSAGE: press and hold the message, "Report this message",
  type a reason, "Submit report".
- REPORT AN ACCOUNT: from the member's profile, the same menu.
- BLOCK: the same menus, "Block" and confirm. The member's posts, comments
  and messages disappear everywhere. Undo in Settings, Account, Blocked
  accounts.
- Clips are reviewed before they appear publicly. We act on every report
  within 24 hours. Content policy: https://www.atlitos.com/content-policy

ACCOUNT DELETION (guideline 5.1.1(v))
Settings, Account, Delete account, type DELETE. The account is deleted
immediately. For Sign in with Apple accounts we also revoke the Apple token,
so Atlitos disappears from the Apple ID's Sign in with Apple list.

PERMISSIONS
- Location, while using the app only: to show courts and coaches near you.
  Everything works if you deny it.
- Photos: The app uses the system photo picker, so only the photo or
  video you pick is shared. It does not ask for access to your whole
  library.
- Notifications: asked only after your first appointment request, behind
  a short explanation.
- Camera, microphone and motion: the binary contains purpose strings for
  these because linked libraries (expo-image-picker, expo-location)
  reference the APIs, but the app never requests them.
No background location and no tracking.

Privacy policy: https://www.atlitos.com/privacy
Terms: https://www.atlitos.com/terms
Support: https://www.atlitos.com/support
```

Before pasting: the block contains no credentials on purpose. **FOUNDER TO FILL IN, IN APP STORE
CONNECT ONLY:** App Review Information, Sign-In Information, User name and Password for the demo
account below. Never write the password into this repo, a commit, a ticket or a chat.

## Demo account

REQUIRED. Runbook 6.6: an email and password account on a team owned address,
`appreview@elsheph.com`, created by a founder. Never a personal address, never deleted after
approval (Apple reuses it for every update).

| Field | Value |
|---|---|
| Username | FOUNDER TO FILL IN, in App Store Connect only (planned: `appreview@elsheph.com`, confirm it exists and signs in) |
| Password | FOUNDER TO FILL IN, in App Store Connect only. Never in this repo |

It must have accepted the content rules (it posts a clip and chats), and carry one upcoming
coaching session, one chat thread with a coach, one approved clip and a completed profile. Sign in
with it on the exact TestFlight build before submitting.

## Support and marketing URLs

| Field | Value |
|---|---|
| Support URL | https://www.atlitos.com/support |
| Marketing URL | https://www.atlitos.com |
| Privacy policy URL | https://www.atlitos.com/privacy |

Support email: `support@elsheph.com`, the same address on the support page, the contact page,
the privacy policy, the terms and the listing. The operator is ELSHEPH SYSTEMS INDIA PRIVATE
LIMITED, named on every one of those pages.

## Screenshots

Required sizes: 6.9 inch and 6.5 inch iPhone. Must show real functionality, not
mockups and not placeholder art.

Note before capturing: the seeded product and venue images render as flat colour
blocks (documented as BUG-06, an asset problem rather than a rendering fault).
Screenshots taken against seed data will look broken. Capture against real
imagery, or replace the seed assets first.

## Most likely rejection reasons, ranked

1. **1.2 user generated content.** Now addressed: report, block, moderation,
   published policy, monitored contact. Make sure the reviewer finds them, which
   is what the review notes above are for.
2. **5.1.1(v) account deletion.** Now addressed, and the notes say where it is.
3. **2.1 crashes or placeholder content.** Test on a real device. Seed imagery
   reads as placeholder.
4. **5.1.1 privacy label mismatch.** The manifest and the label now agree. Keep
   them in step.
5. **2.3 the listing overstating the app.** Describe only what ships.
