import { AlertTriangle, Flag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { supabaseClient } from "../../providers/supabaseClient";
import { reportStatusLabel, reportStatusTone } from "../moderation/status";
import type { ReportQueueRow, ReportStatus } from "../moderation/api";

// AT-103, PRD-04 FR-31, FR-33. The Reports Queue: user submitted reports against
// published clips or comments, showing reporter, reason, the reported entity,
// and date, with a distinct empty state when nothing is pending.
//
// `reports` carries an admin read-all policy (0042); the queue is meant to show
// every report, which is the admin's job, so there is no per-owner filter here.
// The reported entity's own text (clip caption, comment body) is resolved in a
// second query, matching the buyer-name pattern in orders/list.tsx.

type StatusFilter = "all" | ReportStatus;
type LoadState = "loading" | "error" | "ready";

const statusTabs: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "actioned", label: "Taken down" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

export function ReportsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilter = (searchParams.get("status") as StatusFilter | null) ?? "pending";

  const [reports, setReports] = useState<ReportQueueRow[]>([]);
  const [reporterNames, setReporterNames] = useState<Record<string, string>>({});
  const [entityLabels, setEntityLabels] = useState<Record<string, string>>({});
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const { data, error } = await supabaseClient
        .from("reports")
        .select("id,entity_type,entity_id,reporter_id,reason,status,resolved_by,resolved_at,created_at")
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        setState("error");
        return;
      }

      const rows = (data as ReportQueueRow[]) ?? [];
      setReports(rows);

      const reporterIds = Array.from(new Set(rows.map((r) => r.reporter_id)));
      if (reporterIds.length > 0) {
        const { data: users } = await supabaseClient.from("users").select("id,name").in("id", reporterIds);
        if (!cancelled && users) {
          setReporterNames(Object.fromEntries(users.map((u) => [u.id, u.name as string])));
        }
      }

      const clipIds = rows.filter((r) => r.entity_type === "clip").map((r) => r.entity_id);
      const commentIds = rows.filter((r) => r.entity_type === "comment").map((r) => r.entity_id);
      const labels: Record<string, string> = {};
      if (clipIds.length > 0) {
        const { data: clips } = await supabaseClient.from("clips").select("id,caption").in("id", clipIds);
        for (const c of clips ?? []) labels[c.id as string] = c.caption as string;
      }
      if (commentIds.length > 0) {
        const { data: comments } = await supabaseClient.from("clip_comments").select("id,text").in("id", commentIds);
        for (const c of comments ?? []) labels[c.id as string] = c.text as string;
      }
      if (!cancelled) setEntityLabels(labels);

      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => reports.filter((r) => activeFilter === "all" || r.status === activeFilter),
    [reports, activeFilter],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Reports queue</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Reports against published content. Take the content down or dismiss the report, both with a reason.
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-xs)", borderBottom: "1px solid var(--color-border)" }}>
        {statusTabs.map((tab) => {
          const isActive = tab.key === activeFilter;
          const count = tab.key === "all" ? reports.length : reports.filter((r) => r.status === tab.key).length;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSearchParams({ status: tab.key })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-xs)",
                padding: "var(--space-sm) var(--space-lg)",
                border: "none",
                borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
                backgroundColor: "transparent",
                color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
              <Mono
                style={{
                  fontSize: 12,
                  padding: "0 6px",
                  borderRadius: "var(--radius-pill)",
                  backgroundColor: "var(--color-surface-muted)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {count}
              </Mono>
            </button>
          );
        })}
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>
            Loading reports...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load reports"
            description="Something went wrong reading the reports table. Try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Flag size={32} strokeWidth={1.75} />}
            title="Nothing to resolve"
            description="No reports match this filter."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Reported", "Reporter", "Reason", "Filed", "Status"].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      padding: "var(--space-sm) var(--space-lg)",
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((report) => (
                <tr
                  key={report.id}
                  onClick={() => navigate(`/reports/show/${report.id}`)}
                  style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                    {entityLabels[report.entity_id] ?? report.entity_id}
                    <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {report.entity_type}
                    </span>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {reporterNames[report.reporter_id] ?? report.reporter_id}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)", maxWidth: 260 }}>
                    {report.reason}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {new Date(report.created_at).toLocaleDateString()}
                    </Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone={reportStatusTone(report.status)}>{reportStatusLabel(report.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
