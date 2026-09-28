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

The app carries **no analytics, advertising or tracking SDK**, so answer
"Used for Tracking" **No** for every item, and do not add an App Tracking
Transparency prompt. Declare all of these as **Linked to the user**, used for
**App Functionality**:

Name, Email Address, Phone Number, Physical Address, Coarse Location,
Photos or Videos, Other User Content, Purchase History, User ID, Other Data,
Payment Info (coach and venue bank or UPI details for payouts, 0132),
Emails or Text Messages (in app chat).

Product Interaction: **Linked**, used for **Analytics**, not tracking. Buy taps
are recorded against the signed in user (0133 `affiliate_clicks`); the retailer
only ever receives a random click id.

**Not linked to the user**, not used for tracking, App Functionality: Search
History (the ai-search cache keeps query text with no user id), and, for
Sentry, Crash Data, Performance Data, Other Diagnostic Data.

Published in App Store Connect on 2026-09-27 with exactly these 17 types.

This matches `ios.privacyManifests` in `app.json` exactly. If you change one,
change the other, because Apple compares them.

## Review notes

Rewritten 2026-09-29 (launch runbook 7.3) for the iOS 1.0.0 build. COPY:

```
Atlitos is a sports app for athletes in India: find courts, train with
verified coaches, join coached groups, post and watch sports clips, and
compare gear prices across retailers.

DEMO ACCOUNT
Email: appreview@elsheph.com
Password: (in the Sign-In Information fields)
It has an upcoming coaching session, a chat with a coach, an approved clip
and a completed profile. You can also browse as a guest with no account.

HOW THINGS WORK
- Courts: tap a venue, then Book. This opens the venue's own booking
  website. Atlitos does not take payment for courts.
- Coaching sessions and group memberships are real world, in person
  services with a human coach, paid through Razorpay under guideline
  3.1.3(e). Group memberships are paid month by month and never renew
  automatically.
- Gear: Atlitos compares prices across retailers. Buy opens the retailer's
  website. No gear is sold in the app.
- No digital content is sold anywhere in the app, and donations are turned
  off on iOS.

USER GENERATED CONTENT (guideline 1.2)
- Before a first clip, comment or chat message, the user agrees to our
  content rules: no tolerance for objectionable content or abusive users.
  A server side word filter refuses listed words in comments and messages.
- REPORT A CLIP: tap the vertical dots on the right of the video, then
  "Report post", pick a reason, add free text if you like, Submit.
- REPORT A COMMENT: open comments, press and hold the comment, Report.
- REPORT A CHAT MESSAGE: press and hold the message, Report.
- BLOCK: the same menus, "Block". The member's posts, comments and messages
  disappear everywhere at once. Undo in Settings, Account, Blocked accounts.
- Clips are reviewed before they appear publicly. We act on every report
  within 24 hours. Content policy: https://www.atlitos.com/content-policy

ACCOUNT DELETION (guideline 5.1.1(v))
Settings, Account, Delete account, type DELETE. The account is deleted
immediately. For Sign in with Apple accounts we also revoke the Apple token,
so Atlitos disappears from the Apple ID's Sign in with Apple list. Payment
records are kept in anonymised form because Indian tax law requires it.

PERMISSIONS
- Location, while using the app only: to show courts and coaches near you.
  Everything works if you deny it.
- Photos: through the system photo picker, so no library permission is
  requested. Only the photo or video you pick is shared.
- Notifications: asked only after your first booking or group join, behind
  a short explanation.
No camera, microphone, background location or tracking.

Privacy policy: https://www.atlitos.com/privacy
Terms: https://www.atlitos.com/terms
Support: https://www.atlitos.com/support
```

Before pasting: replace nothing inside the block except to confirm the demo address (runbook 6.6)
and that the support address on `/support` is the one picked in runbook 2.6. The password goes in
App Store Connect's Sign-In Information fields only, never in this repo.

## Demo account

REQUIRED. Runbook 6.6: an email and password account on a team owned address,
`appreview@elsheph.com`, created by a founder. Never a personal address, never deleted after
approval (Apple reuses it for every update).

| Field | Value |
|---|---|
| Username | `appreview@elsheph.com` |
| Password | entered only in App Store Connect, never in this repo |

It must have accepted the content rules (it posts a clip and chats), and carry one upcoming
coaching session, one chat thread with a coach, one approved clip and a completed profile. Sign in
with it on the exact TestFlight build before submitting.

## Support and marketing URLs

| Field | Value |
|---|---|
| Support URL | https://www.atlitos.com/support |
| Marketing URL | https://www.atlitos.com |
| Privacy policy URL | https://www.atlitos.com/privacy |

Note the domain mismatch worth tidying before submission: the app and site are
`atlitos.com`, while the published contact is `founder@synthsports.co` and the
site also shows `support@elsheph.com`. Three domains for one product invites a
reviewer question about who actually operates the app. Publish one support
address on the atlitos.com domain and use it everywhere.

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
