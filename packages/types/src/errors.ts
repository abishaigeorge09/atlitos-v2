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
  // booking concurrency
  | 'SLOT_TAKEN'
  // payments (see PAYMENTS.md)
  | 'PRICE_MISMATCH'
  | 'PAYMENT_FAILED'
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
  // generic
  | 'INTERNAL';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  field?: string;
  status: number;
}
