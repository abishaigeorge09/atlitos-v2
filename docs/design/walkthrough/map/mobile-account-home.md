# Mobile: launch, account, Home, search, profile, settings, notifications

Part of the verified workflow map, see [README.md](README.md). 20 workflows, 73 screens.

## Contents

1. App launch and splash (guest)
2. Sign up (Register) (guest)
3. Log in (guest)
4. Forgot password (guest)
5. Onboarding as a player (player)
6. Onboarding as a coach (coach verification wizard) (coach)
7. Your profile (You tab) (player)
8. Edit profile (player)
9. Settings (account settings and personalization) (player)
10. Notifications and notification preferences (player)
11. Blocked accounts (player)
12. Delete account (player)
13. Log out (Sign out) (player)
14. Guest login gate and the guest experience of each tab (guest)
15. Home tour (discover sports, rails, bottom nav) (guest)
16. Search (find coaches, courts, gear, athletes and clips) (guest)
17. Address book (shopper)
18. My wishlist (account page) (shopper)
19. My Impact (donor)
20. Empower from Home (hub, athlete profile, donate) (donor, money)

---

## 1. App launch and splash

Category: ACCOUNT. Persona: guest. Money: no.

Cold start. Root '/' (apps/mobile/src/app/index.tsx) redirects to the splash, which waits for the persisted session to hydrate and then auto routes every status to the Home tab. A first ever open silently starts an anonymous guest session (no login wall). Login, Register and onboarding are never forced at launch.

Release note: UI-UPLIFT premium P1 item 17 proposes a 480ms logo reveal; designer P2 item 30 notes the app boots straight into Home. Not a release blocker.

After success: Home tab, atlitos:// (splash never lands anywhere else in the happy path)

### Screens

**01 Splash**  
Route `atlitos://splash`, source `apps/mobile/src/app/(auth)/splash.tsx`
- See: Centered splash mark image (assets/images/splash-icon.png, NATIVE_SPLASH_IMAGE_WIDTH 220, spring settle, accessibilityLabel 'Atlitos'), tagline 'Train, play and follow the game, all in one place.', accent ActivityIndicator below while resolving.
- Do: Wait. No tap in the happy path.
- Tap targets: `Try again`, `Log in instead`
- Then: guest or signed_in status: router.replace('/(tabs)') lands on Home. signed_out: continueAsGuest() runs silently then routes to Home. Only a failed guest sign in or a failed profile fetch leaves UI on this screen.

**02 Home tab**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx`
- See: Home tab with brand AppBar, search bar, categories and rails. Bottom nav pill at RESTING_SCALE 0.88.
- Do: Browse.
- Then: App is usable as guest immediately.

### States

- loading: Splash. Trigger: Any launch before session hydrates, or signed in with profile still loading, or guest sign in in flight. Source: apps/mobile/src/app/(auth)/splash.tsx showSpinner, ActivityIndicator color={colors.accent}
- error: Splash profile retry. Trigger: Signed in session whose profile fetch failed (meError, me null), e.g. airplane mode on relaunch. Source: apps/mobile/src/app/(auth)/splash.tsx showMeRetry: 'We could not load your profile. Check your connection and try again.' + Button 'Try again' (refreshMe)
- error: Splash guest retry. Trigger: continueAsGuest throws, e.g. anonymous sign ins disabled on the Supabase project. Source: apps/mobile/src/app/(auth)/splash.tsx showGuestRetry: friendlyAuthMessage ('Guest browsing is unavailable right now. Log in or create an account to continue.' from apps/mobile/src/lib/auth-copy.ts) + 'Try again' + text Button 'Log in instead' (router.push('/(auth)/login'))
- loading: Native splash font wait. Trigger: Fonts slow to load. Root layout hides the native splash after 5000ms regardless. Source: apps/mobile/src/app/_layout.tsx FONT_WAIT_MS = 5000, SplashScreen.hideAsync
- error: App error boundary. Trigger: Any uncaught render error anywhere in the navigator. Source: apps/mobile/src/components/organisms/AppErrorBoundary.tsx: TriangleAlert, 'Something went wrong', 'This screen ran into a problem and stopped. Your account and your data are not affected. Try again, and if it keeps happening please contact support.', Button 'Try again'; mounted in apps/mobile/src/app/_layout.tsx surface='root'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3-simulator/ios-sim-atlitos-running-native.png
- docs/phases/evidence/p3-simulator/ios-sim-atlitos-splash.png
- docs/phases/evidence/p9-native/01-boot.png


## 2. Sign up (Register)

Category: ACCOUNT. Persona: guest. Money: no.

Create an account with name, email, phone, date of birth and a password typed twice. Success lands straight on Home in guest to member mode; role select is never forced. If Supabase email confirmation is on, an in place 'Check your email' state appears instead.

Release note: UI-UPLIFT designer P1 item 19: group the seven inputs into About you / Contact / Security (source has six). RELEASE-TODO A-01 to A-03 cover this flow. TEST-SUITE-ATHLETE-APP A-09 NOT RUN (writes a live account).

After success: Home tab, atlitos:// (router.replace('/(tabs)')); with email confirmation on, Login at atlitos://login

### Screens

**01 Login**  
Route `atlitos://login`, source `apps/mobile/src/app/(auth)/login.tsx`
- See: Login form with the register line at the bottom: 'Don't have an account?' followed by an accent 'Register' Link.
- Do: Tap Register (or arrive via LoginGateModal 'Register').
- Tap targets: `Register`
- Then: Link href /(auth)/register.

**02 Create your account**  
Route `atlitos://register`, source `apps/mobile/src/app/(auth)/register.tsx`
- See: h1 'Create your account', body 'Set up training, bookings and orders in one place.', six required Inputs (label plus danger asterisk from Input required): Full name, Email, Phone (type phone, number pad), Date of birth (type pincode, placeholder YYYY-MM-DD, auto dashes via formatDob, maxLength 10), Password (Eye / EyeOff reveal), Confirm password. Primary Button 'Create account'. Footer 'Already have an account.' + accent Link 'Log in'.
- Do: Fill all six fields, tap Create account.
- Tap targets: `Create account`, `Log in`, `Show password`, `Hide password`
- Then: validate() runs first; on API success router.replace('/(tabs)') lands on Home signed in. If result.needsEmailConfirmation the screen swaps to the confirmation state below.

**03 Check your email (confirmation pending)**  
Route `atlitos://register`, source `apps/mobile/src/app/(auth)/register.tsx`
- See: MailCheck icon 48 accent, h2 'Check your email', body 'We sent a confirmation link to {email}. Open it to finish creating your account.', primary Button 'I have confirmed, log in', secondary Button 'Resend email'.
- Do: Open the emailed link, come back, tap 'I have confirmed, log in'.
- Tap targets: `I have confirmed, log in`, `Resend email`
- Then: router.replace('/(auth)/login'). Resend shows success caption 'Confirmation email sent again, check your inbox.'

**04 Home (signed in, no city)**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx`
- See: Home with the 'Finish setting up' nudge card (showFinishSetup: signed_in, me.city null, not dismissed): 'Pick your role and city to unlock coaches, courts and Learn near you.' with an X dismiss (accessibilityLabel 'Dismiss finish setup').
- Do: Tap the card to start onboarding, or X to dismiss for this session.
- Tap targets: `Finish setting up`, `Dismiss finish setup`
- Then: Card tap router.push('/(onboarding)/role-select').

### States

- error: Create your account. Trigger: Submit with any field invalid. Source: apps/mobile/src/app/(auth)/register.tsx validate(): 'Please enter your name', 'That email does not look right, check it and try again', 'Enter a 10 digit mobile number, +91 is optional', 'Enter your full date of birth, year first', 'Use at least 8 characters', 'Both passwords need to match' rendered as Input error under each field
- error: Create your account. Trigger: Register with an email or phone already on an account. Source: apps/mobile/src/app/(auth)/register.tsx handleSubmit catch: EMAIL_TAKEN -> 'This email is already registered, log in instead'; PHONE_TAKEN -> 'This phone number is already registered, log in instead'; any other ApiError -> danger caption friendlyAuthMessage(formError)
- processing: Create your account. Trigger: Tap Create account with a valid form. Source: apps/mobile/src/app/(auth)/register.tsx submitting: Button loading, every Input editable={!submitting}
- success: Check your email. Trigger: Supabase email confirmation enabled. Source: apps/mobile/src/app/(auth)/register.tsx confirmationPending branch
- error: Check your email. Trigger: Resend email fails. Source: apps/mobile/src/app/(auth)/register.tsx resendError danger caption via friendlyAuthMessage


## 3. Log in

Category: ACCOUNT. Persona: guest. Money: no.

Email or mobile plus password, or a one time 6 digit code, or Google, or Apple (iOS only). Also the 'Continue on this device' guest path. After success the screen pops back to wherever the guest gate was raised (PRD-01 FR-4), or to Home if opened cold.

Release note: UI-UPLIFT designer P1 item 18: replace the 'ATLITOS' text wordmark with the logo mark. Primary CTA is deliberately never disabled on empty fields (comment in login.tsx). Google and Apple sign in are present but PRD-01 never specified them (TEST-SUITE A-08 N-A). Apple button renders nothing off iOS (SocialAuthButtons isAppleSignInAvailable).

After success: Returns to the screen beneath the pushed Login (router.back()) when reached from a guest gate; otherwise Home tab atlitos:// (router.replace('/(tabs)'))

### Screens

**01 Login**  
Route `atlitos://login`, source `apps/mobile/src/app/(auth)/login.tsx`
- See: Text wordmark 'ATLITOS' (textStyle body), h3 'Experience the future of Sports' (Sports in accent), callout 'Expert coaching, Smart performance tracking, Premium merch, and more..'. Input label 'Email/Mobile Number' (placeholder 'Email/ Mobile Number'), Input 'Password' with Eye/EyeOff reveal, caption Link 'Forgot Password?' right aligned. Primary Button 'Login'. GoogleSignInButton (accessibilityLabel 'Sign in with Google', inline G mark). Native AppleAuthenticationButton SIGN_IN type (iOS only; the 'Sign in with Apple' label is drawn by iOS, not a source string). 'Don't have an account?' + accent Link 'Register'. Two caption Pressables: 'Use a one time code' and 'Continue on this device'.
- Do: Type identifier and password, tap Login.
- Tap targets: `Login`, `Forgot Password?`, `Sign in with Google`, `Sign in with Apple`, `Register`, `Use a one time code`, `Continue on this device`, `Show password`, `Hide password`
- Then: afterAuth(): router.back() if router.canGoBack() (returns to the gated screen), else router.replace('/(tabs)').

**02 Login, one time code mode**  
Route `atlitos://login`, source `apps/mobile/src/app/(auth)/login.tsx`
- See: Same header. Only the identifier Input shows; primary Button reads 'Send code'. Bottom link now reads 'Use your password'.
- Do: Enter email or mobile, tap Send code.
- Tap targets: `Send code`, `Use your password`, `Continue on this device`
- Then: auth.requestOtp; otpSent = true, screen shows the code entry below.

**03 Login, enter the 6 digit code**  
Route `atlitos://login`, source `apps/mobile/src/app/(auth)/login.tsx`
- See: Label 'Enter the 6 digit code', OTPInput (autoFocus), caption Pressable 'Resend code'. Primary Button 'Verify and continue'.
- Do: Type the code, tap Verify and continue.
- Tap targets: `Verify and continue`, `Resend code`, `Use your password`
- Then: auth.verifyOtp then afterAuth() (back to origin or Home).

### States

- error: Login. Trigger: Submit with an empty identifier or password, or fewer than 6 OTP digits. Source: apps/mobile/src/app/(auth)/login.tsx submitPrimary: fieldError 'Enter your email or mobile number.', 'Enter your password.', 'Enter the 6 digit code.' rendered as danger caption via friendlyAuthMessage
- error: Login. Trigger: Wrong credentials, unconfirmed email, network down, rate limit. Source: apps/mobile/src/lib/auth-copy.ts friendlyAuthMessage: 'That login does not match our records. Check your details and try again.', 'Confirm your email first. Open the link we sent to your inbox, then log in.', 'We could not reach the server. Check your connection and try again.', 'Too many attempts. Wait a moment, then try again.', 'That code has expired. Request a new one and try again.', 'That code does not match. Check the digits and try again.', fallback 'Something went wrong, please try again.'
- processing: Login. Trigger: Any submit. Source: apps/mobile/src/app/(auth)/login.tsx Pending union; Button loading when pending is 'password' or 'otp'; GoogleSignInButton loading shows ActivityIndicator (SocialAuthButtons.tsx); inputs editable={!busy}
- success: Login. Trigger: Provider sheet cancelled is NOT an error: no message, user stays on Login. Source: apps/mobile/src/app/(auth)/login.tsx run(): outcome === 'cancelled' returns silently
- gate: Login (guest path). Trigger: Tap 'Continue on this device'. Source: apps/mobile/src/app/(auth)/login.tsx run('guest', continueAsGuest) then afterAuth()

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/02-login-screen.png


## 4. Forgot password

Category: ACCOUNT. Persona: guest. Money: no.

Three step reset: enter email or phone, verify a 6 digit OTP with a 30 second resend timer, set a new password. Verifying the OTP establishes the session the reset runs against, so the end state is signed in.

Release note: UI-UPLIFT dev P1 item 18: the disabled 'Send code' has no helper caption explaining why. RELEASE-TODO A-04 to A-06 cover this flow. TEST-SUITE A-10 NOT RUN (sends a real email).

After success: Splash atlitos://splash then Home tab atlitos:// (already signed in by the OTP verify)

### Screens

**01 Reset your password**  
Route `atlitos://forgot`, source `apps/mobile/src/app/(auth)/forgot/index.tsx`
- See: h1 'Reset your password', body 'Enter the email or phone on your account and we will send a code.', required Input 'Email or phone', primary Button 'Send code' (disabled={!identifier}).
- Do: Type identifier, tap Send code.
- Tap targets: `Send code`
- Then: auth.requestOtp; router.push('/(auth)/forgot/otp') with the identifier param.

**02 Enter the code**  
Route `atlitos://forgot/otp`, source `apps/mobile/src/app/(auth)/forgot/otp.tsx`
- See: h1 'Enter the code', body 'We sent a 6 digit code to {identifier}.', OTPInput autoFocus, primary Button 'Verify code' (disabled under 6 digits), text Button 'Resend code in {n}s' counting down from RESEND_SECONDS 30 then 'Resend code'.
- Do: Type the 6 digits, tap Verify code.
- Tap targets: `Verify code`, `Resend code`
- Then: auth.verifyOtp; router.replace('/(auth)/forgot/reset').

**03 Set a new password**  
Route `atlitos://forgot/reset`, source `apps/mobile/src/app/(auth)/forgot/reset.tsx`
- See: h1 'Set a new password', body 'Choose a password you have not used before.', required Inputs 'New password' and 'Confirm password' (Eye/EyeOff), primary Button 'Save password'.
- Do: Type the password twice, tap Save password.
- Tap targets: `Save password`, `Show password`, `Hide password`
- Then: auth.resetPassword; router.replace('/(auth)/splash'), splash routes the now signed in session to Home.

### States

- gate: Reset your password. Trigger: Empty identifier. Source: apps/mobile/src/app/(auth)/forgot/index.tsx Button disabled={!identifier}
- error: Reset your password. Trigger: requestOtp fails (unknown account, rate limit, network). Source: apps/mobile/src/app/(auth)/forgot/index.tsx Input error={friendlyAuthMessage(error)}
- processing: Reset your password. Trigger: Tap Send code. Source: apps/mobile/src/app/(auth)/forgot/index.tsx submitting Button loading
- gate: Enter the code. Trigger: Fewer than 6 digits, or resend within 30 seconds. Source: apps/mobile/src/app/(auth)/forgot/otp.tsx Button disabled={otp.length < 6}; resend disabled={secondsLeft > 0}, label 'Resend code in {secondsLeft}s'
- error: Enter the code. Trigger: Wrong, expired or reused OTP. Source: apps/mobile/src/app/(auth)/forgot/otp.tsx danger caption friendlyAuthMessage(error): OTP_INVALID / OTP_EXPIRED / RATE_LIMITED copy from apps/mobile/src/lib/auth-copy.ts; OTPInput error={Boolean(error)}
- processing: Enter the code. Trigger: Verify or resend in flight. Source: apps/mobile/src/app/(auth)/forgot/otp.tsx submitting / resending Button loading
- error: Set a new password. Trigger: Under 8 chars, mismatch, or API failure. Source: apps/mobile/src/app/(auth)/forgot/reset.tsx 'Use at least 8 characters', 'Both passwords need to match', friendlyAuthMessage on catch
- processing: Set a new password. Trigger: Tap Save password. Source: apps/mobile/src/app/(auth)/forgot/reset.tsx submitting Button loading


## 5. Onboarding as a player

Category: ACCOUNT. Persona: player. Money: no.

Role select then a 3 step wizard: Sports, Photo, Location. At least one sport and a city are required (PRD-01 FR-8). Never forced: reachable from Home's 'Finish setting up' card, and 'Explore the app first' defers it.

Release note: Splash never forces onboarding; the only entries are the Home nudge card, Settings 'Become a coach' for the coach branch, CoachVerificationStatus 'Edit and resubmit', and deep link. RELEASE-TODO A-09 to A-12 cover this. Draft answers persist across steps in useOnboardingDraft (apps/mobile/src/store/onboarding-draft.ts, zustand in memory, no persist middleware), so A-11 (quit halfway) restarts the wizard.

After success: Home tab atlitos:// (router.replace('/(tabs)')), the Finish setting up card no longer shows because me.city is set

### Screens

**01 Home, Finish setting up card**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx`
- See: Card under the categories row: 'Finish setting up' / 'Pick your role and city to unlock coaches, courts and Learn near you.' with an X (lucide X) dismiss. Shown only when showFinishSetup (signed in, me.city null, not dismissed this session).
- Do: Tap the card text.
- Tap targets: `Finish setting up`, `Dismiss finish setup`
- Then: router.push('/(onboarding)/role-select').

**02 Role select**  
Route `atlitos://role-select`, source `apps/mobile/src/app/(onboarding)/role-select.tsx`
- See: h1 'How will you use Atlitos.', body 'You can add the other role later from your account.' Two cards: Dumbbell icon 'I am a player' / 'Book coaches and courts, buy gear, and track your progress.' and ClipboardList icon 'I am a coach' / 'List your sessions and pricing, and get discovered by players.', each with ChevronRight. Text Button 'Explore the app first'.
- Do: Tap 'I am a player'.
- Tap targets: `I am a player`, `I am a coach`, `Explore the app first`
- Then: Light haptic, router.push('/(onboarding)/player-setup/0'). 'Explore the app first' calls setOnboardingDeferred() (AsyncStorage flag, apps/mobile/src/lib/onboarding-deferred.ts) and router.replace('/(tabs)').

**03 Player setup step 1, Sports**  
Route `atlitos://player-setup/0`, source `apps/mobile/src/app/(onboarding)/player-setup/[step].tsx`
- See: Stepper (STEP_LABELS Sports, Photo, Location). h2 'What do you play.', body 'Pick at least one sport to personalize your feed and coach search.', select Chips Football, Cricket, Badminton, Tennis (SPORTS enum); the first pick shows an accent 'Primary' caption; hint 'Your first pick becomes your primary sport for Learn.' Footer Buttons 'Back' (secondary) and 'Next' (disabled until one sport).
- Do: Tap one or more sport chips, tap Next.
- Tap targets: `Football`, `Cricket`, `Badminton`, `Tennis`, `Back`, `Next`
- Then: router.push player-setup/[step] with step 1.

**04 Player setup step 2, Photo**  
Route `atlitos://player-setup/1`, source `apps/mobile/src/app/(onboarding)/player-setup/[step].tsx`
- See: h2 'Add a photo.', body 'Optional, you can add or change this anytime from your profile.' 80pt Avatar Pressable with an accent Camera badge (ActivityIndicator while uploading). Back / Next.
- Do: Tap the avatar to open the photo library (optional), then Next.
- Tap targets: `Camera`, `Back`, `Next`
- Then: Image picked, uploadAvatar to storage, draft.avatarUrl set. Next pushes step 2.

**05 Player setup step 3, Location**  
Route `atlitos://player-setup/2`, source `apps/mobile/src/app/(onboarding)/player-setup/[step].tsx`
- See: h2 'Where are you based.', required Input 'City', Input 'State'. Footer 'Back' and 'Finish' (disabled until City has text).
- Do: Type city, tap Finish.
- Tap targets: `Back`, `Finish`
- Then: profile.completePlayerSetup, refreshMe, draft reset, deferred flag cleared, router.replace('/(tabs)').

### States

- gate: Player setup step 1 and 3. Trigger: No sport selected on step 0, or empty City on step 2. Source: apps/mobile/src/app/(onboarding)/player-setup/[step].tsx canGoNext; Button disabled={!canGoNext}
- error: Player setup step 2. Trigger: Deny photo library permission, session missing, or storage upload fails. Source: apps/mobile/src/app/(onboarding)/player-setup/[step].tsx: 'Photo library access was not granted.', 'Session expired, log in again to add a photo.', 'Could not upload photo right now, you can add one later from your profile.' as danger caption
- processing: Player setup step 2. Trigger: Photo uploading. Source: apps/mobile/src/app/(onboarding)/player-setup/[step].tsx photoUploading: ActivityIndicator inside the Camera badge
- processing: Player setup step 3. Trigger: Tap Finish. Source: apps/mobile/src/app/(onboarding)/player-setup/[step].tsx submitting Button loading
- error: Player setup step 3. Trigger: completePlayerSetup RPC fails. Source: apps/mobile/src/app/(onboarding)/player-setup/[step].tsx handleFinish catch friendlyAuthMessage as danger caption
- success: Home. Trigger: Finish succeeds. Source: apps/mobile/src/app/(onboarding)/player-setup/[step].tsx router.replace('/(tabs)'); no dedicated success screen

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3/onboarding-role-select-light.png


## 6. Onboarding as a coach (coach verification wizard)

Category: ACCOUNT. Persona: coach. Money: no.

7 step wizard: Sport, Photo, Experience, Certificates, Pricing, Availability, About. Requires one uploaded certificate, one valid session type and one valid availability window (PRD-02 FR-3 to FR-5). Submitting shows 'Submitted for review.'; the Trainings tab then shows the pending verification status until an admin approves.

Release note: UI-UPLIFT designer P1 item 20 targets the availability screen layout. RELEASE-TODO C-01 to C-09 cover this flow. Pricing copy on step 5 mentions a platform fee deduction.

After success: Home tab atlitos:// via 'Go to home'; Trainings tab atlitos://trainings shows the pending review state

### Screens

**01 Role select**  
Route `atlitos://role-select`, source `apps/mobile/src/app/(onboarding)/role-select.tsx`
- See: Same fork screen as the player path.
- Do: Tap 'I am a coach'. (Alternative entries: Settings > Account > 'Become a coach'; Trainings rejected state 'Edit and resubmit'.)
- Tap targets: `I am a coach`
- Then: router.push('/(onboarding)/coach-setup/0').

**02 Coach setup step 1, Sport**  
Route `atlitos://coach-setup/0`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: Stepper with STEP_LABELS Sport, Photo, Experience, Certificates, Pricing, Availability, About. h2 'What do you coach.', body 'One sport per coach profile. This cannot change once you submit.', single select Chips Football, Cricket, Badminton, Tennis. Footer 'Back' / 'Next' (disabled until draft.sport).
- Do: Tap one sport, Next.
- Tap targets: `Football`, `Cricket`, `Badminton`, `Tennis`, `Back`, `Next`
- Then: Push step 1.

**03 Coach setup step 2, Photo**  
Route `atlitos://coach-setup/1`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: h2 'Add a photo.', Avatar (tap to pick), caption 'Uploading.' while photoUploading. Optional.
- Do: Tap avatar, pick, Next.
- Tap targets: `Back`, `Next`
- Then: uploadAvatar; push step 2.

**04 Coach setup step 3, Experience**  
Route `atlitos://coach-setup/2`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: h2 'Your experience.', Input 'Years coaching', multiline Input 'Coaching style' placeholder 'Technical drills, match simulation, fitness focus...'.
- Do: Fill, Next.
- Tap targets: `Back`, `Next`
- Then: Push step 3 (canGoNext is true on this step).

**05 Coach setup step 4, Certificates**  
Route `atlitos://coach-setup/3`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: h2 'Upload certificates.', body 'At least one is required, coaching licenses or certifications.' Each picked file is a card with FileText icon, name, Trash2 remove. Secondary Button with Plus icon 'Add certificate' (loading while certUploading). Next disabled until one certificate has a storagePath.
- Do: Tap Add certificate, pick images, Next.
- Tap targets: `Add certificate`, `Trash2`, `Back`, `Next`
- Then: uploadCoachCertificate per asset; push step 4.

**06 Coach setup step 5, Session types and pricing**  
Route `atlitos://coach-setup/4`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: h2 'Session types and pricing.', body 'Athletes will pay the price you set. You will receive it after our platform fee is deducted.' Cards 'Session {n}' with Inputs 'Name' (placeholder 'One on one'), 'Duration (min)' (default '60'), 'Session fee (INR)', Trash2 remove. Secondary Button Plus 'Add session type'. Next disabled until every row passes sessionTypeIssue.
- Do: Add session type, fill name and price, Next.
- Tap targets: `Add session type`, `Trash2`, `Back`, `Next`
- Then: Push step 5.

**07 Coach setup step 6, Weekly availability**  
Route `atlitos://coach-setup/5`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: h2 'Weekly availability.' Cards 'Window {n}' with DAY_LABELS Chips Sun, Mon, Tue, Wed, Thu, Fri, Sat, Inputs 'From (HH:MM)' and 'To (HH:MM)' (defaults dayOfWeek 1, 06:00 to 08:00), Trash2. Secondary Button Plus 'Add availability window'. Next disabled until every window passes availabilityIssue.
- Do: Add window, set day and times, Next.
- Tap targets: `Add availability window`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Trash2`, `Back`, `Next`
- Then: Push step 6.

**08 Coach setup step 7, About you**  
Route `atlitos://coach-setup/6`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: h2 'About you.', required Input 'City', Input 'State', multiline Input 'Bio' placeholder 'Tell players about your coaching background.' Footer 'Back' / 'Submit' (disabled until City).
- Do: Fill city, tap Submit.
- Tap targets: `Back`, `Submit`
- Then: profile.submitCoachVerification RPC, refreshMe, clearOnboardingDeferred, submitted = true.

**09 Submitted for review**  
Route `atlitos://coach-setup/6`, source `apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx`
- See: CircleCheck 64 success, h2 'Submitted for review.', body 'An admin will review your profile. You will be notified once you are verified and discoverable to players.', primary Button 'Go to home'.
- Do: Tap Go to home.
- Tap targets: `Go to home`
- Then: resetDraft, router.replace('/(tabs)').

**10 Trainings tab, pending review**  
Route `atlitos://trainings`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx`
- See: Shell title 'Trainings' with Settings gear, no sub nav (TrainingsSubNav renders only for verified coach or player in trainings/(shell)/_layout.tsx). CoachVerificationStatus pending: Clock icon in an 80pt warningTint circle, h3 'Submitted for review', 'We are reviewing your certificates and profile. You will be able to receive session requests once approved.'
- Do: Wait for admin approval (apps/admin verification queue).
- Tap targets: `Settings`
- Then: After approval and refresh, the coach Stats dashboard and coach sub nav (Stats, Trainees, Earnings, Chat, Video Analytics per apps/mobile/src/components/ui/trainings-sub-nav.tsx) render.

### States

- gate: Coach setup, per step. Trigger: Step 0 no sport; step 3 no successfully uploaded certificate; step 4 any invalid session type; step 5 any invalid window; step 6 empty City. Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx canGoNext chain, Button disabled={!canGoNext}
- error: Coach setup step 5. Trigger: Session type with blank name or price 0. Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx sessionTypeIssue: 'Give this session a name and a price above zero.'
- error: Coach setup step 6. Trigger: Type 25:00 or To earlier than From. Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx availabilityIssue: 'Use 24 hour times like 06:30 for From and To.', 'From must be earlier than To.'
- error: Coach setup step 4. Trigger: Certificate upload to storage fails. Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx uploadError 'Upload failed, remove and try again.'
- error: Coach setup step 2 and 4. Trigger: Photo library permission denied; photo upload fails. Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx 'Photo library access was not granted.'; 'Could not upload photo right now, you can add one later from your profile.'
- error: Coach setup step 7 (submit guards). Trigger: Deep link straight to step 6 with bad rows. Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx handleFinish: 'Add at least one certificate that uploaded successfully before you submit.', 'A certificate upload failed. Remove it or add it again before you submit.', 'Every session type needs a name and a price above zero.', 'Check your availability times before you submit.'; RPC failure friendlyAuthMessage
- processing: Coach setup. Trigger: Photo, certificate or submit in flight. Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx 'Uploading.' caption, certUploading Button loading, submitting Button loading
- success: Submitted for review. Trigger: submitCoachVerification resolves. Source: apps/mobile/src/app/(onboarding)/coach-setup/[step].tsx submitted branch
- processing: Trainings tab pending. Trigger: me.coachStatus === 'pending_review'. Source: apps/mobile/src/components/organisms/CoachVerificationStatus.tsx pending branch (Clock, 'Submitted for review')
- failed: Trainings tab rejected. Trigger: Admin rejects the request. Source: apps/mobile/src/components/organisms/CoachVerificationStatus.tsx rejected: TriangleAlert, 'Your coach application was not approved', rejectionReason, Button 'Edit and resubmit' -> coach-setup step 0

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3/onboarding-role-select-light.png
- docs/phases/evidence/p2-cycle2/admin-verification-queue-coach.jpeg


## 7. Your profile (You tab)

Category: ACCOUNT. Persona: player. Money: no.

The fifth bottom tab is the athlete's own social profile: cover, avatar, name, @handle, bio, Following and Followers counts, then four icon tabs: My posts, Liked posts, Follows, My wishlist. Edit profile and Settings sit on the header. Also pushed as /profile from Trainings MySportsCard 'Add sport'.

Release note: UI-UPLIFT dev P0 item 2: 'you' renders blank with no skeleton for 3 to 8 seconds on first open (walkthrough finding 4). Designer P2 item 29: Under review / Removed pills on the grid should use the status chip system. Bottom nav shows the member avatar on the You tab when avatarUri exists (bottom-nav.tsx showAvatar).

After success: Stays on the You tab; sub navigations push detail screens

### Screens

**01 You tab (Profile)**  
Route `atlitos://you`, source `apps/mobile/src/app/(tabs)/you.tsx`
- See: Renders ProfileScreen asTab (apps/mobile/src/app/profile/index.tsx): plain centered h3 'Profile' (no back chevron). Cover image or surfaceMuted band, Avatar overlapping, secondary sm Buttons 'Edit profile' and Settings icon 'Settings' (accessibilityLabel 'Settings'). Name, '@handle', bio. Row '{n} Following' (accessibilityLabel 'See who you follow') and '{n} Followers' ('See your followers'). Icon tab strip: LayoutGrid (My posts), Heart (Liked posts), Users (Follows), Bookmark (My wishlist), each with accessibilityLabel = label. numColumns 3 clip grid with StatusPill overlays for non published own clips. RefreshControl pull to refresh.
- Do: Tap a tab icon, a clip, a follow count, Edit profile or Settings.
- Tap targets: `Edit profile`, `Settings`, `My posts`, `Liked posts`, `Follows`, `My wishlist`, `See who you follow`, `See your followers`
- Then: Clip tile -> /(tabs)/clutch/post/[id]. Follows rows -> /(tabs)/clutch/creator/[id]. Wishlist item -> /shop/product/[id], 'Move to cart' via WishlistGrid. Edit profile -> /profile/edit. Settings -> /settings.

**02 Profile (pushed)**  
Route `atlitos://profile`, source `apps/mobile/src/app/profile/index.tsx`
- See: Identical body with an AppBar backTitle 'Profile' and back chevron (accessibilityLabel 'Back'). Reached from Trainings MySportsCard 'Add sport' (apps/mobile/src/components/organisms/trainings/MySportsCard.tsx router.push('/profile')).
- Do: Same as the tab.
- Tap targets: `Back`, `Edit profile`, `Settings`
- Then: Back pops to the caller.

### States

- gate: You tab (guest). Trigger: Open the You tab as a guest. Source: apps/mobile/src/app/profile/index.tsx isGuest branch: EmptyState icon LogIn, 'Sign in to see your profile', 'Create an account to post clips, follow athletes and build your channel.', ctaLabel 'Sign in' -> router.push('/(auth)/login') directly (no LoginGateModal)
- loading: You tab. Trigger: First open, six parallel reads (getCreator, getMyClips, listLikedClips, listFollowing, listFollowers, listWishlist). Source: apps/mobile/src/app/profile/index.tsx state 'loading': centered ActivityIndicator, no skeleton
- error: You tab. Trigger: Any of the six reads fails. Source: apps/mobile/src/app/profile/index.tsx: TriangleAlert, 'Couldn't load profile', error?.message ?? 'Something went wrong. Please try again.', Button 'Retry'
- empty: My posts. Trigger: No own clips. Source: apps/mobile/src/app/profile/index.tsx LayoutGrid 'You have not posted any clips yet.'
- empty: Liked posts. Trigger: No liked clips. Source: apps/mobile/src/app/profile/index.tsx Heart 'Clips you like show up here.'
- empty: Follows. Trigger: No following / no followers. Source: apps/mobile/src/app/profile/index.tsx Users 'You are not following anyone yet.' / 'No followers yet. Post clips to grow your channel.'
- empty: My wishlist. Trigger: No saved products. Source: apps/mobile/src/app/profile/index.tsx Bookmark 'Nothing saved yet. Tap the heart on any gear to keep it here.'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png


## 8. Edit profile

Category: ACCOUNT. Persona: player. Money: no.

Change cover photo, profile photo, handle (live availability check) and bio (160 char counter). Saves through useProfile.updateProfile on the own row, refreshes the session profile, pops back. City, state and sports are NOT on this screen; they live in Settings.

Release note: RELEASE-TODO A-36 says 'open Profile edit, change city, save, reopen' but this screen has no city field; city and state are edited under Settings > Location (SettingsContent.tsx). TEST-SUITE P-02 PASS.

After success: Back to the previous screen (router.back()), normally the You tab atlitos://you

### Screens

**01 You tab (Profile)**  
Route `atlitos://you`, source `apps/mobile/src/app/profile/index.tsx`
- See: Header with 'Edit profile' secondary button next to the avatar.
- Do: Tap Edit profile. (Also Settings > Account > 'Edit profile'.)
- Tap targets: `Edit profile`
- Then: router.push('/profile/edit').

**02 Edit profile**  
Route `atlitos://profile/edit`, source `apps/mobile/src/app/profile/edit.tsx`
- See: AppBar backTitle 'Edit profile'. Label 'Cover photo' over a fixed 120pt cover Pressable (COVER_PREVIEW_HEIGHT = spacing['4xl'] * 3, accessibilityLabel 'Change cover photo') with an overlay pill ImageIcon 'Change'. Label 'Profile photo' with Avatar AVATAR_SIZE 80 and secondary sm Button Camera 'Change photo'. Input 'Handle' (placeholder 'yourhandle') with caption 'Your public name, shown as @{handle}.' or the availability hint. Multiline Input 'Bio' placeholder 'Tell people what you play and where.' with counter '/160'. Primary Button 'Save changes' (disabled while avatarUploading, coverUploading, handleCheck taken or invalid).
- Do: Change photos, handle or bio, tap Save changes.
- Tap targets: `Change cover photo`, `Change photo`, `Save changes`, `Back`
- Then: profileApi.updateProfile then refreshMe then router.back() to the profile.

### States

- gate: Edit profile (guest). Trigger: Open atlitos://profile/edit as a guest (or me not loaded). Source: apps/mobile/src/app/profile/edit.tsx isGuest || !me branch: EmptyState LogIn 'Sign in to edit your profile', 'Create an account to set your handle, bio and photos.', ctaLabel 'Sign in' -> /(auth)/login
- processing: Edit profile. Trigger: Handle typed and changed (400ms debounce); photo upload; save. Source: apps/mobile/src/app/profile/edit.tsx handleHint 'Checking availability.'; coverUploading indicator over the cover; avatarUploading Button loading; saving Button loading
- success: Edit profile. Trigger: Handle available. Source: apps/mobile/src/app/profile/edit.tsx 'This handle is available.' in colors.success
- error: Edit profile. Trigger: Handle taken, handle malformed, permission denied, upload failure, save failure. Source: apps/mobile/src/app/profile/edit.tsx: 'That handle is taken. Try another one.', 'Use 3 to 24 characters, lowercase letters, numbers and underscores.', 'Photo library access was not granted.', 'Could not upload the photo right now. Please try again.', toApiError(err).message || 'Could not save your profile. Please try again.'


## 9. Settings (account settings and personalization)

Category: ACCOUNT. Persona: player. Money: no.

One shared SettingsContent surface reached from three places: the You tab header Settings button, the pushed Profile page, and the Trainings shell gear. Sections: Appearance (System, Light, Dark), Preferred sports, Location (City, State, Save location), Notifications (three Switches), Account (Edit profile, Blocked accounts, Become a coach, Sign out, Delete account), Legal and support. Guests see Appearance plus Legal and support only, with a 'Sign in to personalize' card.

Release note: RELEASE-TODO task 10 wants support pointing at an atlitos.com address; the 'Contact support' row still opens mailto:founder@synthsports.co. Legal URLs resolve to the landing app pages (apps/landing/privacy.html, terms.html, content-policy.html). BUG-10 (State blank beside City) fixed by seeding from me once per user id (seededForUserId ref). UI-UPLIFT dev P2 item 30 asks for a version and env stamp here (absent). RELEASE-TODO A-37 covers the three entry points.

After success: Stays on Settings; Sign out lands on Home as guest (router.replace('/(tabs)'))

### Screens

**01 You tab (Profile)**  
Route `atlitos://you`, source `apps/mobile/src/app/profile/index.tsx`
- See: Header 'Settings' secondary button with lucide Settings icon.
- Do: Tap Settings. (Or the Settings gear top right of the Trainings tab, apps/mobile/src/app/(tabs)/trainings/(shell)/_layout.tsx accessibilityLabel 'Settings'.)
- Tap targets: `Settings`
- Then: router.push('/settings').

**02 Settings**  
Route `atlitos://settings`, source `apps/mobile/src/app/settings.tsx`
- See: AppBar backTitle 'Settings' then SettingsContent (apps/mobile/src/components/organisms/settings/SettingsContent.tsx). Section 'Appearance': Palette icon 'Theme', THEME_OPTIONS tiles Monitor 'System', Sun 'Light', Moon 'Dark' (applies live). Section 'Preferred sports': Volleyball icon 'What you play', select Chips Football, Cricket, Badminton, Tennis. Section 'Location': Inputs 'City', 'State', secondary Button 'Save location', success caption 'Location saved.' Section 'Notifications': Bell rows 'Session updates' ('Requests, confirmations and reminders for your sessions.'), 'Messages' ('New messages from your coaches and trainees.'), 'Offers and news' ('Occasional deals, drops and Atlitos updates.'), each with a Switch. Section 'Account': UserRoundPen 'Edit profile', UserRoundX 'Blocked accounts', UserRoundPlus 'Become a coach' (hidden when isCoach: verified or pending_review), LogOut 'Sign out' (danger), Trash2 'Delete account' (danger). Section 'Legal and support': ShieldCheck 'Privacy policy', Scale 'Terms of service', FileText 'Content policy', LifeBuoy 'Contact support'. Footer caption 'Saving...' while busy.
- Do: Tap a theme tile, toggle a sport chip or a Switch (each persists immediately), edit city and tap Save location, or open an Account or Legal row.
- Tap targets: `System`, `Light`, `Dark`, `Football`, `Cricket`, `Badminton`, `Tennis`, `Save location`, `Session updates`, `Messages`, `Offers and news`, `Edit profile`, `Blocked accounts`, `Become a coach`, `Sign out`, `Delete account`, `Privacy policy`, `Terms of service`, `Content policy`, `Contact support`, `Back`
- Then: Theme: applyTheme + persist({theme}). Sports and switches: persist (updateProfile then refreshMe). Edit profile -> /profile/edit. Blocked accounts -> /account/blocked. Become a coach -> /(onboarding)/coach-setup/[step] step 0. Legal rows -> Linking.openURL to https://www.atlitos.com/privacy, /terms, /content-policy, and mailto:founder@synthsports.co?subject=Atlitos%20support.

### States

- gate: Settings (guest). Trigger: Open atlitos://settings as a guest. Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx !isSignedIn card: 'Sign in to personalize', 'Create an account to save your sports, location and notification preferences. Appearance still works without one.', Button LogIn 'Sign in' -> /(auth)/login; Preferred sports, Location, Notifications and Account sections behind isSignedIn
- processing: Settings. Trigger: Any persisted change in flight. Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx busy caption 'Saving...'; savingLocation Button loading
- success: Settings. Trigger: Save location resolves. Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx locationSaved caption 'Location saved.' in colors.success. Caveat: handleSaveLocation sets locationSaved true even when persist() caught an error, so the success caption can show beside the error caption on a failed save.
- error: Settings. Trigger: updateProfile fails; or a legal URL cannot open. Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx persist catch 'Could not save that change. Please try again.'; Alert.alert('We could not open that', 'Please visit atlitos.com instead.')


## 10. Notifications and notification preferences

Category: ACCOUNT. Persona: player. Money: no.

In app notification list newest first with a type icon, unread accent tint and relative time; tapping a row marks it read and follows its deep link. Header actions: 'Mark all read' and a Settings2 icon to per type Push and Email toggles. Live inserts arrive via notifications.subscribe. Entry is the Bell in the Home AppBar; the You tab shows a badge dot when unread exist.

Release note: Push transport is stubbed today (preferences.tsx comment 'P9 transport, stubbed today'); RELEASE-TODO task 9 push notifications (P1, Sept 10 to 15) not started. UI-UPLIFT designer P2 item 27 (every clip notification tinted) and dev P1 item 14 (pagination footer) apply. The three notification Switches in Settings (sessions, messages, promotions) are a separate, coarser pref on the users row than the per type prefs here. Deep link as guest bounced to Login with no return (UI-UPLIFT dev P1 item 20).

After success: Row tap lands on the notification's deep link (order, session, clip, chat etc.); otherwise stays on the list

### Screens

**01 Home AppBar**  
Route `atlitos://`, source `apps/mobile/src/components/ui/app-bar.tsx`
- See: Bell icon (24, lucide Bell) with a small accent dot when hasUnreadNotifications. The IconButton has no accessibilityLabel.
- Do: Tap the bell.
- Tap targets: `Bell`
- Then: Signed in: router.push('/notifications') (apps/mobile/src/app/(tabs)/index.tsx onPressNotifications). Guest: openGate() shows LoginGateModal on Home.

**02 Notifications**  
Route `atlitos://notifications`, source `apps/mobile/src/app/notifications/index.tsx`
- See: AppBar backTitle 'Notifications'. Row with 'Mark all read' (accent semibold when hasUnread, tertiary and disabled otherwise) and a Settings2 icon button (accessibilityLabel 'Notification preferences'). List rows: circular icon per type from apps/mobile/src/lib/notification-display.ts (CalendarCheck Bookings, Package Orders, MessageCircle Messages, Clapperboard Clutch, HeartHandshake Empower, BadgeCheck Verification, ArrowLeftRight Payouts, LifeBuoy Support, Bell Updates fallback), title (1 line), body (2 lines), relative time ('now', '{n}m', '{n}h', then en-IN day and short month). Unread rows tinted. RefreshControl pull to refresh.
- Do: Tap a row, or Mark all read, or the preferences icon.
- Tap targets: `Mark all read`, `Notification preferences`, `Back`
- Then: Row: optimistic readAt, notifications.markRead, router.push(item.deepLink). Mark all read: optimistic then markAllRead. Icon: router.push('/notifications/preferences').

**03 Preferences**  
Route `atlitos://notifications/preferences`, source `apps/mobile/src/app/notifications/preferences.tsx`
- See: AppBar backTitle 'Preferences'. Callout 'Choose which updates reach you. In app notifications always show here. Push and email follow your choices below.' One PrefRow card per notification type (label from notificationDisplay) with icon, then 'Push' Switch and 'Email' Switch.
- Do: Toggle Push or Email per type.
- Tap targets: `Push`, `Email`, `Back`
- Then: Optimistic update then notifications.setPref; row opacity 0.6 and switches disabled while busy; reverts on failure.

### States

- gate: Notifications (guest). Trigger: Open atlitos://notifications as a guest. Source: apps/mobile/src/app/notifications/index.tsx requiresAuthGate: setGateVisible(true) on mount over an EmptyState BellOff 'Sign in to see your notifications', 'Bookings, orders, messages and updates land here once you are signed in.', ctaLabel 'Sign in' (reopens the gate)
- loading: Notifications. Trigger: First load. Source: apps/mobile/src/app/notifications/index.tsx state 'loading': five rows of Skeleton circle + two lines
- error: Notifications. Trigger: notifications.list() fails. Source: apps/mobile/src/app/notifications/index.tsx EmptyState TriangleAlert 'Notifications could not load', error?.message ?? 'Something went wrong. Please try again.', ctaLabel 'Retry'
- empty: Notifications. Trigger: No rows for this user. Source: apps/mobile/src/app/notifications/index.tsx EmptyState BellOff 'You are all caught up', 'New bookings, orders, messages and updates will show up here.'
- loading: Preferences. Trigger: First load. Source: apps/mobile/src/app/notifications/preferences.tsx five Skeleton shape card height 64
- error: Preferences. Trigger: listPrefs fails. Source: apps/mobile/src/app/notifications/preferences.tsx EmptyState TriangleAlert 'Preferences could not load', ctaLabel 'Retry'
- processing: Preferences. Trigger: Toggle a switch. Source: apps/mobile/src/app/notifications/preferences.tsx PrefRow busy opacity 0.6, Switch disabled={busy}

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png


## 11. Blocked accounts

Category: ACCOUNT. Persona: player. Money: no.

List of accounts the member has blocked (from Clutch), with an Unblock control behind a confirm Alert. Blocks are invisible to the other person; this is the only place they surface. Entry is Settings > Account > Blocked accounts.

Release note: Migration supabase/migrations/0122_user_blocks.sql (renamed from 0092 in the working tree) is unapplied on the live project, so the screen currently lands on the 'We could not load this' error state (walkthrough finding 3, UI-UPLIFT dev P0 item 4, RELEASE-TODO task 8 apply pending migrations). 0124 is chat_preview_and_bounds, the Messages counterpart. Source shows the friendly error copy, not a raw Postgres string. Missing onPressBack on the AppBar is a bug to log.

After success: Stays on Blocked accounts; list updates in place

### Screens

**01 Settings**  
Route `atlitos://settings`, source `apps/mobile/src/components/organisms/settings/SettingsContent.tsx`
- See: Account section ActionRow UserRoundX 'Blocked accounts'.
- Do: Tap Blocked accounts.
- Tap targets: `Blocked accounts`
- Then: router.push('/account/blocked').

**02 Blocked accounts**  
Route `atlitos://account/blocked`, source `apps/mobile/src/app/account/blocked.tsx`
- See: AppBar variant backTitle title 'Blocked accounts' with NO onPressBack prop, so the chevron (accessibilityLabel 'Back') does nothing; use the swipe back gesture. Caption 'You do not see posts or comments from these accounts. They are not told that you blocked them.' Rows: name and an accent 'Unblock' text button (accessibilityLabel 'Unblock {name}').
- Do: Tap Unblock on a row, then confirm.
- Tap targets: `Unblock`
- Then: Alert.alert('Unblock {name}?', 'You will start seeing their posts and comments again.') with Cancel and Unblock; on confirm clutch.unblockUser, row removed locally.

### States

- loading: Blocked accounts. Trigger: First open. Source: apps/mobile/src/app/account/blocked.tsx state 'loading' centered ActivityIndicator
- error: Blocked accounts. Trigger: clutch.blockedUsers() throws (today: user_blocks missing on the live project). Source: apps/mobile/src/app/account/blocked.tsx EmptyState UserRoundX 'We could not load this', 'Check your connection and try again.', ctaLabel 'Try again'
- empty: Blocked accounts. Trigger: No blocks. Source: apps/mobile/src/app/account/blocked.tsx EmptyState UserRoundX 'You have not blocked anyone', 'Blocked accounts show up here, and you can unblock them at any time.'
- processing: Blocked accounts. Trigger: Confirm Unblock. Source: apps/mobile/src/app/account/blocked.tsx busyId row label 'Unblocking...'
- failed: Blocked accounts. Trigger: unblockUser fails. Source: apps/mobile/src/app/account/blocked.tsx Alert.alert('We could not unblock that account', 'Please try again.')

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 12. Delete account

Category: ACCOUNT. Persona: player. Money: no.

App Store 5.1.1(v) account deletion from Settings > Account. Two native Alerts (never a screen): the first states what survives deletion, the second confirms. Calls profileApi.deleteAccount (delete-account edge function), then signs out locally. There is no dedicated delete account screen or route.

Release note: RELEASE-TODO task 10 requires the delete account path to load; A-39 to A-43 cover it. UI-UPLIFT dev P1 item 17 wants destructive confirms on ConfirmSheet, not Alert.alert. Post deletion the session is signed_out (not guest) and the user remains on Settings; splash owns the signed_out state but is not invoked, worth logging.

After success: No navigation is performed: the app stays on the Settings screen, which re renders in its guest variant ('Sign in to personalize') because status becomes signed_out (session-store derives status from the session). The user is not re guested and not routed to Home or splash.

### Screens

**01 Settings**  
Route `atlitos://settings`, source `apps/mobile/src/components/organisms/settings/SettingsContent.tsx`
- See: Last ActionRow of the Account section: Trash2 icon 'Delete account' in danger tone (reads 'Deleting your account...' while deleting).
- Do: Tap Delete account.
- Tap targets: `Delete account`
- Then: confirmDeleteAccount opens Alert 1.

**02 Alert: Delete your account**  
Route `atlitos://settings`, source `apps/mobile/src/components/organisms/settings/SettingsContent.tsx`
- See: Native Alert title 'Delete your account', message 'This permanently removes your profile, clips, comments, chats, saved addresses and cart. Your order and payment records are kept, without your name attached, because we are required to retain them. This cannot be undone.' Buttons 'Keep my account' (cancel) and 'Delete' (destructive).
- Do: Tap Delete.
- Tap targets: `Keep my account`, `Delete`
- Then: Alert 2 opens.

**03 Alert: Are you sure?**  
Route `atlitos://settings`, source `apps/mobile/src/components/organisms/settings/SettingsContent.tsx`
- See: Native Alert 'Are you sure?' / 'Deleting your account signs you out immediately and cannot be reversed.' Buttons 'Cancel' and 'Delete forever' (destructive).
- Do: Tap Delete forever.
- Tap targets: `Cancel`, `Delete forever`
- Then: handleDeleteAccount: profileApi.deleteAccount() then signOut().

### States

- gate: Alert: Delete your account / Are you sure?. Trigger: Tap Delete account. Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx confirmDeleteAccount, two nested Alert.alert calls, destructive action never the default
- processing: Settings. Trigger: After Delete forever. Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx deleting: row label 'Deleting your account...', onPress ignored while deleting
- failed: Settings. Trigger: Edge function rejects (e.g. in flight order or session, or network). Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx Alert.alert('We could not delete your account', message ?? 'Please try again, or contact support.')
- success: Settings (signed out). Trigger: Deletion resolves. Source: apps/mobile/src/components/organisms/settings/SettingsContent.tsx handleDeleteAccount: await signOut(); no router call, no continueAsGuest


## 13. Log out (Sign out)

Category: ACCOUNT. Persona: player. Money: no.

Two affordances. Settings > Account > 'Sign out' signs out, silently re creates a guest session and replaces to Home. Home also keeps a quiet 'Log out' text button at the very end of the scroll (signed in only, PRD-01 FR-65). Neither lands on Login.

Release note: RELEASE-TODO A-38 covers sign out from Settings. TEST-SUITE A-12 NOT RUN. The Home footer 'Log out' row sits under the floating nav pill until NAV_BAR_INSET padding lands (UI-UPLIFT dev P0 item 1); designer P0 item 5 proposes removing the BrandFooter above it.

After success: Home tab atlitos:// in guest mode

### Screens

**01 Settings**  
Route `atlitos://settings`, source `apps/mobile/src/components/organisms/settings/SettingsContent.tsx`
- See: Account section ActionRow LogOut icon 'Sign out' tone danger.
- Do: Tap Sign out. No confirmation.
- Tap targets: `Sign out`
- Then: handleSignOut: signOut(), continueAsGuest(), router.replace('/(tabs)'). On failure router.replace('/(auth)/splash').

**02 Home (Log out button)**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx`
- See: After the BrandFooter, a text Button 'Log out' in textSecondary, only when status === 'signed_in'.
- Do: Scroll to the bottom, tap Log out.
- Tap targets: `Log out`
- Then: handleLogout: signOut() then continueAsGuest(); stays on Home now as guest. On failure router.replace('/(auth)/splash').

**03 Home (guest)**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx`
- See: Home as guest: header avatar falls back to initial 'A' (app-bar.tsx initialsFor), cart badge hidden at 0, bell without dot; the Log out button is gone.
- Do: Browse as guest.
- Then: Guest gates apply again.

### States

- processing: Settings / Home. Trigger: Tap Sign out or Log out. Source: SettingsContent.tsx handleSignOut setBusy(true) so the shared 'Saving...' caption shows; (tabs)/index.tsx loggingOut Button loading
- failed: Splash. Trigger: Guest re sign in fails after sign out (anonymous sign ins disabled). Source: SettingsContent.tsx handleSignOut catch router.replace('/(auth)/splash'); (tabs)/index.tsx handleLogout catch same; splash then shows the guest retry state


## 14. Guest login gate and the guest experience of each tab

Category: STATES. Persona: guest. Money: no.

Read surfaces browse freely; any mutating or private tap raises LoginGateModal, an in tree bottom sheet through the root PortalHost (not a native Modal). Login and Register push on top of the gated screen so the guest returns to it after auth (PRD-01 FR-3, FR-4). Some private screens render an inline EmptyState with 'Sign in' instead of the sheet.

Release note: RELEASE-TODO task 5 (P0, not started in source): courts become an affiliate click out and the in app booking flow plus its deep link routes are hidden; today court/[id].tsx still renders the SlotPicker and gates 'Book this slot'. G-19 expects the guest booking action on court detail to click out, not gate. Walkthrough finding 2 / UI-UPLIFT dev P0 item 3: LoginGateModal persists across deep link navigation, including over Login itself. Dev P1 item 20: deep links as guest bounce to Login with no return. Guest Home screenshots show 'Browsing as a guest' copy in older builds; current source has no such copy.

After success: After Login or Register completes, the guest is returned to the exact screen where the gate was raised (router.back()); the intended action is not replayed automatically

### Screens

**01 LoginGateModal (bottom sheet)**  
Route `(overlay on the current screen)`, source `apps/mobile/src/components/organisms/LoginGateModal.tsx`
- See: Scrim Pressable (onPress={onClose}), sheet from LoginGateSheet.tsx: X close (accessibilityLabel 'Close'), 'Want to hit the spotlight?', 'Sign in to book sessions, track progress and join the community.', primary Button 'Login', secondary Button 'Register'. Rendered through @rn-primitives/portal Portal into the root PortalHost in apps/mobile/src/app/_layout.tsx.
- Do: Tap Login or Register.
- Tap targets: `Login`, `Register`, `Close`
- Then: onClose then router.push('/(auth)/login') or router.push('/(auth)/register'). After auth, Login's afterAuth does router.back() to this screen.

**02 Home tab (guest)**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx`
- See: Full Home. Header avatar shows 'A'. Gate raised by: cart icon, bell icon, avatar (requiresAuthGate -> openGate); Clutch preview like (ClutchPreviewCard.tsx requiresAuthGate). No 'Finish setting up' card, no 'Log out'.
- Do: Tap cart, bell, avatar, or like on the Clutch preview.
- Tap targets: `ShoppingCart`, `Bell`, `Profile`, `Heart`
- Then: LoginGateModal opens over Home.

**03 Trainings tab (guest)**  
Route `atlitos://trainings`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx`
- See: Shell title 'Trainings' with Settings gear (accessibilityLabel 'Settings'), no sub nav. EmptyState Lock icon 'Set up your profile to train', 'Book coaches, track sessions and see your progress once you have an account.', ctaLabel 'Get started'.
- Do: Tap Get started.
- Tap targets: `Get started`, `Settings`
- Then: LoginGateModal opens. Settings gear opens the guest Settings.

**04 Clutch tab (guest)**  
Route `atlitos://clutch`, source `apps/mobile/src/app/(tabs)/clutch/index.tsx`
- See: Full bleed vertical feed, read only. Header h2 'Clutch' with accent pill Plus 'Post' (accessibilityLabel 'Upload a clip'). Like, comment, share (ClutchPostCard.tsx Heart, MessageCircle, Share2), follow, block and Post go through requireAuth.
- Do: Tap Post or the like heart.
- Tap targets: `Post`, `Heart`, `MessageCircle`, `Share2`
- Then: LoginGateModal opens over the feed.

**05 Courts tab (guest)**  
Route `atlitos://courts`, source `apps/mobile/src/app/(tabs)/courts/index.tsx`
- See: h1 'Courts', accent 'My bookings' (CalendarClock) top right, MapPin row 'Showing courts near {city}' (or 'Finding your location...'), sport chips, court cards. Browse is open.
- Do: Tap My bookings, or open a court and tap 'Book this slot' (apps/mobile/src/app/(tabs)/courts/court/[id].tsx, label 'Select a time to book' until a slot is chosen).
- Tap targets: `My bookings`, `Book this slot`
- Then: LoginGateModal opens.

**06 You tab (guest)**  
Route `atlitos://you`, source `apps/mobile/src/app/profile/index.tsx`
- See: Title 'Profile'. EmptyState LogIn icon 'Sign in to see your profile', 'Create an account to post clips, follow athletes and build your channel.', ctaLabel 'Sign in'.
- Do: Tap Sign in.
- Tap targets: `Sign in`
- Then: router.push('/(auth)/login') directly, no sheet.

**07 Settings (guest)**  
Route `atlitos://settings`, source `apps/mobile/src/components/organisms/settings/SettingsContent.tsx`
- See: Card 'Sign in to personalize' with Button LogIn 'Sign in'; Appearance and Legal and support sections still usable.
- Do: Tap Sign in.
- Tap targets: `Sign in`
- Then: router.push('/(auth)/login').

### States

- gate: LoginGateModal. Trigger: Any gated tap; hosts (grep 'LoginGateModal visible' in apps/mobile/src): (tabs)/index.tsx, trainings/(shell)/index.tsx, clutch/index.tsx, clutch/post/[id].tsx, clutch/creator/[id].tsx, clutch/upload.tsx, courts/index.tsx, courts/court/[id].tsx, coaching/index.tsx, coaching/coach/[id].tsx, home/donate/[id].tsx, learn/drill/[id].tsx, notifications/index.tsx, shop/product/[id].tsx, organisms/chat/ChatThreadList.tsx, organisms/home/ClutchPreviewCard.tsx. Source: apps/mobile/src/components/organisms/LoginGateModal.tsx; sheet copy in apps/mobile/src/components/organisms/LoginGateSheet.tsx
- gate: Inline sign in empty states (no sheet). Trigger: Open You, profile/edit, clutch/profile, notifications (plus auto sheet), shop/cart, chat, account/impact as a guest. Source: profile/index.tsx 'Sign in to see your profile'; profile/edit.tsx 'Sign in to edit your profile'; (tabs)/clutch/profile.tsx 'Sign in to see your clips'; notifications/index.tsx 'Sign in to see your notifications'; shop/cart.tsx 'Sign in to see your cart' ctaLabel 'Browse gear'; chat ChatThreadList.tsx 'Sign in to see your messages'; account/impact.tsx 'Sign in to see your impact'
- gate: Trainings tab. Trigger: Guest opens Trainings. Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx requiresAuthGate EmptyState Lock 'Set up your profile to train' ctaLabel 'Get started'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png
- docs/phases/evidence/p9-native/03-trainings-guest-gate.png
- docs/phases/evidence/p3/guest-home-light.png
- docs/phases/evidence/p9-native/01-boot.png


## 15. Home tour (discover sports, rails, bottom nav)

Category: SPORTS. Persona: guest. Money: no.

The Home tab from top to bottom: brand AppBar, AI search entry, location row, sport category circles (routing into Shop categories), optional Finish setting up card, promo carousel, Recently viewed or Shop rail, Clutch preview, Donate to Empower rail, brand footer, Log out. One ScrollView with pull to refresh; every rail hides itself on empty or error. The floating bottom nav pill has five tabs.

Release note: There is NO Learn entry on Home in source; the only '/learn' pushes are apps/mobile/src/components/organisms/trainings/MilestonesRail.tsx 'See all' and its empty CTA. UI-UPLIFT designer P0 items 3 (hero banner), 4 (Clutch preview 9:16 with caption outside), 5 (remove BrandFooter), premium P0 item 2 (VideoView captions control leaking through the preview), dev P0 item 1 (NAV_BAR_INSET unused, last row under the pill). RELEASE-TODO task 19 PostHog analytics decision pending.

After success: Stays on Home; each rail pushes into its domain (Shop, Clutch, Empower, Search)

### Screens

**01 Home AppBar**  
Route `atlitos://`, source `apps/mobile/src/components/ui/app-bar.tsx`
- See: Wordmark 'ATLITOS' (font-sans-bold text-2xl tracking-tighter). Right side: ShoppingCart icon with accent count badge ('9+' cap, hidden at 0), Bell icon with accent unread dot, h-9 w-9 (36pt) avatar (photo or up to two initials via initialsFor, 'A' for guests; accessibilityLabel 'Profile'). Cart and Bell IconButtons carry no accessibilityLabel.
- Do: Tap cart, bell or avatar.
- Tap targets: `ShoppingCart`, `Bell`, `Profile`
- Then: Signed in: /shop/cart, /notifications, /(tabs)/you. Guest: LoginGateModal (apps/mobile/src/app/(tabs)/index.tsx).

**02 Search bar and location row**  
Route `atlitos://`, source `apps/mobile/src/components/ui/search-bar.tsx`
- See: Non editable SearchBar variant ai: Sparkles icon, default placeholder 'What are you looking for...'. Below it LocationRow (apps/mobile/src/components/organisms/home/LocationRow.tsx): MapPin icon and the city from useLocationStore (Hyderabad fallback). The location row has no onPress.
- Do: Tap the search bar.
- Tap targets: `What are you looking for...`
- Then: router.push('/home/search').

**03 Categories row (sport chips)**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/CategoriesRow.tsx`
- See: Horizontal row of h-14 w-14 (56pt) circles with accent lucide icons and labels from apps/mobile/src/lib/sport-display.ts: Goal 'Football', CircleDot 'Cricket', Feather 'Badminton', Target 'Tennis'; each Pressable accessibilityLabel = SPORT_LABEL.
- Do: Tap a sport.
- Tap targets: `Football`, `Cricket`, `Badminton`, `Tennis`
- Then: router.push('/shop/category/[sport]') (Shop category browse, not a sport hub).

**04 Promo carousel**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/PromoCarousel.tsx`
- See: Paged 160pt banners from promo_banners (listPromoBanners): image with bottom scrim, title, body, pill CTA (item.ctaLabel), dot indicators when banners.length > 1.
- Do: Swipe, tap a banner.
- Tap targets: `{banner.title}`
- Then: router.push(item.ctaRoute) when set.

**05 Recently viewed / Shop rail**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/RecentlyViewedRail.tsx`
- See: h3 'Recently viewed' (when the local buffer has products) or 'Shop' (fallback, first 8 catalog products), accent 'See all' with ChevronRight (accessibilityLabel 'See all gear'), horizontal row of ProductCard variant row.
- Do: Tap See all or a product.
- Tap targets: `See all`
- Then: See all -> /shop. Card -> /shop/product/[id].

**06 Clutch preview**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/ClutchPreviewCard.tsx`
- See: aspectRatio 4/5 ClutchPostCard variant feed of the most recent published clip (like, comment, share rail: Heart, MessageCircle, Share2 in apps/mobile/src/components/molecules/ClutchPostCard.tsx), then a row 'Open Clutch' (accessibilityLabel 'Open Clutch') with ChevronRight.
- Do: Tap the clip, like, or Open Clutch.
- Tap targets: `Open Clutch`, `Heart`, `MessageCircle`, `Share2`
- Then: Open Clutch -> /(tabs)/clutch. Clip or comment -> /(tabs)/clutch/post/[id]. Like optimistic toggle (requiresAuthGate raises LoginGateModal for guests).

**07 Donate to Empower rail**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/EmpowerRail.tsx`
- See: h3 'Donate to Empower', accent 'See all' (accessibilityLabel 'See all Empower athletes'), horizontal UPACard hub variant cards (apps/mobile/src/components/ui/upa-card.tsx: 'Donate' and 'View profile' buttons), up to 8 (rows.slice(0, 8)).
- Do: Tap See all, Donate or View profile.
- Tap targets: `See all`, `Donate`, `View profile`
- Then: See all -> /home/empower. Donate -> /home/donate/[id]. View profile -> /home/upa/[id].

**08 Brand footer and Log out**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/BrandFooter.tsx`
- See: h3 'Built for Athletes. Backed by Tech. Powered by Purpose.' with Athletes, Tech, Purpose in accent. Then, signed in only, text Button 'Log out' (apps/mobile/src/app/(tabs)/index.tsx).
- Do: Scroll to the end.
- Tap targets: `Log out`
- Then: See the Log out workflow.

**09 Bottom nav pill**  
Route `atlitos://`, source `apps/mobile/src/components/ui/bottom-nav.tsx`
- See: Absolute floating BlurView capsule with five icon plus LABEL_SIZE 11 label tabs (TABS): 'Home' (lucide Home), 'Trainings' (Dumbbell), 'Clutch' (Play), 'Courts' (LandPlot), 'You' (CircleUser, replaced by the member avatar Image when avatarUri exists). Active tab strokeWidth 2.2. DOT_SIZE 9 badge dot in navChrome.badge (#FF3B30 / #FF453A) on You when badgedTabs includes 'you' (unread notifications, apps/mobile/src/app/(tabs)/_layout.tsx). RESTING_SCALE 0.88, COLLAPSE_DELAY_MS 2200. Light haptic on tab press. Horizontal PanResponder in (tabs)/_layout.tsx: SWIPE_MIN_DX 56, SWIPE_AXIS_RATIO 1.8, TAB_PATHS '/', '/trainings', '/clutch', '/courts', '/you'. ROUTE_TO_TAB maps coaching to trainings.
- Do: Tap a tab or swipe horizontally.
- Tap targets: `Home`, `Trainings`, `Clutch`, `Courts`, `You`
- Then: Tabs.Screen names index (Home), trainings, clutch, courts, you in apps/mobile/src/app/(tabs)/_layout.tsx.

### States

- loading: Home rails. Trigger: First load or pull to refresh (reloadKey). Source: PromoCarousel Skeleton card height 160; RecentlyViewedRail Skeleton line + two card width 200; ClutchPreviewCard Skeleton card height 280; EmpowerRail Skeleton line + two card width 288
- empty: Home rails. Trigger: Domain returns no rows or throws. Source: PromoCarousel banners.length === 0 return null; RecentlyViewedRail products.length === 0 return null; ClutchPreviewCard !clip return null; EmpowerRail upas.length === 0 return null; Home never shows a rail level error
- gate: Finish setting up card. Trigger: Signed in with me.city null and not dismissed. Source: apps/mobile/src/app/(tabs)/index.tsx showFinishSetup
- loading: Pull to refresh. Trigger: Pull down. Source: apps/mobile/src/app/(tabs)/index.tsx RefreshControl, setRefreshing(false) after 600ms

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p3/athlete-home-light.png
- docs/phases/evidence/p3/athlete-home-dark.png
- docs/phases/evidence/p3/guest-home-light.png
- docs/phases/evidence/p3/coach-home-light.png
- docs/phases/evidence/p3/coach-home-dark.png
- docs/phases/evidence/p9-native/01-boot.png
- docs/phases/evidence/p3-web/web-athlete-home-signed-in.jpg


## 16. Search (find coaches, courts, gear, athletes and clips)

Category: SPORTS. Persona: guest. Money: no.

Single AI search box over the whole catalog, debounced 300ms, ranked results grouped into segments Coaches, Courts, Gear, Athletes, Clips with a rankReason pill per row. Guest open. Suggested chips and locally persisted recent searches (AsyncStorage, MAX_RECENT_SEARCHES 8) on the idle screen. The server can return a specific 'broaden' suggestion for an honest empty result.

Release note: UI-UPLIFT designer P2 item 26 (suggestion chips as a 2 column grid) and premium P2 item 26 (48pt field with border, results animate from the field). TEST-SUITE BUG-03 (S-03): search uses the profile city while Courts uses GPS. TEST-CATALOG SR-05 checks the broaden copy renders verbatim.

After success: The matching detail screen for the tapped result (product, coach profile, court detail, UPA profile, or clip post)

### Screens

**01 Home search bar**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx`
- See: SearchBar variant ai entry point under the AppBar.
- Do: Tap it.
- Tap targets: `What are you looking for...`
- Then: router.push('/home/search').

**02 Search (idle)**  
Route `atlitos://home/search`, source `apps/mobile/src/app/home/search.tsx`
- See: AppBar backTitle 'Search'. Live SearchBar ai, caption 'Searching near {city}'. Label 'Suggested' with SUGGESTIONS Chips 'Courts near me', 'Badminton gear', 'Coaches under 500', 'Athletes to support'. Label 'Recent searches' with 'Clear' and up to 8 Clock icon rows (only after a search). Centered SearchX icon, 'Find coaches, courts, gear, athletes and clips', 'Try "badminton coach near me" or "cricket bat under 1500".'
- Do: Type 2 or more characters, or tap a suggestion or recent row.
- Tap targets: `Courts near me`, `Badminton gear`, `Coaches under 500`, `Athletes to support`, `Clear`, `Back`
- Then: runSearch after a 300ms setTimeout; query remembered in AsyncStorage (q.length < 2 resets to idle).

**03 Search results**  
Route `atlitos://home/search`, source `apps/mobile/src/components/organisms/SearchResults.tsx`
- See: Caption 'Results for "{query}"'. When segments.length > 1, pill segments labelled from SEGMENT_LABEL: Gear, Coaches, Courts, Athletes, Clips. Rows: 56pt image, title, subtitle, StatusPill tone info with the rankReason, price when present, ChevronRight.
- Do: Tap a segment or a row.
- Tap targets: `Coaches`, `Courts`, `Gear`, `Athletes`, `Clips`
- Then: apps/mobile/src/app/home/search.tsx: gear -> /shop/product/[id]; coach -> /(tabs)/coaching/coach/[id]; court -> /(tabs)/courts/court/[id]; athlete -> /home/upa/[id]; clip -> /(tabs)/clutch/post/[id].

### States

- empty: Search (idle). Trigger: Open the screen or clear the query under 2 chars. Source: apps/mobile/src/app/home/search.tsx state 'idle' block with SUGGESTIONS and SearchX copy
- loading: Search. Trigger: Query in flight. Source: apps/mobile/src/app/home/search.tsx state 'loading' centered ActivityIndicator accent
- error: Search. Trigger: ai-search edge function fails. Source: apps/mobile/src/app/home/search.tsx TriangleAlert 'Couldn't run that search', error.message or 'Something went wrong. Please try again.', Button RefreshCw 'Retry'
- empty: Search results. Trigger: Zero hits. Source: apps/mobile/src/app/home/search.tsx emptyLabel={broaden ?? `No matches for "{q}" near {city}. Try another search.`}; SearchResults ListEmptyComponent

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png


## 17. Address book

Category: ACCOUNT. Persona: shopper. Money: no.

Saved delivery addresses under the account group (PRD-07 FR-30): add, edit, set default, delete behind ConfirmSheet. Deleting an address referenced by an in flight or past order is blocked server side and explained inline. No screen in the app pushes '/account/addresses' today (Settings has no row for it; checkout uses its own shop/checkout/address.tsx), so it is reachable only by deep link.

Release note: No in app entry point (grep for '/account/addresses' finds only the AddressForm.tsx comment); RELEASE-TODO section 3 has no athlete or shopper scenario opening the address book outside checkout. Worth a bug ledger row or a Settings row.

After success: Stays on Address book; list updates in place

### Screens

**01 Address book**  
Route `atlitos://account/addresses`, source `apps/mobile/src/app/account/addresses.tsx`
- See: AppBar backTitle 'Address book'. One bordered card per address with a StatusPill verified marker when isDefault, text Buttons 'Edit' and 'Set default' (non default only), Trash2 icon button (accessibilityLabel 'Delete address'). Below the list either the inline AddressForm ('New address' or 'Edit address', submitLabel 'Save address' or 'Save changes') or a secondary Button 'Add a new address'.
- Do: Tap Add a new address and fill the AddressForm, or Edit, Set default, or the Trash2 icon.
- Tap targets: `Add a new address`, `Edit`, `Set default`, `Delete address`, `Save address`, `Save changes`, `Back`
- Then: createAddress / updateAddress then reload; setDefaultAddress; Trash2 opens ConfirmSheet 'Delete this address?' / '{line1}, {city} will be removed from your address book.' with confirmLabel 'Delete'.

### States

- loading: Address book. Trigger: First open. Source: apps/mobile/src/app/account/addresses.tsx two Skeleton shape card height 110
- error: Address book. Trigger: listAddresses fails. Source: apps/mobile/src/app/account/addresses.tsx TriangleAlert 'Couldn't load your addresses', Button 'Retry'
- empty: Address book. Trigger: No saved addresses. Source: apps/mobile/src/app/account/addresses.tsx EmptyState MapPinOff 'No saved addresses', 'Save an address once and every order after this one ships in a tap.', ctaLabel 'Add address'
- gate: Delete confirm. Trigger: Tap the Trash2 icon on a card. Source: apps/mobile/src/app/account/addresses.tsx ConfirmSheet visible={pendingDelete !== null}, icon Trash2, title 'Delete this address?', confirmLabel 'Delete'
- failed: Address book. Trigger: Delete an address on an in flight or past order. Source: apps/mobile/src/app/account/addresses.tsx deleteErrors: ADDRESS_IN_USE -> 'This address is on an order that is still on the way, so it cannot be deleted yet.'; ADDRESS_ON_PAST_ORDER -> 'This address is kept on a past order, so it cannot be deleted.'; else apiError.message || 'Could not delete this address.' rendered inline on the card with TriangleAlert

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-18-address-book-light.jpg
- docs/phases/evidence/p4-web/web-shop-18-address-book-dark.jpg
- docs/phases/evidence/p4-web/web-shop-20-address-book-EDITED-light.jpg
- docs/phases/evidence/p4-web/web-shop-22-address-book-restored-light.jpg


## 18. My wishlist (account page)

Category: ACCOUNT. Persona: shopper. Money: no.

Standalone wishlist page under the account group (PRD-07 FR-28, FR-29), separate from the You tab's wishlist grid. Live prices and stock at display time, 'Move to cart' at qty 1 with a 'Pick a size' overlay when a product has several variants. Entry is the Shop category screen heart shortcut.

Release note: Guest sees the empty state instead of a sign in prompt, inconsistent with the You tab and cart gates. RELEASE-TODO S-01 to S-27 (shopper day) cover wishlist behaviour; not in the athlete list.

After success: Stays on My wishlist; notice row confirms the cart move

### Screens

**01 Shop category**  
Route `atlitos://shop/category/{sport}`, source `apps/mobile/src/app/shop/category/[sport].tsx`
- See: Category browse with a wishlist shortcut in the header.
- Do: Tap the wishlist shortcut.
- Tap targets: `Heart`
- Then: router.push('/account/wishlist').

**02 My wishlist**  
Route `atlitos://account/wishlist`, source `apps/mobile/src/app/account/wishlist.tsx`
- See: AppBar backTitle 'My wishlist'. Optional accentTint notice row with a Check icon ('Moved to your cart.' or 'Only {n} left, so your cart has {qty}.'). WishlistGrid of saved products with remove heart and 'Move to cart' (apps/mobile/src/components/organisms/WishlistGrid.tsx). Multi variant products open a 'Pick a size' overlay listing buyable variants.
- Do: Tap a product, Move to cart, or a size in the picker.
- Tap targets: `Move to cart`, `Pick a size`, `Back`
- Then: Product -> /shop/product/[id]. Move to cart -> shop.addToCart(variantId, 1) then reload and notice.

### States

- loading: My wishlist. Trigger: First open when signed in. Source: apps/mobile/src/app/account/wishlist.tsx four Skeleton shape card height 200 in two rows
- error: My wishlist. Trigger: listWishlist fails. Source: apps/mobile/src/app/account/wishlist.tsx TriangleAlert 'Couldn't load your wishlist', Button 'Retry'
- empty: My wishlist. Trigger: No saved products, or opened as a guest (load() sets state 'empty' without a sign in gate). Source: apps/mobile/src/app/account/wishlist.tsx EmptyState HeartOff 'Nothing saved yet', 'Tap the heart on any gear and it waits for you here, with live prices.', ctaLabel 'Browse gear' -> /shop/category/all
- failed: My wishlist. Trigger: Move to cart hits OUT_OF_STOCK or another API error. Source: apps/mobile/src/app/account/wishlist.tsx notice 'That one just sold out. Try another size.' or apiError.message || 'Could not move this to your cart.'
- gate: Pick a size. Trigger: Move to cart on a product with more than one buyable variant. Source: apps/mobile/src/app/account/wishlist.tsx variantPicker overlay, h3 'Pick a size'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p4-web/web-shop-07-wishlist-light.jpg
- docs/phases/evidence/p4-web/web-shop-07-wishlist-dark.jpg


## 19. My Impact

Category: ACCOUNT. Persona: donor. Money: no.

Donor's own giving summary (PRD-06 FR-12 to FR-14) from get_my_impact_summary: Total given, Athletes supported, Items funded, donation history (General Fund for roundups) and gratitude received. Reached only from the Donate success screen 'View My Impact'; there is no Settings or You tab row for it.

Release note: RELEASE-TODO D-13 to D-16 and D-19 cover My Impact. Only entry is the donate success screen, so D-14 (never donated) and D-16 (second account) need a deep link. RELEASE-TODO row 24 (Apple commission on donations) is an open founder decision affecting this surface.

After success: Stays on My Impact

### Screens

**01 Donate success**  
Route `atlitos://home/donate/{id}`, source `apps/mobile/src/app/home/donate/[id].tsx`
- See: CheckCircle2 success, h2 'Thank you for giving', primary Button 'View My Impact', secondary 'Back to athlete'.
- Do: Tap View My Impact.
- Tap targets: `View My Impact`, `Back to athlete`
- Then: router.replace('/account/impact').

**02 My Impact**  
Route `atlitos://account/impact`, source `apps/mobile/src/app/account/impact.tsx`
- See: AppBar backTitle 'My Impact'. StatTile 'Total given' (HeartHandshake), 'Athletes supported', 'Items funded'. Overline 'Donation history' rows (UPA name or General Fund, amount, date). Overline 'Thank you notes' with MessageSquareHeart rows when gratitude exists.
- Do: Read; tap Back.
- Tap targets: `Back`
- Then: router.back().

### States

- gate: My Impact (guest). Trigger: Open atlitos://account/impact as a guest. Source: apps/mobile/src/app/account/impact.tsx !isSignedIn branch: h3 'Sign in to see your impact', secondary Button 'Sign in' -> /(auth)/login
- loading: My Impact. Trigger: First open. Source: apps/mobile/src/app/account/impact.tsx Skeleton cards height 96, 160, 120
- error: My Impact. Trigger: get_my_impact_summary fails. Source: apps/mobile/src/app/account/impact.tsx TriangleAlert 'Couldn't load My Impact', Button 'Retry'
- empty: My Impact. Trigger: Account that has never donated. Source: apps/mobile/src/app/account/impact.tsx EmptyState HeartHandshake 'No donations yet', 'Support a verified athlete and your giving will show up here.', ctaLabel 'Explore Empower' -> /home/empower


## 20. Empower from Home (hub, athlete profile, donate)

Category: ACCOUNT. Persona: donor. Money: yes.

The Home 'Donate to Empower' rail leads into the Empower hub (sport and region filters over verified athletes), the UPA profile ('Donate to this athlete', per wishlist item 'Fund this', supporters, thank you notes), and the Donate screen (preset amounts 200, 500, 1000, 2500 or a custom amount, shared BillSummary, ConfirmSheet 'Donate now', Razorpay checkout, success with 'View My Impact'). Guests browse freely; tapping a donation amount raises LoginGateModal.

Release note: RELEASE-TODO D-01 to D-13 cover this flow (donor day 3). Task 7 (Razorpay live key) and founder row 24 (Apple commission on donations through an Atlitos held fund) block store submission for this surface. UI-UPLIFT designer P0 items 7 and 8 (Empower card cover and title duplication) apply to the hub cards.

After success: My Impact atlitos://account/impact, or back to the athlete profile atlitos://home/upa/{id}

### Screens

**01 Home, Donate to Empower rail**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/EmpowerRail.tsx`
- See: h3 'Donate to Empower', 'See all', UPACard hub cards with 'Donate' and 'View profile'.
- Do: Tap See all, Donate or View profile.
- Tap targets: `See all`, `Donate`, `View profile`
- Then: /home/empower, /home/donate/[id], /home/upa/[id].

**02 Empower hub**  
Route `atlitos://home/empower`, source `apps/mobile/src/app/home/empower.tsx`
- See: AppBar backTitle 'Empower'. StatTile 'Raised so far' (HeartHandshake). SlidersHorizontal 'Filter' with sport Chips (Football, Cricket, Badminton, Tennis) and region Chips. UPACard list with 'Donate' and 'View profile'.
- Do: Tap a sport or region chip, then Donate or View profile on a card.
- Tap targets: `Football`, `Cricket`, `Badminton`, `Tennis`, `Donate`, `View profile`, `Clear filters`, `Back`
- Then: Donate -> /home/donate/{id}; View profile -> /home/upa/{id}.

**03 Athlete profile (UPA)**  
Route `atlitos://home/upa/{id}`, source `apps/mobile/src/app/home/upa/[id].tsx`
- See: AppBar backTitle 'Athlete'. Caption 'Verified athlete', h1 headline, 'Raised to date' total, primary Button 'Donate to this athlete'. Overline 'Wishlist' with WishlistGrid upa variant items ('Fund this' or 'Funded' marker). '{n} supporter(s)' row or 'No supporters yet. Be the first to fund this athlete.' Overline 'Thank you notes'.
- Do: Tap Donate to this athlete or Fund this on an item.
- Tap targets: `Donate to this athlete`, `Fund this`, `Back`
- Then: /home/donate/{id} or /home/donate/{id}?itemId={itemId}.

**04 Donate**  
Route `atlitos://home/donate/{id}`, source `apps/mobile/src/app/home/donate/[id].tsx`
- See: AppBar backTitle 'Donate'. DonationSheet (apps/mobile/src/components/organisms/DonationSheet.tsx): overline 'Donate', PRESET_AMOUNTS chips 200, 500, 1000, 2500, Input 'Custom amount' placeholder 'Enter amount', shared BillSummary (Donation row + Total), Button 'Donate {amount}'. Funded item variants show 'This item is now funded' / 'This item is fully funded' with 'Donate to the general fund'.
- Do: Pick an amount, tap Donate, confirm in the ConfirmSheet 'Confirm your donation' / 'You are donating {amount} to {target}.' with 'Donate now', complete Razorpay.
- Tap targets: `Donate`, `Donate now`, `Donate to the general fund`, `Back`
- Then: requestDonate gates guests (LoginGateModal); signed in -> ConfirmSheet -> openRazorpayCheckout -> phase success.

**05 Donate success**  
Route `atlitos://home/donate/{id}`, source `apps/mobile/src/app/home/donate/[id].tsx`
- See: CheckCircle2 56 success, h2 'Thank you for giving', callout 'Your donation moves {item} closer to its goal.' or 'Your donation supports {headline}.', Buttons 'View My Impact' and 'Back to athlete'.
- Do: Tap View My Impact.
- Tap targets: `View My Impact`, `Back to athlete`
- Then: router.replace('/account/impact') or router.replace('/home/upa/{id}').

### States

- loading: Empower hub / Athlete / Donate. Trigger: First open. Source: empower.tsx Skeleton cards 96, 200, 200; upa/[id].tsx Skeleton 220, 120, 160; donate/[id].tsx Skeleton 120, 200
- error: Empower hub / Athlete / Donate. Trigger: RPC fails (D-17 airplane mode). Source: empower.tsx, upa/[id].tsx, donate/[id].tsx TriangleAlert plus Button 'Retry'
- empty: Empower hub. Trigger: No verified athletes, or filters exclude all. Source: apps/mobile/src/app/home/empower.tsx EmptyState HeartHandshake 'No athletes yet' / 'No athletes match', ctaLabel 'Clear filters' when filtersActive
- empty: Athlete not found. Trigger: Unknown or unverified UPA id (D-07). Source: apps/mobile/src/app/home/upa/[id].tsx EmptyState SearchX 'Athlete not found', 'This profile is not available. Browse verified athletes on the Empower hub.', ctaLabel 'Back to Empower'
- gate: Donate (guest). Trigger: Guest taps a donation amount (D-28 / G-28). Source: apps/mobile/src/app/home/donate/[id].tsx requestDonate: !isSignedIn -> setGateVisible(true); LoginGateModal
- gate: Confirm your donation. Trigger: Signed in, tap Donate. Source: apps/mobile/src/app/home/donate/[id].tsx ConfirmSheet title 'Confirm your donation', confirmLabel 'Donate now'
- processing: Donate. Trigger: After Donate now. Source: apps/mobile/src/app/home/donate/[id].tsx phase 'processing': ActivityIndicator large, 'Completing your donation. Please do not close this screen.'
- failed: Donate. Trigger: Below minimum, price mismatch, or Razorpay not completed. Source: apps/mobile/src/app/home/donate/[id].tsx phase 'failed': MIN_AMOUNT 'The minimum donation is {min}.', PRICE_MISMATCH 'The amount changed. Nothing was charged. Please review and try again.', else error.message || 'Payment was not completed. Your amount is preserved.'
- success: Donate success. Trigger: Razorpay resolves and the finalize succeeds. Source: apps/mobile/src/app/home/donate/[id].tsx phase 'success' branch, 'Thank you for giving'

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/09-empower-hub.png

