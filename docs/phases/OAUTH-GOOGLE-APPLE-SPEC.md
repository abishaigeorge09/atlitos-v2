# Google and Apple sign-in: scope and prerequisites

Status: APPROVED, NOT STARTED
Decided: 2026-08-11
Scope: `apps/mobile` only
Sequencing: begins after launch Phase 5 (native QA) closes

## The decision

Add Google sign-in and Sign in with Apple to the mobile app only.
The web portals (portal-court, portal-life) and admin keep
email/password for now.

Admin was explicitly excluded. Staff login is safer without a
third-party identity provider in the path.

## Why both, not just Google

App Store Review Guideline 4.8 requires Sign in with Apple to be
offered once the app offers any other third-party sign-in on iOS.
Shipping Google alone is a rejection risk, not a smaller scope.

## Why after Phase 5, not during

This touches `apps/mobile/src/**`, which Track F owns for the Phase 5
fix pass, and `app.json`, which Track N owns. Landing it mid-phase
would invalidate the native QA pass in progress and force a re-run of
every auth-adjacent flow.

## Current state, verified 2026-08-11

Auth today is Supabase email/password, with phone as a secondary
identifier. No OAuth exists anywhere in the repo.

Entry points found:
- `packages/api/src/hooks.ts` (signInWithPassword, signUp)
- `apps/mobile/src/app/(auth)/login.tsx`
- `apps/mobile/src/components/organisms/auth/AuthScene.tsx`
- `apps/mobile/src/components/organisms/LoginGateSheet.tsx`
- `apps/mobile/src/components/organisms/LoginGateModal.tsx`
- `apps/mobile/src/store/session-store.ts`

There are two separate login surfaces (the auth route and the gate
sheet/modal). Both need the new buttons or the app will offer OAuth in
one place and not the other.

## Founder prerequisites, BLOCKING

These are account actions on your own credentials. They can be done in
parallel with Phase 5, before any code is written, and nothing can be
verified end to end until they exist.

### Google
1. Google Cloud Console, create an OAuth consent screen.
2. Create OAuth client IDs: iOS, Android, and Web.
   The Web client ID is the one Supabase needs. The iOS and Android
   IDs go in the app.
   The Android client requires the SHA-1 of the signing certificate.
3. Supabase dashboard, Authentication, Providers, Google: paste the
   Web client ID and secret.

### Apple
1. Apple Developer portal, enable Sign in with Apple on the app id
   for `com.atlitos.app`.
2. Create a Services ID for the web/redirect flow.
3. Create a Sign in with Apple key and download the .p8. It can be
   downloaded once only.
4. Supabase dashboard, Authentication, Providers, Apple: Services ID,
   Team ID, Key ID, and the .p8 contents.

### Supabase
5. Add the app's redirect URL to the allowed redirect list.

## Implementation outline

- Native flows, not web redirects. Use `expo-apple-authentication` for
  Apple and native Google sign-in, then exchange the identity token
  with Supabase via `signInWithIdToken`. The web redirect flow inside a
  native app is a worse experience and a common review complaint.
- `app.json` needs the Apple entitlement and the Google URL scheme.
  That file is Track N's during Phase 5, so this waits.
- Account linking: decide what happens when a Google or Apple identity
  presents an email that already exists as a password account. Silent
  linking is a known account-takeover vector when the provider's email
  is unverified. Default should be to link only on a verified email
  from the provider.
- Apple returns the user's name and email ONLY on the very first
  authorization. If it is not persisted on first sign-in it cannot be
  retrieved later, and the account is left nameless.
- Apple private relay addresses (`@privaterelay.appleid.com`) must be
  accepted anywhere email is validated or displayed.
- Sign in with Apple requires an account deletion path in-app
  (Guideline 5.1.1). `apps/landing/delete-account.html` exists
  untracked in the working tree, so check whether that requirement is
  already covered before building a second one.

## QA implications

Adding this after Phase 5 means the auth flows QA'd during Phase 5 get
re-tested. The Maestro flows that touch login
(`auth-register-skip.yaml`, `gate-login-nav.yaml`, `profile-gate.yaml`,
`clutch-like-gate.yaml`) will need updating, since a new button on the
login surface changes the hierarchy those flows assert against.
