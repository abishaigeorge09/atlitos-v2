import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Tabs } from "../../components/kit/Tabs";
import { relativeTime } from "../../lib/relative-time";
import { supabaseClient } from "../../providers/supabaseClient";
import { reportStatusLabel, reportStatusTone } from "../moderation/status";
import type { ReportStatus } from "../moderation/api";
import { entityTypeLabel, fetchReportedEntitySummaries, type ReportQueueRow } from "./api";
import "./reports.css";

// AT-103, PRD-04 FR-31, FR-33. The Reports Queue: user submitted reports
// against published clips, comments, chat messages (Phase 4 LAUNCH Track C,
// CT-C, 0097_report_block.sql), or a user account directly.
//
// `reports` carries an admin read-all policy (0042); the queue is meant to
// show every report, so there is no per-owner filter here. See ./api.ts for
// the entity_type widening notes.

type StatusFilter = "all" | ReportStatus;
type LoadState = "loading" | "error" | "ready";

const statusTabs: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "actioned", label: "Taken down" },
  { key: "dismissed", label: "Dismissed" },
];

export function ReportsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilter = (searchParams.get("status") as StatusFilter | null) ?? "pending";
  const [search, setSearch] = useState("");

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
      const rpcLabels = await fetchReportedEntitySummaries(rows);
      if (!cancelled) setEntityLabels({ ...labels, ...rpcLabels });

      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabbed = useMemo(
    () => reports.filter((r) => activeFilter === "all" || r.status === activeFilter),
    [reports, activeFilter],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabbed;
    return tabbed.filter((r) => {
      const reporter = (reporterNames[r.reporter_id] ?? "").toLowerCase();
      const entity = (entityLabels[r.entity_id] ?? "").toLowerCase();
      return reporter.includes(q) || entity.includes(q) || r.reason.toLowerCase().includes(q);
    });
  }, [tabbed, search, reporterNames, entityLabels]);

  const columns: DataTableColumn<ReportQueueRow>[] = [
    {
      key: "reported",
      header: "Reported",
      render: (row) => (
        <div>
          <span className="ak-report-entity-label">{entityLabels[row.entity_id] ?? row.entity_id}</span>
          <span className="ak-report-entity-type">{entityTypeLabel[row.entity_type]}</span>
        </div>
      ),
    },
    { key: "reporter", header: "Reporter", render: (row) => reporterNames[row.reporter_id] ?? row.reporter_id },
    { key: "reason", header: "Reason", render: (row) => row.reason },
    { key: "filed", header: "Filed", render: (row) => relativeTime(row.created_at) },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={reportStatusTone(row.status)}>{reportStatusLabel(row.status)}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Community" }]}
        title="Reports queue"
        description="Reports against published content. Take the content down or dismiss the report, both with a reason."
      />

      <Tabs
        items={statusTabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          count: tab.key === "all" ? reports.length : reports.filter((r) => r.status === tab.key).length,
        }))}
        active={activeFilter}
        onChange={(key) => setSearchParams(key === "pending" ? {} : { status: key })}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by reporter, reason or content"
        resultCount={filtered.length}
        resultNoun={filtered.length === 1 ? "report" : "reports"}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        rowHref={(row) => `/reports/show/${row.id}`}
        loading={state === "loading"}
        emptyTitle={state === "error" ? "Could not load reports" : "Nothing to resolve"}
        emptyBody={
          state === "error"
            ? "Something went wrong reading the reports table. Try again."
            : "No reports match this filter."
        }
      />
    </div>
  );
}
