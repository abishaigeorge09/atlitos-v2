import type { PaymentDomain, RefundStatus } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapPostgrestError } from "./errors";

/**
 * AT-148 (AT-88, PRD-02 FR-35 / PRD-04 FR-24). The read side of a refund.
 *
 * A refund already exists in `refunds` with its own amount and status by the
 * time any screen needs to show it; this is a pure READ, never a money write.
 * `refunds` RLS lets the payer of the underlying charge select their own row
 * (SCHEMA.md), so the athlete who is owed the money can read exactly this and
 * nothing else. `refunds_one_per_entity` is UNIQUE on `(domain, entity_id)`,
 * so at most one row exists per session/booking/order and `maybeSingle` is
 * safe. The screen keys its copy off `status`, never off the mere existence
 * of a row: `pending` must never read as "refunded".
 */
export interface RefundSummary {
  amount: number;
  status: RefundStatus;
}

export async function readRefundSummary(
  client: AtlitosClient,
  domain: PaymentDomain,
  entityId: string,
): Promise<RefundSummary | null> {
  const { data, error } = await client
    .from("refunds")
    .select("amount, status")
    .eq("domain", domain)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) throw mapPostgrestError(error);
  if (!data) return null;
  return { amount: data.amount, status: data.status };
}
