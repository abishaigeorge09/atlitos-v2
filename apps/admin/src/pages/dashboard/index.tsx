import { formatINR } from "@atlitos/theme";
import { AlertTriangle, ChevronRight, FileWarning, Flag, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card } from "../../components/kit/Card";
import { PageHeader } from "../../components/kit/PageHeader";
import { Skeleton } from "../../components/kit/Skeleton";
import { Mono } from "../../components/mono";
import { dashboardApi, type KpiActivity, type KpiMoney, type KpiQueues, type KpiUsers } from "./api";
import "./dashboard.css";

// PRD-04 FR-4, FR-5. Dashboard Overview: KPI tiles for total users, GMV this
// week, bookings this week, orders this week, plus queue counts. FR-5 ("each
// KPI tile loads and errors independently; a failure to compute one tile
// does not block the others from rendering") is why this page runs FOUR
// independent fetches, one per `useTileCluster` call below, rather than one
// Promise.all that would fail the whole page on a single RPC error.
//
// "This week" is a rolling 7 days, matching 0096's window definition.

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

function KpiTile<T>({
  label,
  state,
  value,
}: {
  label: string;
  state: ClusterState<T>;
  value: (data: T) => React.ReactNode;
}) {
  return (
    <Card className="ak-dashboard-kpi-card">
      {state.status === "loading" ? (
        <>
          <Skeleton width={70} height={22} />
          <Skeleton width={110} height={12} />
        </>
      ) : state.status === "error" ? (
        <>
          <span className="ak-dashboard-kpi-error">
            <AlertTriangle size={16} strokeWidth={1.75} />
          </span>
          <span className="ak-dashboard-kpi-label">{label}, could not load</span>
        </>
      ) : (
        <>
          <Mono style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)" }}>
            {value(state.data)}
          </Mono>
          <span className="ak-dashboard-kpi-label">{label}</span>
        </>
      )}
    </Card>
  );
}

function AttentionRow({
  icon,
  label,
  state,
  count,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  state?: ClusterState<unknown>;
  count?: (data: unknown) => number;
  to: string;
}) {
  return (
    <Link to={to} className="ak-dashboard-attention-row">
      <span className="ak-dashboard-attention-icon">{icon}</span>
      <span className="ak-dashboard-attention-label">{label}</span>
      {!state || !count ? (
        <ChevronRight size={16} strokeWidth={1.75} />
      ) : state.status === "ready" ? (
        <Mono style={{ fontWeight: "var(--weight-semibold)" }}>{count(state.data)}</Mono>
      ) : state.status === "error" ? (
        <span className="ak-dashboard-kpi-error">Unavailable</span>
      ) : (
        <Skeleton width={24} height={14} />
      )}
    </Link>
  );
}

export function Dashboard() {
  const money = useTileCluster(dashboardApi.money);
  const users = useTileCluster(dashboardApi.users);
  const queues = useTileCluster(dashboardApi.queues);
  const activity = useTileCluster(dashboardApi.activity);

  return (
    <div className="ak-dashboard">
      <PageHeader title="Dashboard" description="Platform activity over the last 7 days." />

      <div className="ak-dashboard-kpi-row">
        <KpiTile label="GMV, gross captured" state={money} value={(m: KpiMoney) => formatINR(Number(m.gmv_captured_7d))} />
        <KpiTile label="Total users" state={users} value={(u: KpiUsers) => u.total_users} />
        <KpiTile label="Bookings this week" state={activity} value={(a: KpiActivity) => a.bookings_7d} />
        <KpiTile label="Orders this week" state={activity} value={(a: KpiActivity) => a.orders_7d} />
      </div>

      <div className="ak-dashboard-cards-row">
        <Card>
          <h2 className="ak-dashboard-card-title">Needs attention</h2>
          <div className="ak-dashboard-attention-list">
            <AttentionRow
              icon={<ShieldCheck size={16} strokeWidth={1.75} />}
              label="Pending verification"
              state={queues}
              count={(d) => (d as KpiQueues).pending_verifications}
              to="/verification"
            />
            <AttentionRow
              icon={<FileWarning size={16} strokeWidth={1.75} />}
              label="Clip moderation queue"
              to="/moderation"
            />
            <AttentionRow
              icon={<Flag size={16} strokeWidth={1.75} />}
              label="Open reports"
              state={queues}
              count={(d) => (d as KpiQueues).pending_reports}
              to="/reports"
            />
          </div>
        </Card>

        <Card>
          <h2 className="ak-dashboard-card-title">Recent</h2>
          {activity.status === "loading" ? (
            <div className="ak-dashboard-recent-list">
              <Skeleton width="90%" height={14} />
              <Skeleton width="80%" height={14} />
              <Skeleton width="70%" height={14} />
            </div>
          ) : activity.status === "error" ? (
            <p className="ak-dashboard-kpi-error">Could not load recent activity. {activity.message}</p>
          ) : (
            <div className="ak-dashboard-recent-list">
              <div className="ak-dashboard-recent-row">
                <span>Court bookings</span>
                <Mono>{activity.data.court_bookings_7d}</Mono>
              </div>
              <div className="ak-dashboard-recent-row">
                <span>Coach sessions</span>
                <Mono>{activity.data.sessions_7d}</Mono>
              </div>
              <div className="ak-dashboard-recent-row">
                <span>Orders placed</span>
                <Mono>{activity.data.orders_7d}</Mono>
              </div>
              <div className="ak-dashboard-recent-row">
                <span>Open support tickets</span>
                <Mono>{activity.data.open_support_tickets}</Mono>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
