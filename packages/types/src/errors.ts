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
  // addresses_block_delete_in_use trigger (0036_address_delete_guard.sql,
  // AT-70). PRD-07 FR-30 / AC-F3: the address is on an order that has not been
  // delivered or cancelled, so deleting it would orphan a parcel in flight.
  // AT-78's Address Book renders this inline beside the address, never as a
  // toast and never as the raw Postgres message.
  | 'ADDRESS_IN_USE'
  // Same trigger, the case FR-30 does not specify: every referencing order is
  // delivered or cancelled, but orders.address_id is a NOT NULL foreign key
  // with no snapshot, so the address cannot be removed without destroying what
  // a past order shipped to. Recorded as a known gap in SCHEMA.md with the
  // proposed fix (snapshot the address onto the order, as order_items already
  // snapshots title and price). Not reachable in the P4 gate.
  | 'ADDRESS_ON_PAST_ORDER'
  // reserve_stock_for_checkout (0033_stock_reservations.sql). The checkout
  // edge function tried to reserve against a payment intent that already holds
  // a reservation. Never a shopper-facing message; seeing it means checkout
  // retried without minting a fresh intent.
  | 'ALREADY_RESERVED'
  // consume_reservation, when a capture arrives for an intent that never
  // reserved anything. Indicates the checkout and finalize paths disagree.
  | 'NO_RESERVATION'
  // place_order_from_draft (0038), when a capture arrives for an intent that
  // carries no priced bill. Means the charge was not created by the `checkout`
  // edge function, so there is nothing to turn into an order.
  | 'NO_DRAFT'
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
  // groups (0079_group_rpcs.sql, join-group/renew-group-membership edge
  // functions, _shared/app-error.ts): this file's vocabulary was not
  // extended when that migration landed, backfilled here by the athlete
  // side groups Track D screens that need to render these. GROUP_FULL /
  // ALREADY_MEMBER fire from the capacity guarded insert inside join-group
  // BEFORE Razorpay is ever called; GROUP_INACTIVE guards a coach
  // deactivated group; NOT_A_MEMBER guards mark_attendance against a
  // non-member player id.
  | 'GROUP_FULL'
  | 'ALREADY_MEMBER'
  | 'GROUP_INACTIVE'
  | 'NOT_A_MEMBER'
  // account state (0090 suspension, 0093 deletion). Both are 403s that the
  // caller authenticated fine for, and they route differently: SUSPENDED sends
  // the member to support, DELETED signs them out without offering an appeal
  // for an account they chose to remove.
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DELETED'
  // generic
  | 'INTERNAL';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  field?: string;
  status: number;
}
