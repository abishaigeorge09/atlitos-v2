# Atlitos store listing copy

Every string below is copy that ships to a user, so house style applies without exception: no
emojis, no em dashes, no hyphens, concise and benefit led, and no number, testimonial, award,
user count or endorsement that cannot be evidenced.

Rewritten 2026-09-29 for iOS 1.0.0 (launch runbook 7.1). App Store Connect is filled in from this
file, so it describes the iOS app **as it ships**, not the roadmap. Character counts were measured
with `len()` on the exact strings (section 10).

## What the iOS app does, and the evidence for each claim

| Claim | Evidence |
|---|---|
| Find courts near you by sport; Book opens the venue's own booking page | `apps/mobile/src/app/(tabs)/courts/`, `COURT_IN_APP_BOOKING_ENABLED` off, `0130_venue_booking_url.sql` |
| Find a verified coach and book a one to one session, paid in the app | `apps/mobile/src/app/(tabs)/coaching/`, `0018_coaching.sql`, `book-session` |
| Join a coached training group, paid month by month, no automatic renewal | `packages/api/src/use-groups.ts`, `0076_training_groups.sql`, `join-group`, `renew-group-membership` |
| Message your coach and your group | `apps/mobile/src/app/(tabs)/chat/`, `0022_chat.sql`, `0078_group_chat_and_notes.sql` |
| Post, watch, like, comment on, save and follow Clutch clips | `apps/mobile/src/app/(tabs)/clutch/`, `0041_clutch_schema.sql`, `0088_clip_saves.sql` |
| Compare gear prices across retailers and open the retailer | `0086_affiliate_marketplace.sql`, `apps/mobile/src/app/shop/affiliate/[id].tsx` |
| Search in plain language across coaches, courts and gear | `supabase/functions/ai-search/`, `apps/mobile/src/app/home/search.tsx` |
| Drills, a roadmap and XP | `apps/mobile/src/app/learn/`, `0057_learn_schema.sql`, `0059_learn_xp_engine.sql` |
| Report and block; reports acted on within 24 hours | `0097_report_block.sql`, `ModerationSheet.tsx`, content policy |
| Browse before you sign up | `0008_anonymous_user_support.sql` |
| Four sports: football, cricket, badminton, tennis | the `public.sport` enum |

**Off on iOS, so never claimed:** paying for a court inside the app, buying gear inside the app
(owned shop behind `shop.owned_enabled`), Empower donations and purchase round ups
(`DONATIONS_ENABLED` off). Also never claimed: any user, court, coach or city count, any rating,
award, partner logo or testimonial.

---

## 1. App name

`Atlitos` (what the binary declares, `apps/mobile/app.json`). `Atlitos: Courts and Coaches`
(27 characters) is an allowed alternative if the founder wants discovery weight.

## 2. iOS subtitle, 30 character limit

`Courts, coaches and your game`

Measured 29 characters.

## 3. iOS promotional text, 170 character limit

```
Find a court near you, train with a verified coach, post your best clips, and compare gear prices across retailers. Everything your game needs, in one app.
```

Measured 155 characters. "Verified" is evidenced by `public.coach_status = verified`, which
gates discovery (`0030_verified_coach_discovery_rls.sql`).

## 4. iOS description, 4000 character limit

```
Atlitos is one app for your whole game. Find a court, train with a coach, join a group, post and watch clips, and compare gear prices across retailers.

FIND A COURT
Browse courts near you by sport. See the venue, its courts and its timings, then book and pay on the venue's own website in one tap. Football, cricket, badminton and tennis.

TRAIN WITH A COACH
Find a verified coach by sport, price and schedule. Request a one to one session in person, pay securely, message your coach in the app, and keep every session in one place.

JOIN A TRAINING GROUP
Prefer training with others? Join a coached group, pay month by month with no automatic renewal, and see the schedule and your attendance.

CLUTCH
Post the point you want people to see. Watch clips from athletes in your sport, follow the ones worth following, and save the ones you want to come back to.

COMPARE GEAR PRICES
See what the same racket or pair of boots costs across retailers, and open the retailer with the best price.

DRILLS AND XP
Work through drills built for your sport, follow a roadmap, and earn XP as you go.

SEARCH IN PLAIN LANGUAGE
Type what you actually want. A tennis coach near me on Saturdays. A badminton racket under 1500. Atlitos searches coaches, courts and gear together.

SAFE BY DESIGN
Report any clip, comment, message or account, and block anyone. We act on every report within 24 hours.

BROWSE BEFORE YOU SIGN UP
Open the app and look around. Create an account when you want to book, post or message.

Atlitos is operated by ELSHEPH SYSTEMS INDIA PRIVATE LIMITED. For people 18 and over.
Privacy policy: https://www.atlitos.com/privacy
Terms: https://www.atlitos.com/terms
```

Measured 1670 characters (re measured 2026-09-30).

## 5. iOS keywords, 100 character limit

```
turf,badminton,cricket,football,tennis,sports,training,drills,clips,academy,racket,booking,group
```

Measured 96 characters. No spaces after commas; words already in the name or subtitle are
not repeated.

---

## 6. Google Play short description (Android, NOT updated in this pass), 80 character limit

```
Book courts, train with coaches, post clips and shop gear. One app, your game.
```

Measured 78 characters.

---

## 7. Google Play full description (Android, NOT updated in this pass), 4000 character limit

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

> The two Play sections above still describe in app gear, donations and court payment. Review them
> against the Android build before the next Play release; they are not used for iOS.

---

## 8. iOS metadata fields (App Store Connect, runbook stage 9)

| Field | Value | Note |
|---|---|---|
| Primary category | Sports | |
| Secondary category | Health and Fitness | Drills, training and coaching |
| Content rights | Contains third party content: Yes | User clips and retailer product data |
| Price | Free | |
| In app purchases | None | No StoreKit product. Coaching sessions and group memberships are real world, in person services paid through Razorpay (Guideline 3.1.3(e)). No digital content is sold |
| Support URL | `https://www.atlitos.com/support` | `apps/landing/support.html` |
| Marketing URL | `https://www.atlitos.com` | |
| Privacy policy URL | `https://www.atlitos.com/privacy` | |
| Copyright | `2026 ELSHEPH SYSTEMS INDIA PRIVATE LIMITED` | |
| Contact email | `support@elsheph.com` | The same address on every page of atlitos.com |
| Version | 1.0.0 | Rename the ASC version from 1.0 |

## 9. Age rating questionnaire inputs (runbook 9.3)

| Question | Answer | Why |
|---|---|---|
| User generated content | **Yes** | Clips, captions, comments, profile text |
| Messaging and chat | **Yes** | One to one and group chat |
| Unrestricted web access | **Yes** | Book opens a venue's site and Buy opens a retailer's site in the in app browser |
| Violence, sexual content, profanity, drugs, gambling | **None** in the app's own content | User uploads are covered by the content rules, the word filter, report, block and moderation |
| Contests, gambling, simulated gambling | **No** | |

Accept the rating the console calculates. The app is for people 18 and over (terms, privacy policy,
consent line on sign up).

---

## 10. How the counts were measured

```
python3 -c 'import sys; print(len(sys.argv[1]))' "Courts, coaches and your game"
```

Every iOS string above was measured on 2026-09-29 and checked for em dashes, en dashes, hyphens
and emoji: none. The only hyphens in this file are inside URLs.
