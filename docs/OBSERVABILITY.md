# Observability

Error monitoring, so that the founder is not the bug detector.

Every visual and runtime bug in this project's history was found by a person holding a phone:
the infinite refetch loop, the cut-off sheet button, the flickering search field. The first of
those would have been screaming in any client instrumentation from the moment it shipped.

## Sentry

Organisation `atlitos` on sentry.io, US data region, created 2026-08-04. Deliberately separate
from `synthsports`, so a different company's error data and stack traces do not share an org
with this one, and so the free quota is not shared.

Five projects, one per deployable runtime. `apps/landing` is static and has none.

| Project | Runtime | DSN env var |
|---|---|---|
| `mobile` | Expo / React Native | `EXPO_PUBLIC_SENTRY_DSN` |
| `portal-life` | Next.js | `NEXT_PUBLIC_SENTRY_DSN` |
| `portal-court` | Next.js | `NEXT_PUBLIC_SENTRY_DSN` |
| `admin` | React + Vite | `VITE_SENTRY_DSN` |
| `edge-functions` | Deno, Supabase | `SENTRY_DSN` |

### The DSNs

A DSN is **public by design**. It is embedded in client bundles and is safe in the repo and in
version control. It only permits sending events in, never reading them out. Do not confuse it
with the auth token below, which is a real secret.

```
mobile          https://876015a1577bb6dc1bb925a5e3990be8@o4511848827256832.ingest.us.sentry.io/4511848834727936
portal-life     https://42f6cec8e00bb7daafe3be6f9ba924bf@o4511848827256832.ingest.us.sentry.io/4511848834793472
portal-court    https://3543f83c7c3c268bd373696b134b8c63@o4511848827256832.ingest.us.sentry.io/4511848834859008
admin           https://32d6e278301e238fce69adac785ad103@o4511848827256832.ingest.us.sentry.io/4511848834859009
edge-functions  https://8dd0184141d0ad8e0b0336fba32aa605@o4511848827256832.ingest.us.sentry.io/4511848834924544
```

### What is a secret

`SENTRY_AUTH_TOKEN`, used to upload source maps at build time. That one is a real credential:
repository secrets and local `.env` only, never committed. Create it at
Settings, Auth Tokens, scoped to `project:releases` and `org:read`.

## Alerts

One rule per project: **New issue**, firing on the first occurrence of an issue, notifying by
email, rate limited to once per 30 minutes per issue.

One alert, not a dashboard. A dashboard is something you have to remember to open, and the
whole point is to be told without looking.

**Not yet scoped to production.** The rule currently fires on a new issue in any environment,
because no environment has reported an event yet and Sentry cannot filter on an environment it
has never seen. Once the first production release reports in, edit each rule to add an
environment filter, or development noise will reach the same inbox as real incidents.

## Source maps and releases

Without both of these, a production stack trace is a list of minified single letters and is
worth nothing.

- **Source maps** uploaded at build time using `SENTRY_AUTH_TOKEN`.
- **Release** set to the commit SHA on every build, so an issue can be traced to the change
  that introduced it, and so Sentry can mark it regressed if it comes back.

## Per runtime wiring (phase 11)

### portal-life, portal-court (Next.js)

`@sentry/nextjs` is a dependency of both apps. `next.config.ts` wraps the config in
`withSentryConfig`, with `tunnelRoute: "/monitoring"` so browser events go through the app's own
origin rather than being blocked by an ad blocker hitting `ingest.sentry.io` directly, and with
`silent: true` plus `disableLogger: true` to keep build output quiet. `instrumentation.ts`,
`instrumentation-client.ts`, `sentry.server.config.ts` and `sentry.edge.config.ts` are all
present and read `NEXT_PUBLIC_SENTRY_DSN`. A real test envelope was posted directly to the
portal-life DSN and returned HTTP 200; see "Verification" below for portal-court, done the same
way in this phase.

### admin (React + Vite)

`@sentry/react` is a dependency. `src/lib/sentry.ts` calls `Sentry.init` with `VITE_SENTRY_DSN`
from `main.tsx`, before the app renders, and is a no-op if the env var is unset (local dev).
`App.tsx` wraps the whole `<Refine>` tree in `Sentry.ErrorBoundary` with a plain fallback
message, so a render-time crash reports to Sentry instead of producing a blank white screen. No
`tunnelRoute` here; Vite has no server route to tunnel through, so the browser SDK talks to
Sentry's ingest endpoint directly.

### mobile (Expo / React Native)

`@sentry/react-native` is a dependency. `apps/mobile/src/lib/sentry.ts` calls `Sentry.init` with
`EXPO_PUBLIC_SENTRY_DSN`, gated so it only runs when a DSN is present (local dev without the
env var stays silent instead of throwing). `apps/mobile/src/app/_layout.tsx` wraps the root
layout in `Sentry.wrap(...)` and a `Sentry.ErrorBoundary` fallback, per the RN SDK's documented
pattern, so both native crashes reported through the RN SDK's native layer and React render
errors are captured. `app.json` registers the `@sentry/react-native/expo` config plugin (needed
so a native prebuild wires the RN SDK's native layer). `eas.json` carries
`EXPO_PUBLIC_SENTRY_DSN` under the `production` build profile's `env` block so production builds
ship with the DSN baked in.

**The wiring is typecheck proven, plus a raw envelope POST directly to the mobile DSN (below)
confirms the project itself accepts events.** What is NOT proven is the RN SDK's own native
crash and JS-error capture path actually firing and reaching Sentry from a running app: that
needs a dev client or EAS build, which this phase could not produce. Deferred to native QA in a
phase that has a device or simulator build available.

### edge-functions (Deno, Supabase)

One shared, dependency-free helper, `supabase/functions/_shared/sentry.ts`. It reads the
`SENTRY_DSN` secret (`Deno.env.get`, no-op if unset), and exposes
`captureEdgeError(err, context)`, which hand-builds a minimal Sentry envelope (event id, message,
stack frames, tags) and POSTs it directly to the project's ingest URL parsed from the DSN. No
SDK dependency: a Deno edge function's cold-start budget does not need tracing or breadcrumbs,
only "send one event and move on". It does not touch the money path's control flow: every call
site is inside an existing `catch` block, called AFTER the ledger or transition logic has
already decided its own response, never before, so a reporting failure can never become a
payment failure.

Wired into:
- `_shared/http.ts`'s `withErrorHandling`, in the unexpected-error branch only (an `AppError` is
  an expected, well-formed refusal like `VALIDATION` or `NOT_FOUND`, not an incident; the
  branch that reports is the one that means the server itself broke). This covers every function
  that uses the shared wrapper, including `verify-payment` and `checkout`, without editing each
  one by hand.
- `razorpay-webhook/index.ts` directly (it has its own `Deno.serve`, not `withErrorHandling`), at
  all three of its failure branches: misconfiguration (missing `RAZORPAY_WEBHOOK_SECRET`), a
  failed `webhook_events` insert, and the catch around event processing (`payment.captured`,
  `refund.processed`, etc).

## Webhook error alert (FR: webhook_events failure visibility)

Checked the actual schema (`supabase/migrations/0010_payments_core.sql`) rather than assuming:
`webhook_events` has `id`, `event_type`, `payload`, `processed_at`. **There is no `status` or
`error` column to poll.** Every row in the table is, by definition, a delivery that was
successfully recorded; a delivery whose *processing* then failed is not distinguished by any
column, only by the `console.error` line in the handler's catch block.

Given that, the simplest correct fix is not a cron job scanning a column that does not exist,
it is reporting at the one place a delivered event's processing actually fails:
`razorpay-webhook`'s own `catch (err)` block now also calls `captureEdgeError`, alongside the
existing `console.error`, before acknowledging Razorpay with 200 (Razorpay must still be acked
so it does not retry into a guaranteed duplicate). This reuses the existing Sentry alert rule
(new issue, once per 30 minutes) rather than adding a second notification path. If a future
phase adds a `status`/`error` column to `webhook_events` (worth doing alongside the webhook
ledger already tracked as debt below), a periodic query becomes possible too, but it would be a
second, redundant path to the same alert this phase already wires at the source.

## Verification (phase 11, this pass)

`/tmp/send_envelope.mjs`, a small script that builds and POSTs a minimal Sentry envelope
(same shape `_shared/sentry.ts` builds) directly to each DSN's ingest URL, parsing the DSN for
the public key, host and project id exactly like the edge helper does:

| DSN | HTTP status | Sentry event id |
|---|---|---|
| `portal-life` | 200 | `6cddc50b27894337876875fc0caf7c0f` |
| `portal-court` | 200 | `8b439cd948494716bd3347cde7e4a505` |
| `edge-functions` | 200 | `f47f06e16b054cc180b1405f6147b033` |
| `admin` | 200 | `e99387d9107a489cadcf2a384a7ef0be` |
| `mobile` | 200 | `531f571807cc4452b8b455f428027280` |

All five DSNs are live and accepting events. In addition, `supabase/functions/_shared/sentry.ts`'s
actual `captureEdgeError` function (not a hand-built curl equivalent) was exercised directly with
`deno run` against a real `Error` and the edge-functions DSN, and completed with no error output,
confirming the real code path (not just the envelope shape) sends successfully.

What is proven beyond DSN reachability:
- `pnpm turbo typecheck`: 12/12 tasks green (includes `portal-life`, `portal-court`, `admin`,
  `mobile`, and the build tasks turbo pulled in as typecheck dependencies). See the phase report
  for the exact run.
- `deno check` passes on `_shared/sentry.ts`, `_shared/http.ts`, `razorpay-webhook/index.ts`,
  `verify-payment/index.ts`, and `book-court/index.ts` (a second consumer of the shared
  `withErrorHandling` wrapper, to confirm the change did not break other functions' typing).

What is NOT proven, and why:
- **A real error inside a deployed edge function reaching Sentry through `withErrorHandling` or
  `razorpay-webhook`'s catch block.** That needs `supabase secrets set SENTRY_DSN=...` against
  the live project (a founder action, below) and a real deployed invocation. The helper's send
  logic itself is proven (previous paragraph); what remains unproven is only the deployed,
  end-to-end path.
- **The RN SDK's native crash and JS-render-error capture actually firing on a device or
  simulator.** Needs an EAS or dev-client build, not available in this phase.

## Founder activation steps (env vars and secrets, not yet set)

- Vercel, `portal-life` project: set `NEXT_PUBLIC_SENTRY_DSN` to the portal-life DSN above,
  `NEXT_PUBLIC_COMMIT_SHA` (can be `$VERCEL_GIT_COMMIT_SHA` via a build-time env passthrough),
  and `SENTRY_AUTH_TOKEN` (secret, for source map upload) in Production environment.
- Vercel, `portal-court` project: same three, using the portal-court DSN.
- Vercel or wherever `admin` deploys: set `VITE_SENTRY_DSN` to the admin DSN above.
- EAS: `EXPO_PUBLIC_SENTRY_DSN` is now baked into `eas.json`'s `production.env` block directly
  (it is a DSN, safe to commit), so no separate `eas secret` step is needed for the DSN itself.
  A `SENTRY_AUTH_TOKEN` EAS secret is still needed if source-map upload for RN is wanted later;
  not configured in this phase.
- Supabase: `supabase secrets set SENTRY_DSN=<edge-functions DSN above>` against the live
  project, so every deployed function that reports through `_shared/sentry.ts` (`razorpay-webhook`
  directly, and everything using `withErrorHandling` in `_shared/http.ts`, which includes
  `verify-payment` and `checkout`) can actually send. Without this secret set,
  `captureEdgeError` silently no-ops rather than throwing, so the payment path is not put at
  risk by a missing secret.

## What this does not cover

- **Performance budgets.** No Core Web Vitals thresholds are enforced anywhere. Tracing is
  configured at a low sample rate for cost, which is enough to see slow paths but is not a
  budget that fails a build.
- **Uptime.** Nothing checks whether the site is up. A silent outage produces no errors at all,
  which is exactly why error monitoring is not a substitute for a health check.
- **The webhook ledger** for money events, recording every event id, its signature result and
  whether it was a duplicate. That is listed in `docs/DEBT.md` and is the one gap that matters
  most, because the money path is where silence is most expensive.
- **End-to-end proof through a deployed edge function and through a real mobile build.** The
  DSNs are proven live and the send code is proven to run; what is not proven is a real error in
  a deployed function or a running native app actually reaching Sentry, because that needs a
  live `SENTRY_DSN` secret and a real invocation (edge) or an EAS/dev-client build (mobile),
  neither available in this phase. See "Founder activation steps" and "Verification" above.
