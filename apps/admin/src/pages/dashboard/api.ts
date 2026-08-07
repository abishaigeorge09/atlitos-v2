import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 FR-4, FR-5. Four independent admin-guarded SECURITY DEFINER RPCs
// (0096, decision 9), one per tile cluster, so a failure computing one
// cluster never blocks the others (FR-5). Each returns `jsonb`; the shapes
// below are this file's own contract with 0096, not a generated type.

export interface KpiMoney {
  gmv_captured_7d: number;
  window: string;
  as_of: string;
}

export interface KpiUsers {
  total_users: number;
  by_role: Record<string, number>;
  signups_7d: number;
  window: string;
  as_of: string;
}

export interface KpiQueues {
  pending_refunds: number;
  pending_verifications: number;
  pending_reports: number;
  as_of: string;
}

export interface KpiActivity {
  bookings_7d: number;
  court_bookings_7d: number;
  sessions_7d: number;
  orders_7d: number;
  open_support_tickets: number;
  window: string;
  as_of: string;
}

async function callKpiRpc<T>(fn: string): Promise<T> {
  const { data, error } = await supabaseClient.rpc(fn);
  if (error) throw error;
  return data as T;
}

export const dashboardApi = {
  money: () => callKpiRpc<KpiMoney>("admin_kpi_money"),
  users: () => callKpiRpc<KpiUsers>("admin_kpi_users"),
  queues: () => callKpiRpc<KpiQueues>("admin_kpi_queues"),
  activity: () => callKpiRpc<KpiActivity>("admin_kpi_activity"),
};
