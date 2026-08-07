import { AlertTriangle, IndianRupee, ListChecks, TrendingUp, Users as UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "../../components/ui";
import { Mono } from "../../components/mono";
import { dashboardApi, type KpiActivity, type KpiMoney, type KpiQueues, type KpiUsers } from "./api";

// PRD-04 FR-4, FR-5. Dashboard Overview: KPI tiles for total users by role,
// bookings this week (courts plus sessions combined), orders this week, GMV
// this week, pending verification count, pending moderation count, and open
// support ticket count (PHASE-4-STATUS.md CT-B / decision 9).
//
// FR-5 ("each KPI tile loads and errors independently; a failure to compute
// one tile does not block the others from rendering") is why this page runs
// FOUR separate fetches, one per `useTileCluster` call below, each with its
// own loading/error state, rather than one Promise.all that would fail the
// whole page on a single RPC error. A cluster that throws renders its own
// inline error card; the other three still render their real numbers.
//
// "This week" is a rolling 7 days, matching 0096's window definition
// (documented there and in RLS.md) rather than a calendar week that would
// reset visibly to 0 every Monday with no incident behind it.

type ClusterState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

function useTileCluster<T>(fetcher: () => Promise<T>): ClusterState<T> {
  const [state, setState] = useState<ClusterState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load this cluster.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

function ClusterCard({
  title,
  icon,
  state,
  render,
}: {
  title: string;
  icon: React.ReactNode;
  state: ClusterState<unknown>;
  render: (data: unknown) => React.ReactNode;
}) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
        <span style={{ color: "var(--color-text-tertiary)" }}>{icon}</span>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
            margin: 0,
          }}
        >
          {title}
        </p>
      </div>
      {state.status === "loading" ? (
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>Loading...</p>
      ) : state.status === "error" ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-sm)" }}>
          <AlertTriangle size={16} strokeWidth={1.75} color="var(--color-danger)" />
          <p style={{ fontSize: 13, color: "var(--color-danger)", margin: 0 }}>
            Could not load this cluster. {state.message}
          </p>
        </div>
      ) : (
        render(state.data)
      )}
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <Mono style={{ fontSize: 24, fontWeight: 700, display: "block" }}>{value}</Mono>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>{label}</p>
    </div>
  );
}

export function Dashboard() {
  const money = useTileCluster(dashboardApi.money);
  const users = useTileCluster(dashboardApi.users);
  const queues = useTileCluster(dashboardApi.queues);
  const activity = useTileCluster(dashboardApi.activity);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Dashboard</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Platform activity over the last 7 days.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--space-lg)" }}>
        <ClusterCard
          title="Money"
          icon={<IndianRupee size={16} strokeWidth={1.75} />}
          state={money}
          render={(data) => {
            const m = data as KpiMoney;
            return <Tile label="GMV, gross captured" value={`Rs ${Number(m.gmv_captured_7d).toFixed(2)}`} />;
          }}
        />

        <ClusterCard
          title="Users"
          icon={<UsersIcon size={16} strokeWidth={1.75} />}
          state={users}
          render={(data) => {
            const u = data as KpiUsers;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                <div style={{ display: "flex", gap: "var(--space-xl)" }}>
                  <Tile label="Total users" value={u.total_users} />
                  <Tile label="Signups" value={u.signups_7d} />
                </div>
                <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                  {Object.entries(u.by_role).map(([role, count]) => (
                    <span
                      key={role}
                      style={{
                        fontSize: 12,
                        padding: "2px var(--space-sm)",
                        borderRadius: "var(--radius-pill)",
                        backgroundColor: "var(--color-surface-muted)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {role}: <Mono style={{ fontWeight: 600 }}>{count}</Mono>
                    </span>
                  ))}
                </div>
              </div>
            );
          }}
        />

        <ClusterCard
          title="Queues"
          icon={<ListChecks size={16} strokeWidth={1.75} />}
          state={queues}
          render={(data) => {
            const q = data as KpiQueues;
            return (
              <div style={{ display: "flex", gap: "var(--space-xl)", flexWrap: "wrap" }}>
                <Tile label="Pending refunds" value={q.pending_refunds} />
                <Tile label="Pending verifications" value={q.pending_verifications} />
                <Tile label="Pending reports" value={q.pending_reports} />
              </div>
            );
          }}
        />

        <ClusterCard
          title="Activity"
          icon={<TrendingUp size={16} strokeWidth={1.75} />}
          state={activity}
          render={(data) => {
            const a = data as KpiActivity;
            return (
              <div style={{ display: "flex", gap: "var(--space-xl)", flexWrap: "wrap" }}>
                <Tile label="Bookings" value={a.bookings_7d} />
                <Tile label="Orders" value={a.orders_7d} />
                <Tile label="Open support tickets" value={a.open_support_tickets} />
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
