# Web: court partner portal, UPA life portal, admin

Part of the verified workflow map, see [README.md](README.md). 28 workflows, 57 screens.

## Contents

1. Court partner sign up (court partner)
2. Court partner sign in and sign out (court partner)
3. Court partner onboarding (venue verification) (court partner)
4. Dashboard overview (court partner, money)
5. Venues and courts management (court partner)
6. Slots and pricing (availability, blackouts, peak rules) (court partner, money)
7. Live today: bookings, check in, cancel, walk in (court partner, money)
8. Earnings, payouts and transfer history (court partner, money)
9. UPA sign up and sign in (Atlitos Life) (upa)
10. UPA shell: sidebar sign out and theme toggle (upa)
11. Apply as a UPA (4 step wizard) (upa)
12. Application status roadmap (upa)
13. UPA dashboard and donations received (upa, money)
14. Wishlist items: add, edit, remove, view funding, mark delivered (upa, money)
15. Gratitude posts (thank your sponsors) (upa)
16. Profile preview (what sponsors see) (upa, money)
17. UPA account: view, sign out, deactivate profile (upa)
18. Admin login and logout (admin)
19. Verification queue: approve or reject coach, venue, UPA requests (admin)
20. Venues: list, filter, search, detail, approve or reject (admin)
21. Moderation queue: approve or reject clips (admin)
22. Reports queue: take down or dismiss (admin)
23. Users: search, suspend, reinstate (admin)
24. Orders: list, filter, search, detail, advance status (admin, money)
25. Catalog and stock: edit product, variants, adjust stock, images (admin, money)
26. Drills: list, filter, create, edit, activate or deactivate (admin)
27. Fee config editing (admin, money)
28. Bookings (read only support list) (admin, money)

---

## 1. Court partner sign up

Category: ACCOUNT. Persona: court partner. Money: no.

Guest lands on the Atlitos Partners marketing page and creates an account with email and password. A brand new signup is routed straight into the onboarding wizard because it has no venue yet.

After success: Lands on /onboarding, which routes to /onboarding/venue-details for a partner with no venue

### Screens

**01 Partners landing**  
Route `/`, source `apps/portal-court/src/app/page.tsx`
- See: Header with Building2 mark and 'Atlitos Partners', hero 'List your courts, fill every slot', three highlight cards (CalendarClock, Radio, Wallet icons).
- Do: Tap Get started
- Tap targets: `Sign in`, `Get started`, `ArrowRight`
- Then: Navigates to /signup

**02 Create your account**  
Route `/signup`, source `apps/portal-court/src/app/(auth)/signup/page.tsx`
- See: Auth card with Building2 mark and 'ATLITOS PARTNERS' eyebrow, heading 'Create your account', subtitle 'List your courts and start filling every slot.', Email and Password fields (placeholder 'you@venue.com', 'At least 8 characters'), footer 'Already have an account. Sign in'.
- Do: Enter email and password (min 8 chars), tap Create account
- Tap targets: `Create account`, `Sign in`
- Then: supabase.auth.signUp; on success router.push(searchParams next ?? '/onboarding') (apps/portal-court/src/components/auth-form.tsx)

### States

- processing: Create your account. Trigger: Submit the form Source: apps/portal-court/src/components/auth-form.tsx submitting state, Loader2 spinner inside the button, button disabled
- error: Create your account. Trigger: Supabase signUp returns an error (existing email, weak password) Source: apps/portal-court/src/components/auth-form.tsx renders authError.message in a destructive bordered paragraph

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-court-signup-dark.jpeg
- docs/phases/evidence/p2-cycle2/portal-court-signup-light-system.jpeg


## 2. Court partner sign in and sign out

Category: ACCOUNT. Persona: court partner. Money: no.

Existing partner signs in with email and password and lands on the dashboard; the dashboard layout gate sends unverified partners to onboarding. Sign out lives in the sidebar user menu.

Release note: No forgot password, edit profile, account settings, or account deletion screens exist in portal-court. Theme toggle is the only preference.

After success: After sign in: /dashboard if the partner owns a verified venue or has an accepted venue_staff membership, otherwise redirect to /onboarding. After sign out: /signin

### Screens

**01 Sign in**  
Route `/signin`, source `apps/portal-court/src/app/(auth)/signin/page.tsx`
- See: Auth card, heading 'Sign in', subtitle 'Manage your courts, slots and payouts.', Email and Password fields, footer 'New to Atlitos Partners. Create one'.
- Do: Enter credentials, tap Sign in
- Tap targets: `Sign in`, `Create one`
- Then: signInWithPassword; router.push(next ?? '/dashboard'). Middleware appends ?next=<path> when an unauthenticated user hits /dashboard/*

**02 Overview (dashboard shell)**  
Route `/dashboard`, source `apps/portal-court/src/app/dashboard/layout.tsx`
- See: Sidebar 'Atlitos Partners' with nav Overview, Venues, Slots and pricing, Live today, Earnings (LayoutDashboard, Building2, CalendarClock, Radio, Wallet); bottom user menu chip with email initial and ChevronsUpDown, theme toggle (Sun or Moon).
- Do: Tap the email chip then Sign out
- Tap targets: `Overview`, `Venues`, `Slots and pricing`, `Live today`, `Earnings`, `ChevronsUpDown`, `Sign out`, `LogOut`, `Switch to dark mode`, `Switch to light mode`
- Then: supabase.auth.signOut then router.push('/signin') (apps/portal-court/src/components/user-menu.tsx)

### States

- gate: Any /dashboard/* route. Trigger: Visit /dashboard/* without a session Source: apps/portal-court/src/lib/supabase/middleware.ts redirects to /signin?next=<path>; apps/portal-court/src/app/dashboard/layout.tsx redirect('/signin')
- gate: Any /dashboard/* route. Trigger: Signed in but no verified venue owned and no accepted staff membership Source: apps/portal-court/src/app/dashboard/layout.tsx redirect('/onboarding')
- processing: Sign in. Trigger: Submit Source: apps/portal-court/src/components/auth-form.tsx Loader2 in button
- error: Sign in. Trigger: Wrong password or unknown email Source: apps/portal-court/src/components/auth-form.tsx destructive paragraph with authError.message

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-court-signin-dark.jpeg
- docs/phases/evidence/p2-cycle2/portal-court-signin-light-system.jpeg


## 3. Court partner onboarding (venue verification)

Category: ACCOUNT. Persona: court partner. Money: no.

Four step wizard: venue details, courts (the actual database write via submit_venue_verification), photos (min 3, max 12), review, then the pending status screen. Rejected venues can be edited and resubmitted as a fresh venue. Step rail labels: Venue details, Courts, Photos, Review.

Release note: PRD-03 'Bank and payout details' onboarding step is not built (docs/qa/PHASE-A-GAP-INVENTORY.md). Staff-restricted role enforcement not built.

After success: After approval by an admin, /onboarding/pending Check again redirects to /dashboard (Overview)

### Screens

**01 Onboarding router**  
Route `/onboarding`, source `apps/portal-court/src/app/onboarding/page.tsx`
- See: No UI, server redirect only.
- Do: None
- Then: No venue -> /onboarding/venue-details; verified -> /dashboard; fewer than 3 photos -> /onboarding/photos; otherwise -> /onboarding/pending

**02 Tell us about your venue**  
Route `/onboarding/venue-details`, source `apps/portal-court/src/app/onboarding/venue-details/page.tsx`
- See: Eyebrow 'Onboarding', heading 'Tell us about your venue', step rail, card 'Venue details' (MapPin) with Venue name, Address, City, Pincode, Latitude (optional), Longitude (optional), Description (optional).
- Do: Fill required fields, tap Continue to courts
- Tap targets: `Continue to courts`
- Then: Draft stored in sessionStorage, navigate to /onboarding/courts. Button disabled until name, address, city, pincode are filled

**03 Add your courts**  
Route `/onboarding/courts`, source `apps/portal-court/src/app/onboarding/courts/page.tsx`
- See: Heading 'Add your courts', card 'Courts' with one or more rows: sport Select (Football, Cricket, Badminton, Tennis), Court name, Capacity, Base price/hr, Trash2 to remove (when more than one), 'Add another court' (Plus).
- Do: Fill courts, tap Create venue and continue
- Tap targets: `Add another court`, `Plus`, `Trash2`, `Back`, `Create venue and continue`
- Then: rpc submit_venue_verification creates venue (pending) + courts + verification_requests row, then navigate to /onboarding/photos

**04 Add photos of your venue**  
Route `/onboarding/photos`, source `apps/portal-court/src/app/onboarding/photos/page.tsx`
- See: Heading 'Add photos of your venue', subtitle 'Upload at least 3 photos, up to 12.', card 'Photos (N of 12)' with thumbnail grid, dashed Upload tile (ImagePlus), Trash2 on hover per photo.
- Do: Upload at least 3 images, tap Continue to review
- Tap targets: `Upload`, `ImagePlus`, `Trash2`, `Back`, `Continue to review`
- Then: Uploads to venue-media bucket and inserts venue_photos; Continue enabled at 3 photos, navigates to /onboarding/review

**05 Review your submission**  
Route `/onboarding/review`, source `apps/portal-court/src/app/onboarding/review/page.tsx`
- See: Heading 'Review your submission', subtitle 'Your venue is already submitted for verification. Confirm everything looks right.', card with venue name (MapPin), status pill 'Pending review', address, Courts (N) list with price/hr in mono, Photos (N) thumbnails.
- Do: Tap Done, view status
- Tap targets: `Done, view status`
- Then: Navigate to /onboarding/pending (read only, no second write)

**06 Verification status**  
Route `/onboarding/pending`, source `apps/portal-court/src/app/onboarding/pending/page.tsx`
- See: Heading 'Verification status', card with venue name (Clock3) and status pill; pending copy 'An Atlitos admin is reviewing your venue. This usually takes one to two business days...'; rejected shows the rejection reason and 'Edit and resubmit'; 'Check again' (RefreshCw).
- Do: Tap Check again, or Edit and resubmit when rejected
- Tap targets: `Check again`, `RefreshCw`, `Edit and resubmit`
- Then: Check again refetches; verified -> redirect /dashboard; Edit and resubmit resets the draft and goes to /onboarding/venue-details where the guard prefills from the rejected venue

### States

- gate: All /onboarding/*. Trigger: No session Source: apps/portal-court/src/app/onboarding/layout.tsx redirect('/signin?next=/onboarding')
- loading: Venue details, Courts. Trigger: Guard checking latest venue Source: apps/portal-court/src/app/onboarding/use-onboarding-guard.ts status 'checking' renders Skeleton h-96
- gate: Venue details, Courts. Trigger: Venue already exists and is not rejected Source: use-onboarding-guard.ts router.replace to /onboarding/photos or /onboarding/pending; verified -> /dashboard
- error: Venue details. Trigger: Latest venue was rejected Source: venue-details/page.tsx banner 'Your previous submission was rejected. Update the details below and resubmit.'
- error: Courts. Trigger: Submit with a court missing name or price Source: courts/page.tsx setError('Every court needs a name and a base price.')
- error: Courts. Trigger: RPC fails Source: courts/page.tsx err.message or 'Could not submit your venue.'
- processing: Courts. Trigger: Submitting Source: courts/page.tsx Loader2 in 'Create venue and continue', disabled
- loading: Photos. Trigger: Initial load Source: photos/page.tsx status 'loading' Skeleton h-32
- error: Photos. Trigger: Load fails Source: photos/page.tsx ErrorState 'Something went wrong' with Try again (components/error-state.tsx)
- error: Photos. Trigger: Upload or delete fails Source: photos/page.tsx destructive paragraph 'Upload failed.' or 'Could not remove that photo.'
- processing: Photos. Trigger: Uploading Source: photos/page.tsx Loader2 replaces ImagePlus in the Upload tile
- empty: Photos. Trigger: Fewer than 3 photos Source: photos/page.tsx 'Add N more photo(s) to continue.' and Continue disabled
- loading: Review, Pending. Trigger: Initial load Source: review/page.tsx Skeleton h-8 + h-72; pending/page.tsx Skeleton h-8 + h-48
- error: Review, Pending. Trigger: Query fails or not authenticated Source: review/page.tsx and pending/page.tsx ErrorState with onRetry
- failed: Verification status. Trigger: Admin rejected the venue Source: pending/page.tsx status pill 'Rejected' (status-pill.tsx venueStatusPill) and rejection_reason banner or 'Your venue was not approved.'
- processing: Verification status. Trigger: Venue pending Source: pending/page.tsx pill 'Pending review' tone warning

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-court-onboarding-venue-details-dark.jpeg
- docs/phases/evidence/p2-cycle2/portal-court-onboarding-courts-dark.jpeg
- docs/phases/evidence/p2-cycle2/portal-court-onboarding-redirect-to-dashboard-overview-light.jpeg


## 4. Dashboard overview

Category: COURTS. Persona: court partner. Money: yes.

Three KPI tiles for the selected venue: bookings today, revenue this week, occupancy today. Venue switcher appears only when the partner has more than one venue.

After success: Stays on /dashboard

### Screens

**01 Your venue at a glance**  
Route `/dashboard`, source `apps/portal-court/src/app/dashboard/page.tsx`
- See: Eyebrow 'Overview', heading 'Your venue at a glance', optional venue Select in the header action slot (components/venue-switcher.tsx, hidden with one venue), three cards: 'Bookings today' (CalendarCheck), 'Revenue this week' (Wallet), 'Occupancy today' (PieChart), values in mono.
- Do: Change venue in the switcher
- Tap targets: `VenueSwitcher select`
- Then: Reloads the tiles for the chosen venue

### States

- loading: Your venue at a glance. Trigger: Venue scope or tiles loading Source: dashboard/page.tsx three Skeleton h-28
- error: Your venue at a glance. Trigger: Venue scope query fails or tile queries fail Source: dashboard/page.tsx ErrorState scope.error / error with Try again
- empty: Your venue at a glance. Trigger: Partner owns no venues (scope.status empty) Source: dashboard/page.tsx EmptyState 'Overview arrives once your first venue is verified'
- empty: Occupancy today tile. Trigger: No availability windows today or no active courts Source: dashboard/page.tsx renders 'No slots today' in place of the percentage

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-court-onboarding-redirect-to-dashboard-overview-light.jpeg


## 5. Venues and courts management

Category: COURTS. Persona: court partner. Money: no.

Per venue card with status pill, courts list with active toggles, add a court inline, photo upload and delete, plus an 'Add another venue' form that submits a new venue for verification.

After success: Stays on /dashboard/venues; new venue appears with 'Pending review' pill

### Screens

**01 Venues and courts**  
Route `/dashboard/venues`, source `apps/portal-court/src/app/dashboard/venues/page.tsx`
- See: Eyebrow 'Venues', heading 'Venues and courts'. One VenueCard per venue: name, status pill (Verified, Pending review, Rejected), MapPin address, sport badges, rejection banner if rejected, 'Courts' list rows with price/hr and 'Active'/'Inactive' Switch, 'Add a court' (Plus) inline form (sport Select, Court name, Capacity, Base price/hr, Save), 'Photos' grid with hover Trash2 and dashed Upload tile (ImagePlus). Bottom card 'Add another venue' with CreateVenueForm (Venue name, City, Address, Pincode, Description, Courts rows, 'Add another court', 'Submit for verification').
- Do: Toggle court active, add a court, upload photos, or fill the new venue form and Submit for verification
- Tap targets: `Add a court`, `Plus`, `Save`, `Switch`, `Upload`, `ImagePlus`, `Trash2`, `Add another court`, `Submit for verification`
- Then: Direct inserts/updates on courts and venue_photos; new venue goes through rpc submit_venue_verification and the list refreshes

### States

- loading: Venues and courts. Trigger: Scope loading Source: venues/page.tsx two Skeleton h-40; per VenueCard Skeleton h-24
- error: Venues and courts. Trigger: Scope or per venue query fails Source: venues/page.tsx ErrorState with Try again
- empty: Venues and courts. Trigger: No venues Source: venues/page.tsx description 'Add your first venue, upload photos and submit for verification to start taking bookings.' and CreateVenueForm rendered directly
- empty: VenueCard courts. Trigger: Venue has no courts Source: venues/page.tsx 'No courts added yet.'
- empty: VenueCard photos. Trigger: Fewer than 3 photos Source: venues/page.tsx 'Add at least 3 photos before submitting for verification.'
- error: Add a court form. Trigger: Missing name or price, or insert error Source: venues/page.tsx AddCourtForm 'Name and base price are required.' or insertError.message
- error: Add another venue form. Trigger: Court missing name/price or RPC error Source: venues/page.tsx CreateVenueForm 'Every court needs a name and a base price.' or rpcError.message
- processing: Forms. Trigger: Submitting or uploading Source: venues/page.tsx Loader2 in Submit for verification, Save, and Upload tile
- failed: VenueCard. Trigger: Venue rejected Source: venues/page.tsx banner 'Rejected. {rejection_reason}'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-court-venues-dark.jpeg
- docs/phases/evidence/p2-cycle2/portal-court-venues-light.jpeg


## 6. Slots and pricing (availability, blackouts, peak rules)

Category: COURTS. Persona: court partner. Money: yes.

Per court configuration: base price per hour, weekly availability windows, blackout date ranges, and peak pricing rules (multiplier or fixed price) with active toggles.

After success: Stays on /dashboard/slots-pricing

### Screens

**01 Availability and pricing rules**  
Route `/dashboard/slots-pricing`, source `apps/portal-court/src/app/dashboard/slots-pricing/page.tsx`
- See: Eyebrow 'Slots and pricing', heading 'Availability and pricing rules', venue switcher, court Select 'Name (Sport)', cards: 'Base price' (Rupees per hour input + Save), 'Weekly availability' (rows 'Monday 06:00 to 23:00, 60 min slots' with Trash2; form day Select, two time inputs, minutes, 'Add window'), 'Blackout dates' (rows with Trash2; form two date inputs, reason, 'Add blackout'), 'Peak pricing rules' (rows 'Fri to Sat 18:00 to 22:00, 1.5x base' or '₹N flat' with Active Switch; form day start/end, time start/end, mode Select Multiplier/Fixed price, value, Plus).
- Do: Pick a court, edit values, add or remove windows, blackouts and rules
- Tap targets: `Save`, `Add window`, `Add blackout`, `Plus`, `Trash2`, `Switch`, `Multiplier`, `Fixed price`
- Then: Direct writes on courts, court_availability_windows, court_blackouts, court_pricing_rules; each card reloads

### States

- loading: Availability and pricing rules. Trigger: Scope or courts loading Source: slots-pricing/page.tsx Skeleton h-64; per card Skeleton h-24/h-20
- error: Availability and pricing rules. Trigger: Scope, courts or any card query fails Source: slots-pricing/page.tsx ErrorState 'Could not load your venues.' / 'Could not load courts.' / per card 'Failed to load.'
- empty: Availability and pricing rules. Trigger: No venue Source: slots-pricing/page.tsx EmptyState 'Set availability once a venue is verified'
- empty: Availability and pricing rules. Trigger: Venue has no courts Source: slots-pricing/page.tsx EmptyState 'Add a court first'
- empty: Weekly availability. Trigger: No windows Source: 'No availability windows set yet, this court has no bookable slots.'
- empty: Blackout dates. Trigger: No blackouts Source: 'No blackout dates. This court is bookable every day its availability windows allow.'
- empty: Peak pricing rules. Trigger: No rules Source: 'No peak pricing rules. Every slot bills at the base price.'
- error: Blackout form. Trigger: Missing start, end or reason Source: 'Start date, end date and reason are all required.'
- error: Peak pricing form. Trigger: Overlapping rule (Postgres 23P01) Source: 'This overlaps an existing peak pricing rule on this court. Adjust the days or time range.'
- processing: All forms. Trigger: Submitting Source: Loader2 in Save / Add window / Add blackout / Plus buttons

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-court-slots-pricing-dark.jpeg
- docs/phases/evidence/p2-cycle2/portal-court-slots-pricing-light.jpeg


## 7. Live today: bookings, check in, cancel, walk in

Category: COURTS. Persona: court partner. Money: yes.

Today's bookings grouped by court with realtime refresh, check in action, cancel with required reason, tap the total to see the BillSummary, and 'Record a walk in' which books a slot through the book-court edge function with a BillSummary preview.

Release note: RELEASE-TODO task 5 makes consumer courts an affiliate click out and hides the in app booking flow, so athlete originated bookings will stop arriving here for release; walk ins remain the live source. Portal code itself is unchanged by task 5. No outbound link field exists yet in portal-court or admin for task 5's 'entry path to fill it'. Check in has no error state (RPC error swallowed).

After success: Stays on /dashboard/live-today; the new walk in appears under its court with 'Upcoming' pill

### Screens

**01 Today, court by court**  
Route `/dashboard/live-today`, source `apps/portal-court/src/app/dashboard/live-today/page.tsx`
- See: Eyebrow 'Live today', heading 'Today, court by court', venue switcher, 'Record a walk in' (UserPlus). Groups by court name; each booking card: 'Athlete booking' or walk in name with 'Walk in' tag, sport and slot range in mono, tappable total '₹N', status pill (Upcoming, Checked in, Completed, Cancelled, No show, Rescheduled, Expired, Awaiting payment), 'Check in' (CircleCheck) when confirmed and not checked in, 'Cancel' (X) when confirmed.
- Do: Tap Check in, Cancel, the total, or Record a walk in
- Tap targets: `Record a walk in`, `UserPlus`, `Check in`, `CircleCheck`, `Cancel`, `X`, `Refresh manually`
- Then: Check in calls rpc court_booking_check_in (errors are swallowed, list reloads only on success); Cancel opens CancelDialog; total opens BillDialog; walk in opens WalkInDialog

**02 Cancel booking dialog**  
Route `/dashboard/live-today`, source `apps/portal-court/src/app/dashboard/live-today/page.tsx`
- See: Dialog 'Cancel booking', description 'A reason is required. If the slot time has already passed, this is recorded as a no show instead of a cancellation.', Textarea placeholder 'Athlete no show, venue issue, weather, other'.
- Do: Type a reason, tap Confirm cancellation
- Tap targets: `Back`, `Confirm cancellation`
- Then: rpc court_booking_transition action 'cancel'; list reloads

**03 Booking detail (bill) dialog**  
Route `/dashboard/live-today`, source `apps/portal-court/src/app/dashboard/live-today/page.tsx`
- See: Dialog 'Booking detail' with sport and slot range, shared BillSummary rows Subtotal, GST, Platform fee, total, footnote 'Walk in booking, cash collected at the desk.' or 'Paid by the athlete at booking time.'
- Do: Read and close
- Then: Closes

**04 Record a walk in dialog**  
Route `/dashboard/live-today`, source `apps/portal-court/src/app/dashboard/live-today/walk-in-dialog.tsx`
- See: Dialog 'Record a walk in', description 'Occupies the slot immediately and blocks it from further booking.', Court select, 'Available slot today' select ('Choose a slot', options 'range · ₹price'), Athlete name and Phone (placeholder 'Optional'), 'Override price' Switch revealing New price and Reason (placeholder 'Required'), BillSummary (Subtotal, GST, Platform fee, total).
- Do: Pick court and slot, optionally override price with reason, tap Confirm walk in
- Tap targets: `Cancel`, `Confirm walk in`, `Override price`
- Then: functions.invoke('book-court') with booking_source walk_in; list reloads and dialog closes

### States

- loading: Today, court by court. Trigger: Scope or bookings loading Source: live-today/page.tsx Skeleton h-64
- error: Today, court by court. Trigger: Scope or bookings query fails Source: live-today/page.tsx ErrorState 'Could not load your venues.' / 'Failed to load today's bookings.'
- empty: Today, court by court. Trigger: No venue Source: EmptyState 'Nothing to show until a venue is verified'
- empty: Today, court by court. Trigger: No bookings today Source: EmptyState 'No bookings today yet' (Radio icon)
- error: Today, court by court. Trigger: Realtime channel not SUBSCRIBED Source: WifiOff banner 'Live updates disconnected.' with link 'Refresh manually'
- error: Cancel booking dialog. Trigger: Empty reason or RPC error Source: CancelDialog 'A reason is required.' or rpcError.message
- processing: Cancel booking dialog. Trigger: Confirming Source: Loader2 in 'Confirm cancellation'
- loading: Record a walk in dialog. Trigger: Slots loading Source: walk-in-dialog.tsx 'Loading available slots...'
- empty: Record a walk in dialog. Trigger: No slots left Source: 'No available slots left today on this court.'
- error: Record a walk in dialog. Trigger: Override without reason, or edge function error Source: 'A reason is required when overriding the price.' or fnError.message
- processing: Record a walk in dialog. Trigger: Confirming Source: Loader2 in 'Confirm walk in'; button disabled until bill computed
- gate: Today, court by court. Trigger: No active courts Source: 'Record a walk in' disabled when courts.length === 0

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-court-live-today-dark.jpeg
- docs/phases/evidence/p2-cycle2/portal-court-live-today-light.jpeg
- docs/phases/evidence/p2-cycle2/live-today-paid-booking-dark.jpeg
- docs/phases/evidence/p2-cycle2/live-today-paid-booking-light.jpeg


## 8. Earnings, payouts and transfer history

Category: PAYMENT. Persona: court partner. Money: yes.

Read only money view: pending balance (ledger derived, credit minus debit, clamped at zero), last payout, payout account linked status, this month BillSummary (Gross bookings minus Platform fee = Net payable), 14 day bar chart, transfer history table.

Release note: No payout account linking screen and no request transfer action exist (PRD-03 /earnings/payout-account, /earnings/transfers not built; docs/qa/PHASE-A-GAP-INVENTORY.md). Pending balance arithmetic fixed in fcae8f0 (credit minus debit).

After success: Stays on /dashboard/earnings

### Screens

**01 Earnings and payouts**  
Route `/dashboard/earnings`, source `apps/portal-court/src/app/dashboard/earnings/page.tsx`
- See: Eyebrow 'Earnings', heading 'Earnings and payouts', venue switcher, tiles 'Pending balance', 'Last payout', 'Payout account' ('Linked' or 'Not linked yet'), card 'This month' with BillSummary totalLabel 'Net payable', card 'Earnings, trailing 14 days' EarningsChart (components/earnings-chart.tsx), card 'Transfer history' table Date, Amount, Status (Paid, Failed, Processing pills), Reference.
- Do: Read; switch venue
- Tap targets: `VenueSwitcher select`
- Then: Reloads for the venue

### States

- loading: Earnings and payouts. Trigger: Loading Source: earnings/page.tsx Skeleton h-64
- error: Earnings and payouts. Trigger: Query fails Source: ErrorState 'Failed to load earnings.'
- empty: Earnings and payouts. Trigger: No venue Source: EmptyState 'Earnings show up after your first venue is verified'
- empty: Last payout tile. Trigger: No paid transfer Source: 'No payouts yet'
- empty: Earnings, trailing 14 days. Trigger: Every point in the trailing 14 days is zero Source: apps/portal-court/src/components/earnings-chart.tsx 'No earnings yet in this period.'
- empty: Transfer history. Trigger: No transfers Source: 'No transfers yet.' when linked, else 'Link a payout account to start receiving transfers.'
- processing: Transfer history row. Trigger: Transfer status processing Source: status-pill.tsx transferStatusPill 'Processing' warning
- failed: Transfer history row. Trigger: Transfer status failed Source: transferStatusPill 'Failed' danger
- success: Transfer history row. Trigger: Transfer paid Source: transferStatusPill 'Paid' success

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-court-earnings-dark.jpeg
- docs/phases/evidence/p2-cycle2/portal-court-earnings-light.jpeg
- docs/phases/evidence/p2-cycle2/earnings-reconciled-dark.jpeg


## 9. UPA sign up and sign in (Atlitos Life)

Category: ACCOUNT. Persona: upa. Money: no.

Guest lands on the Atlitos Life page, creates an account or signs in. Both land on /home; an unverified applicant is bounced from /home to /status by the verified route guard.

Release note: No forgot password or account deletion in portal-life.

After success: /home for a verified UPA; otherwise requireVerifiedApplication redirects to /status

### Screens

**01 Life landing**  
Route `/`, source `apps/portal-life/src/app/page.tsx`
- See: Header HeartHandshake mark 'Atlitos Life', hero 'Support the athletes carrying the sport forward', highlight cards (BadgeCheck, Gift, Heart).
- Do: Tap Get started or Sign in
- Tap targets: `Sign in`, `Get started`, `ArrowRight`
- Then: /signup or /signin

**02 Create your account**  
Route `/signup`, source `apps/portal-life/src/app/(auth)/signup/page.tsx`
- See: Heading 'Create your account', subtitle 'Apply for verification and start your UPA profile.', Email (placeholder 'you@example.com'), Password, footer 'Already have an account. Sign in'.
- Do: Tap Create account
- Tap targets: `Create account`, `Sign in`
- Then: auth.signUp then router.push(next ?? '/home') (apps/portal-life/src/components/auth-form.tsx)

**03 Sign in**  
Route `/signin`, source `apps/portal-life/src/app/(auth)/signin/page.tsx`
- See: Heading 'Sign in', subtitle 'Track your application, wishlist and gratitude posts.', Email, Password, footer 'New to Atlitos Life. Create one'.
- Do: Tap Sign in
- Tap targets: `Sign in`, `Create one`
- Then: signInWithPassword then /home (or ?next)

### States

- gate: Every non public path. Trigger: No session on any path other than /, /signin, /signup Source: apps/portal-life/src/lib/supabase/middleware.ts PUBLIC_PATHS, redirect to /signin?next=<path>
- gate: /home, /wishlist, /wishlist/[itemId], /gratitude, /profile/preview. Trigger: Application missing or not verified Source: apps/portal-life/src/lib/empower.ts requireVerifiedApplication redirect('/status')
- processing: Auth forms. Trigger: Submit Source: auth-form.tsx Loader2 in button
- error: Auth forms. Trigger: Auth error Source: auth-form.tsx destructive paragraph authError.message

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-life-signin-dark-system.jpeg
- docs/phases/evidence/p6-web/portal-signin-light.png
- docs/phases/evidence/p6-web/portal-signin-dark.png


## 10. UPA shell: sidebar sign out and theme toggle

Category: ACCOUNT. Persona: upa. Money: no.

Every signed in portal-life page renders the (app) layout sidebar with a role aware nav (pre verified: Application status, Account; verified: Dashboard, Wishlist, Gratitude, Profile preview, Account), a user menu chip with sign out, and a light/dark theme toggle.

After success: Sign out lands on /signin; theme toggle stays on the current page

### Screens

**01 Life app shell sidebar**  
Route `/status`, source `apps/portal-life/src/app/(app)/layout.tsx`
- See: Sidebar 'Atlitos Life' (HeartHandshake mark). Nav from components/nav-items.ts: pre verified 'Application status' (BadgeCheck) and 'Account' (Settings); verified 'Dashboard' (LayoutDashboard), 'Wishlist' (Gift), 'Gratitude' (Heart), 'Profile preview' (UserRound), 'Account' (Settings). Bottom: email chip with initial and ChevronsUpDown (components/user-menu.tsx), theme toggle button (components/theme-toggle.tsx, Sun in dark mode, Moon in light mode).
- Do: Tap the email chip then Sign out, or tap the theme toggle
- Tap targets: `Application status`, `Account`, `Dashboard`, `Wishlist`, `Gratitude`, `Profile preview`, `ChevronsUpDown`, `Sign out`, `LogOut`, `Switch to dark mode`, `Switch to light mode`
- Then: Sign out: supabase.auth.signOut then router.push('/signin'). Theme toggle: next-themes setTheme('dark'|'light')

### States

- gate: Life app shell sidebar. Trigger: Application not verified Source: (app)/layout.tsx verified = application?.status === 'verified'; components/sidebar.tsx picks preVerifiedNav vs verifiedNav

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/portal-life-dashboard-myprofile-light.jpeg
- docs/phases/evidence/p2-cycle2/portal-life-dashboard-myprofile-dark.jpeg


## 11. Apply as a UPA (4 step wizard)

Category: ACCOUNT. Persona: upa. Money: no.

Steps: Your story, Sport and region, Certificates, Match videos. Draft autosaves to localStorage (key atlitos-life-apply-draft) for new and reapply flows; needs_info resumes into the flagged step. Submit goes through submit_upa_application, resubmit_upa_application, or reapply_upa_application, then evidence rows are inserted.

After success: Lands on /status with pill 'Submitted'. Mode is decided server side in apply/page.tsx from the application status (needs_info -> resume, rejected or deactivated -> reapply, none -> new); the wizard reads ?field=<column> (or needs_info_field) to open the flagged step. The ?resume=<id> query that /status links with is not read by any code.

### Screens

**01 Apply for support, step 1 Your story**  
Route `/apply`, source `apps/portal-life/src/app/(app)/apply/apply-wizard.tsx`
- See: Eyebrow 'Step 1 of 4', title 'Apply for support' (or 'Update your application' on resume, 'Reapply for support' on reapply), description is the step name, four segment progress bar, card with Story headline (max 120), Your story textarea, Profile photo file input (Upload icon placeholder, 'Optional. A clear photo helps sponsors connect.').
- Do: Fill headline and story, tap Continue
- Tap targets: `Back`, `Continue`, `ArrowRight`, `ArrowLeft`
- Then: Validates, advances to step 2

**02 Step 2 Sport and region**  
Route `/apply`, source `apps/portal-life/src/app/(app)/apply/apply-wizard.tsx`
- See: Sport Select ('Choose your sport': Football, Cricket, Badminton, Tennis), City or region, State.
- Do: Tap Continue
- Tap targets: `Back`, `Continue`
- Then: Advances to step 3

**03 Step 3 Certificates**  
Route `/apply`, source `apps/portal-life/src/app/(app)/apply/apply-wizard.tsx`
- See: 'Certificates or ID proof' multi file input (images or PDF), helper 'Images or PDF. Stored privately and only seen by our verification team.', selected file rows with FileText icon and Trash2 'Remove file'.
- Do: Attach files, tap Continue
- Tap targets: `Back`, `Continue`, `Remove file`, `Trash2`
- Then: Advances to step 4

**04 Step 4 Match videos**  
Route `/apply`, source `apps/portal-life/src/app/(app)/apply/apply-wizard.tsx`
- See: 'Match video links' rows with Link2 icon and Trash2 'Remove link', 'Add a link', evidence tally 'Evidence so far: N files and N links. At least one is required.'
- Do: Tap Submit application (or Resubmit application on resume)
- Tap targets: `Add a link`, `Remove link`, `Back`, `Submit application`, `Resubmit application`, `Check`
- Then: RPC then upa_evidence inserts and certificate uploads to upa-evidence; localStorage draft cleared; router.push('/status')

### States

- gate: /apply. Trigger: Application status submitted, under_review or verified Source: apps/portal-life/src/app/(app)/apply/page.tsx redirect('/status')
- error: Any step. Trigger: Required field missing on Continue Source: apply-wizard.tsx stepError: 'A story headline is required.', 'Tell us your story before continuing.', 'Choose your sport.', 'Add your city or region.', 'Add your state.', 'Add at least one certificate or match video.'
- error: Step 4. Trigger: RPC failure Source: apply-wizard.tsx friendlyError: 'You already have an active application. Check your status instead.', COOLDOWN message, 'Please complete every required field before submitting.', 'We could not submit your application. Please try again.'
- processing: Step 1 photo, Step 4 submit. Trigger: Uploading photo or submitting Source: apply-wizard.tsx Loader2 next to photo input; Loader2 in submit button, submit disabled while !hasEvidence


## 12. Application status roadmap

Category: ACCOUNT. Persona: upa. Money: no.

Realtime status screen with a three step roadmap (Submitted, Under review, Verified) and branch cards for needs_info, rejected (with reapply cooldown) and verified.

After success: Verified: /home. Needs info: /apply resumed at the flagged step

### Screens

**01 Your application status**  
Route `/status`, source `apps/portal-life/src/app/(app)/status/status-view.tsx`
- See: Eyebrow 'Verification', heading 'Your application status', description 'Track where your application stands and what is left.', card with story headline, 'Applied <date>', status pill (Submitted, Under review, Needs more info, Verified, Not approved, Deactivated), roadmap list with Check / CircleDashed icons. Branch cards: needs_info 'We need a little more' (CircleAlert) with 'Update your application'; rejected 'Not approved this time' with reason and either 'You can reapply from <date>' or 'Reapply now' (RotateCcw); verified 'You are verified' (BadgeCheck) with 'Go to your dashboard' and 'Manage wishlist'. Pre verified sidebar shows only Application status (BadgeCheck) and Account (Settings).
- Do: Tap the branch action
- Tap targets: `Start your application`, `Update your application`, `Reapply now`, `RotateCcw`, `Go to your dashboard`, `Manage wishlist`, `ArrowRight`
- Then: /apply, /apply?resume=<id> (param inert, mode comes from status), /home or /wishlist. On a realtime flip to verified the session is refreshed and the shell re-renders with the verified nav

### States

- empty: Your application status. Trigger: No application row Source: status-view.tsx EmptyState 'You have not applied yet' (FileText) and button 'Start your application'
- error: Your application status. Trigger: Reload query fails Source: status-view.tsx ErrorState 'We could not load your application.' with Try again
- processing: Your application status. Trigger: Status submitted or under_review Source: status-pill.tsx upaStatusPill 'Submitted' info, 'Under review' warning
- failed: Your application status. Trigger: Status rejected Source: status-view.tsx card 'Not approved this time', pill 'Not approved'
- success: Your application status. Trigger: Status verified Source: status-view.tsx card 'You are verified', pill 'Verified'


## 13. UPA dashboard and donations received

Category: EMPOWER. Persona: upa. Money: yes.

Verified UPA home: total raised (ledger derived via upa_money_summary), supporters count, items funded, items open, a 'Money in and where it goes' panel with payouts marked 'Arriving soon', supporters list (donor name or 'A Sponsor'), own thank you notes, and a nudge to write a thank you for a funded item.

Release note: Bank payouts to UPAs are not enabled (Razorpay Route gated, PAYMENTS.md); dashboard states 'Arriving soon'. Founder decision row 24 (Apple commission on donations) is open. No screenshot of /home exists; the p2-cycle2 portal-life-dashboard-myprofile images show a removed P2 stub route and were dropped.

After success: Stays on /home

### Screens

**01 Dashboard**  
Route `/home`, source `apps/portal-life/src/app/(app)/home/page.tsx`
- See: Eyebrow 'Dashboard', title is the story headline, description 'Your funding at a glance.', action 'Manage wishlist' (Plus). Four tiles: Total raised (Sparkles), Supporters (Users), Items funded (Gift), Items open (Gift). Card 'Money in and where it goes' (Landmark) with 'Raised for you' and 'Payouts to your account' = 'Arriving soon' (Clock). Optional card 'A funded item is waiting for a thank you' with 'Write a thank you' (shown when no gratitude posts and an item is funded). Sections 'Your supporters' and 'Your thank you notes'. Verified sidebar: Dashboard, Wishlist, Gratitude, Profile preview, Account.
- Do: Tap Manage wishlist or Write a thank you
- Tap targets: `Manage wishlist`, `Plus`, `Write a thank you`, `ArrowRight`, `Dashboard`, `Wishlist`, `Gratitude`, `Profile preview`, `Account`
- Then: /wishlist or /gratitude

### States

- gate: Dashboard. Trigger: Not verified Source: home/page.tsx requireVerifiedApplication -> /status
- empty: Your supporters. Trigger: No donations Source: home/page.tsx EmptyState 'No supporters yet' (Users)
- empty: Your thank you notes. Trigger: No gratitude posts Source: home/page.tsx EmptyState 'No thank you notes yet' (Quote)
- empty: Dashboard. Trigger: No wishlist items Source: home/page.tsx EmptyState 'Add your first wishlist item' (Gift)
- processing: Money in panel. Trigger: Always (payouts not enabled) Source: home/page.tsx 'Payouts to your account' shows 'Arriving soon' and copy 'Direct payouts to your bank account open once account setup is enabled.'


## 14. Wishlist items: add, edit, remove, view funding, mark delivered

Category: EMPOWER. Persona: upa. Money: yes.

Verified UPA manages wishlist items sponsors can fund. Items lock once funding starts. Funding detail lists sponsors and lets the UPA mark a funded item delivered via RPC. Realtime updates on donations.

After success: Stays on the wishlist or item page

### Screens

**01 What you need**  
Route `/wishlist`, source `apps/portal-life/src/app/(app)/wishlist/wishlist-manager.tsx`
- See: Eyebrow 'Wishlist', heading 'What you need', description 'Add gear and support with a real cost. Sponsors fund it from your public profile.', action 'Add item' (Plus). Two column grid of item cards: title, 'Cost Rs', status pill (Open, Partly funded, Funded, Delivered), FundingBar with 'X of Y' and percent, 'View funding' link (ArrowRight), Pencil 'Edit item' and Trash2 'Remove item' when open with zero funding, else 'Locked once funding starts'.
- Do: Tap Add item, Edit item, Remove item or View funding
- Tap targets: `Add item`, `Plus`, `View funding`, `ArrowRight`, `Edit item`, `Pencil`, `Remove item`, `Trash2`
- Then: Opens ItemDialog or RemoveDialog, or navigates to /wishlist/<itemId>

**02 Add an item / Edit item dialog**  
Route `/wishlist`, source `apps/portal-life/src/app/(app)/wishlist/wishlist-manager.tsx`
- See: Dialog 'Add an item' ('Name what you need and its cost. It starts open for sponsors to fund.') or 'Edit item' ('You can change the name and cost until funding starts.'), fields Item (max 120) and Cost in rupees.
- Do: Tap Add item or Save changes
- Tap targets: `Cancel`, `Add item`, `Save changes`
- Then: Insert or update upa_wishlist_items (title, cost only); list reloads

**03 Remove this item dialog**  
Route `/wishlist`, source `apps/portal-life/src/app/(app)/wishlist/wishlist-manager.tsx`
- See: Dialog 'Remove this item', 'Remove "title" from your wishlist. This cannot be undone.'
- Do: Tap Remove item
- Tap targets: `Keep it`, `Remove item`
- Then: Delete row (RLS allows only open, unfunded)

**04 Funding progress detail**  
Route `/wishlist/[itemId]`, source `apps/portal-life/src/app/(app)/wishlist/[itemId]/funding-detail.tsx`
- See: 'Back to wishlist' (ArrowLeft), eyebrow 'Funding progress', item title, card with status pill and FundingBar, 'Mark as delivered' (PackageCheck) when status is funded, optional 'Your thank you' card (Heart), 'Sponsors' section with 'N donations' and rows (CircleUser, donor name or 'A Sponsor', date, amount).
- Do: Tap Mark as delivered
- Tap targets: `Back to wishlist`, `ArrowLeft`, `Mark as delivered`, `PackageCheck`
- Then: rpc mark_wishlist_item_delivered; pill becomes 'Delivered' (RPC errors are swallowed, no message shown)

### States

- gate: Wishlist. Trigger: Not verified Source: wishlist/page.tsx and wishlist/[itemId]/page.tsx requireVerifiedApplication -> /status
- empty: What you need. Trigger: No items Source: wishlist-manager.tsx EmptyState 'No items yet' (Gift)
- error: What you need. Trigger: Reload fails Source: wishlist-manager.tsx ErrorState 'We could not load your wishlist.'
- error: Item dialog. Trigger: Blank name or cost <= 0, or write error Source: ItemDialog 'Give the item a name.', 'Enter a cost greater than zero.', writeError.message
- error: Remove dialog. Trigger: Delete refused Source: RemoveDialog deleteError.message
- processing: Dialogs. Trigger: Submitting Source: Loader2 in Add item / Save changes / Remove item
- loading: Funding progress detail. Trigger: Loading Source: funding-detail.tsx Skeleton h-40 + h-56
- error: Funding progress detail. Trigger: Query fails Source: funding-detail.tsx ErrorState 'We could not load this item.'
- empty: Funding progress detail. Trigger: Item missing or not owned Source: funding-detail.tsx EmptyState 'Item not found' (PackageCheck)
- empty: Sponsors section. Trigger: No donations on this item Source: funding-detail.tsx EmptyState 'No sponsors yet' (CircleUser)
- processing: Funding progress detail. Trigger: Marking delivered Source: funding-detail.tsx Loader2 in 'Mark as delivered'
- success: Item card. Trigger: Derived funding >= cost Source: status-pill.tsx derivedItemPill 'Funded' success; funding-bar.tsx turns success color at 100 percent


## 15. Gratitude posts (thank your sponsors)

Category: EMPOWER. Persona: upa. Money: no.

Compose a thank you note for a funded or delivered item without a post yet (one per item), optional photo, published immediately; the UPA can soft delete own posts.

After success: Stays on /gratitude; the post appears in the list and on /profile/preview and /home

### Screens

**01 Thank your sponsors**  
Route `/gratitude`, source `apps/portal-life/src/app/(app)/gratitude/gratitude-view.tsx`
- See: Eyebrow 'Gratitude', heading 'Thank your sponsors', description 'Once an item is funded, share a note your sponsors can see.' Composer card 'Write a thank you' (Heart) with Funded item Select ('Choose a funded item'), Your note textarea, Photo file input (Upload placeholder, 'Optional.'), 'Post thank you'. Below, post cards 'For <item>' with date, body, optional image, Trash2 'Remove post'.
- Do: Pick item, write note, tap Post thank you
- Tap targets: `Post thank you`, `Remove post`, `Trash2`
- Then: Insert gratitude_posts; list reloads. Remove post sets status removed (soft delete)

### States

- gate: Gratitude. Trigger: Not verified Source: gratitude/page.tsx requireVerifiedApplication -> /status
- loading: Thank your sponsors. Trigger: Loading Source: gratitude-view.tsx animate-pulse block h-40
- error: Thank your sponsors. Trigger: Query fails Source: ErrorState 'We could not load your gratitude posts.'
- empty: Thank your sponsors. Trigger: No visible posts Source: EmptyState 'No thank you notes yet' (Heart)
- gate: Composer. Trigger: No funded or delivered item without a post Source: gratitude-view.tsx Composer rendered only when eligibleItems.length > 0
- error: Composer. Trigger: No item chosen, empty note, or insert error Source: Composer 'Choose which funded item to thank sponsors for.', 'Write a short note before posting.', insertError.message
- processing: Composer. Trigger: Uploading photo or posting Source: Loader2 beside photo input; Loader2 in 'Post thank you'; Loader2 in SoftDelete button


## 16. Profile preview (what sponsors see)

Category: ACCOUNT. Persona: upa. Money: yes.

Read only render of the public UPA profile through the same public_upa_profile RPC the consumer app uses.

After success: Stays on /profile/preview

### Screens

**01 What sponsors see**  
Route `/profile/preview`, source `apps/portal-life/src/app/(app)/profile/preview/page.tsx`
- See: Eyebrow 'Profile preview', heading 'What sponsors see', banner 'Viewing as a sponsor' (Eye). Card with photo or BadgeCheck placeholder, headline, 'Verified' badge, sport and region (MapPin), story body, 'N supporters' (Users), 'Total raised'. Sections Wishlist (item cards with pill and FundingBar), Supporters (Heart rows), Thank you notes (Quote cards).
- Do: Read only
- Then: None

### States

- gate: What sponsors see. Trigger: Not verified Source: profile/preview/page.tsx requireVerifiedApplication -> /status
- error: What sponsors see. Trigger: RPC error or null Source: ErrorState 'We could not load your profile preview.' (no retry)
- empty: Wishlist section. Trigger: No items Source: 'No items on your wishlist yet.'
- empty: Supporters section. Trigger: No supporters Source: 'No supporters yet. Sponsors who fund your wishlist show here.'
- empty: Thank you notes section. Trigger: No posts Source: 'No thank you notes yet. They appear here once you thank a sponsor.'


## 17. UPA account: view, sign out, deactivate profile

Category: ACCOUNT. Persona: upa. Money: no.

Reachable in any state. Shows email, read only profile fields with status pill, sign out, and for verified UPAs a destructive 'Deactivate my profile' flow via RPC. No edit profile (story locked after verification, contact support). The deactivate path is dead in practice: it is only shown to verified UPAs and the database makes verified terminal.

Release note: PRD-05 FR-27 contradiction flagged in docs/qa/PHASE-A-GAP-INVENTORY.md (self service deactivate vs contact support). Migration 0052 made verified terminal (AT-110 correction, verified withdraw is an admin action), but account-view.tsx still shows 'Deactivate my profile' only for verified UPAs, so the button always errors with INVALID_TRANSITION. Either hide the card or reopen the edge before release.

After success: Sign out -> /signin. Deactivate: the RPC error is shown inside the dialog; the success path (/status with pill 'Deactivated') is unreachable because the card only renders for verified applications and supabase/migrations/0052_empower_deactivate_edge_fix.sql makes verified terminal

### Screens

**01 Your account**  
Route `/account`, source `apps/portal-life/src/app/(app)/account/account-view.tsx`
- See: Eyebrow 'Account', heading 'Your account', description 'Your sign in and profile details.', card with Email (Mail) and 'Sign out' (LogOut); card 'Your profile' with status pill and Headline, Sport, Region, State plus 'To change your story after verification, contact support so we can keep your funded wishlist safe.'; verified only card 'Deactivate profile' (ShieldAlert) with 'Deactivate my profile'.
- Do: Tap Sign out or Deactivate my profile
- Tap targets: `Sign out`, `LogOut`, `Deactivate my profile`
- Then: Sign out -> /signin. Deactivate opens dialog

**02 Deactivate your profile dialog**  
Route `/account`, source `apps/portal-life/src/app/(app)/account/account-view.tsx`
- See: Dialog 'Deactivate your profile', 'Sponsors will no longer see your profile or fund your wishlist. This cannot be undone from here.'
- Do: Tap Deactivate
- Tap targets: `Keep my profile`, `Deactivate`
- Then: rpc deactivate_upa_application; on success router.push('/status'). For a verified application this always fails with INVALID_TRANSITION and the dialog stays open showing the message

### States

- error: Deactivate dialog. Trigger: Tap Deactivate as a verified UPA (the only state that shows the button) Source: DeactivateDialog rpcError.message; 0052_empower_deactivate_edge_fix.sql v_allowed for 'verified' is an empty array so upa_application_transition_internal raises INVALID_TRANSITION
- processing: Deactivate dialog. Trigger: Submitting Source: Loader2 in Deactivate button
- empty: Your account. Trigger: No application row Source: account-view.tsx renders only the email card and Sign out when application is null


## 18. Admin login and logout

Category: ACCOUNT. Persona: admin. Money: no.

Email and password only, no self registration. Any failure (wrong credentials or a valid non admin account) shows one generic message. Index redirects to the verification queue. There is no /dashboard route.

Release note: PRD-04 Dashboard Overview (KPI tiles, activity feed), Feature flags, Support tickets, Audit log viewer are not built (RELEASE-TODO AD-38 to AD-41, docs/qa/PHASE-A-GAP-INVENTORY.md).

After success: After login: /verification (Coach tab). After logout: /login

### Screens

**01 Admin login**  
Route `/login`, source `apps/admin/src/pages/login/index.tsx`
- See: Card with LayoutGrid mark 'Atlitos Admin', copy 'Sign in with your admin account. Admin accounts are provisioned outside this app.', Email and Password inputs, 'Sign in' button.
- Do: Tap Sign in
- Tap targets: `Sign in`
- Then: authProvider.login: signInWithPassword then user_roles admin check; success redirectTo '/' which NavigateToResource sends to /verification

**02 Admin shell**  
Route `/verification`, source `apps/admin/src/layout/Shell.tsx`
- See: Sidebar 'Atlitos Admin' with nav Verification queue (ShieldCheck), Venues (Building2), Bookings (CalendarClock), Catalog (Package), Orders (ShoppingBag), Drills (GraduationCap), Moderation queue (Film), Reports queue (Flag), Fee config (Percent), Users (Users); bottom shows signed in email and 'Sign out' (LogOut). Light theme only, no toggle.
- Do: Tap Sign out
- Tap targets: `Verification queue`, `Venues`, `Bookings`, `Catalog`, `Orders`, `Drills`, `Moderation queue`, `Reports queue`, `Fee config`, `Users`, `Sign out`, `LogOut`
- Then: signOut scope local, redirect /login

### States

- processing: Admin login. Trigger: Submitting Source: login/index.tsx button label 'Signing in', disabled
- error: Admin login. Trigger: Wrong password, unknown email, or non admin account Source: authProvider.ts LOGIN_ERROR_MESSAGE 'Sign in failed. Check the email and password and try again.' rendered with ShieldAlert
- gate: Any protected route. Trigger: No session, or admin role revoked on check Source: App.tsx Authenticated fallback CatchAllNavigate to /login; authProvider.check signs out non admins
- empty: /dashboard. Trigger: Type /dashboard in the address bar Source: App.tsx registers no /dashboard route and no catch all; a pathless layout route only renders when a child matches, so the expected result is a fully blank page (not run live)

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/admin-verification-queue-coach.jpeg


## 19. Verification queue: approve or reject coach, venue, UPA requests

Category: ADMIN. Persona: admin. Money: no.

Tabbed list of pending_review verification_requests, detail with the payload evidence, approve, or reject with a required reason. Already actioned requests are read only.

After success: Stays on /verification/show/:id showing 'approved' or 'rejected' badge and the read only card 'This request was already <status>...'

### Screens

**01 Verification queue**  
Route `/verification?type=coach|venue|upa`, source `apps/admin/src/pages/verification/list.tsx`
- See: Heading 'Verification queue', subtitle 'Review coach, venue, and UPA applications before they reach the marketplace.', tabs Coach, Venue, UPA with mono counts, table Applicant, Submitted, Status (badge 'pending_review').
- Do: Tap a tab, tap a row
- Tap targets: `Coach`, `Venue`, `UPA`
- Then: Row navigates to /verification/show/:id

**02 Verification detail**  
Route `/verification/show/:id`, source `apps/admin/src/pages/verification/show.tsx`
- See: 'Back to queue' (ArrowLeft), card with eyebrow '<type> application', applicant name, status badge, 'Submitted evidence' definition list, submitted/reviewed timestamps and reason. Action card with 'Approve' (Check) and 'Reject' (X); Reject reveals 'Rejection reason, required' textarea with 'Confirm reject' and 'Cancel'.
- Do: Tap Approve, or Reject then Confirm reject
- Tap targets: `Back to queue`, `ArrowLeft`, `Approve`, `Check`, `Reject`, `X`, `Confirm reject`, `Cancel`
- Then: rpc admin_approve_verification_request / admin_reject_verification_request; detail reloads with new status badge

### States

- loading: Verification queue. Trigger: Loading Source: list.tsx 'Loading verification requests...'
- error: Verification queue. Trigger: Query fails Source: list.tsx EmptyState 'Could not load the queue' (AlertTriangle)
- empty: Verification queue. Trigger: No pending rows in the tab Source: list.tsx EmptyState 'No pending coach/venue/upa requests' (ShieldCheck)
- loading: Verification detail. Trigger: Loading Source: show.tsx 'Loading request...'
- empty: Verification detail. Trigger: Unknown id Source: show.tsx EmptyState 'Request not found'
- error: Verification detail. Trigger: Query fails Source: show.tsx EmptyState 'Could not load this request'
- empty: Submitted evidence. Trigger: Empty payload Source: show.tsx 'No evidence fields were submitted with this request.'
- error: Verification detail. Trigger: Blank rejection reason or RPC error Source: show.tsx actionError 'A rejection reason is required.' or error.message
- gate: Verification detail. Trigger: Request already approved or rejected Source: show.tsx card 'This request was already <status>. Approve and reject are only available while a request is pending review.'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/admin-verification-queue-coach.jpeg
- docs/phases/evidence/p2-cycle2/admin-verification-queue-venue-empty.jpeg
- docs/phases/evidence/p2-cycle2/admin-verification-queue-upa-empty.jpeg


## 20. Venues: list, filter, search, detail, approve or reject

Category: ADMIN. Persona: admin. Money: no.

All venues with status filter tabs and search; detail shows partner, courts and the pending verification request actions.

Release note: No affiliate outbound link field on venues or courts exists in admin yet (RELEASE-TODO task 5 'entry path to fill it' not built).

After success: Stays on /venues/show/:id with badge 'verified' or 'rejected'

### Screens

**01 Venues**  
Route `/venues?status=pending|verified|rejected`, source `apps/admin/src/pages/venues/list.tsx`
- See: Heading 'Venues', tabs All, Pending, Verified, Rejected with counts, search 'Search by name, city, or partner' (Search icon), table Venue, City, Partner, Created, Status.
- Do: Filter, search, tap a row
- Tap targets: `All`, `Pending`, `Verified`, `Rejected`
- Then: /venues/show/:id

**02 Venue detail**  
Route `/venues/show/:id`, source `apps/admin/src/pages/venues/show.tsx`
- See: 'Back to venues' (ArrowLeft), card eyebrow 'Venue', name, MapPin address, status badge, description, Partner, Partner contact, Rejection reason; card 'Courts' table Court, Sport, Capacity, Base price / hour, Active; action card 'Approve venue' (Check) and 'Reject venue' (X) with 'Rejection reason, required' textarea, 'Confirm reject', 'Cancel'.
- Do: Tap Approve venue or Reject venue
- Tap targets: `Back to venues`, `ArrowLeft`, `Approve venue`, `Check`, `Reject venue`, `X`, `Confirm reject`, `Cancel`
- Then: Same admin verification RPCs against the venue's pending request; reload

### States

- loading: Venues. Trigger: Loading Source: venues/list.tsx 'Loading venues...'
- error: Venues. Trigger: Query fails Source: EmptyState 'Could not load venues'
- empty: Venues. Trigger: No match Source: EmptyState 'No venues found' (Building2)
- loading: Venue detail. Trigger: Loading Source: venues/show.tsx 'Loading venue...'
- empty: Venue detail. Trigger: Unknown id Source: EmptyState 'Venue not found'
- error: Venue detail. Trigger: Query fails Source: EmptyState 'Could not load this venue'
- empty: Courts card. Trigger: No courts Source: EmptyState 'No courts on this venue'
- error: Venue detail. Trigger: Blank reason or RPC error Source: actionError 'A rejection reason is required.' or error.message
- gate: Venue detail. Trigger: Pending venue with no matching request (seeded venue, AD-11) Source: show.tsx 'This venue is pending, but no matching verification request was found. Check the Verification queue.'
- gate: Venue detail. Trigger: Already verified or rejected Source: show.tsx 'This venue was already <status>. Approve and reject are only available while a venue is pending.'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/admin-venues.jpeg
- docs/phases/evidence/p2-cycle2/admin-venue-detail-onboarding-demo-turf.jpeg


## 21. Moderation queue: approve or reject clips

Category: REELS / CONTENT (Clutch). Persona: admin. Money: no.

Clips in uploading, processing or ready status. Detail mints an admin only signed preview URL (edge function get-clip-moderation-url), approves (ready only) to publish or rejects with a required reason through moderate_clip.

Release note: RELEASE-TODO task 17 requires a named moderation owner with 24 hour response.

After success: Stays on /moderation/show/:id; badge 'Published' or 'Rejected' and read only card

### Screens

**01 Moderation queue**  
Route `/moderation`, source `apps/admin/src/pages/moderation/list.tsx`
- See: Heading 'Moderation queue', subtitle 'Clips awaiting review before they reach the feed. Approve to publish or reject with a reason.', table Clip (Video placeholder tile + caption), Creator, Sport, Uploaded, Status (Uploading, Processing, Ready for review).
- Do: Tap a row
- Then: /moderation/show/:id

**02 Clip moderation detail**  
Route `/moderation/show/:id`, source `apps/admin/src/pages/moderation/show.tsx`
- See: 'Back to queue', card with '<sport> clip', caption, creator, status badge, Heart likes, MessageCircle comments, Uploaded time; card 'Preview' with video player and 'Signed preview link, expires in N seconds...'; optional 'Rejection reason' card; action card 'Approve and publish' (Check, ready only) and 'Reject' (X) revealing 'Rejection reason, required' textarea, 'The reason is sent to the creator and recorded in the audit log.', 'Confirm reject', 'Cancel'.
- Do: Tap Approve and publish, or Reject then Confirm reject
- Tap targets: `Back to queue`, `ArrowLeft`, `Approve and publish`, `Check`, `Reject`, `X`, `Confirm reject`, `Cancel`
- Then: moderationApi.approveClip / rejectClip (rpc moderate_clip, apps/admin/src/pages/moderation/api.ts); notice shown and detail reloads

### States

- loading: Moderation queue. Trigger: Loading Source: list.tsx 'Loading queue...'
- error: Moderation queue. Trigger: Query fails Source: EmptyState 'Could not load the queue'
- empty: Moderation queue. Trigger: Nothing pending Source: EmptyState 'Nothing to review' (Film)
- loading: Clip moderation detail. Trigger: Loading Source: show.tsx 'Loading clip...'; preview 'Minting preview link...'
- empty: Clip moderation detail. Trigger: Unknown id Source: EmptyState 'Clip not found'
- error: Clip moderation detail. Trigger: Query fails Source: EmptyState 'Could not load this clip'
- error: Preview card. Trigger: Mint refused (403, 404 NOT_FOUND for placeholder bytes) Source: show.tsx previewError code + message, or 'This clip is terminal, so the preview link is refused by design.' for removed/rejected
- error: Action card. Trigger: Blank reason or INVALID_TRANSITION Source: show.tsx actionError code + message ('VALIDATION' 'A rejection reason is required.')
- success: Action card. Trigger: Approve or reject succeeds Source: show.tsx notice 'Clip approved and published to the feed.' or 'Clip rejected. The creator has been notified with the reason.' (CircleCheck)
- gate: Clip moderation detail. Trigger: Clip not pending Source: show.tsx 'This clip is <status>. Approve and reject are only available while a clip is awaiting review.'
- gate: Action card. Trigger: Clip uploading or processing Source: show.tsx canApprove only when status === 'ready', Approve button hidden


## 22. Reports queue: take down or dismiss

Category: REELS / CONTENT (Clutch). Persona: admin. Money: no.

User reports against published clips or comments. Detail shows the reported content (with signed preview for clips) and resolves via takedown (clip becomes removed) or dismissal, both with a required reason through resolve_report.

After success: Stays on /reports/show/:id with badge 'Taken down' or 'Dismissed' and the read only resolved card

### Screens

**01 Reports queue**  
Route `/reports?status=pending|actioned|dismissed|all`, source `apps/admin/src/pages/reports/list.tsx`
- See: Heading 'Reports queue', tabs Pending, Taken down, Dismissed, All with counts, table Reported (caption or comment text + entity type), Reporter, Reason, Filed, Status (Pending, Taken down, Dismissed).
- Do: Tap a tab or row
- Tap targets: `Pending`, `Taken down`, `Dismissed`, `All`
- Then: /reports/show/:id

**02 Report detail**  
Route `/reports/show/:id`, source `apps/admin/src/pages/reports/show.tsx`
- See: 'Back to queue', card 'Report on a clip/comment', reason as title, 'Filed by <name> on <time>', status badge; card 'Reported content' with clip caption, clip status badge and video preview, or the comment text; action card 'Take down' (Trash2) and 'Dismiss report' (X), each revealing 'Takedown reason, required' or 'Dismissal reason, required' textarea, helper copy, 'Confirm takedown' or 'Confirm dismissal', 'Cancel'.
- Do: Tap Take down or Dismiss report, enter reason, confirm
- Tap targets: `Back to queue`, `ArrowLeft`, `Take down`, `Trash2`, `Dismiss report`, `X`, `Confirm takedown`, `Confirm dismissal`, `Cancel`
- Then: moderationApi.removeReport / dismissReport (rpc resolve_report with p_action remove or dismiss); notice and reload

### States

- loading: Reports queue. Trigger: Loading Source: reports/list.tsx 'Loading reports...'
- error: Reports queue. Trigger: Query fails Source: EmptyState 'Could not load reports'
- empty: Reports queue. Trigger: No rows in filter Source: EmptyState 'Nothing to resolve' (Flag)
- loading: Report detail. Trigger: Loading Source: reports/show.tsx 'Loading report...'
- empty: Report detail. Trigger: Unknown id Source: EmptyState 'Report not found'
- error: Report detail. Trigger: Query fails Source: EmptyState 'Could not load this report'
- empty: Reported content. Trigger: Clip or comment deleted, or already removed Source: show.tsx 'The reported clip could not be loaded. It may have been deleted.', 'This clip is already removed, so no preview link is minted.', 'Preview link unavailable for this clip.', 'The reported comment could not be loaded. It may have been removed already.'
- empty: Reported content. Trigger: Report whose entity_type is neither clip nor comment (RELEASE-TODO AD-18 chat message) Source: show.tsx only loads clip or comment entities; any other type shows eyebrow 'Report on a <entity_type>' and the comment fallback 'The reported comment could not be loaded. It may have been removed already.'
- error: Action card. Trigger: Blank reason or RPC error Source: actionError 'A reason is required to resolve a report.' or code + message
- success: Action card. Trigger: Resolved Source: notice 'Content taken down. It is no longer playable and the creator has been notified.' or 'Report dismissed. The content was left in place.'
- gate: Report detail. Trigger: Report already resolved Source: show.tsx 'This report was already resolved as <status> on <time>. Resolution actions are only available while a report is pending.'


## 23. Users: search, suspend, reinstate

Category: ADMIN. Persona: admin. Money: no.

Read only user list with inline suspend and reinstate actions. Search matches name or phone only (email is not fetched; the select is id,name,phone,city,state,status,created_at,updated_at,user_roles(role)). There is no user detail route (/users/show/:id is not registered in App.tsx).

Release note: PRD-04 User Detail screen with activity summary not built; AD-19 email search not supported (name and phone only); AD-20 'open a user detail page' has no route; AD-23 activity summary does not exist. admin-users.jpeg is stale: 5 item sidebar and no Action column (pre SEC-F4).

After success: Stays on /users; the row's Status badge flips and the action button label swaps

### Screens

**01 Users**  
Route `/users`, source `apps/admin/src/pages/users/list.tsx`
- See: Heading 'Users', subtitle 'Every account on the platform, with its roles and status.', search 'Search by name or phone', table Name, Contact ('No phone on file' fallback), Roles (badges), Joined, Status (active/suspended), Action ('Suspend' destructive or 'Reinstate').
- Do: Tap Suspend or Reinstate on a row
- Tap targets: `Suspend`, `Reinstate`
- Then: Inline prompt row expands below the user

**02 Suspend / reinstate inline prompt**  
Route `/users`, source `apps/admin/src/pages/users/list.tsx`
- See: Field 'Reason for suspending, shown to the member' (placeholder 'Repeated policy violations after warning') or 'Note for the audit log, optional' (placeholder 'Appeal upheld'), helper copy about sign out and notification, buttons 'Confirm suspension' or 'Confirm reinstatement' and 'Cancel'.
- Do: Enter reason, confirm
- Tap targets: `Confirm suspension`, `Confirm reinstatement`, `Cancel`
- Then: rpc admin_suspend_user / admin_reinstate_user; row status updates locally

### States

- loading: Users. Trigger: Loading Source: users/list.tsx 'Loading users...'
- error: Users. Trigger: Query fails Source: EmptyState 'Could not load users'
- empty: Users. Trigger: No match Source: EmptyState 'No users found' (Users icon, imported as UsersIcon)
- error: Inline prompt. Trigger: Suspend with empty reason, or RPC error Source: actionError 'A reason is required to suspend an account.' or error.message
- processing: Inline prompt. Trigger: Submitting Source: button label 'Working...', disabled

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/admin-users.jpeg


## 24. Orders: list, filter, search, detail, advance status

Category: SPORTS GEAR. Persona: admin. Money: yes.

Every gear order with status tabs and search; detail shows items, ship to snapshot, shared BillSummary, an advance action (one legal forward step via the admin-order-advance edge function, location or note required) and the timeline. Refund and cancel actions do not exist.

Release note: Refund (PRD-04 FR-24/25) and Cancel actions are not built (commerce/status.ts nextStatus filters cancelled out; TEST-CATALOG AD-04, RELEASE-TODO AD-25, AD-27).

After success: Stays on /orders/show/:id; badge and timeline update; at delivered the card reads 'This order has reached delivered and cannot be advanced further.'

### Screens

**01 Orders**  
Route `/orders?status=placed|shipped|in_transit|delivered|cancelled`, source `apps/admin/src/pages/orders/list.tsx`
- See: Heading 'Orders', tabs All, Placed, Shipped, In transit, Delivered, Cancelled with counts, search 'Search by order number or buyer', table Order (mono number), Buyer, Placed, Total, Status.
- Do: Tap a row
- Tap targets: `All`, `Placed`, `Shipped`, `In transit`, `Delivered`, `Cancelled`
- Then: /orders/show/:id

**02 Order detail**  
Route `/orders/show/:id`, source `apps/admin/src/pages/orders/show.tsx`
- See: 'Back to orders', header card eyebrow 'Order' with mono order number, buyer and phone, status badge; card 'Items' (product title, variant label, xQty, 'Rs unit price'); card 'Delivery address' (MapPin, ship_to snapshot); card 'Bill' with BillSummary rows Subtotal, Delivery charges, GST and others, Donation roundup (only if > 0), totalLabel 'Total paid'; card 'Advance this order' with Location (placeholder 'Bengaluru hub') and Note (placeholder 'Handed to courier') inputs, helper 'A location or a note is required. It is recorded on the timeline the shopper sees.', button 'Move to <next status>' (Truck); card 'Timeline'.
- Do: Enter location or note, tap Move to <status>
- Tap targets: `Back to orders`, `ArrowLeft`, `Move to shipped`, `Move to in transit`, `Move to delivered`, `Truck`
- Then: advanceOrder via edge function admin-order-advance (apps/admin/src/pages/commerce/api.ts); notice 'Order moved to <status>.' and reload

### States

- loading: Orders. Trigger: Loading Source: orders/list.tsx 'Loading orders...'
- error: Orders. Trigger: Query fails Source: EmptyState 'Could not load orders'
- empty: Orders. Trigger: No match Source: EmptyState 'No orders found' (ShoppingBag)
- loading: Order detail. Trigger: Loading Source: orders/show.tsx 'Loading order...'
- empty: Order detail. Trigger: Unknown id Source: EmptyState 'Order not found'
- error: Order detail. Trigger: Query fails Source: EmptyState 'Could not load this order'
- error: Advance this order. Trigger: Edge function refusal (INVALID_TRANSITION etc.) Source: show.tsx error card with Mono code and message
- success: Advance this order. Trigger: Advance succeeds Source: notice 'Order moved to <status>.' with CircleCheck
- gate: Advance this order. Trigger: Terminal status Source: show.tsx 'This order has reached <status> and cannot be advanced further.'; button disabled until location or note entered


## 25. Catalog and stock: edit product, variants, adjust stock, images

Category: SPORTS GEAR. Persona: admin. Money: yes.

Product list with raw stock and held columns; product detail edits title, description, category and base price, toggles active, adds or deletes variants, adjusts stock with a required reason, and reorders or sets primary images. All through admin_* RPCs. No create product screen.

Release note: Create product screen not built (RELEASE-TODO AD-37 and task 6 'data entry path' pending) although catalogApi.createProduct (rpc admin_create_product) exists in apps/admin/src/pages/commerce/api.ts. Image upload not built, only reorder/primary of existing storage paths.

After success: Stays on /products/show/:id with a success notice card

### Screens

**01 Catalog**  
Route `/products?category=<id>`, source `apps/admin/src/pages/products/list.tsx`
- See: Heading 'Catalog', category tabs (All + each category) with counts, search 'Search by product or category', table Product, Category, Variants, Raw stock, Held, Base price, State; footer note explaining raw vs held.
- Do: Tap a row
- Tap targets: `All`
- Then: /products/show/:id

**02 Product detail**  
Route `/products/show/:id`, source `apps/admin/src/pages/products/show.tsx`
- See: 'Back to catalog', card 'Product' with title, active badge, 'Deactivate' (EyeOff) or 'Reactivate' (Eye), form Title, Description, Category select, Base price, 'Save product' (Save). Card 'Variants and inventory' with 'N raw, N held', table SKU, Size, Color, Price override, Raw stock, Held, Available, per row 'Adjust stock' and Trash2 delete; adjust panel 'Stock take. Enter the count actually on the shelf.' with New count, 'Reason, required', 'Save adjustment', 'Cancel'; 'Add a variant' form (SKU, Size, Color, Price override, Opening stock, 'Add variant' Plus). Card 'Images' rows with ArrowUp, ArrowDown, 'Primary' (Star).
- Do: Edit and save, toggle active, add or delete variant, adjust stock with reason, reorder images
- Tap targets: `Back to catalog`, `ArrowLeft`, `Deactivate`, `EyeOff`, `Reactivate`, `Eye`, `Save product`, `Save`, `Adjust stock`, `Trash2`, `Save adjustment`, `Cancel`, `Add variant`, `Plus`, `ArrowUp`, `ArrowDown`, `Primary`, `Star`
- Then: catalogApi RPCs (admin_update_product, admin_set_product_active, admin_create_variant, admin_delete_variant, admin_adjust_variant_stock, admin_set_product_media in apps/admin/src/pages/commerce/api.ts); notice then reload

### States

- loading: Catalog. Trigger: Loading Source: products/list.tsx 'Loading catalog...'
- error: Catalog. Trigger: Query or stock RPC fails Source: EmptyState 'Could not load the catalog'
- empty: Catalog. Trigger: No match Source: EmptyState 'No products found' (Package)
- loading: Product detail. Trigger: Loading Source: products/show.tsx 'Loading product...'
- empty: Product detail. Trigger: Unknown id Source: EmptyState 'Product not found'
- error: Product detail. Trigger: Query fails Source: EmptyState 'Could not load this product'
- empty: Variants and inventory. Trigger: No variants Source: EmptyState 'No variants yet'
- empty: Images. Trigger: No media Source: EmptyState 'No images' (Image)
- error: Product detail. Trigger: Any RPC refusal Source: show.tsx error card with message or 'Something went wrong. Try again.'
- success: Product detail. Trigger: Mutation succeeds Source: notice card: 'Product saved.', 'Product hidden from the shopper catalog.', 'Product restored to the shopper catalog.', 'Variant added.', 'Variant removed.', 'Stock adjusted.', 'Image order updated.', 'Primary image updated.'
- gate: Adjust stock panel. Trigger: Reason empty Source: show.tsx 'Save adjustment' disabled while adjustReason is blank; 'Add variant' disabled while SKU blank


## 26. Drills: list, filter, create, edit, activate or deactivate

Category: LEARN. Persona: admin. Money: no.

Drill catalog with sport, difficulty and state chip filters; create and edit share one form; active toggle is a separate audited RPC.

After success: Create lands on /drills/show/:id of the new drill; edit stays on the detail with notice

### Screens

**01 Drills**  
Route `/drills?sport=&difficulty=&active=`, source `apps/admin/src/pages/drills/list.tsx`
- See: Heading 'Drills', 'New drill' (Plus), filter chip groups Sport (All + sports), Difficulty (All + levels), State (All, Active, Inactive), table Title, Sport, Skill category, Difficulty, XP value, State; footer 'N of N shown are active...'.
- Do: Tap New drill or a row
- Tap targets: `New drill`, `Plus`, `All`, `Active`, `Inactive`
- Then: /drills/create or /drills/show/:id

**02 New drill**  
Route `/drills/create`, source `apps/admin/src/pages/drills/create.tsx`
- See: 'Back to drills', heading 'New drill', subtitle 'A new drill is active and available to players as soon as you save it.', DrillForm (drills/form.tsx): Title, Description, Sport select, Difficulty select, Skill category, XP value (mono), 'Media URL, optional', 'Create drill' (Save).
- Do: Fill and tap Create drill
- Tap targets: `Back to drills`, `ArrowLeft`, `Create drill`, `Save`
- Then: rpc admin_upsert_drill (p_id null, drills/api.ts) then navigate to /drills/show/<new id>

**03 Drill detail / edit**  
Route `/drills/show/:id`, source `apps/admin/src/pages/drills/show.tsx`
- See: 'Back to drills', card 'Drill' with title, 'Worth N XP on completion.', active badge, 'Deactivate' (EyeOff) or 'Activate' (Eye), DrillForm prefilled with 'Save drill'.
- Do: Edit and Save drill, or toggle Activate/Deactivate
- Tap targets: `Back to drills`, `ArrowLeft`, `Deactivate`, `EyeOff`, `Activate`, `Eye`, `Save drill`, `Save`
- Then: admin_upsert_drill / admin_set_drill_active; notice and reload

### States

- loading: Drills. Trigger: Loading Source: drills/list.tsx 'Loading drills...'
- error: Drills. Trigger: Query fails Source: EmptyState 'Could not load drills'
- empty: Drills. Trigger: No match Source: EmptyState 'No drills found' (GraduationCap) 'No drills match these filters. Create one to get started.'
- error: DrillForm. Trigger: XP not a positive integer Source: drills/form.tsx 'XP value must be a whole number greater than zero.'; submit disabled until canSave
- error: New drill, Drill detail. Trigger: RPC refusal Source: create.tsx / show.tsx error card message or 'Something went wrong. Try again.'
- loading: Drill detail. Trigger: Loading Source: show.tsx 'Loading drill...'
- empty: Drill detail. Trigger: Unknown id Source: EmptyState 'Drill not found'
- error: Drill detail. Trigger: Query fails Source: EmptyState 'Could not load this drill'
- success: Drill detail. Trigger: Save or toggle succeeds Source: notice 'Drill saved.', 'Drill hidden from players.', 'Drill restored and visible to players.'


## 27. Fee config editing

Category: PAYMENT. Persona: admin. Money: yes.

Fee rows grouped by domain (Courts, Sessions, Commerce, Donations). Inline edit with range validation (percent 0 to 100, flat non negative) and a required change note, saved through admin_update_fee_config.

After success: Stays on /fee-config with the updated value

### Screens

**01 Fee config**  
Route `/fee-config`, source `apps/admin/src/pages/fee-config/list.tsx`
- See: Heading 'Fee config', subtitle 'Platform fees and rates, grouped by domain. Edits apply only to bookings, sessions, and orders created after the change.', one card per domain with table Key, Type (badge 'percent' or 'flat, rupees'), Value ('12.00 percent' or 'Rs 10.00'), 'Edit' (Pencil). Edit reveals 'Value, percent (0 to 100)' or 'Value, rupees' input, 'Change note, required' (placeholder 'Why is this changing'), 'Save', 'Cancel' (X).
- Do: Tap Edit, change value, enter note, tap Save
- Tap targets: `Edit`, `Pencil`, `Save`, `Cancel`, `X`
- Then: rpc admin_update_fee_config; list reloads

### States

- loading: Fee config. Trigger: Loading Source: fee-config/list.tsx 'Loading fee config...'
- error: Fee config. Trigger: Query fails Source: EmptyState 'Could not load fee config'
- empty: Fee config. Trigger: No rows Source: EmptyState 'No fee config rows' (Percent)
- error: Edit row. Trigger: Invalid number, percent out of range (AD-29 value 150), negative flat, or empty note (AD-30) Source: validationError 'Enter a valid number.', 'Percentage fields must be between 0 and 100.', 'Flat fee fields must be non negative.', 'A change note is required.'
- error: Fee config. Trigger: RPC error Source: actionError paragraph above the cards
- processing: Edit row. Trigger: Saving Source: Save and Cancel disabled while submitting

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/admin-fee-config.jpeg


## 28. Bookings (read only support list)

Category: COURTS. Persona: admin. Money: yes.

Most recent 200 court bookings with venue, court, booker, slot, total, booking status and payment intent status. No actions.

Release note: After RELEASE-TODO task 5 (courts become affiliate click out) only walk in bookings will keep arriving here. Query uses .limit(200).

After success: Stays on /bookings

### Screens

**01 Bookings**  
Route `/bookings`, source `apps/admin/src/pages/bookings/list.tsx`
- See: Heading 'Bookings', subtitle 'Every court booking with its payment status, read only, for support. The most recent 200 bookings.', search 'Search by venue, court, or player', table Venue / Court, Booked by ('name' or 'name, walk in' or 'Walk in'), Date / slot (mono), Total, Booking status badge, Payment status badge ('captured', 'failed', or 'no payment intent').
- Do: Search
- Then: Client side filter

### States

- loading: Bookings. Trigger: Loading Source: bookings/list.tsx 'Loading bookings...'
- error: Bookings. Trigger: Query fails Source: EmptyState 'Could not load bookings'
- empty: Bookings. Trigger: No match Source: EmptyState 'No bookings found' (CalendarClock)
- failed: Bookings row. Trigger: Payment failed or booking cancelled/expired/no_show Source: bookings/list.tsx paymentStatusTone 'failed' danger; bookingStatusTone danger

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/admin-bookings.jpeg

