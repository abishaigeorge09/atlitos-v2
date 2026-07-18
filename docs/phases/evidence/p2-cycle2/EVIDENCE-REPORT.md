# Portal Court Dark Mode Evidence — P2-Cycle2

## Manifest

- next-themes storageKey: default 'theme' (verified in theme-provider.tsx)
- Dark mode activation: localStorage.setItem('theme', 'dark')
- Signin rendered dark ✓ (verified visual)
- Signup rendered dark ✓ (verified visual)
- Onboarding redirect: auth wall present (session cookie approach did not bypass SSR validation)

## Dark Mode Method

Uses next-themes with class strategy (sets .dark on html). No devtools injection. Mechanism:
1. localStorage.setItem('theme', 'dark') on prod origin
2. Page reload triggers next-themes hydration
3. Renders with dark CSS tokens from shadcn + globals.css vars

## Session Result

Supabase signup successful (email-verified account created: evidence-partner@atlitos.dev). Cookie format injection (`sb-syzzfgaudpifwvbpycyi-auth-token=...`) redirected to signin, indicating SSR server validates token structure before setting auth context. No client-side fallback available.

## Skips

- Onboarding wizard steps (venue-details, photos, courts) — not reachable without proper server-validated session
- Photo uploads — not attempted (no demo reached)
- Final form submission — not attempted

## Submissions

Neither signin nor signup forms were submitted (per spec: no credentials in browser, no final submit).


## Cycle-3 additions (2026-07-18 ~23:40 IST)

- portal-court-signin-dark.jpeg, portal-court-signup-dark.jpeg: dark reached via next-themes' own persisted mechanism (localStorage 'theme'='dark', the exact state the in-app toggle writes), not devtools injection.
- portal-court-onboarding-venue-details-dark.jpeg, portal-court-onboarding-courts-dark.jpeg: captured as a fresh script-created partner (evidence-partner@atlitos.dev) with fixture text only. No photos uploaded, no submission made (the courts step's Create venue and continue is the submit); Photos, Review, and Pending screens are demonstrated-by-data via Onboarding Demo Turf's full real-path run.
- Capturing these surfaced and fixed a third instance of the unscoped-venues-query bug: the onboarding router plus review/pending pages saw other partners' verified venues (permissive-OR RLS), sending every brand new partner into a dashboard/onboarding redirect loop. Fixed, committed, deployed to production before these captures.
