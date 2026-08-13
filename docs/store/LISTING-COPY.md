# Atlitos store listing copy

Every string below is copy that ships to a user, so house style applies without exception: no
emojis, no em dashes, no hyphens, concise and benefit led, and no number, testimonial, award,
user count or endorsement that cannot be evidenced.

Character counts in this file were measured, not estimated. The measurement command is in
section 9 so it can be re run after any edit.

## What the app actually does, and the evidence for each claim

Only these claims appear in the copy below. Nothing else is claimed.

| Claim | Evidence |
|---|---|
| Book a court by sport and time slot | `apps/mobile/src/app/(tabs)/courts/`, `supabase/migrations/0009_courts.sql` |
| Find and book a coach for a one to one session | `apps/mobile/src/app/(tabs)/coaching/`, `supabase/migrations/0018_coaching.sql` |
| Join a coached training group on a monthly membership | `packages/api/src/use-groups.ts:9-12`, `supabase/migrations/0076_training_groups.sql` |
| Message your coach in the app | `apps/mobile/src/app/(tabs)/chat/`, `supabase/migrations/0022_chat.sql` |
| Post and watch short sports clips, called Clutch | `apps/mobile/src/app/(tabs)/clutch/`, `supabase/migrations/0041_clutch_schema.sql` |
| Like, comment, save and follow | `supabase/migrations/0044_clutch_engagement_rpcs.sql`, `0088_clip_saves.sql`, `0072_profile_social.sql` |
| Buy gear in the app | `apps/mobile/src/app/shop/`, `supabase/migrations/0031_commerce.sql` |
| Compare prices for gear across retailers and open the retailer | `supabase/migrations/0086_affiliate_marketplace.sql:1-22` |
| Search in plain language across gear, coaches and courts | `supabase/functions/ai-search/`, `apps/mobile/src/app/home/search.tsx` |
| Drills, a roadmap and XP | `apps/mobile/src/app/learn/`, `supabase/migrations/0057_learn_schema.sql`, `0059_learn_xp_engine.sql` |
| Fund an athlete who cannot afford to play, called Empower | `apps/mobile/src/app/home/empower.tsx`, `supabase/migrations/0048_empower_schema.sql` |
| Round up a purchase into the fund | `supabase/migrations/0055_roundup_backfill_general_fund.sql`, `fee_config commerce.donation_roundup_multiple` in production |
| Browse before you sign up | `supabase/migrations/0008_anonymous_user_support.sql`, PRD-01 section 1 guest stakeholder |
| Four sports: football, cricket, badminton, tennis | `supabase/migrations/0001_identity.sql:41`, the `public.sport` enum. This is the real ceiling, so the copy never implies more |
| Report and block | `supabase/migrations/0097_report_block.sql`, `apps/mobile/src/components/organisms/moderation/ModerationSheet.tsx` |
| India, rupee pricing | `apps/mobile/eas.json` Razorpay key, INR currency throughout the payment functions |

Claims deliberately NOT made anywhere in this copy: any user count, any court or coach count, any
city count, any rating, any award, any partner logo, any testimonial, and any subscription tier.
None of them can be evidenced today.

---

## 1. App name

**Both stores:** `Atlitos: Courts and Coaches`

Measured 27 characters. Apple allows 30, Google Play allows 30.

Plain `Atlitos` is also correct and is what the binary declares (`apps/mobile/app.json:3`). Use the
longer form only if the founder wants discovery weight on the two strongest nouns.

---

## 2. iOS subtitle, 30 character limit

`Book courts, coaches and gear`

Measured 29 characters.

Alternates, both measured under the limit:
- `Courts, coaches, clips, gear` (28)
- `One app for your whole game` (27)

---

## 3. iOS promotional text, 170 character limit

Editable without a new build, so this is where a seasonal message goes.

```
Book a court in a few taps, train with a verified coach, post your best clips, and shop gear at the best price. Everything your game needs, in one app.
```

Measured 151 characters.

Note on the word "verified": coaches carry a real verification status
(`supabase/migrations/0001_identity.sql:43`, `public.coach_status` with `verified`, and
`0030_verified_coach_discovery_rls.sql` gates discovery on it), so the claim is evidenced.

---

## 4. iOS description, 4000 character limit

Apple shows the first three lines before the More button, so the first three lines carry the load.

```
Atlitos is one app for your whole game. Find a court, book a coach, train with a group, watch and post clips, and get your gear at the best price.

BOOK A COURT
Browse courts near you by sport and time. See the price before you book, pay in the app, and get a confirmation you can show at the gate. Football, cricket, badminton and tennis.

TRAIN WITH A COACH
Find a verified coach by sport, price and schedule. Book a one to one session, message your coach in the app, and keep every session in one place. Prefer training with others? Join a coached group on a monthly membership.

CLUTCH
Post the point you want people to see. Watch clips from athletes in your sport, follow the ones worth following, save the ones you want to come back to.

SHOP GEAR
Buy gear in the app, or compare what the same racket costs across retailers and open the cheapest one. Round up any purchase and the difference funds an athlete who cannot afford to play.

DRILLS AND XP
Work through drills built for your sport, follow a roadmap, and earn XP as you go. Progress you can actually see.

EMPOWER
Some athletes cannot afford a racket, a pair of boots or a coaching block. Empower lets you fund a specific need for a specific athlete, and shows you what your money did.

SEARCH IN PLAIN LANGUAGE
Type what you actually want. A badminton racket under 1500. A tennis coach near me on Saturdays. Atlitos searches gear, coaches and courts together.

BROWSE BEFORE YOU SIGN UP
Open the app and look around. Create an account when you want to book, buy or post.

BUILT FOR INDIA
Rupee pricing, local courts, local coaches, and payments through Razorpay.

Atlitos is operated by ELSHEPH SYSTEMS INDIA PRIVATE LIMITED.
Privacy policy: https://www.atlitos.com/privacy
```

Measured 1740 characters, well inside the 4000 limit.

---

## 5. iOS keywords, 100 character limit

Comma separated, no spaces after the commas (a space costs a character and Apple does not need
it). Do not repeat words already in the app name or subtitle; Apple indexes those separately.

```
turf,badminton,cricket,football,tennis,sports,training,drills,clips,booking,academy,racket,gear
```

Measured 95 characters.

---

## 6. Google Play short description, 80 character limit

```
Book courts, train with coaches, post clips and shop gear. One app, your game.
```

Measured 78 characters.

---

## 7. Google Play full description, 4000 character limit

Play renders line breaks, so the structure carries. Play indexes this text for search, unlike
Apple, so the sport and city nouns are worth their place here.

```
Atlitos is one app for your whole game. Find a court, book a coach, train with a group, watch and post clips, follow drills, and get your gear at the best price.

BOOK A COURT
Browse courts near you by sport and by time slot. See the price before you commit, pay in the app, and arrive with a confirmation. Football, cricket, badminton and tennis.

TRAIN WITH A COACH
Find a verified coach by sport, by price and by the times they actually have free. Book a one to one session, message your coach in the app, and keep your whole training history in one place.

JOIN A TRAINING GROUP
Prefer training alongside other people? Join a coached group on a monthly membership, see the schedule, and track attendance.

CLUTCH, THE CLIPS FEED
Post the point you want people to see. Watch clips from athletes playing your sport, follow the creators worth following, save what you want to come back to, and build a visible record of your game.

SHOP GEAR
Buy gear inside the app with delivery to your address. Or compare what the same racket costs across retailers and open the one with the best price. Round up any purchase and the difference funds an athlete who cannot afford to play.

DRILLS AND XP
Work through drills built for your sport, follow a roadmap, and earn XP for the sessions you finish. Effort you can actually see.

EMPOWER
Some athletes cannot afford a racket, a pair of boots, or a block of coaching. Empower lets you fund a specific need for a specific athlete, and shows you where your money went.

SEARCH IN PLAIN LANGUAGE
Type what you actually want. A badminton racket under 1500. A tennis coach near me on Saturdays. Atlitos searches gear, coaches and courts together and ranks what fits.

BROWSE BEFORE YOU SIGN UP
Open the app and look around first. Create an account when you want to book, buy, post or fund.

SAFETY
You can report any clip, comment, message or account, and you can block anyone. Blocked accounts disappear from your feed, your comments and your inbox.

BUILT FOR INDIA
Rupee pricing, courts and coaches near you, and payments handled by Razorpay.

Atlitos is operated by ELSHEPH SYSTEMS INDIA PRIVATE LIMITED.
Privacy policy: https://www.atlitos.com/privacy
Delete your account: https://www.atlitos.com/delete-account
```

Measured 2252 characters, well inside the 4000 limit.

---

## 8. Metadata fields

| Field | iOS value | Google value | Note |
|---|---|---|---|
| Primary category | Sports | Sports | |
| Secondary category | Shopping | not applicable | Play takes one category. The shop and the affiliate compare surface justify Shopping as the Apple secondary |
| Content rights | Contains third party content: **Yes** | same | The app hosts user uploaded clips and lists retailer product data |
| Price | Free | Free | The download is free. Bookings, sessions, memberships, gear and donations are paid inside the app through Razorpay |
| In app purchases | **None** | **None** | There is no StoreKit or Play Billing product. Grep for `expo-in-app-purchases`, `react-native-iap` and `StoreKit` across `apps/mobile` and `packages`: zero matches. See the payments note below |
| Support URL | **BLOCKED**, see below | **BLOCKED**, see below | |
| Marketing URL | `https://www.atlitos.com` | `https://www.atlitos.com` | HTTP 200 verified 2026-08-13 |
| Privacy policy URL | `https://www.atlitos.com/privacy` | `https://www.atlitos.com/privacy` | HTTP 200 verified 2026-08-13 |
| Account deletion URL | not a separate ASC field | `https://www.atlitos.com/delete-account` | HTTP 200 verified 2026-08-13 |
| Copyright | `2026 ELSHEPH SYSTEMS INDIA PRIVATE LIMITED` | same | Entity name from `apps/landing/privacy.html:46` |
| Contact email | `support@elsheph.com` | `support@elsheph.com` | `apps/landing/delete-account.html:79` |

### Support URL is blocked

`https://www.atlitos.com/support` returns **404**, verified 2026-08-13. Apple requires a working
support URL and rejects a broken one. Google requires a contact email and accepts a support URL.

Options, cheapest first:
1. Point the support URL at `https://www.atlitos.com/delete-account`, which already carries a contact block. Weak, because the page is about deletion.
2. Add a small `support.html` to `apps/landing` with the contact email, response expectation and links to privacy and deletion. This is the right answer and is roughly the same size as the existing deletion page.

Either way it is a change in `apps/landing/**`, which this track does not own. Listed in
`SUBMISSION-CHECKLIST.md`.

### Payments note for the reviewer facing fields

Everything paid for in the app is a real world good or service: a physical court slot, a session
with a human coach, a membership to an in person training group, physical gear delivered to an
address, and a donation. None of it is digital content consumed in the app. That is why Razorpay
rather than in app purchase is the correct rail under Apple guideline 3.1.3 and 3.1.5, and under
Play's payments policy.

The donation flow takes **no platform fee**: `supabase/functions/_shared/finalize-donation-payment.ts:20`
states there is no platform fee leg, and the production `fee_config` table carries a fee row for
`courts`, `sessions` and `commerce` but only a `min_amount` row for `donations` (verified by a read
only query, 2026-08-13). Say this plainly in App Review notes; it is the fact that matters for
Apple's rules on facilitating payments between people.

---

## 9. Content rating questionnaire inputs

Do not guess the resulting rating. These are the honest inputs; the console computes the rating.

| Question both consoles ask | Answer | Evidence |
|---|---|---|
| Does the app contain user generated content? | **Yes**, video clips, captions, comments and profile text | `supabase/migrations/0041_clutch_schema.sql` |
| Can users interact or communicate with each other? | **Yes**, one to one chat, group chat, and public comments | `supabase/migrations/0022_chat.sql`, `0078_group_chat_and_notes.sql`, `0041_clutch_schema.sql:118-124` |
| Can users share content with others? | **Yes**, clips are published to a public feed | `supabase/migrations/0042_clutch_rls.sql` |
| Does the app share the user's physical location with other users? | **No.** Location is used only to sort courts by distance and is never shown to another user | `apps/mobile/src/store/location-store.ts`, no location column on any user facing table |
| Is there moderation, reporting and blocking? | **Yes**, all three | `supabase/migrations/0097_report_block.sql`, `0003_moderation_audit.sql`, admin moderation queue in `apps/admin` |
| Does the app contain violence, sexual content, profanity, horror, drugs, alcohol or tobacco? | **No** in the app's own content. User uploads are the residual risk, which is what report, block and the admin moderation queue exist for | |
| Does the app contain gambling or simulated gambling? | **No** | No wagering surface exists |
| Does the app contain in app purchases of digital goods? | **No** | No StoreKit or Play Billing product. All payments are for real world goods and services |
| Does the app let users purchase physical goods? | **Yes**, gear | `supabase/migrations/0031_commerce.sql` |
| Does the app collect or transmit personal information? | **Yes** | See `docs/store/DATA-INVENTORY.md` |
| Does the app contain unrestricted web access? | **No** | There is no in app browser. Affiliate click outs open a specific retailer URL in the system browser |
| Is the app directed at children? | **No.** The target audience is students and amateur athletes | Privacy policy states Atlitos is not directed to children under 13 (`apps/landing/privacy.html:123`) |

### The age gate gap, flag this to the founder

There is now **no age collection at signup at all**. Date of birth was removed from the register
screen (grep for `dob` in `apps/mobile/src/app/(auth)/register.tsx` returns 0 matches) and is only
an optional profile field. The privacy policy asserts the service is not directed to children
under 13 (`apps/landing/privacy.html:123`), but nothing in the app enforces or even asks.

For Play's Target Audience and Content declaration, answering that the app targets 13 and over is
consistent with the policy and with the product. It is worth knowing that no mechanism backs the
claim, and Play sometimes asks how the age assurance works. This is a product decision, not a
copywriting one.

---

## 10. How the character counts above were measured

```
python3 - <<'PY'
s = "Book courts, coaches and gear"
print(len(s))
PY
```

Every count in this file was produced by measuring the exact string as written, on 2026-08-13.
Re measure after any edit. A subtitle one character over the limit is a rejected metadata save,
not a rejected app, but it wastes a submission cycle.

The same pass checked every copy string for em dashes, en dashes, hyphens and emoji. One hyphen
survives, in the literal URL `https://www.atlitos.com/delete-account` at the foot of the Play
description. That is the real address of a live page, not prose, so it stays as is. There are no
other hyphens, no dashes of any kind, and no emoji in any string in this file.
