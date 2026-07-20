// API error shape, ported verbatim from v1's Section 7 ApiError, plus the
// full code vocabulary collected from v1's PLAN-2-3-api-contract-and-llm.md
// per-endpoint error columns and the v2-only codes RPCs/edge functions in
// API-MAPPING.md and PAYMENTS.md raise. Every RPC and edge function response
// error maps to exactly one of these codes; the client never pattern-matches
// on a raw error message string.

export type ApiErrorCode =
  // common, v1-inherited
  | 'UNAUTHENTICATED'
  | 'GUEST_FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  // role/ownership check failed on an RPC or edge function (e.g.
  // court_booking_transition's "not the booking athlete or venue
  // partner/staff", verify-payment's payment_intent ownership check).
  // Distinct from GUEST_FORBIDDEN (the caller has no account at all).
  | 'FORBIDDEN'
  // auth
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'PHONE_TAKEN'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'ALREADY_SETUP'
  // state machines (sessions, court_bookings, orders, clips, upa_applications)
  | 'INVALID_TRANSITION'
  | 'NOT_COMPLETED'
  | 'ALREADY_RATED'
  // session_transition('cancel'|'complete', ...) (0021_session_state_machine.sql):
  // TOO_EARLY guards complete-session's "scheduled end time not reached",
  // SESSION_STARTED guards cancel once the session has begun.
  | 'TOO_EARLY'
  | 'SESSION_STARTED'
  // session_transition (0027_session_transition_service_role_gate.sql, AT-61):
  // the action is money-consequential and its money half lives in an edge
  // function, so the bare RPC refuses it. Raised for 'complete' from any
  // state, and for 'cancel' when the session is still `requested`. NOT a
  // permission failure: the caller may well be the right party, but the entry
  // point is wrong, so the fix is to call complete-session /
  // cancel-session-refund, never to hide the button. Client code should never
  // surface this to a user; seeing it means a call site regressed to the RPC.
  | 'USE_EDGE_FUNCTION'
  // book-session's Razorpay order creation failed server side (API-MAPPING.md)
  | 'RAZORPAY_ERROR'
  // court_booking_transition('cancel', ...)/(0009_courts.sql) requires a
  // non-empty p_reason
  | 'REASON_REQUIRED'
  // booking concurrency
  | 'SLOT_TAKEN'
  // payments (see PAYMENTS.md)
  | 'PRICE_MISMATCH'
  | 'PAYMENT_FAILED'
  // verify-payment: the razorpay_signature triple did not verify against
  // RAZORPAY_KEY_SECRET
  | 'INVALID_SIGNATURE'
  // commerce
  | 'OUT_OF_STOCK'
  | 'PINCODE_INVALID'
  | 'NO_ADDRESS'
  // clutch
  | 'TOO_LARGE'
  | 'BAD_FORMAT'
  // empower
  | 'ITEM_FUNDED'
  | 'MIN_AMOUNT'
  // coach
  | 'NOT_COACH'
  // payouts (razorpay-route-onboard/-transfer; see PAYMENTS.md), added by
  // Track C (AT-50) for the coach payout setup and transfer screens
  | 'ROUTE_UNAVAILABLE'
  | 'PAYMENT_NOT_CAPTURED'
  // generic
  | 'INTERNAL';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  field?: string;
  status: number;
}
