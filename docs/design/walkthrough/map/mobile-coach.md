# Mobile: coach mode

Part of the verified workflow map, see [README.md](README.md). 18 workflows, 46 screens.

## Contents

1. Coach onboarding wizard (seven steps) and submit for review (coach)
2. Coach verification status (pending, approved, rejected, resubmit) (coach)
3. Coach Stats dashboard (Trainings tab as a verified coach) (coach, money)
4. Availability: add and delete weekly windows (coach)
5. Session types management (does not exist post onboarding) (coach)
6. Session requests: accept or decline (coach, money)
7. Requested session detail (read only, Accept and Decline are card only) (coach)
8. Upcoming sessions list (coach) (coach)
9. 1:1 session lifecycle: Mark complete, Cancel with reason, Reschedule (coach, money)
10. Trainees tab: roster with filters, group cards and trainee cards (coach)
11. Trainee profile: Overview, Sessions, Payments, Notes, Video Analytics, Message (coach, money)
12. Training group profile (view only) and group creation, edit, scheduling (not built in mobile) (coach, money)
13. Group session: Start session, Mark attendance, End session (coach)
14. Earnings tab, payout account setup and transfer to bank (coach, money)
15. Coach chat: thread list, 1:1 and group threads, send message (coach)
16. Coach analytics (sub nav label 'Video Analytics', content is numeric trends) (coach)
17. Coach video review upload (not reachable) and athlete 'My review videos' (coach)
18. Settings from the Trainings shell (coach) (coach)

---

## 1. Coach onboarding wizard (seven steps) and submit for review

Category: ACCOUNT. Persona: coach. Money: no.

A signed in user picks 'I am a coach' at role select and walks the seven step coach setup wizard (Sport, Photo, Experience, Certificates, Pricing, Availability, About). Submit calls the submit_coach_verification RPC and shows 'Submitted for review', not a success dashboard. Entry points: Home 'Finish setting up' card (shown while me.city is empty and not dismissed) which goes to role select; Settings > Account > 'Become a coach' (shown unless coachStatus is verified or pending_review, so rejected coaches also see it) which goes straight to coach-setup/0; 'Edit and resubmit' on a rejected verification status; 'Start coach setup' on trainings/verification. Register and login replace to (tabs), never to role select.

Release note: RELEASE-TODO C-01 says 'sign up a brand new account and pick Coach at role select'; register.tsx replaces to (tabs), so the tester reaches role select via the Home 'Finish setting up' card, not directly after sign up.

After success: Home tab (atlitos://, the (tabs) index). Trainings tab (atlitos://trainings) shows 'Submitted for review' pending status with no sub nav.

### Screens

**01 Role select**  
Route `atlitos://role-select`, source `apps/mobile/src/app/(onboarding)/role-select.tsx`
- See: Heading 'How will you use Atlitos.' with body 'You can add the other role later from your account.' Two cards: 'I am a player' (Dumbbell icon, 'Book coaches and courts, buy gear, and track your progress.') and 'I am a coach' (ClipboardList icon, 'List your sessions and pricing, and get discovered by players.'), each with a ChevronRight. Text button 'Explore the app first'.
- Do: Tap the 'I am a coach' card
- Tap targets: `I am a coach`, `I am a player`, `Explore the app first`
- Then: Pushes /(onboarding)/coach-setup/0 (Sport step). 'Explore the app first' sets the onboarding deferred flag and replaces to Home.

**02 Coach setup step 1 of 7, Sport**  
Route `atlitos://coach-setup/0`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: Stepper with labels Sport, Photo, Experience, Certificates, Pricing, Availability, About. Heading 'What do you coach.' body 'One sport per coach profile. This cannot change once you submit.' Select chips Football, Cricket, Badminton, Tennis. Bottom row: 'Back' (secondary) and 'Next' (primary, disabled until a sport is selected).
- Do: Tap one sport chip, then Next
- Tap targets: `Football`, `Cricket`, `Badminton`, `Tennis`, `Back`, `Next`
- Then: draft.sport set; Next pushes step 1.

**03 Coach setup step 2 of 7, Photo**  
Route `atlitos://coach-setup/1`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: Heading 'Add a photo.' A tappable 80pt Avatar. While uploading, caption 'Uploading.' Photo is optional; Next is always enabled on this step.
- Do: Tap the avatar to open the image library, pick a square crop
- Tap targets: `Back`, `Next`
- Then: uploadAvatar stores the image and sets draft.avatarUrl. Permission denied shows 'Photo library access was not granted.' Upload failure shows 'Could not upload photo right now, you can add one later from your profile.'

**04 Coach setup step 3 of 7, Experience**  
Route `atlitos://coach-setup/2`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: Heading 'Your experience.' Inputs 'Years coaching' (required, numeric) and 'Coaching style' (multiline, placeholder 'Technical drills, match simulation, fitness focus...'). Next is always enabled on this step.
- Do: Fill the fields, tap Next
- Tap targets: `Years coaching`, `Coaching style`, `Back`, `Next`
- Then: Draft updated, pushes step 3.

**05 Coach setup step 4 of 7, Certificates**  
Route `atlitos://coach-setup/3`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: Heading 'Upload certificates.' body 'At least one is required, coaching licenses or certifications.' Each picked file renders as a row with FileText icon, file name, and a Trash2 remove control; a failed row has a danger border and caption 'Upload failed, remove and try again.' Secondary button 'Add certificate' (Plus icon) with a loading spinner while uploading. Next is disabled until at least one certificate has a real storagePath.
- Do: Tap 'Add certificate', multi select images from the library
- Tap targets: `Add certificate`, `Trash2`, `Back`, `Next`
- Then: uploadCoachCertificate writes to the coach-certificates bucket per file; rows appear; Next unlocks once one upload succeeded.

**06 Coach setup step 5 of 7, Pricing (session types)**  
Route `atlitos://coach-setup/4`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: Heading 'Session types and pricing.' body 'Athletes will pay the price you set. You will receive it after our platform fee is deducted.' Each session type card: label 'Session N', Trash2 remove, inputs 'Name' (placeholder 'One on one'), 'Duration (min)' (default 60), 'Session fee (INR)'. Inline caption 'Give this session a name and a price above zero.' on a touched invalid row. Secondary button 'Add session type' (Plus). Next disabled until at least one row exists and every row is valid.
- Do: Tap 'Add session type', fill name, duration and fee, tap Next
- Tap targets: `Add session type`, `Name`, `Duration (min)`, `Session fee (INR)`, `Trash2`, `Back`, `Next`
- Then: Session types saved to the draft; inserted into session_types by the submit RPC at the end. This is the only place session types are managed in the mobile app.

**07 Coach setup step 6 of 7, Availability**  
Route `atlitos://coach-setup/5`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: Heading 'Weekly availability.' Each window card: label 'Window N', Trash2, day select chips Sun Mon Tue Wed Thu Fri Sat, inputs 'From (HH:MM)' and 'To (HH:MM)' (defaults 06:00 and 08:00, default day Mon). Inline captions 'Use 24 hour times like 06:30 for From and To.' or 'From must be earlier than To.' on invalid rows (danger border). Secondary button 'Add availability window' (Plus). Next disabled until at least one valid window.
- Do: Tap 'Add availability window', pick a day, set times, tap Next
- Tap targets: `Add availability window`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `From (HH:MM)`, `To (HH:MM)`, `Trash2`, `Back`, `Next`
- Then: Windows saved to the draft; a 25:00 start fails the HH:MM regex and blocks Next with the inline caption.

**08 Coach setup step 7 of 7, About**  
Route `atlitos://coach-setup/6`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: Heading 'About you.' Inputs 'City' (required), 'State', 'Bio' (multiline, placeholder 'Tell players about your coaching background.'). Primary button reads 'Submit' on this last step and is disabled until City is non empty. Any submit error renders as a danger caption above the buttons.
- Do: Fill City, tap Submit
- Tap targets: `City`, `State`, `Bio`, `Back`, `Submit`
- Then: profile.submitCoachVerification runs the submit_coach_verification RPC (sport, experience, style, bio, city, state, certificates, session types, availability windows), refreshMe, clears the onboarding deferred flag, then renders the submitted screen.

**09 Submitted for review**  
Route `atlitos://coach-setup/6`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: CircleCheck icon (success), heading 'Submitted for review.', body 'An admin will review your profile. You will be notified once you are verified and discoverable to players.' Primary button 'Go to home'.
- Do: Tap 'Go to home'
- Tap targets: `Go to home`
- Then: Resets the coach draft and replaces the stack with the tabs root (Home). Trainings now shows the pending verification status until an admin approves.

### States

- gate: Coach setup step gates. Trigger: Try Next on Sport with no chip, Certificates with no successful upload, Pricing with an invalid or empty row, Availability with invalid or no window, About with empty City Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx canGoNext (stepIndex 0, 3, 4, 5, 6) and Button disabled={!canGoNext}
- error: Photo or certificate permission denied. Trigger: Deny photo library permission when picking Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx handlePickPhoto / handlePickCertificates: 'Photo library access was not granted.'
- error: Photo upload failed. Trigger: uploadAvatar throws Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx: 'Could not upload photo right now, you can add one later from your profile.'
- failed: Certificate upload failed row. Trigger: coach-certificates bucket missing or upload throws Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx handlePickCertificates: row uploadError 'Upload failed, remove and try again.', danger border
- error: Pricing row invalid. Trigger: Blank name or price 0 on a touched row Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx sessionTypeIssue: 'Give this session a name and a price above zero.'
- error: Availability row invalid. Trigger: Type 25:00 or a To earlier than From Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx availabilityIssue: 'Use 24 hour times like 06:30 for From and To.' / 'From must be earlier than To.'
- error: Submit guards (deep link to last step). Trigger: Deep link to coach-setup/6 with bad draft rows and tap Submit Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx handleFinish: 'Add at least one certificate that uploaded successfully before you submit.', 'A certificate upload failed. Remove it or add it again before you submit.', 'Every session type needs a name and a price above zero.', 'Check your availability times before you submit.'
- error: Submit RPC failed. Trigger: submit_coach_verification RPC throws Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx handleFinish catch: setError(friendlyAuthMessage(err))
- processing: Submitting. Trigger: Tap Submit Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx Button loading={submitting}
- success: Submitted for review. Trigger: Submit succeeds Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx `if (submitted)` branch, CircleCheck + 'Submitted for review.'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3/onboarding-role-select-light.png


## 2. Coach verification status (pending, approved, rejected, resubmit)

Category: ACCOUNT. Persona: coach. Money: no.

After submitting the wizard, the Trainings tab root renders the CoachVerificationStatus organism instead of the dashboard while coachStatus is pending_review or rejected; the shell hides TrainingsSubNav and the RefreshControl for these states. A verified coach lands on the Stats dashboard. The dedicated trainings/verification route exists with loading, error, populated and 'not started' states but no screen in the app links to it (deep link only). Approval is an admin action in apps/admin. `me` is only refetched by session-store applySession on an auth state change, so after approval the coach must relaunch the app or sign out and in; re-opening the tab does not refetch.

Release note: trainings/verification has no in app entry point (grep of apps/mobile/src finds no push to it); deep link only. RELEASE-TODO C-08 'pull to refresh the Trainings tab' cannot work for a pending coach: no RefreshControl renders and `me` only refetches on an auth state change (relaunch or sign out and in). Admin approval lives in apps/admin Verification queue (RELEASE-TODO AD-07).

After success: Verified coach: Trainings Stats dashboard (atlitos://trainings). Rejected coach tapping Edit and resubmit: atlitos://coach-setup/0.

### Screens

**01 Trainings tab, pending review**  
Route `atlitos://trainings`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx`
- See: Shell header 'Trainings' with a Settings gear (accessibilityLabel 'Settings'). No sub nav, no pull to refresh. Centered Clock icon in a warning tint circle, heading 'Submitted for review', body 'We are reviewing your certificates and profile. You will be able to receive session requests once approved.' (rendered by CoachVerificationStatus).
- Do: Wait for admin approval; relaunch the app
- Tap targets: `Settings`
- Then: Once me.coachStatus becomes 'verified' (after an auth state change refetch) the same route renders the coach Stats dashboard with the five tab sub nav.

**02 Trainings tab, rejected**  
Route `atlitos://trainings`, source `apps/mobile/src/components/organisms/CoachVerificationStatus.tsx`
- See: TriangleAlert icon in a danger tint circle, heading 'Your coach application was not approved', the admin's rejectionReason text if present (fetched via verification.getStatus in index.tsx), primary button 'Edit and resubmit'.
- Do: Tap 'Edit and resubmit'
- Tap targets: `Edit and resubmit`
- Then: Pushes /(onboarding)/coach-setup/0 to rerun the wizard.

**03 Coach verification (dedicated route)**  
Route `atlitos://trainings/verification`, source `apps/mobile/src/app/(tabs)/trainings/verification.tsx`
- See: AppBar 'Coach verification' with back. Loading skeleton (circle plus two lines). Populated renders CoachVerificationStatus for pending_review, verified (BadgeCheck icon, 'You are a verified coach', 'Athletes can find and book you now.') or rejected. If the caller has no coach profile: 'You have not started coach setup yet' with button 'Start coach setup'. Error: 'Could not load your verification status' with 'Retry'.
- Do: Read status, or tap 'Start coach setup' / 'Retry' / 'Edit and resubmit'
- Tap targets: `Start coach setup`, `Retry`, `Edit and resubmit`
- Then: Start coach setup and Edit and resubmit push coach-setup/0; Retry reloads getStatus.

### States

- processing: Trainings tab, pending review. Trigger: coachStatus === 'pending_review' Source: apps/mobile/src/components/organisms/CoachVerificationStatus.tsx default branch: Clock icon, 'Submitted for review'
- success: Coach verification, verified. Trigger: coachStatus === 'verified' on trainings/verification Source: apps/mobile/src/components/organisms/CoachVerificationStatus.tsx status === 'verified': BadgeCheck, 'You are a verified coach'
- failed: Trainings tab, rejected. Trigger: coachStatus === 'rejected' Source: apps/mobile/src/components/organisms/CoachVerificationStatus.tsx status === 'rejected': 'Your coach application was not approved', 'Edit and resubmit'
- loading: Coach verification. Trigger: Open trainings/verification Source: apps/mobile/src/app/(tabs)/trainings/verification.tsx state === 'loading' Skeleton circle + lines
- error: Coach verification. Trigger: getStatus throws Source: apps/mobile/src/app/(tabs)/trainings/verification.tsx: 'Could not load your verification status', Retry
- empty: Coach verification, not started. Trigger: No coach profile row for the caller Source: apps/mobile/src/app/(tabs)/trainings/verification.tsx: 'You have not started coach setup yet', 'Start coach setup'
- loading: Trainings tab, profile loading. Trigger: signed_in with meLoading and no me Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx showLoading Skeleton
- error: Trainings tab, profile failed. Trigger: meError set Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx EmptyState 'Could not load your dashboard', 'Check your connection and try again.', Retry -> refreshMe

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/admin-verification-queue-coach.jpeg


## 3. Coach Stats dashboard (Trainings tab as a verified coach)

Category: COACHES. Persona: coach. Money: yes.

The Trainings tab root for a verified coach. Fixed shell owns the 'Trainings' title, Settings gear and the TrainingsSubNav with tabs Stats, Trainees, Earnings, Chat, Video Analytics. The Stats tab shows six stat tiles, an Upcoming sessions preview (3) with 'Availability' and 'View all' links, a Session requests preview (3) with inline Accept and Decline, and the Milestones rail with 'Open Learn'.

Release note: UI-UPLIFT-PROPOSAL 'Role aware Trainings' (Trainings section item 5, line 62) flags that players can open coach only tabs (Earnings errors 'caller holds no coach profile'); 'segmented control' (visual section item 14, line 31) proposes replacing the underline tab strip. Both unbuilt as of source.

After success: Stays on the Stats tab after Accept or Decline (silent reload). Sub nav tabs use router.navigate so back from any tab exits the module to Home.

### Screens

**01 Trainings, Stats tab (coach)**  
Route `atlitos://trainings`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx`
- See: Sub nav: Stats, Trainees, Earnings, Chat, Video Analytics. Stat tiles: 'Players coached' (Users), 'Avg rating' (Star), 'Total sessions' (Dumbbell), 'Sessions this month' (CalendarClock), 'Total earnings' (IndianRupee), 'Earnings this month' (IndianRupee), amounts via formatINR in mono. Section 'Upcoming sessions' with text buttons 'Availability' and 'View all', up to 3 SessionCards (variant upcoming: name, session type, 'date, HH:MM to HH:MM', focus area or 'No focus area noted', location or 'Location to be confirmed') or 'No upcoming sessions'. Section 'Session requests' with 'View all' (only when more than 3), request SessionCards with 'Accept' and 'Decline' or 'No pending requests'. Per card 'Updating...' while acting, danger caption on failure. MilestonesRail 'Milestones and rewards' with 'Open Learn' at the bottom. Pull to refresh.
- Do: Tap a session card, Accept/Decline, Availability, View all, Open Learn, or a sub nav tab
- Tap targets: `Stats`, `Trainees`, `Earnings`, `Chat`, `Video Analytics`, `Settings`, `Availability`, `View all`, `Accept`, `Decline`, `Open Learn`
- Then: Session card opens trainings/session/[id]; Availability opens trainings/availability; Upcoming View all opens trainings/upcoming; Requests View all opens trainings/requests; Accept calls session_transition 'accept'; Decline calls decline-session-refund; Open Learn pushes /learn; Settings pushes /settings.

### States

- loading: Trainings, Stats tab (coach). Trigger: First load of the coach dashboard Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx dashState === 'loading' Skeleton cards
- error: Trainings, Stats tab (coach). Trigger: getStats/listRequests/listUpcoming throws Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx dashState === 'error' EmptyState 'Could not load your dashboard', Retry
- empty: Trainings, Stats tab (coach), no sessions yet. Trigger: No requests, no upcoming and sessionsThisMonth === 0 Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx EmptyState Dumbbell 'No sessions yet', 'Set your availability so athletes can find open slots and send you a request.', CTA 'Set your availability' -> trainings/availability
- empty: Upcoming sessions section. Trigger: upcoming.length === 0 while other data exists Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx 'No upcoming sessions'
- empty: Session requests section. Trigger: requests.length === 0 Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx 'No pending requests'
- empty: Milestones rail. Trigger: Learn read fails or no milestones Source: apps/mobile/src/components/organisms/trainings/MilestonesRail.tsx EmptyState Trophy 'No milestones yet', 'Complete drills in Learn to earn XP and unlock milestones.', CTA 'Open Learn'
- processing: Request card acting. Trigger: Tap Accept or Decline Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx actioningId === session.id 'Updating...'
- error: Request card action failed. Trigger: accept/decline RPC throws Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx actionErrorId caption dashError.message or 'Could not update this request. Try again.'
- gate: Trainings tab as guest. Trigger: Open Trainings while not signed in Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx requiresAuthGate EmptyState Lock 'Set up your profile to train', CTA 'Get started' -> LoginGateModal

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3/coach-home-light.png
- docs/phases/evidence/p3/coach-home-dark.png
- docs/phases/evidence/p9-native/03-trainings-guest-gate.png
- docs/phases/evidence/p3-web-cycle2/web-coach-trainings-dark.jpg


## 4. Availability: add and delete weekly windows

Category: COACHES. Persona: coach. Money: no.

The only input to the slot engine. Windows are grouped by day (Sunday to Saturday); each day has an 'Add window' inline form and each window row a Trash2 delete. Client side validation for HH:MM, order and same day overlap; the database exclusion constraint is the real guard. There is no blocked date UI. Reached from the Stats dashboard 'Availability' link or the empty state CTA 'Set your availability'.

Release note: Silent delete failure (no visible error) is a QA note for RELEASE-TODO C-16.

After success: Stays on Availability with the updated list; back returns to the Stats tab.

### Screens

**01 Availability**  
Route `atlitos://trainings/availability`, source `apps/mobile/src/app/(tabs)/trainings/availability.tsx`
- See: AppBar 'Availability' with back. Intro 'Athletes can only book within these windows. Changes apply to future bookings only.' Seven day sections (Sunday ... Saturday) each with a text button 'Add window' (Plus). Rows show CalendarClock icon, 'HH:MM to HH:MM' in mono, and a Trash2 delete button (spinner while deleting). Days with no rows show 'No windows set'.
- Do: Tap 'Add window' on a day
- Tap targets: `Add window`, `Trash2`
- Then: An inline form opens under that day with 'From' and 'To' fields (placeholders 06:00 / 08:00) and a button 'Save {Sun|Mon|...} window' (day short label). Tapping 'Add window' again closes it.

**02 Availability, add window form**  
Route `atlitos://trainings/availability`, source `apps/mobile/src/app/(tabs)/trainings/availability.tsx`
- See: Bordered card with 'From' and 'To' TextFields, optional danger caption, primary small button 'Save Sun window' / 'Save Mon window' / ... / 'Save Sat window' with loading spinner.
- Do: Enter times, tap Save
- Tap targets: `From`, `To`, `Save Sun window`, `Save Mon window`, `Save Tue window`, `Save Wed window`, `Save Thu window`, `Save Fri window`, `Save Sat window`
- Then: availability.createWindow inserts the row; the form closes and the row appears. Errors: 'Enter times as HH:MM, for example 06:00.', 'The end time must be after the start time.', 'This overlaps another window on the same day.', or the server message.

**03 Availability, delete window**  
Route `atlitos://trainings/availability`, source `apps/mobile/src/app/(tabs)/trainings/availability.tsx`
- See: Trash2 button on the row shows a spinner while deleting.
- Do: Tap Trash2 on a window row
- Tap targets: `Trash2`
- Then: availability.deleteWindow removes the row (no confirm dialog). Already accepted sessions are untouched (FR-23). A delete failure is silent: setError runs but state stays 'populated', so no error UI renders and the row stays.

### States

- loading: Availability. Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/availability.tsx state === 'loading' Skeleton
- error: Availability. Trigger: listWindows throws (deleteWindow failures do NOT reach this state) Source: apps/mobile/src/app/(tabs)/trainings/availability.tsx state === 'error': 'Could not load your availability', Retry; handleDelete catch only setError without setState('error')
- empty: Availability, day with no windows. Trigger: No rows on that day Source: apps/mobile/src/app/(tabs)/trainings/availability.tsx 'No windows set'
- error: Availability, add form validation. Trigger: Bad HH:MM, To before From, overlap Source: apps/mobile/src/app/(tabs)/trainings/availability.tsx handleAdd formError strings
- processing: Availability, saving or deleting. Trigger: Tap Save or Trash2 Source: apps/mobile/src/app/(tabs)/trainings/availability.tsx Button loading={submitting} / loading={deletingId === window.id}


## 5. Session types management (does not exist post onboarding)

Category: COACHES. Persona: coach. Money: no.

Session types (name, duration, price) are created only in the coach setup wizard Pricing step (coach-setup/4) and inserted by the submit_coach_verification RPC. There is no screen, hook or RPC in apps/mobile or packages/api to add, edit, hide or delete a session type after onboarding (packages/api reads session_types only via joins and one select of duration_minutes). RELEASE-TODO scenarios C-10 to C-13 have no UI to run against; only C-11's validation exists inside the wizard step.

Release note: Not built: no post onboarding session type CRUD or hidden toggle anywhere in apps/mobile/src or packages/api/src (grep for session_types shows only reads). RELEASE-TODO C-10, C-12, C-13 cannot be executed as written.

After success: Wizard continues to Availability step; nothing else.

### Screens

**01 Coach setup step 5 of 7, Pricing (session types)**  
Route `atlitos://coach-setup/4`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: See the onboarding workflow: 'Session types and pricing.' cards with Name, Duration (min), Session fee (INR), 'Add session type'.
- Do: Add rows and continue
- Tap targets: `Add session type`, `Name`, `Duration (min)`, `Session fee (INR)`, `Trash2`, `Next`
- Then: Rows are persisted only at wizard submit. A rejected coach can rerun the wizard via 'Edit and resubmit'.

### States

- error: Pricing row invalid. Trigger: Blank name or price 0 on a touched row Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx sessionTypeIssue

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web-cycle2/web-athlete-coach-profile-sessiontypes-light.jpg
- docs/phases/evidence/p3-web-cycle2/web-athlete-coach-profile-sessiontypes-dark.jpg


## 6. Session requests: accept or decline

Category: BOOKING. Persona: coach. Money: yes.

Pending 1:1 booking requests (status requested, athlete already paid). Filter chips All / One on one / Group / Online. Accept runs session_transition 'accept'; Decline runs the decline-session-refund edge function (auto refund). Group sessions never appear here (coach scheduled, insert as accepted). Reached from the Stats dashboard 'View all' on Session requests (visible only when more than 3 requests) or by deep link.

After success: Stays on Requests (silent reload). Back returns to the Stats tab.

### Screens

**01 Requests**  
Route `atlitos://trainings/requests`, source `apps/mobile/src/app/(tabs)/trainings/requests.tsx`
- See: AppBar 'Requests' with back. When any request exists: SessionFilterChips All, One on one, Group, Online above a list of request SessionCards (name, session type, 'date, HH:MM to HH:MM', focus area, location) each with 'Accept' (primary) and 'Decline' (ghost danger). Per card 'Updating...' while acting and a danger caption on failure. Pull to refresh only in this populated state.
- Do: Tap Accept or Decline on a card, or tap the card body
- Tap targets: `Accept`, `Decline`, `All`, `One on one`, `Group`, `Online`
- Then: Accept: session becomes Accepted and disappears from the list. Decline: session becomes Declined with an automatic refund and disappears. Tapping the card body opens trainings/session/[id] (read only for a requested session).

### States

- loading: Requests. Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/requests.tsx state === 'loading' Skeleton cards
- empty: Requests. Trigger: No requested sessions at all (no chips, no pull to refresh in this state) Source: apps/mobile/src/app/(tabs)/trainings/requests.tsx state === 'empty' CalendarX2 'No pending requests'
- empty: Requests, filter empty. Trigger: Pick Group / Online / other filter with no matches Source: apps/mobile/src/app/(tabs)/trainings/requests.tsx ListEmptyComponent: 'Group sessions have no requests. Athletes join a group the moment their payment goes through.' / 'No pending online requests.' / 'No pending requests match this filter.'
- error: Requests. Trigger: listRequests throws Source: apps/mobile/src/app/(tabs)/trainings/requests.tsx 'Could not load requests', Retry
- processing: Requests, card acting. Trigger: Tap Accept or Decline Source: apps/mobile/src/app/(tabs)/trainings/requests.tsx actioningId 'Updating...'
- failed: Requests, action failed. Trigger: session_transition or decline-session-refund throws Source: apps/mobile/src/app/(tabs)/trainings/requests.tsx actionErrorId caption error.message or 'Could not update this request. Try again.'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web/web-coach-trainings-requests.jpg
- docs/phases/evidence/p3-web/web-coach-accept-request.jpg
- docs/phases/evidence/p3-web/web-coach-decline-request-nopending.jpg


## 7. Requested session detail (read only, Accept and Decline are card only)

Category: BOOKING. Persona: coach. Money: no.

Tapping the body of a Session request card (Stats preview or Requests list) opens the 1:1 session detail for a session still in 'requested'. SESSION_TRANSITIONS.requested only allows accepted or declined, and the detail screen renders buttons only for completed, cancelled and rescheduled edges, so the coach sees the summary card and 'You earn' with no action at all and must go back to the list to Accept or Decline.

Release note: Testers running RELEASE-TODO C-17 who tap the card instead of the Accept button will find no action on the detail; this is by design of the transitions map, not a bug.

After success: Back to the list that opened it (Stats or Requests).

### Screens

**01 Session (1:1 detail), requested**  
Route `atlitos://trainings/session/[id]`, source `apps/mobile/src/app/(tabs)/trainings/session/[id].tsx`
- See: AppBar 'Session' with back. Card: player name, StatusPill 'Requested', session type name, 'date, HH:MM to HH:MM', frequency label, 'Focus: ...' and location if set. Card 'You earn' with PriceText of total minus platformFee. No buttons.
- Do: Read, tap back
- Tap targets: `Session`
- Then: Returns to the Stats tab or Requests list where Accept and Decline live.

### States

- gate: Session (1:1 detail), requested. Trigger: Open a session whose status is requested Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx canComplete/canCancel/canReschedule all false via canTransition(SESSION_TRANSITIONS, 'requested', ...); packages/types/src/transitions/index.ts requested: ['accepted','declined']


## 8. Upcoming sessions list (coach)

Category: BOOKING. Persona: coach. Money: no.

Dedicated coach upcoming list mixing 1:1 accepted/rescheduled sessions with every group's accepted or in_progress sessions from today onward, soonest first, behind the shared filter chips. Reached from the Stats dashboard 'View all' on Upcoming sessions.

After success: Session detail or group session detail; back returns here then to the Stats tab.

### Screens

**01 Upcoming sessions**  
Route `atlitos://trainings/upcoming`, source `apps/mobile/src/app/(tabs)/trainings/upcoming.tsx`
- See: AppBar 'Upcoming sessions' with back. SessionFilterChips All, One on one, Group, Online. SessionCards (variant upcoming); group entries show the group name as person and session type 'Group session'. Pull to refresh (populated state only).
- Do: Tap a card
- Tap targets: `All`, `One on one`, `Group`, `Online`
- Then: 1:1 card opens trainings/session/[id]; group card opens trainings/group-session/[id].

### States

- loading: Upcoming sessions. Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/upcoming.tsx state === 'loading' Skeleton
- empty: Upcoming sessions. Trigger: No accepted 1:1 or group sessions from today onward Source: apps/mobile/src/app/(tabs)/trainings/upcoming.tsx CalendarX2 'No upcoming sessions', 'Accepted sessions and scheduled group sessions will show up here.'
- empty: Upcoming sessions, filter empty. Trigger: Filter yields nothing Source: apps/mobile/src/app/(tabs)/trainings/upcoming.tsx 'No upcoming group sessions.' / 'No upcoming online sessions.' / 'No upcoming sessions match this filter.'
- error: Upcoming sessions. Trigger: Reads throw Source: apps/mobile/src/app/(tabs)/trainings/upcoming.tsx 'Could not load upcoming sessions', Retry


## 9. 1:1 session lifecycle: Mark complete, Cancel with reason, Reschedule

Category: BOOKING. Persona: coach. Money: yes.

Coach session detail for a 1:1 session. Actions render only when SESSION_TRANSITIONS allows them from the current status. StatusPill labels: Requested, Accepted, In progress, Declined, Completed, Cancelled, Rescheduled, Rated (server enum requested, accepted, in_progress, declined, completed, cancelled, rescheduled, rated). Transitions: requested -> accepted | declined; accepted -> in_progress | completed | cancelled | rescheduled; in_progress -> completed; rescheduled -> completed | cancelled | rescheduled; completed -> rated (athlete only). There is NO 'Start session' button on a 1:1 session; Mark complete calls the complete-session edge function (TOO_EARLY / PAYMENT_NOT_CAPTURED gated server side, accrues the coach's ledger entry). Cancel requires a reason (REASON_REQUIRED) and a native confirm. Reschedule recomputes slots from the coach's own availability minus busy pairs and navigates to the NEW session id.

Release note: RELEASE-TODO C-19 says 'tap Start session, then Mark complete' on an accepted session; Start session exists only on group sessions. 1:1 sessions go straight to Mark complete.

After success: Stays on the same session detail (Mark complete, Cancel) or replaces to the new session id (Reschedule). Back returns to whichever list opened it (Stats, Requests, Upcoming).

### Screens

**01 Session (1:1 detail)**  
Route `atlitos://trainings/session/[id]`, source `apps/mobile/src/app/(tabs)/trainings/session/[id].tsx`
- See: AppBar 'Session' with back. Card: player name, StatusPill, session type name, 'date, HH:MM to HH:MM', frequency label (One time / Weekly / Monthly), 'Focus: ...', location, 'Reason: ...' if cancelled. Card 'You earn' with PriceText of total minus platformFee. Action stack depending on status: 'Mark complete' (CheckCircle2, primary), 'Reschedule' / 'Close reschedule' (CalendarClock, secondary), 'Cancel session' / 'Close cancel' (XCircle, ghost danger). Danger caption for action errors.
- Do: Tap Mark complete
- Tap targets: `Mark complete`, `Reschedule`, `Close reschedule`, `Cancel session`, `Close cancel`
- Then: complete-session edge function runs; on success the pill becomes Completed and the ledger accrual is written; on TOO_EARLY or PAYMENT_NOT_CAPTURED the error message shows inline.

**02 Session, cancel with reason**  
Route `atlitos://trainings/session/[id]`, source `apps/mobile/src/app/(tabs)/trainings/session/[id].tsx`
- See: Inline TextField 'Reason for cancelling' (placeholder 'Let the athlete know why', multiline) and destructive button 'Confirm cancel' (disabled until a reason is typed). Tapping it raises a native Alert 'Cancel this session' / 'The athlete will be notified and this slot will be released.' with 'Keep session' and 'Cancel session'.
- Do: Type a reason, tap Confirm cancel, then 'Cancel session' in the alert
- Tap targets: `Cancel session`, `Reason for cancelling`, `Confirm cancel`, `Keep session`
- Then: session_transition 'cancel' with the reason; pill becomes Cancelled and 'Reason: ...' renders on the card.

**03 Session, reschedule**  
Route `atlitos://trainings/session/[id]`, source `apps/mobile/src/app/(tabs)/trainings/session/[id].tsx`
- See: 'Pick a new date' with CalendarPicker, 'Pick a new time' with SlotPicker (skeleton tiles while loading, or 'No open slots on this date within your availability. Try another date.'), primary 'Confirm reschedule' (disabled until a slot is selected).
- Do: Pick date and slot, tap Confirm reschedule
- Tap targets: `Reschedule`, `Confirm reschedule`
- Then: session_transition 'reschedule' tombstones this row as Rescheduled and inserts a new session; the screen replaces itself with trainings/session/[newId]. SLOT_TAKEN surfaces as the inline action error.

### States

- loading: Session (1:1 detail). Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx state === 'loading' Skeleton
- error: Session (1:1 detail). Trigger: Not the caller's coach session and not their player session, or read throws Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx NOT_FOUND 'This session could not be found.', Retry; a player owned id replaces to trainings/booking/[id]
- gate: Session (1:1 detail), requested. Trigger: Open a requested session Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx canComplete/canCancel/canReschedule false, no action stack
- processing: Session, completing. Trigger: Tap Mark complete Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx Button loading={completing}
- failed: Session, action failed. Trigger: complete-session returns TOO_EARLY / PAYMENT_NOT_CAPTURED, cancel without reason (REASON_REQUIRED), reschedule SLOT_TAKEN Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx actionError caption; packages/api/src/errors.ts codes TOO_EARLY, REASON_REQUIRED, SLOT_TAKEN, INVALID_TRANSITION; supabase/functions/complete-session/index.ts PAYMENT_NOT_CAPTURED
- empty: Session, reschedule no slots. Trigger: Pick a date with no availability window Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx 'No open slots on this date within your availability. Try another date.'
- success: Session, completed. Trigger: Mark complete succeeds Source: apps/mobile/src/app/(tabs)/trainings/session/[id].tsx setSession(updated) -> StatusPill 'Completed' (apps/mobile/src/components/ui/status-pill.tsx)

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web-cycle2/web-coach-session-detail-dark.jpg
- docs/phases/evidence/p3-web/web-coach-session-mark-complete-earn990.jpg
- docs/phases/evidence/p3-web/web-coach-mark-complete-payment-not-captured.jpg


## 10. Trainees tab: roster with filters, group cards and trainee cards

Category: COACHES. Persona: coach. Money: no.

Coach Trainees tab inside the Trainings shell. Filter chips All / One on one / Group / Online. Group cards (Users icon, name, 'N members, N sessions', 'Next on date at time' or 'No upcoming session', pill 'Group') interleaved with trainee cards (avatar, name, 'N sessions, last on date', optional 'Trains online', pill 'Active' or 'No upcoming'). Whole cards are the tap targets; the pills are labels only.

After success: Trainee profile or Group profile; back returns to the Trainees tab with the shell intact.

### Screens

**01 Trainings, Trainees tab**  
Route `atlitos://trainings/trainees`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/trainees.tsx`
- See: SessionFilterChips All, One on one, Group, Online above a FlatList of group and trainee cards. Group card accessibilityLabel '{name}, group, open group profile'. Pull to refresh.
- Do: Tap a trainee card or a group card
- Tap targets: `All`, `One on one`, `Group`, `Online`
- Then: Trainee card opens trainings/trainee/[playerId]; group card opens trainings/group/[groupId].

### States

- loading: Trainings, Trainees tab. Trigger: First load Source: apps/mobile/src/app/(tabs)/trainings/(shell)/trainees.tsx state === 'loading' Skeleton
- empty: Trainings, Trainees tab. Trigger: No trainees and no groups Source: apps/mobile/src/app/(tabs)/trainings/(shell)/trainees.tsx Users icon 'No trainees yet', 'Athletes you have trained will show up here once they book a session with you.'
- empty: Trainees, filter empty. Trigger: Pick a filter with no matches Source: apps/mobile/src/app/(tabs)/trainings/(shell)/trainees.tsx ListEmptyComponent 'No training groups yet.' / 'No online trainees yet.' / 'No trainees match this filter.'
- error: Trainings, Trainees tab. Trigger: listTrainees or listMyGroups throws Source: apps/mobile/src/app/(tabs)/trainings/(shell)/trainees.tsx 'Could not load trainees', Retry

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p10-groups-integration/coach-trainees-cric-squad.png


## 11. Trainee profile: Overview, Sessions, Payments, Notes, Video Analytics, Message

Category: COACHES. Persona: coach. Money: yes.

Five tab trainee profile pushed above the shell. Header: avatar, name, 'N sessions together', secondary button 'Message'. Tabs Overview, Sessions, Payments, Notes, Video Analytics (the fifth tab is labelled 'Video Analytics', not 'Videos'). Notes are coach private (coach_trainee_notes); add via a full screen composer, delete via long press with no confirm. Video Analytics renders only a placeholder empty state; the TraineeVideoAnalytics upload organism exists but is not mounted.

Release note: Coach video review upload is not reachable: apps/mobile/src/components/organisms/trainings/TraineeVideoAnalytics.tsx has no importer in apps/mobile/src; the tab renders a hard coded empty state. The Overview 'Attendance rate' placeholder is an em dash character, a house style violation. RELEASE-TODO C-26 'delete it' is a long press with no confirm and no visible affordance; C-25 says 'Videos' tab but the label is 'Video Analytics'.

After success: Stays on the trainee profile; Message lands on the Trainings Chat tab.

### Screens

**01 Trainee profile, Overview**  
Route `atlitos://trainings/trainee/[id]`, source `apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx`
- See: AppBar with the trainee name. Header avatar, name, 'N sessions together', button 'Message' (MessageCircle). Tab strip Overview, Sessions, Payments, Notes, Video Analytics. Overview card: '@handle' and bio or 'No bio yet.'; StatTiles 'Total sessions' and 'Attendance rate' (percent or an em dash placeholder when undefined).
- Do: Tap a tab or Message
- Tap targets: `Message`, `Overview`, `Sessions`, `Payments`, `Notes`, `Video Analytics`
- Then: Message runs router.navigate('/trainings/chat') (the Trainings Chat tab thread list), not a specific thread.

**02 Trainee profile, Sessions**  
Route `atlitos://trainings/trainee/[id]`, source `apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx`
- See: Pill toggles 'Upcoming' and 'All'. Cards titled '1 on 1 session' with StatusPill, 'date, HH:MM to HH:MM', focus area, PriceText total. Empty: CalendarX2 'No sessions found'.
- Do: Toggle Upcoming / All
- Tap targets: `Upcoming`, `All`
- Then: List filters between upcoming only and upcoming plus past. Cards are not tappable.

**03 Trainee profile, Payments**  
Route `atlitos://trainings/trainee/[id]`, source `apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx`
- See: Read only cards: label, StatusPill (session rows use the session status; membership rows map pending -> Pending, active -> Confirmed, lapsed -> Expired), date, PriceText amount. No 'Due' state exists (payment precedes requested). Empty: Receipt icon 'No payments found'.
- Do: Read
- Tap targets: `Payments`
- Then: No actions.

**04 Trainee profile, Notes**  
Route `atlitos://trainings/trainee/[id]`, source `apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx`
- See: List of note cards (body, YYYY-MM-DD) with long press to delete; primary button 'Add note' (Plus) pinned at the bottom. Empty: StickyNote 'No notes yet', 'Notes about this trainee are private to you.'
- Do: Tap 'Add note'
- Tap targets: `Add note`
- Then: Opens the full screen composer overlay.

**05 Add note composer**  
Route `atlitos://trainings/trainee/[id]`, source `apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx`
- See: Overlay with X close (accessibilityLabel 'Close'), title 'Add note', autofocused multiline Input placeholder 'Write a note about this trainee.', primary button 'Save note'. Inline error 'Write something before saving.' on empty body.
- Do: Type, tap Save note
- Tap targets: `Save note`, `Close`
- Then: groups.addTraineeNote inserts; note prepends to the list; composer closes. Long press a note to delete via groups.deleteTraineeNote (silent on failure, note stays).

**06 Trainee profile, Video Analytics**  
Route `atlitos://trainings/trainee/[id]`, source `apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx`
- See: VideoOff icon, 'No videos found', 'Trainee video review is coming soon.' Always this state.
- Do: Read
- Tap targets: `Video Analytics`
- Then: Nothing; no upload affordance is mounted here.

### States

- loading: Trainee profile. Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx state === 'loading' Skeleton
- error: Trainee profile. Trigger: Any of the four reads throws Source: apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx 'Could not load trainee', Retry
- empty: Trainee profile, Sessions. Trigger: No sessions in the chosen filter Source: apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx CalendarX2 'No sessions found'
- empty: Trainee profile, Payments. Trigger: No paid rows Source: apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx Receipt 'No payments found'
- empty: Trainee profile, Notes. Trigger: No notes Source: apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx StickyNote 'No notes yet'
- empty: Trainee profile, Video Analytics. Trigger: Always Source: apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx tab === 'video' VideoOff 'No videos found', 'Trainee video review is coming soon.'
- error: Add note composer. Trigger: Save with empty body or addTraineeNote throws Source: apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx noteError 'Write something before saving.' / err.message ?? 'Could not save the note. Try again.'
- processing: Add note composer. Trigger: Tap Save note Source: apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx Button loading={savingNote}


## 12. Training group profile (view only) and group creation, edit, scheduling (not built in mobile)

Category: COACHES. Persona: coach. Money: yes.

Group profile drill in reached from a group card on the Trainees tab, with Overview and Sessions pill tabs. Overview: attribute card (Sport, Skill level, Capacity 'N of N', Monthly fee, Billing 'Monthly, renewed manually', Status Active/Inactive), tiles Total sessions and Attendance rate, Team members list with Active / Lapsed / Pending chips (each row opens the trainee profile), Attendance policy card. Sessions: Upcoming sessions then All sessions rows opening the group session detail. There is NO create group, edit group, or schedule group session UI anywhere in apps/mobile: packages/api/src/use-groups.ts exposes createGroup, updateGroup and createGroupSession (RPCs create_training_group, update_training_group, create_group_session) but the only callers are scripts/seed-groups-demo.mjs, scripts/verify-groups-probes.mjs and apps/e2e/specs/money/coaching.spec.ts.

Release note: Not built in mobile: create group, edit group (including 'change its sport'), schedule group session. RELEASE-TODO C-22, C-23, C-24 have no UI; groups exist only via seed scripts or direct RPC. COACH-TRAININGS-GAP.md (2026-07-25) predates the groups schema (0076 to 0080) and is stale on its 'schema blocked' rows 6, 7, 9, 10, 14, 15, 17.

After success: Group session detail or trainee profile; back returns to the group profile then the Trainees tab.

### Screens

**01 Group profile, Overview**  
Route `atlitos://trainings/group/[id]`, source `apps/mobile/src/app/(tabs)/trainings/group/[id].tsx`
- See: AppBar with the group name and back. Pill tabs 'Overview' and 'Sessions'. Attribute card rows Sport, Skill level (if set), Capacity, Monthly fee (PriceText), Billing, Status. StatTiles 'Total sessions' (CalendarCheck2) and 'Attendance rate' (Percent, 'No data' until one session has marked attendance). 'Team members' list with avatar, name, 'Attendance N%' caption, chip Active / Lapsed / Pending, or 'No members yet. Athletes join from your coach profile.' 'Attendance policy' card (ClipboardList) when set. Pull to refresh.
- Do: Tap a member row or the Sessions tab
- Tap targets: `Overview`, `Sessions`
- Then: Member row opens trainings/trainee/[playerId]. Sessions tab swaps the content.

**02 Group profile, Sessions**  
Route `atlitos://trainings/group/[id]`, source `apps/mobile/src/app/(tabs)/trainings/group/[id].tsx`
- See: 'Upcoming sessions' rows or 'No upcoming sessions.'; 'All sessions' rows ('date, HH:MM to HH:MM', StatusPill, focus area and location) or CalendarX2 'No sessions scheduled for this group yet.' No add or schedule button.
- Do: Tap a session row
- Tap targets: `Sessions`
- Then: Opens trainings/group-session/[id].

### States

- loading: Group profile. Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/group/[id].tsx state === 'loading' Skeleton
- error: Group profile. Trigger: Group not owned by the caller (explicit coachId check) or read throws Source: apps/mobile/src/app/(tabs)/trainings/group/[id].tsx NOT_FOUND 'This group could not be found.', Retry
- empty: Group profile, Team members. Trigger: No memberships Source: apps/mobile/src/app/(tabs)/trainings/group/[id].tsx 'No members yet. Athletes join from your coach profile.'
- empty: Group profile, Attendance rate. Trigger: No marked participant rows Source: apps/mobile/src/app/(tabs)/trainings/group/[id].tsx StatTile value 'No data'
- empty: Group profile, Sessions. Trigger: No sessions for the group Source: apps/mobile/src/app/(tabs)/trainings/group/[id].tsx 'No upcoming sessions.' / CalendarX2 'No sessions scheduled for this group yet.'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p10-groups-integration/coach-trainees-cric-squad.png


## 13. Group session: Start session, Mark attendance, End session

Category: ATTENDANCE. Persona: coach. Money: no.

The coach side of attendance. Group session detail pushed above the shell. Pre session (status accepted): 'Start session' calls session_transition 'start' (accepted -> in_progress). In session (in_progress): per member Present / Absent toggles, 'Mark attendance' calls the mark_attendance RPC (coach only, session must be in_progress, no money effect), 'End session' calls session_transition 'complete' (client complete door allowed only for group rows). Completed or rated: read only attendance chips Present / Absent / Not marked. A StickyNote icon per member (accessibilityLabel 'Add notes for X') opens that trainee's profile for notes. No cancel or reschedule exists for group sessions.

Release note: Attendance and Start/End session exist only for group sessions; 1:1 sessions have no attendance concept. .maestro/groups-coach.yaml exercises this flow against the seeded 'Cric Squad' session.

After success: Stays on the group session detail with the new status. Back returns to the group profile, Upcoming list, or Trainees tab that opened it. Attendance rate on the group profile and member rows updates from the marked rows.

### Screens

**01 Group session, pre session**  
Route `atlitos://trainings/group-session/[id]`, source `apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx`
- See: AppBar 'Group session' with back. Card: group name, StatusPill 'Accepted', 'Group session', 'date, HH:MM to HH:MM', 'Session duration: N hours' or 'N minutes', 'Focus: ...', location. Primary button 'Start session' (Play icon).
- Do: Tap 'Start session'
- Tap targets: `Start session`
- Then: session_transition 'start' moves the row to In progress; the attendance section appears.

**02 Group session, in session (attendance)**  
Route `atlitos://trainings/group-session/[id]`, source `apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx`
- See: StatusPill 'In progress'. Section 'Attendance' (Users icon) with 'N of M present' once anything is marked. One row per participant: avatar, name, toggle pills 'Present' (success tint) and 'Absent' (danger tint), StickyNote icon. Secondary button 'Mark attendance' (only when the roster is non empty, disabled until at least one toggle is set), primary button 'End session' (CheckCircle2). Empty roster: 'No members were enrolled when this session was scheduled.'
- Do: Toggle Present or Absent per member, tap 'Mark attendance', then 'End session'
- Tap targets: `Present`, `Absent`, `Mark attendance`, `End session`
- Then: mark_attendance writes attendance_status and marked_at per participant and refreshes the roster; End session moves the row to Completed.

**03 Group session, completed**  
Route `atlitos://trainings/group-session/[id]`, source `apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx`
- See: StatusPill 'Completed'. Attendance rows show read only chips 'Present' / 'Absent' / 'Not marked' and the StickyNote shortcut. No buttons.
- Do: Tap StickyNote to add notes for a member
- Tap targets: `Add notes for`
- Then: Opens trainings/trainee/[playerId] (Notes tab is chosen manually there).

### States

- loading: Group session. Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx state === 'loading' Skeleton
- error: Group session. Trigger: Not the caller's group session (getGroupSession returns null) or read throws Source: apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx NOT_FOUND 'This session could not be found.', Retry
- processing: Group session, starting / marking / ending. Trigger: Tap Start session, Mark attendance, End session Source: apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx Button loading={starting} / {marking} / {ending}
- failed: Group session, action failed. Trigger: INVALID_TRANSITION (mark outside in_progress), NOT_A_MEMBER, or RPC throws Source: apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx actionError caption; packages/api/src/use-groups.ts markAttendance doc (NOT_A_MEMBER)
- empty: Group session, no participants. Trigger: Session scheduled with zero active members Source: apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx 'No members were enrolled when this session was scheduled.'; Mark attendance hidden (isRunning && participants.length > 0)
- gate: Group session, Mark attendance disabled. Trigger: No toggle chosen yet Source: apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx disabled={Object.keys(marks).length === 0}
- success: Group session, completed. Trigger: End session succeeds Source: apps/mobile/src/app/(tabs)/trainings/group-session/[id].tsx isCompleted branch, StatusPill 'Completed'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p10-groups-integration/coach-trainees-cric-squad.png


## 14. Earnings tab, payout account setup and transfer to bank

Category: PAYMENT. Persona: coach. Money: yes.

Coach Earnings tab inside the shell: EarningsHeader (Balance in mono from get_coach_wallet_balance, buttons 'Send' and 'Transfer', 'This month'; the header's optional Pending readout is never passed by this screen), filter chips All / Session income / Transfer out, transactions grouped by month. 'Send' opens Payout account (Razorpay Route linked account onboarding via razorpay-route-onboard); 'Transfer' opens the amount entry flow gated on an active payout account, reviewed through BillSummary, then razorpay-route-transfer. Client never writes money rows; the server re-checks the amount against the wallet balance.

Release note: Razorpay Route is not enabled on the test merchant (ROUTE_UNAVAILABLE is the expected live outcome per the payout-setup doc comment). RELEASE-TODO task 7 (live Razorpay key) and founder row 22 (Zaakpay or Razorpay) gate real payouts. Commit fcae8f0 'court earnings overstated the withdrawable balance' touched the court partner side, not this screen.

After success: Earnings tab (atlitos://trainings/earnings) after 'Back to earnings'; Payout account screen stays put and is polled by re-tapping setup.

### Screens

**01 Trainings, Earnings tab**  
Route `atlitos://trainings/earnings`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/earnings.tsx`
- See: EarningsHeader: overline 'Balance', big mono amount, secondary button 'Send' (Send icon), primary 'Transfer' (ArrowDownToLine icon), 'This month' amount. Chips 'All', 'Session income', 'Transfer out'. Month overlines with TransactionRows. Pull to refresh.
- Do: Tap 'Send' or 'Transfer', or a filter chip
- Tap targets: `Send`, `Transfer`, `All`, `Session income`, `Transfer out`
- Then: Send pushes trainings/earnings/payout-setup; Transfer pushes trainings/earnings/transfer; chips refetch listTransactions by kind.

**02 Payout account**  
Route `atlitos://trainings/earnings/payout-setup`, source `apps/mobile/src/app/(tabs)/trainings/earnings/payout-setup.tsx`
- See: AppBar 'Payout account' with back. Status icon (CircleCheck success when active, Clock warning otherwise) and copy per status: not_started 'Set up your payout account' / 'Add your bank details to receive coaching earnings directly to your account.'; pending 'Verification in progress' / 'We are verifying your bank details. This usually takes a short while.'; active 'Payout account active' / 'You can transfer your earnings to your bank account any time.'; needs_attention 'Action needed' / 'Some details could not be verified. Continue the setup to fix them.'; failed 'Setup failed' / 'Your payout account could not be created. Try again.' Button 'Start setup' (not_started) or 'Continue setup' (other non active). After setup returns a URL, secondary button 'Open verification link'. Danger box 'Payouts are not enabled yet' plus server message on ROUTE_UNAVAILABLE.
- Do: Tap 'Start setup' then 'Open verification link'
- Tap targets: `Start setup`, `Continue setup`, `Open verification link`, `Retry`
- Then: razorpay-route-onboard is invoked (idempotent); 'Open verification link' opens the hosted Razorpay flow via Linking.openURL; re-tapping setup polls status. A non ROUTE_UNAVAILABLE setup failure is silent (setError without state change).

**03 Transfer, amount entry**  
Route `atlitos://trainings/earnings/transfer`, source `apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx`
- See: AppBar 'Transfer' with back. 'Available balance' with mono amount, TextField 'Amount to transfer' (numeric, placeholder 0), primary 'Review transfer' (disabled until 0 < amount <= balance). Inline errors 'Enter an amount greater than zero.' / 'This is more than your available balance.'
- Do: Type an amount, tap 'Review transfer'
- Tap targets: `Amount to transfer`, `Review transfer`
- Then: Shows the confirmation step.

**04 Transfer, review**  
Route `atlitos://trainings/earnings/transfer`, source `apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx`
- See: Card with BillSummary rows 'Amount requested' and total (no fee row), primary 'Confirm transfer', secondary 'Edit amount'.
- Do: Tap 'Confirm transfer'
- Tap targets: `Confirm transfer`, `Edit amount`
- Then: razorpay-route-transfer edge function initiates the transfer; success or failure screen.

**05 Transfer, success**  
Route `atlitos://trainings/earnings/transfer`, source `apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx`
- See: CheckCircle2, 'Transfer started', '{amount} is on its way to your bank account.', button 'Back to earnings'.
- Do: Tap 'Back to earnings'
- Tap targets: `Back to earnings`
- Then: router.navigate('/trainings/earnings'); the payout appears under 'Transfer out'.

### States

- loading: Trainings, Earnings tab. Trigger: First load Source: apps/mobile/src/app/(tabs)/trainings/(shell)/earnings.tsx state === 'loading' Skeleton
- error: Trainings, Earnings tab. Trigger: getWalletBalance or listTransactions throws (also a player opening this tab: 'NOT_COACH: caller holds no coach profile' from 0025_wallet_and_transactions_rpcs.sql) Source: apps/mobile/src/app/(tabs)/trainings/(shell)/earnings.tsx 'Could not load your earnings', Retry
- empty: Trainings, Earnings tab. Trigger: No transactions Source: apps/mobile/src/app/(tabs)/trainings/(shell)/earnings.tsx EmptyState Wallet 'No earnings yet', 'Complete a session to see it appear here, then transfer it to your bank account.'
- loading: Payout account. Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/earnings/payout-setup.tsx state === 'loading'
- error: Payout account. Trigger: getPayoutAccountStatus throws (setup failures other than ROUTE_UNAVAILABLE do not render) Source: apps/mobile/src/app/(tabs)/trainings/earnings/payout-setup.tsx state === 'error': 'Could not load your payout account', Retry; handleSetup catch setError without setState
- failed: Payout account, Route unavailable. Trigger: razorpay-route-onboard returns 503 ROUTE_UNAVAILABLE (expected on the test merchant) Source: apps/mobile/src/app/(tabs)/trainings/earnings/payout-setup.tsx routeUnavailable box 'Payouts are not enabled yet'
- processing: Payout account, pending. Trigger: account.status === 'pending' Source: apps/mobile/src/app/(tabs)/trainings/earnings/payout-setup.tsx STATUS_COPY.pending 'Verification in progress'
- success: Payout account, active. Trigger: account.status === 'active' Source: apps/mobile/src/app/(tabs)/trainings/earnings/payout-setup.tsx STATUS_COPY.active, CircleCheck
- failed: Payout account, failed or needs attention. Trigger: account.status === 'failed' or 'needs_attention' Source: apps/mobile/src/app/(tabs)/trainings/earnings/payout-setup.tsx STATUS_COPY.failed / needs_attention, 'Continue setup'
- gate: Transfer, no payout account. Trigger: Open Transfer with account status not active Source: apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx !accountActive: TriangleAlert warning 'Set up your payout account first', 'Transfers are enabled once your payout account is verified and active.', button 'Go to payout account setup'
- loading: Transfer. Trigger: Open the screen Source: apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx state === 'loading'
- error: Transfer. Trigger: Balance or account read throws Source: apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx 'Could not load your balance', Retry
- error: Transfer, amount validation. Trigger: Zero, non numeric, or more than balance Source: apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx formError strings
- processing: Transfer, confirming. Trigger: Tap Confirm transfer Source: apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx Button loading={submitting}
- success: Transfer, success. Trigger: initiateTransfer resolves Source: apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx result === 'success' 'Transfer started'
- failed: Transfer, failed. Trigger: razorpay-route-transfer throws Source: apps/mobile/src/app/(tabs)/trainings/earnings/transfer.tsx result === 'failure' TriangleAlert 'Transfer failed', message, 'Try again'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p2-cycle2/earnings-reconciled-dark.jpeg


## 15. Coach chat: thread list, 1:1 and group threads, send message

Category: COACHES. Persona: coach. Money: no.

Trainings Chat tab embeds the shared ChatThreadList (most recent first, realtime pill); tapping a row pushes trainings/chat-thread/[id], a re-export of the standalone chat/[id] screen. Group threads (one per training group) show a header row 'N members' that opens the GroupMembersSheet and sender names on bubbles. Sending is optimistic with rollback on failure. Trainee profile 'Message' lands on this tab's list rather than a specific thread.

Release note: UX-AND-BUG-REPORT-2026-09-05 BUG-11: group threads fall back to 'Group chat' in the list because training_groups is readable only by members; a SELECT policy widening was flagged for a decision. p9 walkthrough README finding 3: chat_thread_previews migration 0122 unapplied on live at 2026-09-14 (Messages showed raw Postgres errors).

After success: Stays in the thread; back returns to the Chat tab with the shell intact.

### Screens

**01 Trainings, Chat tab**  
Route `atlitos://trainings/chat`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/chat.tsx`
- See: ChatThreadList without its own title (the shell owns the header). Optional warning pill 'Reconnecting' / 'Disconnected' (CloudOff). Rows: avatar, name (group name for group threads), last message preview with sender prefix on group rows or 'Start the conversation.', relative time, 'N members' on group rows. Pull to refresh.
- Do: Tap a thread row
- Tap targets: `Chat`
- Then: Pushes trainings/chat-thread/[threadId].

**02 Chat thread**  
Route `atlitos://trainings/chat-thread/[id]`, source `apps/mobile/src/app/(tabs)/chat/[id].tsx`
- See: AppBar with the participant name or group name (fallback 'Chat' / 'Group'). Group threads: pressable row Users icon 'N members' with ChevronRight (accessibilityLabel 'N members, view group members'). Warning strip 'Reconnecting, messages may be delayed' / 'Disconnected, pull down to reload' when realtime drops. Message bubbles with mono timestamps; group bubbles carry sender names. Composer TextInput placeholder 'Message' (accessibilityLabel 'Message input') and a Send icon button (accessibilityLabel 'Send message').
- Do: Type and tap Send
- Tap targets: `Send message`, `Message input`, `members, view group members`
- Then: Message inserts optimistically then via chat.sendMessage; on failure the row is dropped and the draft restored. Members row opens the GroupMembersSheet (Close control accessibilityLabel 'Close').

### States

- gate: Trainings, Chat tab as guest. Trigger: Not signed in Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx requiresAuthGate EmptyState 'Sign in to see your messages', CTA 'Sign in' -> LoginGateModal
- loading: Trainings, Chat tab. Trigger: First load Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx state === 'loading' skeleton rows
- empty: Trainings, Chat tab. Trigger: No threads Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx EmptyState MessageCircle 'No messages yet', 'Once you have a session with a coach or player, your conversation shows up here.'
- error: Trainings, Chat tab. Trigger: listThreads throws (e.g. chat_thread_previews missing on live per p9 walkthrough finding 3) Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx EmptyState 'Messages could not load', Retry
- loading: Chat thread. Trigger: Open a thread Source: apps/mobile/src/app/(tabs)/chat/[id].tsx state === 'loading' Skeleton lines
- error: Chat thread. Trigger: Thread not found (not a participant, e.g. deep link to someone else's thread) or read throws Source: apps/mobile/src/app/(tabs)/chat/[id].tsx NOT_FOUND 'This conversation could not be found.', EmptyState 'Conversation could not load', Retry
- empty: Chat thread, no messages. Trigger: Thread with zero messages Source: apps/mobile/src/app/(tabs)/chat/[id].tsx EmptyState 'Say hello', 'Send the first message to {name}.'
- error: Chat thread, realtime degraded. Trigger: Realtime channel CHANNEL_ERROR / TIMED_OUT / CLOSED Source: apps/mobile/src/app/(tabs)/chat/[id].tsx realtimeStatus strip 'Reconnecting, messages may be delayed' / 'Disconnected, pull down to reload'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-web/web-chat-coach-view-thread.jpg
- docs/phases/evidence/p3-web/web-chat-coach-sent-message.jpg
- docs/phases/evidence/p3-web/web-chat-coach-realtime-received-reply.jpg


## 16. Coach analytics (sub nav label 'Video Analytics', content is numeric trends)

Category: COACHES. Persona: coach. Money: no.

The fifth coach sub nav tab is labelled 'Video Analytics' but the route (trainings/analytics) renders numeric coach analytics: one card per month with token styled bar rows Sessions, Hours coached, Earnings, Avg rating. Fewer than INSUFFICIENT_DATA_THRESHOLD (3, packages/api/src/use-coach.ts line 968) completed sessions renders an empty state. No video review lives here (RELEASE-TODO AD-42).

Release note: Label and content diverge: TrainingsSubNav labels the coach tab 'Video Analytics' (apps/mobile/src/components/ui/trainings-sub-nav.tsx) while the screen is numeric analytics; COACH-TRAININGS-GAP.md row 18 records this as DIVERGED. RELEASE-TODO C-35 and C-36 say 'Analytics' tab; the tester must tap 'Video Analytics'.

After success: Stays on the tab.

### Screens

**01 Trainings, Video Analytics tab (coach analytics)**  
Route `atlitos://trainings/analytics`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/analytics.tsx`
- See: Month cards titled like 'Sep 2026' each with BarRows 'Sessions', 'Hours coached', 'Earnings' (formatINR), and 'Avg rating' ('4.2/5') when rated. Values in mono.
- Do: Scroll
- Tap targets: `Video Analytics`
- Then: Read only.

### States

- loading: Trainings, Video Analytics tab. Trigger: First load Source: apps/mobile/src/app/(tabs)/trainings/(shell)/analytics.tsx CoachAnalyticsScreen state === 'loading' Skeleton
- error: Trainings, Video Analytics tab. Trigger: getAnalytics throws Source: apps/mobile/src/app/(tabs)/trainings/(shell)/analytics.tsx 'Could not load your analytics', Retry
- empty: Trainings, Video Analytics tab, insufficient data. Trigger: Fewer than 3 completed sessions Source: apps/mobile/src/app/(tabs)/trainings/(shell)/analytics.tsx EmptyState ChartNoAxesCombined 'Not enough sessions yet', 'Complete at least 3 sessions to see your trends here.'


## 17. Coach video review upload (not reachable) and athlete 'My review videos'

Category: COACHES. Persona: coach. Money: no.

The coach upload path for trainee review videos is built as the TraineeVideoAnalytics organism but no screen mounts it (no importer in apps/mobile/src); the trainee profile Video Analytics tab shows a fixed 'coming soon' empty state. trainings/my-videos is the ATHLETE side (read only list of review videos coaches posted, reached from the athlete Stats tab row 'My review videos'); a coach has no entry to it.

Release note: Coach upload not reachable: apps/mobile/src/components/organisms/trainings/TraineeVideoAnalytics.tsx has no importer (grep confirms). Trainee profile Video Analytics tab is hard coded to the empty state.

After success: Back to the athlete Stats tab.

### Screens

**01 My review videos (athlete side)**  
Route `atlitos://trainings/my-videos`, source `apps/mobile/src/app/(tabs)/trainings/my-videos.tsx`
- See: AppBar 'My review videos'. Rows with Film icon, caption or 'Review video', date; tap plays in a full screen Modal with an X close (accessibilityLabel 'Close video'). Empty: Film 'No data found', 'Videos your coach posts to review your training will show up here.'
- Do: Tap a row (accessibilityLabel 'Play review video')
- Tap targets: `Play review video`, `Close video`
- Then: getPlaybackUrl mints a signed URL and plays it.

### States

- loading: My review videos. Trigger: Open Source: apps/mobile/src/app/(tabs)/trainings/my-videos.tsx state === 'loading'
- empty: My review videos. Trigger: No videos Source: apps/mobile/src/app/(tabs)/trainings/my-videos.tsx EmptyState 'No data found'
- error: My review videos. Trigger: list throws Source: apps/mobile/src/app/(tabs)/trainings/my-videos.tsx 'Could not load videos', Retry
- error: My review videos, playback failed. Trigger: getPlaybackUrl throws Source: apps/mobile/src/app/(tabs)/trainings/my-videos.tsx playbackError caption message ?? 'Could not load this video.'


## 18. Settings from the Trainings shell (coach)

Category: ACCOUNT. Persona: coach. Money: no.

The Trainings shell header carries a Settings gear on every tab, including the pending and rejected verification states. Settings Account section shows 'Edit profile', 'Blocked accounts', 'Sign out', 'Delete account'; the 'Become a coach' row is hidden only when coachStatus is verified or pending_review, so a rejected coach still sees it (it pushes coach-setup/0, the same target as 'Edit and resubmit'). Coach specific settings (session types, verification status, availability) are not present in Settings.

After success: Settings screen; back returns to the Trainings tab that opened it.

### Screens

**01 Trainings shell header**  
Route `atlitos://trainings`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/_layout.tsx`
- See: Title 'Trainings' and a Settings icon button (accessibilityLabel 'Settings').
- Do: Tap the gear
- Tap targets: `Settings`
- Then: Pushes /settings (atlitos://settings), AppBar 'Settings' with back over SettingsContent.

**02 Settings, Account section (coach)**  
Route `atlitos://settings`, source `apps/mobile/src/components/organisms/settings/SettingsContent.tsx`
- See: Rows 'Edit profile' (UserRoundPen), 'Blocked accounts' (UserRoundX), 'Sign out' (LogOut, danger), 'Delete account' (Trash2, danger). 'Become a coach' (UserRoundPlus) only when coachStatus is neither verified nor pending_review.
- Do: Tap a row
- Tap targets: `Edit profile`, `Blocked accounts`, `Become a coach`, `Sign out`, `Delete account`
- Then: Edit profile -> /profile/edit; Blocked accounts -> /account/blocked; Become a coach -> coach-setup/0.

### States

- gate: Settings, Become a coach row. Trigger: Signed in with coachStatus verified or pending_review hides it; rejected or no coach profile shows it Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx line 200 isCoach and line 439 {!isCoach ? ... 'Become a coach'}

