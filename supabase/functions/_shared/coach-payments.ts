// ATLITOS v2 — supabase/functions/_shared/coach-payments.ts
//
// Server side switch for in-app payment on 1:1 coach sessions.
//
// OFF for the launch, founder decision 2026-10-01: a coach session is booked
// as an appointment request and the athlete pays the coach directly at the
// session. With the switch off:
//
//   - book-session inserts the `requested` session exactly as before, but
//     creates no payment_intent and no Razorpay order, and answers
//     `payment: "offline"` (no order fields).
//   - complete-session completes a session that has no payment_intent (an
//     appointment) without writing ledger rows: no money passed through
//     Atlitos, so neither the coach wallet nor the platform is credited.
//
// It is read from the `COACH_IN_APP_PAYMENTS` function secret and is ON only
// when that secret is exactly "on", so a deploy with the secret unset is
// appointment mode. Turn paid booking back on with
// `supabase secrets set COACH_IN_APP_PAYMENTS=on` together with the app's
// `COACH_IN_APP_PAYMENT_ENABLED` flag (apps/mobile/src/lib/feature-flags.ts).
// Nothing in the paid path is deleted.

export function coachInAppPaymentsEnabled(): boolean {
  return Deno.env.get("COACH_IN_APP_PAYMENTS") === "on";
}
