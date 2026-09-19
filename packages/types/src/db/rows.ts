// Hand-authored snake_case row types mirroring docs/architecture/SCHEMA.md.
//
// INTERIM FILE: once supabase/migrations exist and `supabase gen types
// typescript --linked` has run (see database.types.ts in this folder), the
// generated `Database['public']['Tables'][T]['Row']` types become the real
// source of truth and these hand-authored interfaces are re-pointed to
// re-export from there, so nothing outside this folder has to change. Until
// then, this file IS the contract migrations are written against.
//
// Money columns are `number` here (numeric(12,2) in Postgres, rupees with
// paise as the decimal part); Supabase's JS client returns `numeric` as a
// string by default unless cast, so the real generated types may show
// `string` for these columns until a cast/view normalizes them. Treat that
// as a known seam, not a contradiction, when database.types.ts lands.

import type {
  AppRole,
  ApplicantType,
  BookingSource,
  ClipStatus,
  CoachStatus,
  CourtBookingStatus,
  DonationMethod,
  DrillDifficulty,
  FeeValueType,
  LedgerAccountType,
  LedgerDirection,
  NotificationType,
  OrderStatus,
  PayoutAccountStatus,
  PaymentDomain,
  PaymentIntentStatus,
  ReportStatus,
  SessionFrequency,
  SessionStatus,
  Sport,
  StockReservationStatus,
  TicketStatus,
  TransferStatus,
  UpaStatus,
  UpaWishlistItemStatus,
  UserStatus,
  VenueStatus,
  VerificationStatus,
  XpSource,
} from '../enums';

type UUID = string;
type ISODate = string; // date
type ISOTime = string; // time
type ISODateTime = string; // timestamptz

// ---- identity/roles -------------------------------------------------------

export interface UserRow {
  id: UUID;
  name: string;
  phone: string | null;
  dob: ISODate | null;
  avatar_url: string | null;
  channel_name: string | null;
  bio: string | null;
  cover_url: string | null;
  handle: string | null;
  city: string | null;
  state: string | null;
  sports: Sport[];
  status: UserStatus;
  suspended_reason: string | null;
  show_donor_name: boolean;
  theme: "system" | "light" | "dark";
  notification_prefs: { sessions: boolean; messages: boolean; promotions: boolean };
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface UserRoleRow {
  id: UUID;
  user_id: UUID;
  role: AppRole;
  created_at: ISODateTime;
}

export interface AddressRow {
  id: UUID;
  user_id: UUID;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  is_default: boolean;
  created_at: ISODateTime;
}

// ---- coaching ---------------------------------------------------------

export interface CoachProfileRow {
  user_id: UUID;
  sport: Sport;
  experience_years: number;
  coaching_style: string | null;
  specialization: string[];
  bio: string | null;
  city: string;
  state: string;
  status: CoachStatus;
  rating: number;
  rating_count: number;
  players_coached_count: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface CoachCertificateRow {
  id: UUID;
  coach_id: UUID;
  name: string;
  storage_path: string;
  verified: boolean;
  created_at: ISODateTime;
}

export interface SessionTypeRow {
  id: UUID;
  coach_id: UUID;
  name: string;
  duration_minutes: number;
  price: number;
  active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface CoachAvailabilityWindowRow {
  id: UUID;
  coach_id: UUID;
  day_of_week: number;
  start_time: ISOTime;
  end_time: ISOTime;
  effective_from: ISODate;
  created_at: ISODateTime;
}

export interface SessionRow {
  id: UUID;
  coach_id: UUID;
  player_id: UUID;
  session_type_id: UUID;
  frequency: SessionFrequency;
  date: ISODate;
  slot_start: ISOTime;
  slot_end: ISOTime;
  focus_area: string | null;
  location: string | null;
  status: SessionStatus;
  price: number;
  platform_fee: number;
  total: number;
  payment_intent_id: UUID | null;
  rating: number | null;
  remarks: string | null;
  decline_reason: string | null;
  cancellation_reason: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// ---- courts -------------------------------------------------------------

export interface VenueRow {
  id: UUID;
  partner_user_id: UUID;
  name: string;
  address: string;
  city: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  description: string | null;
  status: VenueStatus;
  rejection_reason: string | null;
  /** External booking link (affiliate model for courts, 0120). */
  booking_url: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface VenuePhotoRow {
  id: UUID;
  venue_id: UUID;
  storage_path: string;
  position: number;
  created_at: ISODateTime;
}

export interface VenueStaffRow {
  id: UUID;
  venue_id: UUID;
  user_id: UUID;
  invited_at: ISODateTime;
  accepted_at: ISODateTime | null;
}

export interface CourtRow {
  id: UUID;
  venue_id: UUID;
  sport: Sport;
  name: string;
  capacity: number | null;
  base_price_per_hour: number;
  active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface CourtAvailabilityWindowRow {
  id: UUID;
  court_id: UUID;
  day_of_week: number;
  open_time: ISOTime;
  close_time: ISOTime;
  slot_duration_minutes: number;
  created_at: ISODateTime;
}

export interface CourtBlackoutRow {
  id: UUID;
  court_id: UUID;
  start_date: ISODate;
  end_date: ISODate;
  reason: string;
  created_at: ISODateTime;
}

export interface CourtPricingRuleRow {
  id: UUID;
  court_id: UUID;
  day_of_week_start: number;
  day_of_week_end: number;
  time_start: ISOTime;
  time_end: ISOTime;
  multiplier: number | null;
  fixed_price: number | null;
  active: boolean;
  created_at: ISODateTime;
}

export interface CourtBookingRow {
  id: UUID;
  court_id: UUID;
  user_id: UUID | null;
  booking_source: BookingSource;
  walk_in_name: string | null;
  walk_in_phone: string | null;
  created_by_staff_id: UUID | null;
  date: ISODate;
  slot_start: ISOTime;
  slot_end: ISOTime;
  subtotal: number;
  gst: number;
  platform_fee: number;
  total: number;
  status: CourtBookingStatus;
  checked_in_at: ISODateTime | null;
  cancellation_reason: string | null;
  rating: number | null;
  remarks: string | null;
  payment_intent_id: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// ---- commerce -------------------------------------------------------------

export interface CategoryRow {
  id: UUID;
  name: string;
  slug: string;
}

export interface ProductRow {
  id: UUID;
  title: string;
  description: string | null;
  category_id: UUID | null;
  sport: Sport | null;
  base_price: number;
  active: boolean;
  recommended_rank: number | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface ProductMediaRow {
  id: UUID;
  product_id: UUID;
  storage_path: string;
  position: number;
  is_primary: boolean;
}

export interface ProductVariantRow {
  id: UUID;
  product_id: UUID;
  size: string | null;
  color: string | null;
  sku: string;
  price_override: number | null;
  stock: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface ProductWishlistItemRow {
  id: UUID;
  user_id: UUID;
  product_id: UUID;
  created_at: ISODateTime;
}

export interface CartItemRow {
  id: UUID;
  user_id: UUID;
  product_variant_id: UUID;
  qty: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface OrderRow {
  id: UUID;
  order_number: string; // "#ATL00001"
  user_id: UUID;
  // Which saved address was picked, for Reorder and support only. Nullable
  // since 0038 (ON DELETE SET NULL). NEVER render the delivery address from
  // this join: read the ship_to_* snapshot below. A shopper editing a saved
  // address must not rewrite where a past order went, which is the same
  // "snapshot, do not recompute" rule order_items already applies to prices.
  address_id: UUID | null;
  ship_to_line1: string;
  ship_to_line2: string | null;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_pincode: string;
  subtotal: number;
  delivery_charges: number;
  gst_and_others: number;
  donation_roundup: number;
  total: number;
  status: OrderStatus;
  payment_intent_id: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface OrderItemRow {
  id: UUID;
  order_id: UUID;
  product_variant_id: UUID;
  product_title_snapshot: string;
  variant_label_snapshot: string;
  qty: number;
  unit_price: number;
  created_at: ISODateTime;
}

export interface OrderTimelineRow {
  id: UUID;
  order_id: UUID;
  status: OrderStatus;
  note: string | null;
  location: string | null;
  actor_id: UUID | null;
  created_at: ISODateTime;
}

export interface OrderFeedbackRow {
  id: UUID;
  order_id: UUID;
  rating: number;
  remarks: string | null;
  created_at: ISODateTime;
}

// One row per (payment intent, variant), written by
// reserve_stock_for_checkout before Razorpay is called and resolved by exactly
// one of consume_reservation / release_reservation. See PHASE-4-STATUS.md D2.
//
// No client ever reads this table: its grants are withdrawn from anon and
// authenticated entirely, and it has no RLS policy. It is typed here because
// the checkout and finalize edge functions (service role) handle these rows.
export interface StockReservationRow {
  id: UUID;
  payment_intent_id: UUID;
  product_variant_id: UUID;
  qty: number;
  status: StockReservationStatus;
  expires_at: ISODateTime;
  release_reason: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// The `product_variant_availability` view, which is the ONE definition of
// available stock in the system (raw stock minus held, unexpired
// reservations). Every shopper-facing stock read goes through it. Never
// recompute this subtraction client side from `stock`; a ProductVariantRow's
// `stock` column is RAW inventory and is not what a shopper may buy.
export interface ProductVariantAvailabilityRow {
  product_variant_id: UUID;
  product_id: UUID;
  sku: string;
  size: string | null;
  color: string | null;
  effective_price: number;
  stock: number;
  held_qty: number;
  available_stock: number;
}

// Return shape of add_to_cart / update_cart_item (0034). `capped` is true when
// the requested quantity exceeded available stock and the line was written at
// `available_stock` instead. PRD-07 FR-9 requires the shopper be told, and
// FR-12 requires Proceed To Buy stay blocked until they resolve it, so this
// flag drives real UI and is not diagnostic.
export interface CartMutationResult {
  cart_item_id: UUID;
  product_variant_id: UUID;
  qty: number;
  requested_qty: number;
  available_stock: number;
  capped: boolean;
}

// ---- clutch -------------------------------------------------------------

export interface ClipRow {
  id: UUID;
  owner_id: UUID;
  cf_stream_uid: string | null;
  video_url: string | null;
  thumb_url: string | null;
  caption: string;
  sport: Sport;
  status: ClipStatus;
  rejection_reason: string | null;
  likes_count: number;
  comment_count: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface ClipLikeRow {
  id: UUID;
  clip_id: UUID;
  user_id: UUID;
  created_at: ISODateTime;
}

export interface ClipCommentRow {
  id: UUID;
  clip_id: UUID;
  user_id: UUID;
  text: string;
  created_at: ISODateTime;
}

export interface FollowRow {
  id: UUID;
  follower_id: UUID;
  followee_id: UUID;
  created_at: ISODateTime;
}

// ---- empower -------------------------------------------------------------

export interface UpaApplicationRow {
  id: UUID;
  applicant_user_id: UUID;
  story_headline: string;
  story_body: string;
  sport: Sport;
  region: string;
  state: string;
  photo_url: string | null;
  status: UpaStatus;
  needs_info_field: string | null;
  rejection_reason: string | null;
  reapply_after: ISODate | null;
  verified_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface UpaEvidenceRow {
  id: UUID;
  application_id: UUID;
  kind: 'certificate' | 'id_proof' | 'guardian_consent' | 'video_link';
  storage_path: string | null;
  url: string | null;
  created_at: ISODateTime;
}

export interface UpaWishlistItemRow {
  id: UUID;
  upa_id: UUID;
  title: string;
  cost: number;
  funded_amount: number;
  status: UpaWishlistItemStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface DonationRow {
  id: UUID;
  donor_id: UUID;
  upa_id: UUID | null;
  item_id: UUID | null;
  amount: number;
  method: DonationMethod;
  order_id: UUID | null;
  payment_intent_id: UUID;
  // AT-149: finalize-time snapshot of the donor name to show the UPA. Null
  // unless show_donor_name was on at donation time; renders "A Sponsor".
  donor_display_name: string | null;
  created_at: ISODateTime;
}

export interface GratitudePostRow {
  id: UUID;
  upa_id: UUID;
  wishlist_item_id: UUID;
  body: string;
  photo_url: string | null;
  status: 'published' | 'removed';
  deleted_at: ISODateTime | null;
  created_at: ISODateTime;
}

// ---- learn -------------------------------------------------------------

export interface DrillRow {
  id: UUID;
  title: string;
  description: string;
  sport: Sport;
  skill_category: string;
  difficulty: DrillDifficulty;
  xp_value: number;
  media_url: string | null;
  active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface DrillCompletionRow {
  id: UUID;
  user_id: UUID;
  drill_id: UUID;
  completed_at: ISODateTime;
}

export interface RoadmapStageRow {
  id: UUID;
  sport: Sport;
  stage_order: number;
  name: string;
  xp_threshold: number;
}

export interface XpEventRow {
  id: UUID;
  user_id: UUID;
  drill_id: UUID | null;
  source: XpSource;
  xp_amount: number;
  created_at: ISODateTime;
}

export interface MilestoneRow {
  id: UUID;
  key: string;
  name: string;
  description: string;
  icon_name: string; // lucide icon name, never an emoji
  criteria: Record<string, unknown>;
}

export interface UserMilestoneRow {
  id: UUID;
  user_id: UUID;
  milestone_id: UUID;
  earned_at: ISODateTime;
}

// ---- chat -------------------------------------------------------------

// Group rows (0078_group_chat_and_notes.sql) null both participant columns;
// the CHECK constraint enforces that as the only shape allowed to do so.
export interface ChatThreadRow {
  id: UUID;
  participant_a: UUID | null;
  participant_b: UUID | null;
  context_type: 'coaching' | 'clutch_creator' | 'group';
  context_id: UUID;
  last_message_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface ChatMessageRow {
  id: UUID;
  thread_id: UUID;
  sender_id: UUID;
  text: string;
  created_at: ISODateTime;
}

// Group threads only (0078_group_chat_and_notes.sql), the seated roster.
// Never written by a client, see the table's header comment.
export interface ChatThreadMemberRow {
  thread_id: UUID;
  user_id: UUID;
  created_at: ISODateTime;
}

// ---- notifications -------------------------------------------------------

export interface NotificationRow {
  id: UUID;
  user_id: UUID;
  type: NotificationType;
  title: string;
  body: string;
  deep_link: string;
  read_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface DeviceTokenRow {
  id: UUID;
  user_id: UUID;
  token: string;
  platform: 'ios' | 'android';
  created_at: ISODateTime;
}

// ---- payments -------------------------------------------------------------

export interface PaymentIntentRow {
  id: UUID;
  user_id: UUID;
  domain: PaymentDomain;
  entity_id: UUID | null;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount: number;
  currency: string;
  status: PaymentIntentStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface LedgerEntryRow {
  id: UUID;
  entry_group_id: UUID;
  payment_intent_id: UUID | null;
  account_type: LedgerAccountType;
  account_ref: UUID | null;
  direction: LedgerDirection;
  amount: number;
  domain: PaymentDomain;
  entity_id: UUID;
  description: string;
  created_at: ISODateTime;
}

export interface PayoutAccountRow {
  id: UUID;
  owner_type: 'coach' | 'court_partner';
  owner_id: UUID;
  razorpay_account_id: string | null;
  status: PayoutAccountStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface TransferRow {
  id: UUID;
  payout_account_id: UUID;
  amount: number;
  razorpay_transfer_id: string | null;
  status: TransferStatus;
  ledger_entry_group_id: UUID;
  created_at: ISODateTime;
}

export interface FeeConfigRow {
  id: UUID;
  domain: 'courts' | 'sessions' | 'commerce' | 'donations';
  key: string;
  value_type: FeeValueType;
  value: number;
  effective_from: ISODateTime;
  created_at: ISODateTime;
}

export interface WebhookEventRow {
  id: string; // Razorpay/Cloudflare event id, not a uuid
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: ISODateTime;
}

// ---- moderation/audit ------------------------------------------------

export interface VerificationRequestRow {
  id: UUID;
  applicant_type: ApplicantType;
  applicant_id: UUID;
  status: VerificationStatus;
  payload: Record<string, unknown>;
  reviewer_id: UUID | null;
  rejection_reason: string | null;
  reviewed_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface ReportRow {
  id: UUID;
  entity_type: 'clip' | 'comment';
  entity_id: UUID;
  reporter_id: UUID;
  reason: string;
  status: ReportStatus;
  resolved_by: UUID | null;
  resolved_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface FeatureFlagRow {
  id: UUID;
  key: string;
  description: string;
  enabled: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface AuditLogRow {
  id: UUID;
  actor_id: UUID | null;
  action: string;
  entity_type: string;
  entity_id: UUID;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  created_at: ISODateTime;
}

export interface SupportTicketRow {
  id: UUID;
  submitter_id: UUID;
  subject: string;
  description: string;
  status: TicketStatus;
  resolution_note: string | null;
  resolved_at: ISODateTime | null;
  created_at: ISODateTime;
}

// ---- affiliate marketplace (0086, admin writes 0120) --------------------

export interface AffiliateProductRow {
  id: UUID;
  title: string;
  brand: string | null;
  sport: Sport | null;
  category_id: UUID | null;
  skill_level: string | null;
  age_range: string | null;
  description: string | null;
  image_url: string | null;
  active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  /** Phase S2, ADR-011 D3. The retailer's own image URL, kept for re-fetch. Never rendered directly. */
  source_image_url: string | null;
  /** Phase S2, ADR-011 D3. Storage path of our own copy under product-images/<retailer_key>/<hash>.<ext>, written only by gear-ingest's save action. */
  image_path: string | null;
  /** Phase S2, ADR-011 D4. Free-text health summary the Catalog health page derives; written by gear-recheck. */
  health_status: string | null;
  /** Phase S2, ADR-011 D4. When gear-recheck last evaluated this product's overall health. */
  health_checked_at: ISODateTime | null;
  /** Phase S2, FR-51, AC-11-4. Set only by system_auto_delist_affiliate_product. Null for an admin-initiated delist. */
  auto_delisted_at: ISODateTime | null;
}

export interface ProductOfferRow {
  id: UUID;
  affiliate_product_id: UUID;
  retailer: string;
  price: number;
  currency: string;
  affiliate_url: string;
  in_stock: boolean;
  last_checked_at: ISODateTime;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  /** Phase S2, ADR-011 D3. The retailer's canonical product URL, distinct from affiliate_url (which carries the, currently empty, affiliate tag). */
  canonical_url: string | null;
  /** Phase S2, ADR-011 D3. Which retailer_programmes row produced this offer. Null for a manual entry with no matching programme. */
  retailer_key: string | null;
  /** Phase S2, ADR-011 D4. Only gone/blocked count toward consecutive_failures; every other outcome resets it. */
  last_check_outcome: 'ok' | 'price_changed' | 'out_of_stock' | 'gone' | 'blocked' | null;
  consecutive_failures: number;
  last_price_change_at: ISODateTime | null;
}

// ---- ingest and health: retailer config, fetch log (Phase S2) -----------
// See docs/architecture/ADR-011-shop-search-ingest-health.md D3, D4, D6 and
// PRD-07 section 11 (FR-44 to FR-52). Both tables are admin-read only
// (has_role('admin')), no anon/authenticated grant at all: operational
// config and an operational log, not shopper-facing content.

export interface RetailerExtractorMap {
  title?: string;
  brand?: string;
  price?: string;
  currency?: string;
  image?: string;
  description?: string;
  inStock?: string;
}

export interface RetailerProgrammeRow {
  key: string;
  display_name: string;
  url_patterns: string[];
  /** Empty until a real affiliate programme is approved (open question 11). Never fabricated. */
  affiliate_tag_template: string | null;
  extractor: RetailerExtractorMap | null;
  fetch_policy: { maxPerMinute: number } & Record<string, unknown>;
  active: boolean;
}

export type ProductFetchOutcome = 'ok' | 'price_changed' | 'out_of_stock' | 'gone' | 'blocked' | 'unparsed';

export interface ProductFetchLogRow {
  id: UUID;
  offer_id: UUID;
  fetched_at: ISODateTime;
  outcome: ProductFetchOutcome;
  http_status: number | null;
  price_seen: number | null;
  in_stock_seen: boolean | null;
  notes: string | null;
  /** FR-52. Claude's read of a 200 that no extraction strategy could parse. Never applied automatically. */
  ai_suggestion: Record<string, unknown> | null;
}

// ---- shop search: vectors, query cache, owned shop flag (Phase S1) -------
// See docs/architecture/ADR-011-shop-search-ingest-health.md D1, D5, D6 and
// PRD-07 section 11 (FR-40, FR-43, FR-53).

/**
 * `affiliate_products.embedding` is excluded from every client select via a
 * column-level grant (AC-11-6, AC-11-7), so `AffiliateProductRow` above
 * intentionally has no `embedding` field: no client-side type should carry
 * a column no client can ever read.
 */

export interface AppConfigRow {
  key: string;
  value: unknown;
  public: boolean;
  updated_at: ISODateTime;
}
