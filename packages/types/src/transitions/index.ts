// State-machine transition maps, ported verbatim from v1 src/types/models.ts's
// machine comments and extended to the v2 statuses that PRD-02/PRD-03/PRD-04
// make explicit (notably `rated` on sessions, and the admin-driven order and
// clip machines that v1 never modeled because v1 had no admin surface).
//
// Every RPC and edge function in API-MAPPING.md that performs a transition
// enforces the same map server side (source of truth: the RPC's own SQL
// guard clause); this file is the client-side mirror used to disable an
// action before a request is even made, and by tests that assert the RPC
// rejects everything not listed here with INVALID_TRANSITION.
//
// Usage: `canTransition(SESSION_TRANSITIONS, session.status, 'accepted')`.

import type {
  ClipStatus,
  CourtBookingStatus,
  OrderStatus,
  SessionStatus,
  UpaStatus,
  UpaWishlistItemStatus,
  VerificationStatus,
} from '../enums';

export type TransitionMap<S extends string> = Record<S, readonly S[]>;

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return map[from].includes(to);
}

/**
 * requested -> (accepted | declined)
 * accepted -> (completed | cancelled | rescheduled)
 * rescheduled behaves like accepted going forward (can itself be completed,
 * cancelled, or rescheduled again), matching PRD-02's "mirrors the Courts
 * booking detail pattern exactly" note.
 * completed -> rated (athlete-only, exactly once)
 */
export const SESSION_TRANSITIONS: TransitionMap<SessionStatus> = {
  requested: ['accepted', 'declined'],
  accepted: ['completed', 'cancelled', 'rescheduled'],
  declined: [],
  rescheduled: ['completed', 'cancelled', 'rescheduled'],
  completed: ['rated'],
  cancelled: [],
  rated: [],
};

/**
 * confirmed -> (completed | cancelled | rescheduled | no_show)
 * rescheduled behaves like confirmed going forward.
 * Rating has no terminal status of its own here (unlike sessions): a
 * completed booking's `rating` column going non-null is the "rated" fact,
 * checked with `canRateCourtBooking()` below, not a further status.
 */
export const COURT_BOOKING_TRANSITIONS: TransitionMap<CourtBookingStatus> = {
  confirmed: ['completed', 'cancelled', 'rescheduled', 'no_show'],
  rescheduled: ['completed', 'cancelled', 'rescheduled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canRateCourtBooking(booking: { status: CourtBookingStatus; rating: number | null }): boolean {
  return booking.status === 'completed' && booking.rating === null;
}

/**
 * placed -> shipped -> in_transit -> delivered, strictly forward.
 * cancelled is reachable only from placed (admin-driven, never a shopper
 * self-cancel in v2, per PRD-07 open question 3).
 */
export const ORDER_TRANSITIONS: TransitionMap<OrderStatus> = {
  placed: ['shipped', 'cancelled'],
  shipped: ['in_transit'],
  in_transit: ['delivered'],
  delivered: [],
  cancelled: [],
};

/**
 * uploading -> processing (tus upload completes)
 * processing -> (ready | rejected) (Cloudflare Stream transcode result)
 * ready -> (published | rejected) (admin moderation decision)
 * published -> removed (admin takedown only, terminal)
 */
export const CLIP_TRANSITIONS: TransitionMap<ClipStatus> = {
  uploading: ['processing'],
  processing: ['ready', 'rejected'],
  ready: ['published', 'rejected'],
  published: ['removed'],
  rejected: [],
  removed: [],
};

/**
 * submitted -> under_review
 * under_review -> (needs_info | verified | rejected)
 * needs_info -> under_review (resubmit)
 * rejected has no forward edge on the SAME row: a reapply after rejection
 * creates a NEW upa_applications row (see SCHEMA.md), it does not reopen
 * this one. `rejected: []` reflects that this row's machine is over.
 */
export const UPA_TRANSITIONS: TransitionMap<UpaStatus> = {
  submitted: ['under_review'],
  under_review: ['needs_info', 'verified', 'rejected'],
  needs_info: ['under_review'],
  verified: [],
  rejected: [],
};

/**
 * open -> funded (server, on funding target reached)
 * funded -> delivered (server, on fulfillment)
 * Never client-writable, see RLS.md.
 */
export const UPA_WISHLIST_ITEM_TRANSITIONS: TransitionMap<UpaWishlistItemStatus> = {
  open: ['funded'],
  funded: ['delivered'],
  delivered: [],
};

/**
 * Generic verification_requests machine, shared by coach, venue, and UPA
 * verification (the applicant_type column distinguishes which entity).
 */
export const VERIFICATION_REQUEST_TRANSITIONS: TransitionMap<VerificationStatus> = {
  pending_review: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};
