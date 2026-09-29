# Legal open questions (founder checklist)

Internal. These notes used to live as HTML comments inside the public pages in
`apps/landing/*.html`, where anyone could read them with View Source. They were
moved here on 2026-09-30 so the published pages carry no notes to staff.

None of the published pages is legal advice. Each one describes what the
software actually does, so a lawyer can review it cheaply. The items below are
the decisions a person still has to make. Until each is settled the live pages
use the neutral, accurate wording noted against it, so nothing here blocks a
deploy, but each one should be closed before the lawyer signs off.

## Open

- [ ] **Cancellation windows and penalty tiers** (`terms.html` section 6,
  `refund-policy.html` sections 1 and 2). Today the pages say what the code
  does: a coach decline or a cancel before the coach answers is refunded in full
  automatically; a cancel after acceptance is decided case by case by support
  within 3 working days; a started session cannot be cancelled; a started
  membership month is not refunded. If specific windows or penalty tiers are
  introduced (for example "full refund up to 24 hours before"), they are product
  configuration, not code constants. Write the numbers into both pages and make
  the app show the same numbers, in the same change.

- [ ] **Lawyer sign off on liability** (`terms.html` section 11, "Our
  responsibility", and the injury paragraph in section 4). Liability caps and
  their enforceability under the Indian Contract Act and the Consumer Protection
  Act need a lawyer. The current wording is a starting point, not a settled
  position.

- [ ] **Registered location and jurisdiction courts** (`terms.html` section 14).
  The page currently says the laws of India govern and the courts of India have
  jurisdiction. The registered office on `contact.html` is in Hyderabad,
  Telangana. Decide whether to name the courts at Hyderabad, then update the
  clause.

- [ ] **Grievance Officer, named person** (`privacy.html`, Grievance Officer
  section, and `contact.html`). The page now publishes a role based contact:
  "Grievance Officer, ELSHEPH SYSTEMS INDIA PRIVATE LIMITED", support@elsheph.com
  with the subject line Grievance, and the registered postal address. Confirm
  with counsel whether the DPDP Rules require a named individual. If they do,
  add the name next to the role; do not remove the role or the address.

- [ ] **SMS and SMTP providers** (`privacy.html`, "Who else receives your
  data"). `supabase/config.toml` does not configure a custom SMTP server, and its
  `[auth.sms.twilio]` block is disabled, so the repository cannot tell us which
  services send one time codes in production. The page says, neutrally, "Email
  and SMS delivery providers" receive your email address or phone number and the
  one time code, only to deliver it. Check Supabase dashboard, Authentication,
  Emails (SMTP settings) and Phone provider, then name the providers on the page
  (for example the Supabase built in mailer or a custom SMTP service, and the SMS
  provider if phone sign in is on).

## Rules for whoever edits these pages next

- Every rule on `refund-policy.html` must match what the checkout and the
  session and membership state machines actually do. A policy the checkout
  contradicts is worse than no policy. Change the code and the page in the same
  change.
- `shipping.html` says no physical goods are sold. The owned store exists behind
  the `shop.owned_enabled` flag with a flat delivery charge in `fee_config`. If
  that flag is turned on, rewrite `shipping.html`, `refund-policy.html` and the
  privacy "Saved addresses" row in the same change, and make the numbers match
  `fee_config` exactly.
- Courts are booked on the venue's own website (`COURT_IN_APP_BOOKING_ENABLED`
  is false in `apps/mobile/src/lib/feature-flags.ts`). If in app court booking
  is turned back on, the court sections of `terms.html`, `refund-policy.html`,
  `shipping.html`, `support.html` and `contact.html` all need rewriting before
  release.
- Donations follow `DONATIONS_ENABLED` (off on iOS, on for Android and the web).
  The pages say so. If that changes, update the lede of `refund-policy.html`,
  section 5 of `terms.html` and section 4 of `shipping.html`.
- `content-policy.html` is required by App Store guideline 1.2. Describe only
  controls that exist in the app (report and block in
  `apps/mobile/src/components/organisms/moderation/ModerationSheet.tsx`,
  moderation through `clips.status` and the admin review queue).
- `delete-account.html` is the store data deletion URL
  (https://www.atlitos.com/delete-account). In app deletion is Settings,
  Account, Delete account, confirmed by typing DELETE, and is immediate
  (`apps/mobile/src/app/profile/delete-account.tsx`, `delete_my_account()`).
- `contact.html` fields are statutory values from the entity's own records. Do
  not add a field we cannot answer.
- No HTML comments with notes to staff in any public page. Put them here.

## Chat messages and comments after account deletion (added 29 Sep, night)

Today `delete_my_account()` keeps a deleted person's chat messages and their comments on other
people's clips, attributed to "Deleted user" with name, photo and every personal field erased. The
privacy page and the delete account page now say exactly that. Decide whether to keep this
(common practice, keeps the other person's thread readable) or to delete the text as well. If
deletion is wanted, it is a small change to `delete_my_account()` plus a chat UI check for threads
that lose messages, and both pages change back.
