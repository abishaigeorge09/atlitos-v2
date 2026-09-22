import type { Db } from "@atlitos/types";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { EmptyState } from "../../components/kit/EmptyState";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Select } from "../../components/kit/Select";
import { Tabs } from "../../components/kit/Tabs";
import { Badge } from "../../components/kit/Badge";
import { statusLabel, statusTone } from "../../lib/status";
import { supabaseClient } from "../../providers/supabaseClient";
import { nameFromPayload, resolveApplicantNames } from "./applicant";
import "./verification.css";

// PRD-04 3.3 Verification Queue / FR-7, FR-12: tabbed list (by review status)
// of verification_requests, filterable by applicant type and searchable by
// applicant name. Reads public.verification_requests (RLS:
// verification_requests_select_admin, admin/moderator reads all).
type Tab = Db.VerificationRequestRow["status"];
type ApplicantType = Db.VerificationRequestRow["applicant_type"];

const statusTabs: { key: Tab; label: string }[] = [
  { key: "pending_review", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

const typeLabel: Record<ApplicantType, string> = {
  coach: "Coach",
  venue: "Venue",
  upa: "UPA",
};

type LoadState = "loading" | "error" | "ready";

export function VerificationList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("status") as Tab | null) ?? "pending_review";

  const [requests, setRequests] = useState<Db.VerificationRequestRow[]>([]);
  const [applicantNames, setApplicantNames] = useState<Record<string, string>>({});
  const [state, setState] = useState<LoadState>("loading");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const { data, error } = await supabaseClient
        .from("verification_requests")
        .select("id,applicant_type,applicant_id,status,payload,reviewer_id,rejection_reason,reviewed_at,created_at")
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setState("error");
        return;
      }

      const rows = (data as Db.VerificationRequestRow[]) ?? [];
      setRequests(rows);

      // One resolver for the queue and the detail screen, so the two cannot
      // drift again (see ./applicant.ts). Every applicant type is covered,
      // not only coaches.
      const names = await resolveApplicantNames(rows);
      if (!cancelled) setApplicantNames(names);

      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function applicantName(row: Db.VerificationRequestRow): string {
    return applicantNames[row.applicant_id] ?? nameFromPayload(row) ?? row.applicant_id;
  }

  const byTypeFilter = useMemo(
    () => requests.filter((r) => typeFilter === "" || r.applicant_type === typeFilter),
    [requests, typeFilter],
  );

  const rowsForTab = useMemo(() => {
    const q = search.trim().toLowerCase();
    return byTypeFilter.filter((r) => {
      if (r.status !== activeTab) return false;
      if (q.length === 0) return true;
      return applicantName(r).toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byTypeFilter, activeTab, search, applicantNames]);

  const columns: DataTableColumn<Db.VerificationRequestRow>[] = [
    { key: "applicant", header: "Applicant", render: (row) => applicantName(row) },
    { key: "type", header: "Type", render: (row) => typeLabel[row.applicant_type] },
    { key: "submitted", header: "Submitted", render: (row) => new Date(row.created_at).toLocaleDateString() },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>,
    },
  ];

  return (
    <div className="ak-page-stack">
      <PageHeader
        breadcrumbs={[{ label: "Operations" }, { label: "Verification" }]}
        title="Verification queue"
        description="Review coach, venue, and UPA applications before they reach the marketplace."
      />

      <Tabs
        items={statusTabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          count: byTypeFilter.filter((r) => r.status === tab.key).length,
        }))}
        active={activeTab}
        onChange={(key) => setSearchParams(key === "pending_review" ? {} : { status: key })}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by applicant name"
        filters={
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            placeholder="All applicant types"
            options={[
              { value: "coach", label: "Coach" },
              { value: "venue", label: "Venue" },
              { value: "upa", label: "UPA" },
            ]}
          />
        }
        resultCount={rowsForTab.length}
        resultNoun="requests"
      />

      {state === "error" ? (
        <EmptyState title="Could not load the queue" body="Something went wrong reading verification_requests. Try again." />
      ) : (
        <DataTable
          columns={columns}
          rows={rowsForTab}
          rowKey={(row) => row.id}
          rowHref={(row) => `/verification/show/${row.id}`}
          loading={state === "loading"}
          emptyTitle={`No ${statusTabs.find((t) => t.key === activeTab)?.label.toLowerCase()} requests`}
          emptyBody="Nothing matches this tab, type, and search right now."
        />
      )}
    </div>
  );
}
