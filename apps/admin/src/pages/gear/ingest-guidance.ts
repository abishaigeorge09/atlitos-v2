// What each gear-ingest refusal means, in one line the admin can act on.
//
// Phase A3-T1 of the admin UX rebuild (docs/PLAN-ADMIN-UX.md). Before this,
// every refusal surfaced as the server's raw message with no next step, and a
// supported retailer that answered 503 said "Could not read a product from
// this page", which reads as "your link is wrong". The founder's words:
// "the link does not really add in".
//
// Every code here is one the function actually returns (see
// supabase/functions/gear-ingest/index.ts and docs/architecture/API-MAPPING.md).

export type IngestErrorCode =
  | "UNSUPPORTED_RETAILER"
  | "ROBOTS_DISALLOWED"
  | "BLOCKED_TARGET"
  | "RETAILER_UNAVAILABLE"
  | "NO_PRODUCT_FOUND"
  | "INTERNAL";

export interface IngestGuidance {
  /** One line under the message: what to do now. */
  guidance: string;
  /** Whether the manual form below is the way forward (it almost always is). */
  fillByHand: boolean;
}

const GUIDANCE: Record<IngestErrorCode, IngestGuidance> = {
  UNSUPPORTED_RETAILER: {
    guidance: "Add the retailer to the programme list first, or fill the form below and paste the link as the offer.",
    fillByHand: true,
  },
  ROBOTS_DISALLOWED: {
    guidance: "The retailer's robots.txt asks us not to read this path. Fill the form below; the link still works as the offer.",
    fillByHand: true,
  },
  BLOCKED_TARGET: {
    guidance: "That address is not a public retailer page. Check the URL, or fill the form below.",
    fillByHand: true,
  },
  RETAILER_UNAVAILABLE: {
    guidance: "Fill the form below. The link you pasted is kept as the offer, so nothing is lost.",
    fillByHand: true,
  },
  NO_PRODUCT_FOUND: {
    guidance: "The page loaded but carried no product details. Whatever was readable is filled in below; complete the rest.",
    fillByHand: true,
  },
  INTERNAL: {
    guidance: "Something went wrong on our side. Try again, or fill the form below.",
    fillByHand: true,
  },
};

const FALLBACK: IngestGuidance = {
  guidance: "Fill the form below and paste the link as the offer.",
  fillByHand: true,
};

export function ingestGuidance(code: string | null | undefined): IngestGuidance {
  if (!code) return FALLBACK;
  return GUIDANCE[code as IngestErrorCode] ?? FALLBACK;
}

/** True for the codes where the pasted URL is still a valid offer link. */
export function keepsUrlAsOffer(code: string | null | undefined): boolean {
  return code === "RETAILER_UNAVAILABLE" || code === "ROBOTS_DISALLOWED" || code === "NO_PRODUCT_FOUND";
}
