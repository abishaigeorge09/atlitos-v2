# Mobile: courts, coaching sessions, training groups, athlete Trainings

Part of the verified workflow map, see [README.md](README.md). 28 workflows, 46 screens.

## Contents

1. Find a court (browse and filter by sport) (guest)
2. View a court, pick a date and a time slot (guest)
3. Book and pay for a court slot (reserve, review bill, pay, processing, success, failed) (player, money)
4. View my court bookings and a booking detail (player, money)
5. Cancel a court booking (player, money)
6. Reschedule a court booking (player, money)
7. Rate a court after a completed booking (player)
8. Court affiliate click out (release replacement for in-app booking) (guest)
9. Find a coach (browse and filter by sport) (guest)
10. View a coach, check availability, choose session type, frequency, date, time and details (guest)
11. Pay for a coaching session (review price, pay, processing, confirmation, failed) (player, money)
12. My sessions (upcoming and history) with stat tiles (player, money)
13. Session detail: cancel a pending request (full refund), cancel an accepted session, message the coach (player, money)
14. Reschedule a coaching session (player, money)
15. Rate a coach after a completed session (player)
16. Join a training group (month 1) (player, money)
17. Renew a lapsed group membership (player, money)
18. Athlete Trainings dashboard (Stats tab): upcoming sessions, requests, groups, milestones, review videos (player, money)
19. Trainings Payments tab (session payment history) (player, money)
20. Trainings Chat tab and chat thread (player)
21. Trainings Analytics tab (athlete trends) (player)
22. My review videos (coach posted trainee videos) (player)
23. What attendance maps to: session start, complete, rate (athlete has no check in) (player)
24. Guest login gates across Courts, Coaches and Trainings (guest)
25. Coach only drill ins that share the Trainings route group (not athlete surfaces) (coach)
26. Search for a coach or court from Home AI search (guest)
27. Pending or rejected coach opens the Trainings tab (verification status) (coach)
28. Open the athlete session detail from inside the Trainings module (player, money)

---

## 1. Find a court (browse and filter by sport)

Category: COURTS. Persona: guest. Money: no.

Courts is a bottom tab. The list shows verified venues near the athlete's location (device GPS, falling back to profile city), filtered by sport chips and bounded to MAX_NEARBY_KM = 150. There is no text search on this tab; text search for courts lives in Home AI search (home/search.tsx), whose court hits deep link to the court detail. Guest open, nothing here mutates.

Release note: Browse stays for release. Per RELEASE-TODO task 5 the 'My bookings' entry point and every in-app booking route are to be hidden (scenario A-33 expects no My Bookings entry anywhere); the Book button becomes the affiliate click out. No outbound link field exists yet on courts or venues (checked packages/types, supabase/migrations, packages/api).

After success: Court detail at atlitos://courts/court/<id>

### Screens

**01 Courts tab (court list)**  
Route `atlitos://courts`, source `apps/mobile/src/app/(tabs)/courts/index.tsx`
- See: H1 'Courts', top right 'My bookings' link with CalendarClock icon, MapPin line 'Showing courts near {city}' (or 'Finding your location...'), horizontal filter chips 'All sports', 'Football', 'Cricket', 'Badminton', 'Tennis', then CourtCard list: venue image (LandPlot placeholder when none), name, MapPin location, distance in mono 'x.x km', mono price with '/hour', and a 'Book' button. Pull to refresh.
- Do: Tap a sport chip to filter, tap a card or its Book button to open the court.
- Tap targets: `Courts (bottom nav, lucide LandPlot)`, `My bookings`, `CalendarClock`, `All sports`, `Football`, `Cricket`, `Badminton`, `Tennis`, `Book`, `court card (accessibilityLabel = court name)`
- Then: Card and Book both push atlitos://courts/court/<id>. 'My bookings' pushes atlitos://courts/bookings when signed in, otherwise raises LoginGateModal.

### States

- loading: Courts tab. Trigger: First open or sport chip change Source: apps/mobile/src/app/(tabs)/courts/index.tsx state === 'loading': header plus three Skeleton shape='card' height 220
- empty: Courts tab. Trigger: No verified venue within 150 km for the chosen sport (or device located outside India, BUG-03) Source: apps/mobile/src/app/(tabs)/courts/index.tsx state === 'empty': LandPlot in circle, 'No courts near you yet', 'No verified {sport} courts near {city} right now. Try another sport.' or 'No verified courts near {city} right now. Check back soon.'
- error: Courts tab. Trigger: listCourts throws (offline) Source: apps/mobile/src/app/(tabs)/courts/index.tsx state === 'error': TriangleAlert, 'Couldn't load courts', error message, 'Retry' button with RefreshCw
- gate: Courts tab, My bookings tap as guest. Trigger: Tap 'My bookings' while status !== 'signed_in' Source: apps/mobile/src/app/(tabs)/courts/index.tsx requiresAuthGate -> setGateVisible(true) -> LoginGateModal (LoginGateSheet heading 'Want to hit the spotlight?', body 'Sign in to book sessions, track progress and join the community.', buttons 'Login', 'Register', 'Close')

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/05-courts-browse.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png


## 2. View a court, pick a date and a time slot

Category: COURTS. Persona: guest. Money: no.

Court detail with image carousel, sport, address, StarRating, base price per hour with a peak pricing note, then CalendarPicker and SlotPicker fed by get_court_available_slots. The selected slot shows its exact price. Book is the only mutating action and is gated for guests.

Release note: Per RELEASE-TODO task 5 the date and time pickers and 'Book this slot' are replaced by an affiliate click out (scenarios G-19 to G-22, A-32). Detail screen itself stays. Needs an outbound link field on courts and a missing link state (G-21); neither exists in source today.

After success: atlitos://courts/book/pay (signed in) or LoginGateModal (guest)

### Screens

**01 Court detail**  
Route `atlitos://courts/court/<id>`, source `apps/mobile/src/app/(tabs)/courts/court/[id].tsx`
- See: AppBar back (ChevronLeft, accessibilityLabel 'Back'), AdBannerCarousel of court images (LandPlot placeholder square if none), H1 court name with sport icon (Goal, CircleDot, Feather or Target) and sport label, address line, StarRating with count, PriceText per hour plus 'per hour', caption 'Prices can be higher during peak hours, the exact price for your chosen slot shows below.', H3 'Pick a date' with CalendarPicker (ChevronLeft, ChevronRight month arrows, day cells), H3 'Pick a time' with SlotPicker chips labelled '{from} to {to}', 'Price for this slot' once a slot is chosen, pinned bottom button.
- Do: Tap a day, tap a time chip, tap the bottom button.
- Tap targets: `Back`, `ChevronLeft`, `ChevronRight`, `day cell`, `time chip ('{from} to {to}')`, `Select a time to book (disabled)`, `Book this slot`, `Retry`
- Then: Selecting a date refetches slots. Book this slot pushes atlitos://courts/book/pay with courtId, courtName, venueLocation, date, slotFrom, slotTo; as a guest it raises LoginGateModal instead.

### States

- loading: Court detail. Trigger: Open from the list Source: apps/mobile/src/app/(tabs)/courts/court/[id].tsx state === 'loading': Skeleton card 220, two lines, card 160
- error: Court detail. Trigger: Unknown id or fetch failure Source: apps/mobile/src/app/(tabs)/courts/court/[id].tsx state === 'error': TriangleAlert, error.message or 'This court could not be found.', 'Retry'
- loading: Court detail, slot section. Trigger: Every date change Source: apps/mobile/src/app/(tabs)/courts/court/[id].tsx slotsState === 'loading': four Skeleton tiles 92x44
- empty: Court detail, slot section. Trigger: Pick a date with no open slots Source: apps/mobile/src/app/(tabs)/courts/court/[id].tsx slotsState === 'empty': 'No open slots on this date. Try another date.'
- error: Court detail, slot section. Trigger: get_court_available_slots throws Source: apps/mobile/src/app/(tabs)/courts/court/[id].tsx slotsState === 'error': 'Couldn't load slots for this date. Try another date or check back.' in danger colour
- gate: Court detail, Book as guest. Trigger: Select a slot and tap 'Book this slot' while not signed in Source: apps/mobile/src/app/(tabs)/courts/court/[id].tsx handleBook requiresAuthGate -> LoginGateModal

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png


## 3. Book and pay for a court slot (reserve, review bill, pay, processing, success, failed)

Category: COURTS. Persona: player. Money: yes.

Signed in only (guest is bounced back). On mount the screen calls the book-court edge function which holds the slot, re-prices server side and returns a Razorpay order; the bill renders through the shared BillSummary (Subtotal, GST, Platform fee, Total). Pay opens the Razorpay sheet, then verify-payment, then a confirmed state. No money row is ever written client side.

Release note: hidden for release per RELEASE-TODO task 5 (in-app booking flow and its deep link routes hidden; replaced by affiliate click out)

After success: Booking detail at atlitos://courts/booking/<id> (View booking) or the Courts tab at atlitos://courts (Explore more courts)

### Screens

**01 Reserving your slot**  
Route `atlitos://courts/book/pay`, source `apps/mobile/src/app/(tabs)/courts/book/pay.tsx`
- See: AppBar title 'Reserving your slot' with back, skeleton line, card 140, line while book-court runs.
- Do: Wait.
- Tap targets: `Back`
- Then: Moves to Confirm and pay, or to the reserve error state.

**02 Confirm and pay (review)**  
Route `atlitos://courts/book/pay`, source `apps/mobile/src/app/(tabs)/courts/book/pay.tsx`
- See: AppBar title 'Confirm and pay', card with court name, venue location, '{date}, {from} to {to}', BillSummary card with rows 'Subtotal', 'GST', 'Platform fee' and Total, inline danger row (TriangleAlert 16) if a previous pay attempt failed, pinned button 'Pay ₹{total}' (amount in mono).
- Do: Tap Pay.
- Tap targets: `Back`, `Pay ₹{total}`
- Then: Button shows a spinner (loading) and state becomes 'paying'; the Razorpay checkout sheet opens (description '{courtName} booking').

**03 Razorpay checkout sheet (processing)**  
Route `atlitos://courts/book/pay`, source `apps/mobile/src/lib/razorpay-checkout.native.ts`
- See: Native Razorpay sheet over the screen; Pay button is disabled with ActivityIndicator underneath.
- Do: Complete or dismiss the sheet.
- Tap targets: `Razorpay sheet controls (native)`
- Then: Success calls verifyPayment then shows Court booked. Dismiss or failure throws RazorpayCheckoutCancelledError ('Payment was not completed.', apps/mobile/src/lib/razorpay-checkout.types.ts) and returns to the review screen with an inline error.

**04 Court booked (success)**  
Route `atlitos://courts/book/pay`, source `apps/mobile/src/app/(tabs)/courts/book/pay.tsx`
- See: No AppBar. CheckCircle2 in success tint circle, H1 'Court booked', '{courtName} is confirmed for {date}, {from} to {to}.', mono 'Booking ID {id}', BillSummary card, buttons 'View booking' and 'Explore more courts'.
- Do: Tap View booking or Explore more courts.
- Tap targets: `View booking`, `Explore more courts`
- Then: View booking replaces to atlitos://courts/booking/<id>; Explore more courts replaces to atlitos://courts.

### States

- gate: Confirm and pay. Trigger: Deep link here as a guest Source: apps/mobile/src/app/(tabs)/courts/book/pay.tsx useEffect: if requiresAuthGate router.back()
- processing: Reserving your slot. Trigger: Mount Source: apps/mobile/src/app/(tabs)/courts/book/pay.tsx state === 'reserving'
- failed: Couldn't reserve this slot. Trigger: book-court rejects (SLOT_TAKEN or other) Source: apps/mobile/src/app/(tabs)/courts/book/pay.tsx state === 'error' && !booking: AppBar back only, TriangleAlert, 'This slot was just taken' + 'Someone else booked it first. Go back and pick another time.' for SLOT_TAKEN, else 'Couldn't reserve this slot' + error.message; button 'Choose another slot' (router.back)
- processing: Confirm and pay. Trigger: Tap Pay Source: apps/mobile/src/app/(tabs)/courts/book/pay.tsx Button loading={payLoading || state === 'paying'}
- failed: Confirm and pay, inline payment error. Trigger: Dismiss the Razorpay sheet, or verify-payment returns INVALID_SIGNATURE Source: apps/mobile/src/app/(tabs)/courts/book/pay.tsx error row: TriangleAlert 16 + 'Payment could not be verified. Please try again.' for INVALID_SIGNATURE, else error.message or 'Payment was not completed.'; state returns to 'ready' so Pay can be retried
- success: Court booked. Trigger: verify-payment succeeds Source: apps/mobile/src/app/(tabs)/courts/book/pay.tsx state === 'confirmed' && booking

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-native/native-checkout-module-loaded.png
- docs/phases/evidence/p3-native/native-checkout-payment-resolved.png


## 4. View my court bookings and a booking detail

Category: COURTS. Persona: player. Money: yes.

'My bookings' from the Courts tab lists the athlete's own court bookings (RLS scoped listMyBookings) with status pill and mono total; tapping opens the booking detail with the BillSummary and status appropriate actions.

Release note: hidden for release per RELEASE-TODO task 5 (bookings list, booking detail and their deep links are part of the in-app booking flow to hide; A-33 expects no My Bookings entry point)

After success: Stays on atlitos://courts/booking/<id>; back returns to My bookings

### Screens

**01 My bookings**  
Route `atlitos://courts/bookings`, source `apps/mobile/src/app/(tabs)/courts/bookings.tsx`
- See: AppBar title 'My bookings', card per booking: court name (or 'Court'), StatusPill (Pending, Confirmed, Completed, Cancelled, Rescheduled, No show, Expired via COURT_BOOKING_STATUS_PILL), venue name, '{date}, {from} to {to}', PriceText total. Pull to refresh.
- Do: Tap a booking card.
- Tap targets: `Back`, `booking card`, `Find a court`, `Retry`
- Then: Pushes atlitos://courts/booking/<id>.

**02 Booking detail**  
Route `atlitos://courts/booking/<id>`, source `apps/mobile/src/app/(tabs)/courts/booking/[id].tsx`
- See: AppBar title 'Booking', summary card (court name, StatusPill, venue, location, '{date}, {from} to {to}', sport label, 'Reason: {cancellationReason}' when set), BillSummary card (Subtotal, GST, Platform fee, Total), then actions that depend on COURT_BOOKING_TRANSITIONS: 'Reschedule' (CalendarClock) and 'Cancel booking' (XCircle) while confirmed or rescheduled, RateReviewForm once completed and unrated (canRateCourtBooking), 'Your review' card with mono 'x.x/5' once rated.
- Do: Read, or pick an action.
- Tap targets: `Back`, `Reschedule`, `Close reschedule`, `Cancel booking`, `Retry`
- Then: See the cancel, reschedule and rate workflows.

### States

- loading: My bookings. Trigger: Open Source: apps/mobile/src/app/(tabs)/courts/bookings.tsx state === 'loading': three Skeleton cards 120
- empty: My bookings. Trigger: Account with no court bookings Source: apps/mobile/src/app/(tabs)/courts/bookings.tsx state === 'empty': CalendarX2, 'No bookings yet', 'Book a court from the Courts tab and it will show up here.', button 'Find a court' (router.replace to /(tabs)/courts)
- error: My bookings. Trigger: listMyBookings throws Source: apps/mobile/src/app/(tabs)/courts/bookings.tsx state === 'error': TriangleAlert, 'Couldn't load your bookings', 'Retry'
- loading: Booking detail. Trigger: Open Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx state === 'loading': Skeleton line, card 120, card 160
- error: Booking detail. Trigger: Unknown id Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx state === 'error': error.message or 'This booking could not be found.', 'Retry'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 5. Cancel a court booking

Category: COURTS. Persona: player. Money: yes.

From the booking detail, 'Cancel booking' renders only while COURT_BOOKING_TRANSITIONS allows confirmed or rescheduled to cancelled. Confirmation is a native Alert.alert; the transition runs through the court_booking_transition RPC with reason 'Cancelled by athlete'. No refund copy is shown on this path.

Release note: hidden for release per RELEASE-TODO task 5

After success: Same booking detail, now Cancelled, at atlitos://courts/booking/<id>

### Screens

**01 Booking detail**  
Route `atlitos://courts/booking/<id>`, source `apps/mobile/src/app/(tabs)/courts/booking/[id].tsx`
- See: Ghost danger button 'Cancel booking' with XCircle under the BillSummary.
- Do: Tap Cancel booking.
- Tap targets: `Cancel booking`
- Then: Native alert 'Cancel this booking' opens.

**02 Cancel this booking (native alert)**  
Route `atlitos://courts/booking/<id>`, source `apps/mobile/src/app/(tabs)/courts/booking/[id].tsx`
- See: Alert title 'Cancel this booking', body 'Are you sure you want to cancel? This slot will be released for other athletes.', buttons 'Keep booking' and destructive 'Cancel booking'.
- Do: Tap Cancel booking to confirm.
- Tap targets: `Keep booking`, `Cancel booking`
- Then: Button enters loading; transitionBooking action 'cancel' runs; screen reloads showing StatusPill 'Cancelled' and 'Reason: Cancelled by athlete'; actions disappear.

### States

- processing: Booking detail. Trigger: Confirm cancel Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx Button loading={cancelling}
- error: Booking detail, inline action error. Trigger: RPC rejects (INVALID_TRANSITION) Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx actionError caption in danger colour above the action buttons
- success: Booking detail. Trigger: Cancel succeeds Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx load() re-render with StatusPill 'Cancelled' (COURT_BOOKING_STATUS_PILL) and cancellationReason line


## 6. Reschedule a court booking

Category: COURTS. Persona: player. Money: yes.

Reschedule exists for courts. The booking detail toggles an inline 'Pick a new date' calendar and 'Pick a new time' slot picker; confirming runs the reschedule transition and the screen replaces itself with the returned booking id.

Release note: hidden for release per RELEASE-TODO task 5

After success: New booking detail at atlitos://courts/booking/<newId>

### Screens

**01 Booking detail, reschedule panel**  
Route `atlitos://courts/booking/<id>`, source `apps/mobile/src/app/(tabs)/courts/booking/[id].tsx`
- See: After tapping 'Reschedule' (label flips to 'Close reschedule'): H3 'Pick a new date' with CalendarPicker, H3 'Pick a new time' with SlotPicker chips '{from} to {to}' (three skeleton tiles while loading, 'No open slots on this date. Try another date.' when empty), button 'Confirm reschedule' disabled until a slot is chosen.
- Do: Pick date and time, tap Confirm reschedule.
- Tap targets: `Reschedule`, `Close reschedule`, `ChevronLeft`, `ChevronRight`, `day cell`, `time chip ('{from} to {to}')`, `Confirm reschedule`
- Then: transitionBooking action 'reschedule' with newDate and newSlotStart; router.replace to atlitos://courts/booking/<newId> whose pill reads 'Rescheduled'.

### States

- loading: Reschedule panel slots. Trigger: Open panel or change date Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx reschedSlotsLoading: three Skeleton tiles 92x44
- empty: Reschedule panel slots. Trigger: Date with no open slots (or slot fetch failure, which is caught to an empty list) Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx reschedSlots.length === 0: 'No open slots on this date. Try another date.'
- processing: Confirm reschedule. Trigger: Tap Confirm reschedule Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx Button loading={reschedSubmitting}
- error: Booking detail, inline action error. Trigger: Reschedule RPC rejects Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx setActionError((err as ApiError).message)


## 7. Rate a court after a completed booking

Category: COURTS. Persona: player. Money: no.

Once a booking is completed and has no rating (canRateCourtBooking), the detail renders the shared RateReviewForm; rate_court_booking RPC stores the rating and the card flips to 'Your review'.

Release note: hidden for release per RELEASE-TODO task 5 (no in-app court bookings means no completed booking to rate)

After success: Same booking detail at atlitos://courts/booking/<id> with the 'Your review' card

### Screens

**01 Booking detail, rate form**  
Route `atlitos://courts/booking/<id>`, source `apps/mobile/src/components/organisms/RateReviewForm.tsx`
- See: Card with court name, venue subtitle, caption 'Booking ID {id}', StarRating input (five lucide Star, size 32), TextField 'Remarks' with placeholder 'Tell others about your experience', button 'Submit review' disabled until a star is chosen. After submit: CheckCircle2, 'Thanks for the review', 'Your feedback helps other athletes choose with confidence.'
- Do: Tap stars, optionally type remarks, tap Submit review.
- Tap targets: `Star`, `Remarks`, `Submit review`
- Then: rateBooking runs, form shows 'Thanks for the review', screen reloads and shows 'Your review' with mono 'x.x/5' and remarks.

### States

- success: Rate form submitted. Trigger: Submit review succeeds Source: apps/mobile/src/components/organisms/RateReviewForm.tsx submitted branch 'Thanks for the review'; apps/mobile/src/app/(tabs)/courts/booking/[id].tsx booking.rating branch 'Your review'
- error: Booking detail, inline action error. Trigger: rate_court_booking rejects Source: apps/mobile/src/app/(tabs)/courts/booking/[id].tsx handleRate catch -> actionError


## 8. Court affiliate click out (release replacement for in-app booking)

Category: COURTS. Persona: guest. Money: no.

Does not exist in source yet. RELEASE-TODO task 5 (P0, Sept 9 to 12) specifies: an outbound link field on courts, an entry path to fill it, a click out screen modelled on the shop affiliate screen, and the in-app booking flow plus its deep link routes hidden. Test scenarios G-19 to G-22 and A-32 describe the target behaviour: tapping the booking action on a court detail opens the partner's external booking site, the back gesture returns to the app, a court with a missing or invalid link shows a clear state, and the detail copy must not promise in-app booking or payment. The model to copy is apps/mobile/src/app/shop/affiliate/[id].tsx: ExternalLink icon, 'Buy on {retailer}' button calling Linking.openURL(offer.affiliateUrl), disclosure line 'Prices are updated regularly. You complete the purchase on the retailer site. Atlitos may earn a commission.'

Release note: founder-open: RELEASE-TODO task 5 not started; no booking_url or equivalent column on courts or venues (grep of supabase/migrations, packages/types/src, packages/api/src), no click out screen, no data entry path (task 6). Downstream row 2 (Amaeya adds courts with affiliate links) is blocked on it.

After success: External browser (target); returning lands back on atlitos://courts/court/<id>

### Screens

**01 Court detail (to be modified)**  
Route `atlitos://courts/court/<id>`, source `apps/mobile/src/app/(tabs)/courts/court/[id].tsx`
- See: Today: date and slot pickers and 'Book this slot'. Target: an outbound 'Book on {partner}' style action with lucide ExternalLink, a disclosure line, and a missing link state.
- Do: Tap the outbound action.
- Tap targets: `Book this slot (today)`, `ExternalLink (target, per shop affiliate model)`
- Then: Target: Linking.openURL to the partner's booking site; the app stays in the stack so the back gesture returns.

### States

- empty: Court detail, missing booking link (target, G-21). Trigger: Court row with no outbound link Source: Not in source. Needed per docs/qa/RELEASE-TODO-PRASANTH.md scenario G-21


## 9. Find a coach (browse and filter by sport)

Category: COACHES. Persona: guest. Money: no.

Coach discovery is not a bottom tab. It is reached from the Trainings tab (FindCoachCard 'Find a coach', the Coaches sub tab which embeds the same list, the Payments, Analytics, My sessions and Upcoming sessions empty state CTAs), from Home AI search coach hits, or by deep link atlitos://coaching. The shared CoachBrowseList shows verified coaches near the profile city, same city first, filtered by sport chips. Guest open.

After success: Coach profile at atlitos://coaching/coach/<id> or atlitos://trainings/coach/<id>

### Screens

**01 Coaches (standalone browse)**  
Route `atlitos://coaching`, source `apps/mobile/src/app/(tabs)/coaching/index.tsx`
- See: H1 'Coaches', top right 'My sessions' link with CalendarClock, then CoachBrowseList: 'Showing coaches near {city}' (or 'Finding your location...'), chips 'All sports', 'Football', 'Cricket', 'Badminton', 'Tennis', CoachCard per coach: avatar or initial, name, filled Star with mono rating or 'New' when unrated, '{sport}, {n} yrs experience', 'From ₹{price}' in mono or 'Pricing coming soon', MapPin with city. Pull to refresh.
- Do: Filter by sport, tap a coach card.
- Tap targets: `My sessions`, `CalendarClock`, `All sports`, `Football`, `Cricket`, `Badminton`, `Tennis`, `coach card`
- Then: Card pushes atlitos://coaching/coach/<id>. 'My sessions' pushes atlitos://coaching/bookings when signed in, otherwise LoginGateModal.

**02 Trainings, Coaches tab (embedded browse)**  
Route `atlitos://trainings/coaches`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/coaches.tsx`
- See: Under the Trainings shell header and sub nav: H3 'My coaches' (cards per coach already booked: name, 'Sessions till date' mono count, 'Next session' or 'Last session' date), H3 'Browse coaches', then the same CoachBrowseList inline (scrollEnabled false, one outer ScrollView).
- Do: Tap a My coaches card or a browse card.
- Tap targets: `Coaches (sub nav)`, `coach card (accessibilityLabel 'Coach {name}')`, `Retry`
- Then: Pushes atlitos://trainings/coach/<id>, a re-export of the same coach profile screen kept inside the Trainings stack so back returns to this tab.

### States

- loading: Coach browse list. Trigger: Open or chip change Source: apps/mobile/src/components/organisms/coaching/CoachBrowseList.tsx state === 'loading': three Skeleton cards 110
- empty: Coach browse list. Trigger: No verified coach for the sport near the city Source: apps/mobile/src/components/organisms/coaching/CoachBrowseList.tsx state === 'empty': Users icon, 'No coaches found', 'No verified {sport} coaches near {city} right now. Try another sport.' or 'No verified coaches near {city} right now. Check back soon.'
- error: Coach browse list. Trigger: listCoaches throws Source: apps/mobile/src/components/organisms/coaching/CoachBrowseList.tsx state === 'error': TriangleAlert, 'Couldn't load coaches', 'Retry' with RefreshCw
- loading: Trainings Coaches tab, My coaches. Trigger: Open tab Source: apps/mobile/src/app/(tabs)/trainings/(shell)/coaches.tsx state === 'loading': Skeleton cards 72, 120, 120
- empty: Trainings Coaches tab, My coaches. Trigger: Athlete with no sessions Source: apps/mobile/src/app/(tabs)/trainings/(shell)/coaches.tsx rows.length === 0: EmptyState Users 'No coaches yet' 'Book your first session and your coaches will show up here. Browse coaches below to get started.'
- error: Trainings Coaches tab, My coaches. Trigger: listMySessions throws Source: apps/mobile/src/app/(tabs)/trainings/(shell)/coaches.tsx state === 'error': EmptyState TriangleAlert 'Could not load your coaches' with 'Retry'
- gate: Coaches, My sessions tap as guest. Trigger: Tap 'My sessions' while not signed in Source: apps/mobile/src/app/(tabs)/coaching/index.tsx requiresAuthGate -> LoginGateModal

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/06-coaches-browse.png
- docs/phases/evidence/p3-web/web-athlete-browse-coaches.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-browse-coaches-light.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-browse-coaches-dark.jpg
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png


## 10. View a coach, check availability, choose session type, frequency, date, time and details

Category: COACHES. Persona: guest. Money: no.

One screen with progressive disclosure in the PRD-01 FR-22 order: profile header, Groups section, Session type cards; Frequency chips appear once a type is chosen; Pick a date and Pick a time appear once type and frequency are chosen (slots computed by computeAvailableSessionSlots from the coach's availability windows minus get_coach_busy_slots for the type's duration); Details appears once a slot is chosen. Continue enables once type, frequency and slot are all chosen. Guest open; Continue and Join gate.

After success: atlitos://coaching/book/pay (session) or atlitos://coaching/group/join (group) or LoginGateModal (guest)

### Screens

**01 Coach profile**  
Route `atlitos://coaching/coach/<id>`, source `apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx`
- See: AppBar back, Avatar 80 with verified badge, H1 name, '{sport}, {n} yrs experience', StarRating with count, bio, specialization chips. H3 'Groups' (if any): card per group with Users icon, name, mono '₹{fee}/mo', '{n} of {capacity} spots left' or 'Group is full', attendance policy, and one of 'Join, month 1', 'Full' (disabled), 'Joined' (disabled), 'Payment pending' (disabled), 'Renew membership'. H3 'Session type': selectable cards with name, '{n} min', mono price, or 'This coach has not published session types yet.'. H3 'Frequency' chips 'One time', 'Weekly', 'Monthly'. H3 'Pick a date' CalendarPicker. H3 'Pick a time' SlotPicker chips '{from} to {to}'. H3 'Details' with TextFields 'Focus area, optional' (placeholder 'What do you want to work on') and 'Location, optional' (placeholder 'Where you would like to train'). Pinned button 'Continue, ₹{price}' or disabled 'Choose a type, date, and time'.
- Do: Tap a session type card, a frequency chip, a day, a time chip, optionally fill details, tap Continue.
- Tap targets: `Back`, `Join, month 1`, `Renew membership`, `session type card`, `One time`, `Weekly`, `Monthly`, `ChevronLeft`, `ChevronRight`, `day cell`, `time chip ('{from} to {to}')`, `Focus area, optional`, `Location, optional`, `Continue, ₹{price}`, `Choose a type, date, and time (disabled)`, `Retry`
- Then: Continue pushes atlitos://coaching/book/pay with coachId, coachName, sessionTypeId, sessionTypeName, durationMinutes, frequency, date, slotFrom, slotTo, expectedTotal, focusArea, location. As a guest it raises LoginGateModal. Join, month 1 pushes atlitos://coaching/group/join (gated); Renew membership (only for a signed in athlete with a lapsed membership) pushes atlitos://coaching/group/renew.

### States

- loading: Coach profile. Trigger: Open Source: apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx state === 'loading': Skeleton circle, two lines, card 160
- error: Coach profile. Trigger: Unknown or unverified coach id Source: apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx state === 'error': error.message or 'This coach could not be found.', 'Retry'
- empty: Coach profile, Session type. Trigger: Coach with no published session types Source: apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx coach.sessionTypes.length === 0: 'This coach has not published session types yet.' (Continue can never enable)
- loading: Coach profile, Pick a time. Trigger: Select a session type or change the date Source: apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx slotsState === 'loading': four Skeleton tiles 92x44
- empty: Coach profile, Pick a time. Trigger: Date outside the coach's availability windows or fully booked Source: apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx availableSlots.length === 0: 'No open slots on this date. Try another date.'
- error: Coach profile, Pick a time. Trigger: get_coach_busy_slots throws Source: apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx slotsState === 'error': 'Couldn't load availability for this date. Try another date or check back.'
- gate: Coach profile, Continue or Join as guest. Trigger: Tap Continue or Join, month 1 while not signed in Source: apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx handleContinue and handleJoinGroup requiresAuthGate -> LoginGateModal

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web-cycle2/web-athlete-coach-profile-sessiontypes-light.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-coach-profile-sessiontypes-dark.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-coach-profile-slots-light.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-coach-profile-slots-dark.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-booking-pick-time-details-dark.jpg
- docs/phases/evidence/p3-web/web-coach-profile-session-types-missing-BUG.jpg


## 11. Pay for a coaching session (review price, pay, processing, confirmation, failed)

Category: COACHES. Persona: player. Money: yes.

Signed in only. On mount the screen calls the book-session edge function (re-prices, PRICE_MISMATCH on a stale price, returns a Razorpay order). BillSummary renders one 'Session fee' row plus Total (platform fee is carved out of the price for sessions, unlike courts). Pay opens Razorpay, then verify-payment, then 'Session requested', because a 1:1 session is paid up front and then waits for the coach to accept.

Release note: Depends on RELEASE-TODO task 7 (live Razorpay key) and founder row 22 (Zaakpay or Razorpay). Scenario A-29 reads this BillSummary.

After success: Session detail at atlitos://coaching/booking/<id> (status Requested) or the coach browse at atlitos://coaching

### Screens

**01 Reserving your session**  
Route `atlitos://coaching/book/pay`, source `apps/mobile/src/app/(tabs)/coaching/book/pay.tsx`
- See: AppBar 'Reserving your session', skeleton line, card 140, line.
- Do: Wait.
- Tap targets: `Back`
- Then: Confirm and pay, or reserve error.

**02 Confirm and pay (review)**  
Route `atlitos://coaching/book/pay`, source `apps/mobile/src/app/(tabs)/coaching/book/pay.tsx`
- See: AppBar 'Confirm and pay', card with session type name, 'with {coachName}', '{date}, {from} to {to}', frequency label ('One time', 'Weekly', 'Monthly'), BillSummary card with row 'Session fee' and Total, inline danger row after a failed payment, pinned button 'Pay ₹{total}'.
- Do: Tap Pay.
- Tap targets: `Back`, `Pay ₹{total}`
- Then: Button spinner, Razorpay sheet opens (description 'Session with {coachName}').

**03 Razorpay checkout sheet (processing)**  
Route `atlitos://coaching/book/pay`, source `apps/mobile/src/lib/razorpay-checkout.native.ts`
- See: Native Razorpay sheet; Pay disabled with ActivityIndicator.
- Do: Complete or dismiss.
- Tap targets: `Razorpay sheet controls (native)`
- Then: Success -> verifySessionPayment -> 'Session requested'. Dismiss -> back to review with inline 'Payment was not completed.'

**04 Session requested (success)**  
Route `atlitos://coaching/book/pay`, source `apps/mobile/src/app/(tabs)/coaching/book/pay.tsx`
- See: CheckCircle2 in success tint, H1 'Session requested', '{sessionTypeName} with {coachName} on {date}, {from} to {to}.' then on a new line 'Waiting for the coach to accept.', mono 'Session ID {id}', BillSummary card, buttons 'View session' and 'Find more coaches'.
- Do: Tap View session or Find more coaches.
- Tap targets: `View session`, `Find more coaches`
- Then: View session replaces to atlitos://coaching/booking/<sessionId>; Find more coaches replaces to atlitos://coaching.

### States

- gate: Confirm and pay. Trigger: Deep link as a guest Source: apps/mobile/src/app/(tabs)/coaching/book/pay.tsx useEffect: if requiresAuthGate router.back()
- processing: Reserving your session. Trigger: Mount Source: apps/mobile/src/app/(tabs)/coaching/book/pay.tsx state === 'reserving'
- failed: Couldn't reserve this session. Trigger: book-session rejects with SLOT_TAKEN, PRICE_MISMATCH or other Source: apps/mobile/src/app/(tabs)/coaching/book/pay.tsx state === 'error' && !booking: 'This slot was just taken' + 'This coach was booked for that time first. Go back and pick another slot.' (SLOT_TAKEN); 'Couldn't reserve this session' + 'This session type changed price. Go back and choose again.' (PRICE_MISMATCH) or error.message; button 'Choose another time'
- processing: Confirm and pay. Trigger: Tap Pay Source: apps/mobile/src/app/(tabs)/coaching/book/pay.tsx Button loading={payLoading || state === 'paying'}
- failed: Confirm and pay, inline payment error. Trigger: Dismiss Razorpay or INVALID_SIGNATURE from verify Source: apps/mobile/src/app/(tabs)/coaching/book/pay.tsx error row: 'Payment could not be verified. Please try again.' or error.message or 'Payment was not completed.'; state back to 'ready'
- success: Session requested. Trigger: verify succeeds Source: apps/mobile/src/app/(tabs)/coaching/book/pay.tsx state === 'confirmed' && booking

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web-cycle2/web-athlete-booking-confirm-billsummary-light.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-booking-confirm-billsummary-dark.jpg
- docs/phases/evidence/p3-web/web-athlete-booking-billsummary-requested.jpg
- docs/phases/evidence/p3-native/native-checkout-module-loaded.png
- docs/phases/evidence/p3-native/native-checkout-payment-resolved.png


## 12. My sessions (upcoming and history) with stat tiles

Category: COACHES. Persona: player. Money: yes.

'My sessions' from the Coaches header (and 'View all' on the Trainings Stats tab when more than three upcoming). Merges 1:1 sessions and group sessions, most recent first, with four StatTiles computed from the athlete's real rows (1:1 only). This is the athlete's session history surface.

After success: Session detail at atlitos://coaching/booking/<id>

### Screens

**01 My sessions**  
Route `atlitos://coaching/bookings`, source `apps/mobile/src/app/(tabs)/coaching/bookings.tsx`
- See: AppBar 'My sessions', StatTiles 'Total sessions' (CalendarClock), 'This month' (CalendarClock), 'Hours trained' (Clock), 'Payments' (Wallet, mono ₹), then cards: session type name, StatusPill (Requested, Accepted, In progress, Declined, Completed, Cancelled, Rescheduled, Rated), 'with {coachName}', '{date}, {from} to {to}', PriceText total; group rows show group name, literal 'Group' and time only. Pull to refresh.
- Do: Tap a 1:1 session card.
- Tap targets: `Back`, `session card`, `Find a coach`, `Retry`
- Then: Pushes atlitos://coaching/booking/<id>. Group rows are plain Views, not tappable (no athlete facing group session detail exists).

### States

- loading: My sessions. Trigger: Open Source: apps/mobile/src/app/(tabs)/coaching/bookings.tsx state === 'loading': three Skeleton cards 120
- empty: My sessions. Trigger: No 1:1 sessions and no group sessions Source: apps/mobile/src/app/(tabs)/coaching/bookings.tsx state === 'empty': CalendarX2, 'No sessions yet', 'Book a coach and it will show up here.', button 'Find a coach' (router.replace to /(tabs)/coaching)
- error: My sessions. Trigger: listMySessions throws Source: apps/mobile/src/app/(tabs)/coaching/bookings.tsx state === 'error': 'Couldn't load your sessions', 'Retry'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png


## 13. Session detail: cancel a pending request (full refund), cancel an accepted session, message the coach

Category: COACHES. Persona: player. Money: yes.

The athlete's session detail (also mounted at atlitos://trainings/booking/<id> so back returns to the Trainings tab). Actions depend on status. Requested: 'Cancel request' via the cancel-session-refund edge function with an automatic full refund, and a refund card once cancelled. Accepted or Rescheduled: 'Reschedule' and 'Cancel session' (no automatic refund). 'Message coach' always renders and opens or creates the chat thread. Declined and cancelled sessions show the reason.

Release note: Scenarios A-30 and A-31 cover this screen. Message coach depends on migration 0122 being applied (UI-UPLIFT-PROPOSAL developer P0 item 4).

After success: Same session detail at atlitos://coaching/booking/<id> (or atlitos://trainings/booking/<id>), now Cancelled; Message coach lands on atlitos://chat/<threadId>

### Screens

**01 Session detail**  
Route `atlitos://coaching/booking/<id>`, source `apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx`
- See: AppBar 'Session', card with session type name, StatusPill, 'with {coachName}', '{date}, {from} to {to}', frequency label, 'Focus: {focusArea}', 'This coach could not take this session: {declineReason}' when declined, 'This session was cancelled: {reason}' when cancelled. BillSummary card ('Session fee', Total). Refund card when cancelled and a refund exists: heading 'Refunded', 'Refund on its way' or 'Refund pending', PriceText amount, caption. When requested: 'Waiting for the coach to accept. You can cancel now and get a full refund, since the coach has not responded yet.' plus ghost danger 'Cancel request' (XCircle). Secondary 'Message coach' (MessageCircle). When accepted or rescheduled: 'Reschedule' (CalendarClock) and 'Cancel session' (XCircle). RateReviewForm when completed; 'Your review' card when rated.
- Do: Tap Cancel request, Cancel session, or Message coach.
- Tap targets: `Back`, `Cancel request`, `Message coach`, `Reschedule`, `Close reschedule`, `Cancel session`, `Retry`
- Then: Cancel request opens alert 'Cancel this request'; Cancel session opens alert 'Cancel this session'; Message coach pushes atlitos://chat/<threadId> (the standalone (tabs)/chat/[id] route).

**02 Cancel this request (native alert)**  
Route `atlitos://coaching/booking/<id>`, source `apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx`
- See: Alert 'Cancel this request', body 'The coach has not responded yet. Cancelling now refunds your payment in full, automatically.', buttons 'Keep request' and destructive 'Cancel request'.
- Do: Confirm.
- Tap targets: `Keep request`, `Cancel request`
- Then: cancelRequestedSession runs; follow up alert 'Request cancelled' with 'Your full refund has been processed.' (processed), 'Your full refund is on its way. It can take a few days to reach your account.' (pending) or 'Your request has been cancelled.'; status pill becomes Cancelled and the refund card appears.

**03 Cancel this session (native alert)**  
Route `atlitos://coaching/booking/<id>`, source `apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx`
- See: Alert 'Cancel this session', body 'The coach has accepted this session. If you cancel now, the time will be released but your payment is not automatically refunded.', buttons 'Keep session' and destructive 'Cancel session'.
- Do: Confirm.
- Tap targets: `Keep session`, `Cancel session`
- Then: transitionSession action 'cancel' with reason 'Cancelled by athlete'; reload shows Cancelled.

### States

- loading: Session detail. Trigger: Open Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx state === 'loading': Skeleton line, card 120, card 160
- error: Session detail. Trigger: Unknown id or not the caller's session Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx state === 'error': error.message or 'This session could not be found.', 'Retry'
- processing: Cancel request. Trigger: Confirm the alert Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx Button loading={cancellingRequest}
- processing: Cancel session. Trigger: Confirm the alert Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx Button loading={cancelling}
- processing: Message coach. Trigger: Tap Message coach Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx Button loading={openingThread}
- error: Could not open chat (alert). Trigger: openCoachingThread throws (for example migration 0122 chat_thread_previews missing on the live project) Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx handleMessageCoach catch -> Alert.alert('Could not open chat', message)
- success: Request cancelled (alert). Trigger: cancel-session-refund succeeds Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx handleCancelRequest refundStatus branches
- success: Session detail, refund card. Trigger: Open a cancelled session that has a refund row Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx refund card using REFUND_STATUS_HEADING and REFUND_STATUS_CAPTION from apps/mobile/src/lib/refund-display.ts
- error: Session detail, inline action error. Trigger: Any transition RPC rejects Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx actionError caption in danger

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web/web-athlete-cancel-refund-result.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-session-detail-cancelled-refund-light.jpg
- docs/phases/evidence/p3-web/web-chat-player-view-thread.jpg
- docs/phases/evidence/p3-web/web-chat-player-sent-reply.jpg
- docs/phases/evidence/p3-web/web-chat-player-sees-coach-message.jpg


## 14. Reschedule a coaching session

Category: COACHES. Persona: player. Money: yes.

Reschedule exists for the athlete on accepted or rescheduled sessions. The panel recomputes slots from the coach's availability windows and the original session type's duration minus busy slots. Confirming inserts a new session row and the screen replaces itself with the returned id.

After success: New session detail at atlitos://coaching/booking/<newId>

### Screens

**01 Session detail, reschedule panel**  
Route `atlitos://coaching/booking/<id>`, source `apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx`
- See: After 'Reschedule' (flips to 'Close reschedule'): H3 'Pick a new date' CalendarPicker, H3 'Pick a new time' SlotPicker chips '{from} to {to}' or 'No open slots on this date. Try another date.', button 'Confirm reschedule' disabled until a slot is chosen.
- Do: Pick date and time, tap Confirm reschedule.
- Tap targets: `Reschedule`, `Close reschedule`, `ChevronLeft`, `ChevronRight`, `day cell`, `time chip ('{from} to {to}')`, `Confirm reschedule`
- Then: transitionSession action 'reschedule'; router.replace to atlitos://coaching/booking/<newId> with pill 'Rescheduled'.

### States

- loading: Reschedule panel slots. Trigger: Open panel or change date Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx reschedSlotsLoading: three Skeleton tiles 92x44
- empty: Reschedule panel slots. Trigger: No slots (also when the coach or type lookup fails, caught to empty) Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx reschedSlots.length === 0
- processing: Confirm reschedule. Trigger: Tap Confirm reschedule Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx Button loading={reschedSubmitting}
- error: Session detail, inline action error. Trigger: Reschedule rejects (SLOT_TAKEN, INVALID_TRANSITION) Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx handleConfirmReschedule catch


## 15. Rate a coach after a completed session

Category: COACHES. Persona: player. Money: no.

Once the coach marks the session complete (status completed), SESSION_TRANSITIONS allows completed to rated and the athlete's session detail renders RateReviewForm. rate_session stores it; the pill becomes Rated and 'Your review' shows.

Release note: Scenario A-30 opens a completed session and looks for the rate action.

After success: Same session detail at atlitos://coaching/booking/<id> with the 'Your review' card

### Screens

**01 Session detail, rate form**  
Route `atlitos://coaching/booking/<id>`, source `apps/mobile/src/components/organisms/RateReviewForm.tsx`
- See: Card with coach name, session type subtitle, 'Booking ID {id}', StarRating input (five lucide Star, size 32), TextField 'Remarks' (placeholder 'Tell others about your experience'), 'Submit review' disabled until a star is picked; after submit CheckCircle2, 'Thanks for the review', 'Your feedback helps other athletes choose with confidence.'
- Do: Tap stars, type remarks, tap Submit review.
- Tap targets: `Star`, `Remarks`, `Submit review`
- Then: rateSession runs; reload shows StatusPill 'Rated' and a 'Your review' card with mono 'x.x/5' and remarks.

### States

- success: Rate form submitted. Trigger: Submit succeeds Source: apps/mobile/src/components/organisms/RateReviewForm.tsx submitted branch; apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx session.rating branch 'Your review'
- error: Session detail, inline action error. Trigger: rate_session rejects (already rated, not completed) Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx handleRate catch -> actionError

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web/web-athlete-completed-session-billsummary-rating-form.jpg
- docs/phases/evidence/p3-web/web-athlete-rating-5star-filled.jpg
- docs/phases/evidence/p3-web/web-athlete-rating-submitted.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-session-detail-rated-light.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-session-detail-rated-dark.jpg


## 16. Join a training group (month 1)

Category: TRAINING GROUPS. Persona: player. Money: yes.

From the coach profile's Groups section. joinGroup (edge function) creates a pending membership under the group's capacity lock and returns a Razorpay order; the shared GroupMembershipPayScreen shows BillSummary ('Monthly fee', Total), opens Razorpay (description '{groupName} membership'), verifies, then 'You are in'. Membership fares carve the platform fee out of the price.

Release note: Scenario T-12 in TEST-SUITE-ATHLETE-APP.md was NOT RUN because it moves money.

After success: Trainings Stats tab at atlitos://trainings (My groups card shows the membership) or the coach browse at atlitos://coaching

### Screens

**01 Join group (reserving)**  
Route `atlitos://coaching/group/join`, source `apps/mobile/src/app/(tabs)/coaching/group/join.tsx`
- See: AppBar 'Join group' with skeletons while joinGroup runs.
- Do: Wait.
- Tap targets: `Back`
- Then: Review, or reserve error.

**02 Join group (review and pay)**  
Route `atlitos://coaching/group/join`, source `apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx`
- See: AppBar 'Join group', card with group name, 'with {coachName}, monthly membership', attendance policy caption, BillSummary card with row 'Monthly fee' and Total, inline error row after a failed payment, pinned 'Pay ₹{total}'.
- Do: Tap Pay.
- Tap targets: `Back`, `Pay ₹{total}`
- Then: Razorpay sheet (description '{groupName} membership'), then verifyMembershipPayment.

**03 You are in (success)**  
Route `atlitos://coaching/group/join`, source `apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx`
- See: CheckCircle2, H1 'You are in', 'Month 1 of {groupName} is paid. The coach will confirm your spot.', BillSummary, buttons 'Go to my trainings' and 'Find more coaches'.
- Do: Tap a button.
- Tap targets: `Go to my trainings`, `Find more coaches`
- Then: Go to my trainings replaces to atlitos://trainings (Stats tab, My groups card); Find more coaches replaces to atlitos://coaching.

### States

- gate: Join group. Trigger: Deep link as a guest Source: apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx useEffect requiresAuthGate -> router.back()
- processing: Join group. Trigger: Mount Source: apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx state === 'reserving'
- failed: Couldn't reserve this membership. Trigger: joinGroup rejects Source: apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx state === 'error' && !reserved: 'This group is full' + 'Every seat in this group is taken. Check back if a spot opens up.' (GROUP_FULL); 'You are already a member' (ALREADY_MEMBER); 'This group is no longer active' + 'The coach closed this group to new members.' (GROUP_INACTIVE); 'The monthly fee changed. Go back and try again.' (PRICE_MISMATCH); else 'Couldn't reserve this membership'; button 'Go back'
- processing: Join group, Pay. Trigger: Tap Pay Source: apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx Button loading={payLoading || state === 'paying'}
- failed: Join group, inline payment error. Trigger: Dismiss Razorpay or INVALID_SIGNATURE Source: apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx error row 'Payment could not be verified. Please try again.' or 'Payment was not completed.'
- success: You are in. Trigger: verifyMembershipPayment succeeds Source: apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx state === 'confirmed' with confirmedTitle 'You are in' (join.tsx)


## 17. Renew a lapsed group membership

Category: TRAINING GROUPS. Persona: player. Money: yes.

Manual renewal (no autopay). Reached from the Trainings Stats tab 'My groups' card 'Renew' button on a lapsed membership, or the coach profile's 'Renew membership' button. renewMembership re-links the same membership to a new intent and re-prices server side; same GroupMembershipPayScreen as join (Razorpay description '{groupName} membership renewal').

After success: Trainings Stats tab at atlitos://trainings with My groups showing 'Active until {date}'

### Screens

**01 Renew membership**  
Route `atlitos://coaching/group/renew`, source `apps/mobile/src/app/(tabs)/coaching/group/renew.tsx`
- See: AppBar 'Renew membership', card with group name and 'Renew for another month', BillSummary 'Monthly fee' and Total, pinned 'Pay ₹{total}'. Success: H1 'Membership renewed', 'Your next month of {groupName} is paid.', buttons 'Go to my trainings' and 'Find more coaches'.
- Do: Tap Pay, complete Razorpay.
- Tap targets: `Back`, `Pay ₹{total}`, `Go to my trainings`, `Find more coaches`, `Go back`
- Then: Membership returns to Active; Go to my trainings replaces to atlitos://trainings.

### States

- processing: Renew membership. Trigger: Mount and on Pay Source: apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx 'reserving' and 'paying' states
- failed: Renew membership. Trigger: renewMembership rejects or payment dismissed Source: apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx same error and inline error branches as join
- success: Membership renewed. Trigger: verify succeeds Source: apps/mobile/src/app/(tabs)/coaching/group/renew.tsx confirmedTitle 'Membership renewed'


## 18. Athlete Trainings dashboard (Stats tab): upcoming sessions, requests, groups, milestones, review videos

Category: TRAININGS. Persona: player. Money: yes.

The Trainings bottom tab renders a fixed shell (H1 'Trainings', Settings icon, sub nav) and the Stats tab is the athlete dashboard. It is the athlete's 'upcoming session' and 'session request' overview and the home for group memberships and Learn milestones. Guests see a locked EmptyState; pending or rejected coaches see CoachVerificationStatus instead; verified coaches see the coach dashboard.

Release note: UI-UPLIFT-PROPOSAL designer P0 item 6 proposes re-laying the stat tiles; developer P0 item 5 flags that players can still deep link to coach only tabs (Earnings, Trainees). Scenario A-27 checks the stat tiles against history.

After success: Stays on atlitos://trainings; drill ins push above the shell and pop back to it

### Screens

**01 Trainings, Stats tab (athlete dashboard)**  
Route `atlitos://trainings`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx`
- See: Shell ((shell)/_layout.tsx): H1 'Trainings', Settings icon (accessibilityLabel 'Settings', pushes /settings), sub nav 'Stats', 'Coaches', 'Payments', 'Chat', 'Analytics'. Content: H2 'Your trainings at a glance', 'Your growth, goals and game, all in one place.', PlayerStatsGrid tiles 'Total sessions' (CalendarCheck2), 'This month' (CalendarClock), 'Hours trained' (Clock), 'Payments done' (Wallet), 'My sports' card ('Add sport', lucide Plus) when the profile has sports, 'My groups' cards (StatusPill Active or Lapsed, 'Active until {date}' or 'Lapsed since {date}', mono '₹{total}/mo', 'Renew' when lapsed), FindCoachCard 'Find a coach' with Search icon and ChevronRight (above the list when no sessions, below otherwise), 'Upcoming sessions' SessionCards (coach name, session type, date, time, focus, location; group rows show group name and 'Group') with 'View all' when more than 3, 'Session requests' SessionCards with caption 'Awaiting coach response. Tap to view or cancel.', 'Milestones and rewards' rail with 'Open Learn', secondary button 'My review videos' (Film, ChevronRight). Pull to refresh.
- Do: Tap a session card, a request card, Renew, Find a coach, View all, My review videos, Add sport, or a sub nav tab.
- Tap targets: `Trainings (bottom nav, lucide Dumbbell)`, `Settings`, `Stats`, `Coaches`, `Payments`, `Chat`, `Analytics`, `Find a coach`, `View all`, `upcoming session card`, `request session card`, `Renew`, `Open Learn`, `My review videos`, `Add sport`, `Get started`, `Retry`
- Then: Upcoming 1:1 card pushes atlitos://trainings/session/<id> (which redirects an athlete to atlitos://trainings/booking/<id>); request card pushes atlitos://coaching/booking/<id>; View all pushes atlitos://coaching/bookings; Find a coach pushes atlitos://coaching; Renew pushes atlitos://coaching/group/renew; My review videos pushes atlitos://trainings/my-videos; Open Learn pushes /learn; Add sport pushes /profile; Settings pushes /settings.

### States

- gate: Trainings, guest. Trigger: Open Trainings while not signed in Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx requiresAuthGate: EmptyState Lock 'Set up your profile to train' 'Book coaches, track sessions and see your progress once you have an account.' CTA 'Get started' -> LoginGateModal; sub nav hidden by (shell)/_layout.tsx
- gate: Trainings, pending or rejected coach. Trigger: Signed in with coachStatus pending_review or rejected Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx isPendingOrRejectedCoach -> CoachVerificationStatus: Clock 'Submitted for review' 'We are reviewing your certificates and profile. You will be able to receive session requests once approved.' or TriangleAlert 'Your coach application was not approved' + rejectionReason + 'Edit and resubmit' (pushes coach-setup step 0); sub nav hidden
- loading: Trainings, Stats tab. Trigger: Signed in, profile still loading, or dashboard fetch Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx showLoading skeleton; playerState === 'loading': three tile skeletons 96 plus cards 140, 140, 72
- error: Trainings, Stats tab. Trigger: me fetch fails or listMySessions throws Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx meError: EmptyState TriangleAlert 'Could not load your dashboard' 'Check your connection and try again.' 'Retry'; playerState === 'error': same title with error.message
- empty: Upcoming sessions section. Trigger: No accepted future 1:1 or group session Source: apps/mobile/src/components/organisms/trainings/PlayerUpcomingSessions.tsx EmptyState CalendarClock 'No upcoming sessions' 'Book a coach and your confirmed sessions will show up here.' CTA 'Find a coach'
- empty: Session requests section. Trigger: No requested session Source: apps/mobile/src/components/organisms/trainings/PlayerSessionRequests.tsx EmptyState Inbox 'No pending requests' 'When you request a session it waits here until the coach accepts.'
- empty: Milestones and rewards. Trigger: No Learn milestones Source: apps/mobile/src/components/organisms/trainings/MilestonesRail.tsx EmptyState Trophy 'No milestones yet' 'Complete drills in Learn to earn XP and unlock milestones.' CTA 'Open Learn'
- empty: My groups. Trigger: No active or lapsed membership Source: apps/mobile/src/components/organisms/trainings/MyGroupsCard.tsx returns null when rows.length === 0 (section hidden)

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/03-trainings-guest-gate.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 19. Trainings Payments tab (session payment history)

Category: TRAININGS. Persona: player. Money: yes.

Read only money history: every session row the athlete paid for, with two StatTiles and a Transactions list. Cancelled and declined rows stay visible with their status pill. Tapping a row opens the session detail inside the Trainings stack.

After success: Session detail at atlitos://trainings/booking/<id>; back returns to the Payments tab

### Screens

**01 Trainings, Payments tab**  
Route `atlitos://trainings/payments`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/payments.tsx`
- See: StatTiles 'Paid for sessions held' (Wallet) and 'Booked ahead' (ReceiptIndianRupee) in mono ₹, H3 'Transactions', cards with coach name, PriceText total, '{date}, {sessionTypeName}', StatusPill. Pull to refresh.
- Do: Tap a transaction.
- Tap targets: `Payments`, `transaction card (accessibilityLabel 'Payment to {coach} on {date}')`, `Find a coach`, `Retry`
- Then: Pushes atlitos://trainings/booking/<id>.

### States

- loading: Payments tab. Trigger: Open Source: apps/mobile/src/app/(tabs)/trainings/(shell)/payments.tsx state === 'loading': two tile skeletons 96, two card skeletons 88
- empty: Payments tab. Trigger: No paid session Source: apps/mobile/src/app/(tabs)/trainings/(shell)/payments.tsx sessions.length === 0: EmptyState ReceiptIndianRupee 'No payments yet' 'Book a session with a coach and your payment history will show up here.' CTA 'Find a coach'
- error: Payments tab. Trigger: listMySessions throws Source: apps/mobile/src/app/(tabs)/trainings/(shell)/payments.tsx state === 'error': EmptyState TriangleAlert 'Could not load your payments' 'Retry'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 20. Trainings Chat tab and chat thread

Category: TRAININGS. Persona: player. Money: no.

The Chat sub tab embeds the shared ChatThreadList; a thread opens at atlitos://trainings/chat-thread/<id>, a re-export of the standalone (tabs)/chat/[id] screen kept inside the Trainings stack. Threads only exist once a session links the athlete and coach.

Release note: UI-UPLIFT-PROPOSAL developer P0 item 4 and the p9 walkthrough README finding 3: Messages shows a raw Postgres error until migration 0122 is applied (RELEASE-TODO task 8).

After success: Back to atlitos://trainings/chat

### Screens

**01 Trainings, Chat tab**  
Route `atlitos://trainings/chat`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/chat.tsx`
- See: ChatThreadList rows; a 'Reconnecting' or 'Disconnected' pill when realtime drops.
- Do: Tap a thread.
- Tap targets: `Chat`, `thread row`, `Sign in`, `Retry`
- Then: Pushes atlitos://trainings/chat-thread/<id>.

**02 Chat thread**  
Route `atlitos://trainings/chat-thread/<id>`, source `apps/mobile/src/app/(tabs)/trainings/chat-thread/[id].tsx`
- See: Same screen as atlitos://chat/<id> (apps/mobile/src/app/(tabs)/chat/[id].tsx): AppBar with the thread title, member count row with ChevronRight for group threads, message list, CloudOff pill 'Reconnecting, messages may be delayed' or 'Disconnected, pull down to reload' when realtime drops, composer TextInput (placeholder 'Message', accessibilityLabel 'Message input') and a Send button (lucide Send, accessibilityLabel 'Send message') disabled until the draft has text.
- Do: Type and send.
- Tap targets: `Back`, `Message input`, `Send message`
- Then: Optimistic row appears, then confirms; back pops to the Chat tab with the shell intact.

### States

- gate: Chat tab, guest. Trigger: Not signed in Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx EmptyState 'Sign in to see your messages' 'Chat opens once you have a session with a coach or player.' CTA 'Sign in'
- error: Chat tab. Trigger: chat_thread_previews missing on live project (migration 0122 unapplied) Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx EmptyState 'Messages could not load' with error.message and 'Retry'
- empty: Chat tab. Trigger: No thread yet Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx EmptyState 'No messages yet' 'Once you have a session with a coach or player, your conversation shows up here.'
- empty: Chat thread. Trigger: Thread with no messages Source: apps/mobile/src/app/(tabs)/chat/[id].tsx EmptyState 'Say hello' 'Send the first message to {name}.'
- error: Chat thread. Trigger: Thread fetch fails or not a member Source: apps/mobile/src/app/(tabs)/chat/[id].tsx EmptyState 'Conversation could not load'
- processing: Chat thread, send. Trigger: Tap Send message Source: apps/mobile/src/app/(tabs)/chat/[id].tsx sending state disables the Send button; on failure the optimistic row is dropped and the draft restored

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web/web-chat-player-view-thread.jpg
- docs/phases/evidence/p3-web/web-chat-player-sent-reply.jpg
- docs/phases/evidence/p3-web/web-chat-player-sees-coach-message.jpg


## 21. Trainings Analytics tab (athlete trends)

Category: TRAININGS. Persona: player. Money: no.

Token styled bar readouts per month of sessions held and hours trained plus an XP tile from Learn; below PLAYER_INSUFFICIENT_THRESHOLD (3) held sessions it shows an insufficient data state. Verified coaches see the coach analytics variant on the same route instead.

After success: Stays on atlitos://trainings/analytics

### Screens

**01 Trainings, Analytics tab**  
Route `atlitos://trainings/analytics`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/analytics.tsx`
- See: StatTiles 'Sessions held', 'Hours trained', 'XP' (when Learn loads), then one card per month labelled with a short month and year (Intl en-IN), each with BarRows 'Sessions' and 'Hours trained'.
- Do: Read.
- Tap targets: `Analytics`, `Find a coach`, `Retry`
- Then: Find a coach pushes atlitos://coaching.

### States

- loading: Analytics tab. Trigger: Open Source: apps/mobile/src/app/(tabs)/trainings/(shell)/analytics.tsx state === 'loading': Skeleton cards 96 and 140
- error: Analytics tab. Trigger: listMySessions throws Source: apps/mobile/src/app/(tabs)/trainings/(shell)/analytics.tsx EmptyState TriangleAlert 'Could not load your analytics' 'Retry'
- empty: Analytics tab. Trigger: Fewer than PLAYER_INSUFFICIENT_THRESHOLD (3) held sessions Source: apps/mobile/src/app/(tabs)/trainings/(shell)/analytics.tsx EmptyState ChartNoAxesCombined 'Not enough sessions yet' 'Complete at least 3 sessions to see your trends here.' CTA 'Find a coach'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 22. My review videos (coach posted trainee videos)

Category: TRAININGS. Persona: player. Money: no.

Read only list of videos a coach has posted to review this athlete's training, newest first, reached from the Stats tab 'My review videos' row. Tapping plays in a full screen native Modal (expo-video VideoView with native controls).

Release note: Empty title 'No data found' is generic; scenario T-09 in TEST-SUITE-ATHLETE-APP.md passed with 6 videos.

After success: Back to atlitos://trainings Stats tab

### Screens

**01 My review videos**  
Route `atlitos://trainings/my-videos`, source `apps/mobile/src/app/(tabs)/trainings/my-videos.tsx`
- See: AppBar 'My review videos', rows with Film icon, caption or 'Review video', created date; inline danger line if a playback URL fails.
- Do: Tap a row.
- Tap targets: `Back`, `row (accessibilityLabel 'Play review video')`, `Close video (X)`, `Retry`
- Then: Modal with VideoView and native controls; X (accessibilityLabel 'Close video') closes.

### States

- loading: My review videos. Trigger: Open Source: apps/mobile/src/app/(tabs)/trainings/my-videos.tsx state === 'loading': two Skeleton cards 64
- empty: My review videos. Trigger: No video posted Source: apps/mobile/src/app/(tabs)/trainings/my-videos.tsx EmptyState Film 'No data found' 'Videos your coach posts to review your training will show up here.'
- error: My review videos. Trigger: list throws Source: apps/mobile/src/app/(tabs)/trainings/my-videos.tsx state === 'error': 'Could not load videos' 'Retry'
- error: My review videos, playback. Trigger: getPlaybackUrl throws Source: apps/mobile/src/app/(tabs)/trainings/my-videos.tsx playbackError row: TriangleAlert + message or 'Could not load this video.'


## 23. What attendance maps to: session start, complete, rate (athlete has no check in)

Category: ATTENDANCE. Persona: player. Money: no.

There is no athlete check in or attendance marking anywhere in the athlete app. For 1:1 sessions the lifecycle is requested (paid) -> accepted (coach) -> completed (coach taps 'Mark complete', complete-session edge function, TOO_EARLY gated) -> rated (athlete). The athlete watches status pills change on My sessions, the Trainings Stats tab, Payments and the session detail, and gets the rate form once completed. For group sessions the coach taps 'Start session', toggles 'Present' or 'Absent' per member and taps 'Mark attendance' then 'End session' on the coach only group session screen; the athlete sees the group session only as an inert 'Group' row in Upcoming sessions and My sessions, with no attendance readout. Attendance history for the athlete equals the session history on My sessions and the Payments tab.

Release note: No athlete attendance feature exists; the guide should describe attendance as coach driven session completion.

After success: Athlete: session detail at atlitos://coaching/booking/<id> shows Completed then Rated

### Screens

**01 My sessions (athlete view of status)**  
Route `atlitos://coaching/bookings`, source `apps/mobile/src/app/(tabs)/coaching/bookings.tsx`
- See: StatusPill per session: Requested, Accepted, In progress, Completed, Rated, Declined, Cancelled, Rescheduled.
- Do: Tap a completed session to rate it.
- Tap targets: `session card`
- Then: atlitos://coaching/booking/<id> with the rate form.

**02 Coach session detail (coach marks complete, reference only)**  
Route `atlitos://trainings/session/<id>`, source `apps/mobile/src/app/(tabs)/trainings/session/[id].tsx`
- See: Coach side: athlete name, StatusPill, 'You earn' PriceText, buttons 'Mark complete' (CheckCircle2), 'Reschedule' / 'Close reschedule', 'Cancel session' / 'Close cancel' with 'Reason for cancelling' field and 'Confirm cancel' (native alert 'Cancel this session', 'The athlete will be notified and this slot will be released.', 'Keep session' / 'Cancel session'). If an athlete opens this route for their own session it redirects (router.replace) to atlitos://trainings/booking/<id>.
- Do: Coach taps Mark complete.
- Tap targets: `Mark complete`, `Reschedule`, `Close reschedule`, `Cancel session`, `Close cancel`, `Reason for cancelling`, `Confirm cancel`, `Keep session`
- Then: Session becomes Completed; the athlete's detail now shows RateReviewForm.

**03 Coach group session detail (coach marks attendance, reference only)**  
Route `atlitos://trainings/group-session/<id>`, source `apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx`
- See: Coach side: 'Group session' AppBar, date and time, 'Start session' (Play), H3 'Attendance' with per member Avatar, 'Present' / 'Absent' toggles (or 'Not marked'), StickyNote button 'Add notes for {name}', 'Mark attendance', 'End session'.
- Do: Coach only.
- Tap targets: `Start session`, `Present`, `Absent`, `Add notes for {name}`, `Mark attendance`, `End session`
- Then: mark_attendance RPC; no money effect; athlete sees nothing beyond the session status.

### States

- success: Session detail. Trigger: Coach marks complete Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx canRate = canTransition(SESSION_TRANSITIONS, 'completed', 'rated') renders RateReviewForm; packages/types/src/transitions/index.ts completed: ['rated']
- gate: Coach group session detail. Trigger: Athlete deep links to group-session/<id> or group/<id> Source: apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx getGroupSession (packages/api/src/use-groups.ts .eq('coach_id', userId)) returns null -> 'This session could not be found.'; apps/mobile/src/app/(tabs)/trainings/group/[id].tsx compares group.coachId to the auth user -> 'This group could not be found.'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web/web-coach-session-mark-complete-earn990.jpg
- docs/phases/evidence/p3-web/web-coach-mark-complete-payment-not-captured.jpg
- docs/phases/evidence/p3-web-cycle2/web-coach-session-detail-dark.jpg


## 24. Guest login gates across Courts, Coaches and Trainings

Category: STATES. Persona: guest. Money: no.

Guests can browse courts, court details, coaches and coach profiles. Every mutating tap raises LoginGateModal (a bottom sheet via the root Portal, not a native Modal): 'My bookings', 'Book this slot', 'My sessions', 'Continue, ₹x', 'Join, month 1', and the Trainings tab's 'Get started'. The pay and join screens bounce a guest straight back if reached by deep link.

Release note: UI-UPLIFT-PROPOSAL developer P0 item 3 and the p9 walkthrough finding 2: LoginGateModal persists across deep link navigation, including over Login itself.

After success: atlitos://login or atlitos://register, then back to the gated screen

### Screens

**01 LoginGateModal (bottom sheet)**  
Route `overlay on the gated screen`, source `apps/mobile/src/components/organisms/LoginGateModal.tsx`
- See: Scrim (accessibilityLabel 'Close'), sheet (LoginGateSheet.tsx) with X close button (accessibilityLabel 'Close'), H2 'Want to hit the spotlight?', body 'Sign in to book sessions, track progress and join the community.', primary 'Login', secondary 'Register'.
- Do: Tap Login or Register.
- Tap targets: `Login`, `Register`, `Close`
- Then: Login pushes atlitos://login; Register pushes atlitos://register; the gated screen stays mounted underneath so the user returns to it after auth (PRD-01 FR-4).

### States

- gate: Courts tab, My bookings. Trigger: Guest tap Source: apps/mobile/src/app/(tabs)/courts/index.tsx requiresAuthGate -> setGateVisible(true)
- gate: Court detail, Book this slot. Trigger: Guest tap Source: apps/mobile/src/app/(tabs)/courts/court/[id].tsx handleBook
- gate: Coaches, My sessions. Trigger: Guest tap Source: apps/mobile/src/app/(tabs)/coaching/index.tsx requiresAuthGate -> setGateVisible(true)
- gate: Coach profile, Continue and Join. Trigger: Guest tap Source: apps/mobile/src/app/(tabs)/coaching/coach/[id].tsx handleContinue, handleJoinGroup
- gate: Trainings tab. Trigger: Guest opens the tab Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx EmptyState Lock 'Set up your profile to train' CTA 'Get started'
- gate: Pay and join screens by deep link. Trigger: Guest opens courts/book/pay, coaching/book/pay, coaching/group/join or renew Source: router.back() in useEffect of apps/mobile/src/app/(tabs)/courts/book/pay.tsx, apps/mobile/src/app/(tabs)/coaching/book/pay.tsx, apps/mobile/src/components/organisms/trainings/GroupMembershipPayScreen.tsx

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/03-trainings-guest-gate.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png


## 25. Coach only drill ins that share the Trainings route group (not athlete surfaces)

Category: TRAININGS. Persona: coach. Money: no.

These routes live under (tabs)/trainings but are coach facing: upcoming (coach's accepted and group sessions with 'All', 'One on one', 'Group', 'Online' filter chips), requests (pending requests with the same chips and 'Accept' / 'Decline'), verification ('Coach verification' status, 'Start coach setup'), group/[id] (coach's group profile, asserts ownership) and group-session/[id] (attendance). The athlete equivalents are My sessions (atlitos://coaching/bookings), the Stats tab 'Session requests' section, and nothing for groups (group rows are inert). A player who deep links to these gets the coach RPC errors or 'could not be found' states; UI-UPLIFT-PROPOSAL developer P0 item 5 asks to hide them per role.

Release note: Role gating of these routes for players is an open UI-UPLIFT-PROPOSAL developer P0 item 5 (deferred to the uplift pass).

After success: Back to atlitos://trainings

### Screens

**01 Upcoming sessions (coach)**  
Route `atlitos://trainings/upcoming`, source `apps/mobile/src/app/(tabs)/trainings/upcoming.tsx`
- See: AppBar 'Upcoming sessions', SessionFilterChips 'All', 'One on one', 'Group', 'Online', SessionCards (group rows labelled 'Group session'); empty 'No upcoming sessions' 'Accepted sessions and scheduled group sessions will show up here.'; per filter empty 'No upcoming group sessions.', 'No upcoming online sessions.', 'No upcoming sessions match this filter.'
- Do: Coach only.
- Tap targets: `Back`, `All`, `One on one`, `Group`, `Online`, `session card`, `Retry`
- Then: Pushes atlitos://trainings/session/<id> or atlitos://trainings/group-session/<id>.

**02 Requests (coach)**  
Route `atlitos://trainings/requests`, source `apps/mobile/src/app/(tabs)/trainings/requests.tsx`
- See: AppBar 'Requests', SessionFilterChips 'All', 'One on one', 'Group', 'Online', pending SessionCards variant request with 'Accept' and 'Decline'; 'Updating...' caption while acting; empty 'No pending requests'.
- Do: Coach only.
- Tap targets: `Back`, `All`, `One on one`, `Group`, `Online`, `Accept`, `Decline`, `session card`, `Retry`
- Then: acceptSession or declineSession; card tap pushes atlitos://trainings/session/<id>.

**03 Coach verification**  
Route `atlitos://trainings/verification`, source `apps/mobile/src/app/(tabs)/trainings/verification.tsx`
- See: AppBar 'Coach verification', CoachVerificationStatus ('Submitted for review', 'Your coach application was not approved' with 'Edit and resubmit', or 'You are a verified coach'), or 'You have not started coach setup yet' with 'Start coach setup'.
- Do: Coach only.
- Tap targets: `Back`, `Start coach setup`, `Edit and resubmit`, `Retry`
- Then: Start coach setup and Edit and resubmit push the coach setup wizard step 0 (/(onboarding)/coach-setup/[step]).

### States

- empty: Upcoming sessions (coach). Trigger: Nothing accepted Source: apps/mobile/src/app/(tabs)/trainings/upcoming.tsx state === 'empty' CalendarX2 'No upcoming sessions'
- empty: Requests (coach). Trigger: No pending request Source: apps/mobile/src/app/(tabs)/trainings/requests.tsx state === 'empty' CalendarX2 'No pending requests'
- error: Any coach drill in opened by a player. Trigger: Player deep links Source: docs/qa/TEST-SUITE-ATHLETE-APP.md T-11 'NOT_COACH' at API; docs/design/UI-UPLIFT-PROPOSAL.md developer P0 item 5 'caller holds no coach profile'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web/web-coach-trainings-requests.jpg
- docs/phases/evidence/p3-web/web-coach-accept-request.jpg
- docs/phases/evidence/p3-web/web-coach-decline-request-nopending.jpg
- docs/phases/evidence/p3-web-cycle2/web-coach-trainings-dark.jpg
- docs/phases/evidence/p10-groups-integration/coach-trainees-cric-squad.png


## 26. Search for a coach or court from Home AI search

Category: COACHES. Persona: guest. Money: no.

The Home tab's AI SearchBar pushes /home/search. Results are segmented ('Coaches', 'Courts', 'Gear', 'Athletes', 'Clips'); a coach hit pushes the coach profile and a court hit pushes the court detail, so this is the only text search entry into both surfaces. Guest open, nothing mutates. Searches near the profile or device city.

After success: Coach profile at atlitos://coaching/coach/<id> or court detail at atlitos://courts/court/<id>

### Screens

**01 Search**  
Route `atlitos://home/search`, source `apps/mobile/src/app/home/search.tsx`
- See: AppBar 'Search', autofocused AI SearchBar (lucide Sparkles), caption 'Searching near {city}'. Idle: 'Suggested' chips ('Courts near me', 'Badminton gear', 'Coaches under 500', 'Athletes to support'), 'Recent searches' with Clock rows and 'Clear', SearchX with 'Find coaches, courts, gear, athletes and clips' and 'Try "badminton coach near me" or "cricket bat under 1500".'. Results: SearchResults segment chips and rows with title, subtitle, image, mono price, rank reason.
- Do: Type a query and submit, or tap a suggestion, then tap a result.
- Tap targets: `Back`, `search input`, `Courts near me`, `Badminton gear`, `Coaches under 500`, `Athletes to support`, `Clear`, `recent search row`, `Coaches`, `Courts`, `result row`, `Retry`
- Then: Coach hit pushes atlitos://coaching/coach/<id>; court hit pushes atlitos://courts/court/<id> (openHit in search.tsx).

### States

- loading: Search. Trigger: Submit a query Source: apps/mobile/src/app/home/search.tsx state === 'loading': centred ActivityIndicator
- error: Search. Trigger: Search RPC throws Source: apps/mobile/src/app/home/search.tsx state === 'error': TriangleAlert, 'Couldn't run that search', error.message, 'Retry'
- empty: Search results. Trigger: No hit for the query Source: apps/mobile/src/app/home/search.tsx SearchResults emptyLabel 'No matches for "{query}" near {city}. Try another search.' (or the broaden hint)


## 27. Pending or rejected coach opens the Trainings tab (verification status)

Category: TRAININGS. Persona: coach. Money: no.

A signed in user whose coachStatus is pending_review or rejected does not get the athlete dashboard or the coach dashboard. The Stats tab renders CoachVerificationStatus in place of content and the shell hides the sub nav. Covers RELEASE-TODO C-06 (open Trainings right after submitting the wizard), C-08 (pull to refresh after admin approval) and C-09 (rejected coach sign in). The same organism renders on the atlitos://trainings/verification drill in.

After success: Stays on atlitos://trainings, or the coach setup wizard step 0

### Screens

**01 Trainings, Stats tab (verification status)**  
Route `atlitos://trainings`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx`
- See: Shell H1 'Trainings' and Settings icon, no sub nav. Pending: Clock icon, 'Submitted for review', 'We are reviewing your certificates and profile. You will be able to receive session requests once approved.'. Rejected: TriangleAlert, 'Your coach application was not approved', the rejection reason, button 'Edit and resubmit'.
- Do: Read; rejected coach taps Edit and resubmit.
- Tap targets: `Trainings (bottom nav, lucide Dumbbell)`, `Settings`, `Edit and resubmit`
- Then: Edit and resubmit pushes /(onboarding)/coach-setup/[step] with step 0. Once an admin verifies, refreshMe flips the tab to the coach dashboard.

### States

- gate: Trainings, Stats tab. Trigger: coachStatus pending_review Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx isPendingOrRejectedCoach -> apps/mobile/src/components/organisms/CoachVerificationStatus.tsx 'Submitted for review'
- failed: Trainings, Stats tab. Trigger: coachStatus rejected Source: apps/mobile/src/components/organisms/CoachVerificationStatus.tsx status === 'rejected': 'Your coach application was not approved', rejectionReason, 'Edit and resubmit'
- loading: Trainings, Stats tab. Trigger: Profile still loading Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx showLoading skeleton


## 28. Open the athlete session detail from inside the Trainings module

Category: TRAININGS. Persona: player. Money: yes.

Stats tab upcoming cards push atlitos://trainings/session/<id>; that coach screen detects the caller is the session's player and router.replace()s to atlitos://trainings/booking/<id>. Payments tab rows push atlitos://trainings/booking/<id> directly. trainings/booking/[id].tsx re-exports the coaching session detail, so every athlete action (cancel request with refund, cancel session, reschedule, rate, message coach) works here and back pops to the Trainings tab that opened it instead of leaving the module.

After success: Back to atlitos://trainings or atlitos://trainings/payments

### Screens

**01 Session detail (inside Trainings)**  
Route `atlitos://trainings/booking/<id>`, source `apps/mobile/src/app/(tabs)/trainings/booking/[id].tsx`
- See: Identical to atlitos://coaching/booking/<id>: AppBar 'Session', summary card with StatusPill, BillSummary ('Session fee', Total), refund card when applicable, status appropriate actions.
- Do: Read or act (see the session detail, reschedule and rate workflows).
- Tap targets: `Back`, `Cancel request`, `Message coach`, `Reschedule`, `Cancel session`, `Retry`
- Then: Same behaviour as the coaching route; Back returns to the Trainings tab (Stats or Payments) with the shell intact.

### States

- processing: Coach session route redirect. Trigger: Athlete taps an upcoming card on the Stats tab Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx load(): coachSessions.getSession returns null, coaching.getSession matches playerId -> router.replace to /(tabs)/trainings/booking/[id]
- error: Session detail (inside Trainings). Trigger: Unknown id Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx state === 'error': 'This session could not be found.', 'Retry'

