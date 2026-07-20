// Postgres enums from docs/architecture/SCHEMA.md, mirrored as TS union types
// plus a runtime `as const` tuple per enum for dropdowns/iteration.
// These are the single source of truth for every enum string literal used
// anywhere in the monorepo; nothing hardcodes this list a second time.
// When supabase gen types produces db/database.types.ts, these are checked
// against it, not replaced by it (this file documents intent, the generated
// file documents what actually shipped in a migration).

export const APP_ROLES = ['player', 'coach', 'court_partner', 'court_staff', 'upa', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];
// 'guest' is never persisted: it is a session with zero user_roles rows
// (including a Supabase anonymous auth session). See RLS.md.

export const SPORTS = ['football', 'cricket', 'badminton', 'tennis'] as const;
export type Sport = (typeof SPORTS)[number];

export const SESSION_STATUSES = [
  'requested',
  'accepted',
  'declined',
  'completed',
  'cancelled',
  'rescheduled',
  'rated',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_FREQUENCIES = ['one_time', 'weekly', 'monthly'] as const;
export type SessionFrequency = (typeof SESSION_FREQUENCIES)[number];

export const COACH_STATUSES = ['pending_review', 'verified', 'rejected'] as const;
export type CoachStatus = (typeof COACH_STATUSES)[number];

export const VENUE_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

export const COURT_BOOKING_STATUSES = [
  'pending_payment',
  'confirmed',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show',
  'expired',
] as const;
export type CourtBookingStatus = (typeof COURT_BOOKING_STATUSES)[number];
// Rating is tracked by a non-null `rating` column once `completed`, not by
// a further status value (asymmetric with sessions, see SCHEMA.md).
// `pending_payment`/`expired` added by 0011_courts_payment_state.sql +
// 0012_courts_payment_state_rpcs.sql (book-court's Razorpay checkout hold
// state and its unpaid-abandonment terminal state); this file documents
// intent and had drifted behind the migrations that actually shipped them,
// see CLAUDE.md's docs update duty.

export const ORDER_STATUSES = ['placed', 'shipped', 'in_transit', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Stock reservation lifecycle (0033_stock_reservations.sql, PHASE-4-STATUS.md
// D2). Not a state machine an RPC guards with INVALID_TRANSITION: `held` is
// the only starting state and the other two are its terminal exits, one per
// way a checkout can end.
//   held     -> consumed  capture succeeded, stock decremented in the same
//                         transaction as the order insert
//   held     -> released  payment failed, or the TTL passed and the sweep
//                         reclaimed it; product_variants.stock never moved
// A `consumed` row is never reverted here; unwinding a captured payment is a
// refund, not a release.
export const STOCK_RESERVATION_STATUSES = ['held', 'consumed', 'released'] as const;
export type StockReservationStatus = (typeof STOCK_RESERVATION_STATUSES)[number];

export const CLIP_STATUSES = ['uploading', 'processing', 'ready', 'published', 'rejected', 'removed'] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

export const UPA_STATUSES = ['submitted', 'under_review', 'needs_info', 'verified', 'rejected'] as const;
export type UpaStatus = (typeof UPA_STATUSES)[number];

export const UPA_WISHLIST_ITEM_STATUSES = ['open', 'funded', 'delivered'] as const;
export type UpaWishlistItemStatus = (typeof UPA_WISHLIST_ITEM_STATUSES)[number];

export const DONATION_METHODS = ['standalone', 'checkout_roundup'] as const;
export type DonationMethod = (typeof DONATION_METHODS)[number];

export const PAYMENT_INTENT_STATUSES = [
  'created',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'partially_refunded',
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

export const PAYMENT_DOMAINS = ['session', 'court', 'commerce', 'donation'] as const;
export type PaymentDomain = (typeof PAYMENT_DOMAINS)[number];

export const PAYOUT_ACCOUNT_STATUSES = ['not_started', 'pending', 'active', 'needs_attention', 'failed'] as const;
export type PayoutAccountStatus = (typeof PAYOUT_ACCOUNT_STATUSES)[number];

export const TRANSFER_STATUSES = ['processing', 'paid', 'failed'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const VERIFICATION_STATUSES = ['pending_review', 'approved', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const APPLICANT_TYPES = ['coach', 'venue', 'upa'] as const;
export type ApplicantType = (typeof APPLICANT_TYPES)[number];

export const REPORT_STATUSES = ['pending', 'dismissed', 'removed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const TICKET_STATUSES = ['open', 'resolved'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const DRILL_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type DrillDifficulty = (typeof DRILL_DIFFICULTIES)[number];

export const XP_SOURCES = ['drill_complete', 'milestone', 'other'] as const;
export type XpSource = (typeof XP_SOURCES)[number];

export const BOOKING_SOURCES = ['self_service', 'walk_in'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const LEDGER_ACCOUNT_TYPES = ['platform', 'coach', 'court_partner', 'upa_fund', 'user'] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const LEDGER_DIRECTIONS = ['debit', 'credit'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

export const FEE_VALUE_TYPES = ['percentage', 'flat'] as const;
export type FeeValueType = (typeof FEE_VALUE_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'booking',
  'order',
  'chat',
  'clip_moderation',
  'donation',
  'verification',
  'transfer',
  'support',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const TRANSACTION_KINDS = ['session', 'court', 'commerce', 'donation', 'payout'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
// Domain-level union used by get_my_transactions() (API-MAPPING.md); note
// 'commerce' here where v1 used 'gear', matching v2's payment_domain naming.

export const SEARCH_ENTITY_TYPES = ['gear', 'coach', 'court'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];
