// ATLITOS v2 — supabase/functions/_shared/fee-config.ts
//
// Reads the currently active fee_config row for a (domain, key) pair, per
// docs/architecture/PAYMENTS.md's "fee_config in practice" query:
//
//   select value, value_type from fee_config
//   where domain = $1 and key = $2 and effective_from <= now()
//   order by effective_from desc limit 1;
//
// One shared helper so every re-pricing edge function reads this the same
// way instead of re-deriving the query per function.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";

export type FeeValueType = "percentage" | "flat";

export interface FeeConfigRow {
  value: number;
  value_type: FeeValueType;
}

export async function getActiveFeeConfig(
  supabase: SupabaseClient,
  domain: "courts" | "sessions" | "commerce" | "donations",
  key: string,
): Promise<FeeConfigRow> {
  const { data, error } = await supabase
    .from("fee_config")
    .select("value, value_type")
    .eq("domain", domain)
    .eq("key", key)
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle<FeeConfigRow>();

  if (error) {
    throw new AppError(
      "INTERNAL",
      `Failed to read fee_config for ${domain}.${key}: ${error.message}`,
      500,
    );
  }

  if (!data) {
    throw new AppError(
      "INTERNAL",
      `No active fee_config row for ${domain}.${key}.`,
      500,
    );
  }

  return data;
}

/** Rounds to 2 decimal places, matching every money column's numeric(12,2). */
export function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}
