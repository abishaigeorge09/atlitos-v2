import type { Db } from "@atlitos/types";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, Card, EmptyState } from "../../components/ui";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 3.3 Verification Queue / FR-7, FR-12: tabbed list (Coach, Venue,
// UPA) of pending verification_requests, each tab with its own distinct
// empty state. Reads public.verification_requests (RLS:
// verification_requests_select_admin, admin/moderator reads all).
type Tab = Db.VerificationRequestRow["applicant_type"];

const tabs: { key: Tab; label: string }[] = [
  { key: "coach", label: "Coach" },
  { key: "venue", label: "Venue" },
  { key: "upa", label: "UPA" },
];

type LoadState = "loading" | "error" | "ready";

export function VerificationList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("type") as Tab | null) ?? "coach";

  const [requests, setRequests] = useState<Db.VerificationRequestRow[]>([]);
  const [applicantNames, setApplicantNames] = useState<Record<string, string>>({});
  const [state, setState] = useState<LoadState>("loading");

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

      // applicant name resolution: coach applicant_id is a public.users id
      // (== coach_profiles.user_id); venue/upa tables don't exist yet (see
      // 0007_admin_verification_rpcs.sql header), so those fall back to the
      // payload's own name field, checked at render time.
      const coachIds = rows.filter((r) => r.applicant_type === "coach").map((r) => r.applicant_id);
      if (coachIds.length > 0) {
        const { data: users } = await supabaseClient.from("users").select("id,name").in("id", coachIds);
        if (!cancelled && users) {
          setApplicantNames(Object.fromEntries(users.map((u) => [u.id, u.name as string])));
        }
      }

      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rowsForTab = useMemo(
    () => requests.filter((r) => r.applicant_type === activeTab && r.status === "pending_review"),
    [requests, activeTab],
  );

  function applicantName(row: Db.VerificationRequestRow): string {
    if (row.applicant_type === "coach") return applicantNames[row.applicant_id] ?? row.applicant_id;
    const payloadName = (row.payload as Record<string, unknown>)?.name;
    return typeof payloadName === "string" ? payloadName : row.applicant_id;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>
          Verification queue
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Review coach, venue, and UPA applications before they reach the marketplace.
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-xs)", borderBottom: "1px solid var(--color-border)" }}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          const count = requests.filter((r) => r.applicant_type === tab.key && r.status === "pending_review").length;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSearchParams({ type: tab.key })}
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
              }}
            >
              {tab.label}
              <span
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 12,
                  padding: "0 6px",
                  borderRadius: "var(--radius-pill)",
                  backgroundColor: "var(--color-surface-muted)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>
            Loading verification requests...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load the queue"
            description="Something went wrong reading verification_requests. Try again."
          />
        ) : rowsForTab.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={32} strokeWidth={1.75} />}
            title={`No pending ${tabs.find((t) => t.key === activeTab)?.label.toLowerCase()} requests`}
            description="Nothing is waiting for review in this tab right now."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Applicant", "Submitted", "Status"].map((heading) => (
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
              {rowsForTab.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => navigate(`/verification/show/${row.id}`)}
                  style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                    {applicantName(row)}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-md) var(--space-lg)",
                      fontSize: 13,
                      fontFamily: "JetBrains Mono, monospace",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {new Date(row.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone="warning">{row.status}</Badge>
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
