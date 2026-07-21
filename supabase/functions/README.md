# ATLITOS v2 edge functions

Deno edge functions running under the `service_role` key, per CLAUDE.md's
financial invariant: this is the only lane in the app allowed to write
`payment_intents` or `ledger_entries`, or move money via Razorpay. See
`docs/architecture/PAYMENTS.md` for the full architecture and
`docs/architecture/API-MAPPING.md` for how each v1 endpoint maps here.

## Functions in this phase (courts vertical slice, AT-4 / AT-11)

| Function | Called by | Purpose |
|---|---|---|
| `book-court` | Mobile app, athlete's own JWT | Re-prices a court slot server side, holds it as `pending_payment`, creates the Razorpay order |
| `razorpay-webhook` | Razorpay servers only | Verifies the webhook signature, idempotently finalizes `payment.captured` / `payment.failed` |
| `verify-payment` | Mobile app, athlete's own JWT | Client-callback fallback that finalizes a captured payment without a public webhook URL, idempotent with `razorpay-webhook` |

## Clutch video functions (Phase 5, AT-94 / AT-95 / AT-96)

v1 Supabase Storage adapter (Cloudflare Stream deferred, see `docs/architecture/VIDEO.md`). Deploy:

```
supabase functions deploy stream-upload-url
supabase functions deploy stream-webhook
supabase functions deploy get-clip-playback-url --no-verify-jwt
supabase functions deploy get-clip-moderation-url
```

| Function | Called by | verify_jwt | Purpose |
|---|---|---|---|
| `stream-upload-url` | Athlete's own JWT | on | Creates/updates the own clip row `uploading` and mints a signed Storage upload URL (private `clips` bucket). Returns `{ clipId, uploadUrl, token, path }` |
| `stream-webhook` | Uploader's own JWT, synchronous confirm | on | Idempotent finalizer, drives the own clip `uploading -> ready` via `clip_transition_internal` (service role). Redelivery is a no-op |
| `get-clip-playback-url` | Public (guest, owner, or admin) | OFF | 300s signed playback URL, only for `published` / owner-own / admin; refuses `removed`/`rejected` for everyone |
| `get-clip-moderation-url` | admin/moderator only | on | 300s signed preview URL for a not-yet-published clip; the distinct moderation grant |

`get-clip-playback-url` is `--no-verify-jwt` because it is public-callable (guests browsing the published feed have no user JWT); it reads any bearer token optionally inside, and a valid session only ever grants more (owner/admin), never less.

Shared code lives in `_shared/` and is not itself deployed as a function:

- `_shared/razorpay.ts` — minimal Razorpay REST client: `createOrder`, `verifyWebhookSignature`, `verifyPaymentSignature`, `razorpayKeyId`.
- `_shared/supabase.ts` — `serviceRoleClient()` and `getAuthenticatedUser(req)`.
- `_shared/fee-config.ts` — reads the active `fee_config` row for a `(domain, key)` pair.
- `_shared/finalize-court-booking-payment.ts` — the one place a captured court booking payment is finalized (payment_intents, the `court_booking_confirm_payment` RPC, the ledger_entries group); shared verbatim by `razorpay-webhook` and `verify-payment` so the two entry points cannot process the same capture differently.
- `_shared/app-error.ts` — `AppError` (code + message + HTTP status) and a mapper from a Postgres `raise exception 'CODE: message'` string to one.
- `_shared/http.ts` — `jsonResponse`, `errorResponse`, `withErrorHandling`.
- `_shared/cors.ts` — shared CORS headers and preflight handling (portal-court calls these functions directly from a browser).

## Required secrets

Set via `supabase secrets set` (or the Supabase dashboard's Edge Functions
secrets panel) for the deployed project, and locally in `supabase/.env` for
`supabase functions serve`:

| Secret | Required | Used by | Notes |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | Yes | `book-court`, `verify-payment` | Public test key id, also returned to the client so it can open the Razorpay checkout sheet. Already committed to `supabase/.env` locally (`rzp_test_TCwxkMaUz54BPH`); not a secret by Razorpay's own design. |
| `RAZORPAY_KEY_SECRET` | Yes | `book-court` (order creation), `verify-payment` (payment signature verification) | Never logged, never returned in any response, never hardcoded in source. Lives in `supabase/.env` locally and as an edge function env var in the deployed project. |
| `RAZORPAY_WEBHOOK_SECRET` | Optional for the local/demo path | `razorpay-webhook` only | Only needed if a public webhook URL is actually registered with Razorpay. This phase's demo relies on `verify-payment` (the client-callback fallback) to finalize payments, so a local/demo run with no public URL and no webhook secret configured still completes bookings end to end; `razorpay-webhook` simply cannot be invoked usefully without a real Razorpay-delivered signature to verify, and returns a `500` configuration error if called with the secret unset rather than silently accepting unverified events. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | Yes | all three | Auto-provided in every Supabase edge function's runtime environment; never set manually. |

## Deploy list (this phase)

```
supabase functions deploy book-court
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy verify-payment
```

`razorpay-webhook` is deployed with `--no-verify-jwt` because Razorpay's
webhook caller never presents a Supabase user JWT; the function's own
`x-razorpay-signature` check is the only auth this endpoint has, and is
sufficient (an unsigned or forged request is rejected before any query
runs). `book-court` and `verify-payment` are deployed with Supabase's
default JWT verification on, on top of each function's own explicit
`getAuthenticatedUser` check (defense in depth: the platform-level check
rejects a missing/malformed token before the function even runs; the
function-level check is what actually reads `auth.uid()` out of it for
ownership checks).

## Migrations this phase depends on

`0009_courts.sql` shipped without a notion of "booking created, payment not
yet captured", so two new migrations add it:

- `supabase/migrations/0011_courts_payment_state.sql` adds the
  `pending_payment` and `expired` values to `court_booking_status`. Nothing
  else; see its header comment for why (Postgres will not let a new enum
  value be referenced anywhere in the same transaction that added it).
- `supabase/migrations/0012_courts_payment_state_rpcs.sql` (applied after
  0011 commits) widens the slot-release condition on
  `court_bookings_court_date_slot_unique` and adds two new
  `service_role`-only RPCs, `court_booking_confirm_payment` and
  `court_booking_expire_payment`.

Read 0011's header comment before touching any of these three functions or
either migration; it documents why the two new transitions are separate,
narrowly-granted RPCs rather than two more branches on the existing
(`authenticated`-granted) `court_booking_transition`, and why the enum
addition and its consumers had to be split across two migration files.
