# SURFACE-AUDIT-PLAN: every URL this product exposes

Written 2026-08-14 after the founder asked for the admin pages and all other URLs to be added
to the audit and test plan. Until now essentially all QA effort has gone to the mobile app.
**Six surfaces are live in production and five of them have never been systematically tested.**

Design partners get this for UAT. They will not confine themselves to the phone.

---

## The inventory, probed live 2026-08-14

| Surface | URL | Status | Shape | Routes |
|---|---|---|---|---|
| Landing | `www.atlitos.com` | 200 | static HTML | 6 files |
| Landing apex | `atlitos.com` | 308 to www | redirect | - |
| Mobile web | `atlitos-app.vercel.app` | 200 | Expo SPA | 102 screens |
| Admin | `atlitos-admin.vercel.app` | 200 | Vite SPA, Refine | 20 routes, 22 pages |
| Court partner | `atlitos-portal-court.vercel.app` | 200 | Next.js | 14 routes |
| UPA life | `atlitos-portal-life.vercel.app` | 200 | Next.js | 11 routes |
| Edge functions | `syzzfgaudpifwvbpycyi.functions.supabase.co` | - | Deno | 27 functions |

Deploys are MANUAL Vercel CLI. A push to main does NOT deploy, so what is live may lag the
branch. Establish what revision each surface is actually serving before auditing it, or you
will file bugs against code that shipped weeks ago.

---

## The question that matters most, ask it first

**The admin app is a PUBLIC SPA with no server-side gate.** `atlitos-admin.vercel.app` serves a
715 byte shell with `<div id="root">` to anyone who asks, no auth challenge, no Vercel
protection. It is a Refine plus Supabase client app, which means it ships the anon key and
**every authorization decision that matters must be enforced by RLS and by SECURITY DEFINER
RPCs, not by the router.**

A client-side `<Authenticated>` wrapper hides the UI. It does not stop anyone opening the
bundle, reading the resource names (`users`, `orders`, `fee_config`, `court_bookings`,
`verification_requests`, `clips`, `reports`), and calling PostgREST directly with an ordinary
signed-in account.

So the admin audit is not "do the pages render". It is: **for every table the admin touches,
can a non-admin read or write it?** Prove the forbidden operation is REFUSED, not merely that
the allowed one succeeds. That distinction is a standing rule here and it exists because a test
written against an unscoped query passes for the wrong reason.

`fee_config` is the sharpest instance: it sets the platform's take rate. If a signed-in athlete
can update it, that is a direct financial control.

---

## Per-surface scope

### 1. Admin, `atlitos-admin.vercel.app` (highest risk, least tested)

Routes: `/login`, `/dashboard`, `/verification`, `/verification/show/:id`, `/venues`,
`/venues/show/:id`, `/products`, `/products/show/:id`, `/orders`, `/orders/show/:id`,
`/drills`, `/drills/create`, `/drills/show/:id`, `/moderation`, `/moderation/show/:id`,
`/reports`, `/reports/show/:id`, `/fee-config`, `/bookings`, `/users`, `/users/show/:id`.

- Authorization per resource, proven from a non-admin session. Read AND write.
- The money actions: order refund, user suspend. These call edge functions
  (`admin-order-refund`, `admin-user-suspend`, `admin-order-advance`). Confirm the edge function
  itself re-checks the caller's role rather than trusting the client.
- Every list is unbounded until proven otherwise. The same PostgREST silent-cap class that hit
  `packages/api` applies here: a capped list looks complete and is not.
- Does it render at all with real data volume, and does it degrade honestly on error.

### 2. Court partner portal, `atlitos-portal-court.vercel.app`

`/`, `/signin`, `/signup`, `/dashboard`, `/dashboard/earnings`, `/dashboard/live-today`,
`/dashboard/slots-pricing`, `/dashboard/venues`, `/onboarding`, `/onboarding/venue-details`,
`/onboarding/courts`, `/onboarding/photos`, `/onboarding/review`, `/onboarding/pending`.

- **`venues` is the canonical dual-policy table** and this portal is where the three historical
  cross-partner leaks happened. Every read must carry its own owner filter. Re-verify from a
  second partner account and assert the two partner ids actually DIFFER.
- Earnings is a money surface: numbers must reconcile against the ledger.
- Onboarding is a funnel; a partner who abandons midway must be able to resume.

### 3. UPA life portal, `atlitos-portal-life.vercel.app`

`/`, `/signin`, `/signup`, `/home`, `/apply`, `/status`, `/account`, `/gratitude`,
`/wishlist`, `/wishlist/[itemId]`, `/profile/preview`.

- The apply wizard writes `photo_url` as a FULL public URL, which is what made the image
  sizing fix subtle. Confirm the fix holds here after the merge.
- Applicants are vulnerable people. Check what a signed-out visitor can see of an application,
  and what one applicant can see of another.

### 4. Landing, `www.atlitos.com`

`index.html`, `privacy.html`, `terms.html`, `support.html`, `delete-account.html`,
`nav-options.html`.

- `nav-options.html` reads like an internal design comparison page. Both it and
  `delete-account.html` returned 308 on a direct probe, so establish what they actually serve
  and whether `nav-options` should be public at all.
- `privacy`, `terms`, `support`, `delete-account` are STORE SUBMISSION BLOCKERS. Apple and
  Google both fetch them. They must be reachable, correct, and must not 404 or redirect oddly.
- No invented numbers, testimonials, logos or counts. This has been enforced before and the
  subscription tiers were removed for advertising features that do not exist.

### 5. Mobile web, `atlitos-app.vercel.app`

The Expo SPA. Deep-link refresh depends on `vercel-dist.json` being copied to `dist/vercel.json`
at build time; if a build lacks it, every deep link 404s on refresh. Probe a deep link directly,
not just `/`.

### 6. Edge functions, 27 of them

Every one is an unauthenticated HTTP endpoint until it checks. For each: does it verify the
caller, does it re-validate price server side, does it enforce the role it assumes. The
money-bearing ones are `checkout`, `verify-payment`, `razorpay-webhook`, `book-court`,
`book-session`, `donate`, `renew-group-membership`, `admin-order-refund`,
`cancel-session-refund`, `decline-session-refund`, `razorpay-route-transfer`.

---

## Rules for the audit

- Production Supabase is READ ONLY. SELECT only. Authorization tests that need a write must run
  against the LOCAL stack, which now exists precisely so this is possible.
- Never enter credentials on the founder's accounts.
- Prove the forbidden operation is refused, not that the allowed one succeeds.
- An isolation test must assert the two parties' ids actually differ, or it passes vacuously.
- When you find a bug, sweep for its class.
- Open the screenshot before filing anything. An environmental failure looks exactly like a
  product bug and has been mistaken for one nine times on this project.
