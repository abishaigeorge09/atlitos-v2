// Domain (camelCase, hydrated) types consumed by apps/* and packages/api.
// Ported from the v1 prototype's src/types/models.ts (Desktop/ATLITOS/05
// Code & Prototypes/atlitos-app), section 7 of the v1 build spec, adapted to
// the v2 real schema in docs/architecture/SCHEMA.md. Where v1's shape
// changed, the comment says why; everything else is intentionally as close
// to v1 as the real schema allows, because screens and components carry
// over unchanged per docs/PLAN.md.
//
// These are API-facing shapes: hydrated joins, camelCase, no snake_case
// leaking past packages/api. `packages/api`'s typed hooks are what map a
// `db/rows.ts` row (or a future generated Database row) into one of these.

import type {
  AppRole,
  BookingSource,
  ClipStatus,
  CoachStatus,
  CourtBookingStatus,
  DonationMethod,
  DrillDifficulty,
  OrderStatus,
  SearchEntityType,
  Sport,
  SessionFrequency,
  SessionStatus,
  TransactionKind,
  UpaStatus,
  UpaWishlistItemStatus,
  VenueStatus,
} from '../enums';

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

/**
 * v1 had a single `role: Role`. v2 is multi-role (docs/PLAN.md: "multi-role
 * user_roles"), so this is `roles: AppRole[]` instead. `guest` is still not
 * a member of AppRole, it is the absence of any row (see enums.ts).
 */
export interface User {
  id: string;
  roles: AppRole[];
  name: string;
  email: string;
  phone: string;
  dob: string; // ISO date
  avatarUrl?: string;
  channelName?: string; // Clutch creator display name
  city: string;
  state: string;
  sports: Sport[];
  createdAt: string;
}

export interface Address {
  id: string;
  userId: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// coaching
// ---------------------------------------------------------------------------

/**
 * v1 modeled availability as a fixed `window: 'morning' | 'evening'` label.
 * v2 uses the real recurring-weekly shape PRD-02 FR-5/FR-22 specifies: a day
 * of week plus a start and end time, editable independent windows.
 */
export interface AvailabilityWindow {
  dayOfWeek: number; // 0-6
  from: string; // "06:00"
  to: string; // "09:00"
  effectiveFrom?: string; // ISO date
}

export interface Certificate {
  id: string;
  name: string;
  url: string; // resolved signed/public URL, never a raw storage path
  verified: boolean;
}

/**
 * v1 folded pricing into `pricing: Record<SessionType, number>` against a
 * closed `SessionType` union. v2 lets a coach define their own named session
 * types (name, duration, price) per PRD-02 FR-4, so this is now a list of
 * first-class entities rather than a fixed-key record.
 */
export interface SessionTypeOption {
  id: string;
  coachId: string;
  name: string;
  durationMinutes: number;
  price: number;
  active: boolean;
}

export interface CoachProfile {
  userId: string;
  sport: Sport; // single sport per coach, v1 rule carried forward verbatim
  experienceYears: number;
  coachingStyle: string;
  specialization: string[];
  sessionTypes: SessionTypeOption[];
  availability: AvailabilityWindow[];
  certificates: Certificate[];
  status: CoachStatus;
  rating: number;
  ratingCount: number;
  playersCoached: number;
  bio: string;
  // hydrated for discovery/profile screens
  user?: User;
  distanceKm?: number;
}

export interface TimeSlot {
  from: string; // "17:00"
  to: string; // "18:00"
}

/**
 * State machine (see transitions/index.ts SESSION_TRANSITIONS):
 * requested -> accepted|declined; accepted -> completed|cancelled|rescheduled;
 * completed -> rated. `rated` is a v2 addition to the status enum itself
 * (v1 tracked "rated-ness" only via a present `rating` field); PRD-02 FR-19
 * states the transition explicitly, so v2 makes it a real status.
 */
export interface Session {
  id: string;
  coachId: string;
  playerId: string;
  sessionTypeId: string;
  frequency: SessionFrequency;
  date: string; // ISO date
  slot: TimeSlot;
  focusArea: string;
  location: string;
  status: SessionStatus;
  price: number;
  platformFee: number;
  total: number;
  paymentIntentId?: string;
  rating?: number;
  remarks?: string;
  declineReason?: string;
  cancellationReason?: string;
  // hydrated display fields (server joins these)
  coachName?: string;
  playerName?: string;
  sessionTypeName?: string;
}

// ---------------------------------------------------------------------------
// courts
// ---------------------------------------------------------------------------

export interface Court {
  id: string;
  venueId: string;
  name: string;
  location: string; // venue address, hydrated
  city: string;
  lat: number;
  lng: number;
  sport: Sport; // v1 had `sports: Sport[]` per court; v2's schema scopes one
  // sport per court row (a venue with football and cricket lists two court
  // rows), matching PRD-03's "each court with a sport" (FR-4). A venue-level
  // aggregate `sports: Sport[]` is still derivable by grouping a venue's
  // courts, exposed as `Venue.sports` below where that shape is needed.
  basePricePerHour: number;
  rating: number;
  ratingCount: number;
  images: string[];
  active: boolean;
  // hydrated for list/discovery screens, mirrors CoachProfile.distanceKm
  distanceKm?: number;
}

export interface Venue {
  id: string;
  partnerUserId: string;
  name: string;
  address: string;
  city: string;
  pincode: string;
  status: VenueStatus;
  sports: Sport[]; // derived: distinct sports across this venue's courts
  courts?: Court[];
  images: string[];
}

/**
 * State machine (see transitions/index.ts COURT_BOOKING_TRANSITIONS):
 * confirmed -> completed|cancelled|rescheduled|no_show. Rating has no
 * further status of its own (see enums.ts COURT_BOOKING_STATUSES comment);
 * `canRateCourtBooking()` in transitions/index.ts is the source of truth for
 * whether the Rate action should render.
 */
export interface CourtBooking {
  id: string;
  courtId: string;
  userId: string;
  bookingSource: BookingSource;
  date: string;
  slot: TimeSlot;
  subtotal: number;
  gst: number;
  platformFee: number;
  total: number;
  status: CourtBookingStatus;
  checkedInAt?: string;
  rating?: number;
  remarks?: string;
  cancellationReason?: string;
  // hydrated (joined from courts/venues) for list/detail screens
  courtName?: string;
  sport?: Sport;
  venueName?: string;
  location?: string;
}

// ---------------------------------------------------------------------------
// commerce
// ---------------------------------------------------------------------------

export interface ProductVariant {
  id: string;
  productId: string;
  size?: string;
  color?: string;
  price: number; // resolved: priceOverride ?? product.basePrice
  stock: number;
}

export interface Product {
  id: string;
  title: string;
  sport: Sport | 'general';
  price: number; // base price for display; variant price wins on the PDP
  images: string[];
  variants: ProductVariant[];
  rating?: number;
  description: string;
}

export interface CartItem {
  productVariantId: string;
  productId: string;
  qty: number;
  price: number;
  size?: string;
  product?: Product; // hydrated
}

/**
 * State machine (see transitions/index.ts ORDER_TRANSITIONS):
 * placed -> shipped -> in_transit -> delivered, strictly forward;
 * cancelled reachable only from placed, admin-driven.
 */
export interface Order {
  id: string; // format "#ATL39284" (order_number column)
  items: CartItem[];
  subtotal: number;
  deliveryCharges: number;
  gstAndOthers: number;
  donationRoundup: number; // 0 if unchecked
  total: number;
  addressId: string;
  status: OrderStatus;
  timeline: { date: string; event: OrderStatus; location: string; note?: string }[];
}

// ---------------------------------------------------------------------------
// clutch
// ---------------------------------------------------------------------------

/**
 * State machine (see transitions/index.ts CLIP_TRANSITIONS):
 * uploading -> processing -> ready -> published|rejected; published ->
 * removed. See docs/architecture/VIDEO.md for the Cloudflare Stream pipeline
 * this status tracks.
 */
export interface Clip {
  id: string;
  ownerId: string;
  channel: string; // users.channel_name, e.g. "Cric World"
  videoUrl?: string; // signed playback URL, minted on demand, never stored raw
  thumbUrl?: string;
  caption: string;
  sport: Sport;
  status: ClipStatus;
  likes: number;
  commentCount: number;
  createdAt: string;
  likedByMe?: boolean;
  topComment?: Comment; // hydrated for feed cards
}

export interface Comment {
  id: string;
  clipId: string;
  userId: string;
  username: string;
  text: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// empower
// ---------------------------------------------------------------------------

/**
 * v1's UPAProfile carried an `age: number` field. v2's schema deliberately
 * omits it: PRD-05's apply wizard (section 3, screen 2) does not collect age
 * as a first-class field, and PRD-05 open question 4 leaves minor/guardian
 * handling unresolved. Adding an age column ahead of that founder decision
 * would be inventing schema the PRD does not yet license; when question 4
 * resolves, `SCHEMA.md`'s `upa_applications` gains the field and this type
 * gains it back.
 *
 * State machine (see transitions/index.ts UPA_TRANSITIONS): submitted ->
 * under_review -> (needs_info | verified | rejected); needs_info back to
 * under_review; a reapply after rejected creates a new row, it does not
 * reopen this one.
 */
export interface UPAProfile {
  id: string;
  name: string; // hydrated from applicant_user_id's users.name
  sport: Sport;
  region: string;
  state: string;
  storyHeadline: string;
  storyBody: string;
  photoUrl: string;
  status: UpaStatus;
  totalRaised: number; // derived from ledger_entries, never denormalized
  wishlist: UPAWishlistItem[];
}

/**
 * State machine (see transitions/index.ts UPA_WISHLIST_ITEM_TRANSITIONS):
 * open -> funded -> delivered, server-written only.
 */
export interface UPAWishlistItem {
  id: string;
  upaId: string;
  title: string;
  cost: number;
  fundedAmount: number;
  status: UpaWishlistItemStatus;
}

export interface Donation {
  id: string;
  donorId: string;
  upaId: string | null; // null = platform general fund
  amount: number;
  itemId?: string;
  method: DonationMethod;
  createdAt: string;
  upaName?: string; // hydrated, "General Fund" label when upaId is null
}

export interface GratitudePost {
  id: string;
  upaId: string;
  wishlistItemId: string;
  body: string;
  photoUrl?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// learn
// ---------------------------------------------------------------------------

export interface Drill {
  id: string;
  title: string;
  description: string;
  sport: Sport;
  skillCategory: string;
  difficulty: DrillDifficulty;
  xpValue: number;
  mediaUrl?: string;
  completedByMe?: boolean; // hydrated
}

export interface RoadmapStage {
  id: string;
  sport: Sport;
  stageOrder: number;
  name: string;
  xpThreshold: number;
}

export interface Milestone {
  id: string;
  key: string;
  name: string;
  description: string;
  iconName: string; // lucide icon name, never an emoji, per house rules
  earned: boolean; // hydrated from user_milestones
  earnedAt?: string;
}

export interface RoadmapProgress {
  sport: Sport;
  totalXp: number;
  currentStage: RoadmapStage;
  nextStage?: RoadmapStage;
}

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

export interface ChatThread {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatarUrl?: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  text: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  deepLink: string;
  readAt?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// payments (client-facing views over ledger_entries, never a stored balance)
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  userId: string;
  kind: TransactionKind;
  label: string;
  amount: number;
  direction: 'debit' | 'credit';
  frequencyTag?: 'one_time' | 'monthly';
  createdAt: string;
  refId?: string; // deep-link target id (session/order/booking/donation)
}

export interface EarningsSummary {
  balance: number;
  pending: number;
  thisMonth: number;
}

export interface BillSummaryLine {
  label: string;
  amount: number;
  emphasis?: 'total' | 'muted';
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export interface SearchResult {
  entityType: SearchEntityType;
  entityId: string;
  rankScore: number; // 0-1
  rankReason: string; // "Closest, 1.2km" | "Best price match" | "Top rated nearby"
  distanceKm?: number;
  snapshot: Product | (CoachProfile & { user: User }) | Court;
}

export interface ParsedIntent {
  entityTypes: SearchEntityType[];
  sport?: Sport | 'general';
  priceMax?: number;
  timeWindow?: 'morning' | 'evening';
  keywords: string[];
}

export interface LocationContext {
  lat: number;
  lng: number;
  city: string;
  pincode: string;
}
