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

The app carries user generated video with no age restriction on what members
post, so answer the questionnaire honestly rather than optimistically:

- **Unrestricted web access:** No
- **User generated content:** **Yes**, with moderation, reporting and blocking
- Realistic violence, sexual content, profanity, gambling, drugs: **None**

Expect a 12+ rating from the user generated content answer alone. Rate for
what the app **can** produce, not what you hope it produces.

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
Photos or Videos, Other User Content, Purchase History, User ID, Other Data.

Plus, for Sentry, **Not linked to the user**, not used for tracking, App
Functionality: Crash Data, Performance Data, Other Diagnostic Data.

This matches `ios.privacyManifests` in `app.json` exactly. If you change one,
change the other, because Apple compares them.

## Review notes

COPY:

```
Atlitos is a sports app for athletes in India: find courts, book coaching,
post match clips, and compare prices on sports gear.

To test:
1. Open the app. You can browse courts, coaches and the Clutch feed as a
   guest, with no account.
2. Sign in with the demo account below to see the full experience.
3. Home shows courts and coaches near you. Courts requires location
   permission; deny it and the app still works, it just cannot sort by
   distance.
4. Clutch is the video feed. Swipe vertically.

User generated content. Members post short sports videos with captions, and
can comment. Every one of the required controls is in the app:
- REPORT: on any post in Clutch, tap the vertical dots on the right of the
  video, then "Report post", then pick a reason.
- BLOCK: same menu, "Block". The blocked member's posts and comments
  disappear immediately and everywhere. Manage or undo this in
  Settings > Account > Blocked accounts.
- MODERATION: videos are reviewed before they appear publicly. Reports go to
  an internal review queue.
- Content policy: https://www.atlitos.com/content-policy

Account deletion: Settings > Account > Delete account. Two confirmations,
then the account is deleted immediately. Personal data is erased. Order and
payment records are retained in anonymised form because Indian tax law
requires it, and the privacy policy says so.

Permissions we request, and why:
- Photo library: only when you tap to pick a video, a profile picture or a
  coaching certificate. We never scan the library.
- Location, while using the app only: to sort courts by distance. The app
  works fully if you deny it.
We request no camera, microphone or background location access.

Payments: coaching sessions are real world services, delivered in person or
live one to one, and court bookings are real world venue time, so both are
paid through Razorpay under guideline 3.1.3(d)/(e). Gear opens the partner
retailer's own site. Card details never reach our servers.
[Confirm the live Razorpay key is in the production build before submitting.]

Third parties that receive data: Supabase (our backend), Razorpay
(payments), Anthropic and Voyage AI (search text only), Sentry (crash
reports, not linked to the account), Apple and Google (only for their own
sign in). No analytics, no advertising, no tracking.

Privacy policy: https://www.atlitos.com/privacy
Terms: https://www.atlitos.com/terms
Support: founder@synthsports.co
```

## Demo account

REQUIRED, because parts of the app need sign in. Reviewers reject on a demo
account that does not work more often than on almost anything else.

| Field | Value |
|---|---|
| Username | TO BE FILLED |
| Password | TO BE FILLED |

Before submitting, verify by hand that the demo account:

- signs in on a real device, on the exact build being submitted
- has at least one upcoming booking, one past order and some Clutch content
  visible, so the reviewer sees a populated app rather than empty states
- is NOT the account you use daily, and holds no real personal data
- is not suspended, and its phone or email is not a real person's

## Support and marketing URLs

| Field | Value |
|---|---|
| Support URL | https://www.atlitos.com (add a visible support link, currently mailto only) |
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
