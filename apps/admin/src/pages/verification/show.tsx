import type { Db } from "@atlitos/types";
import { AlertTriangle, ArrowLeft, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge, Card, EmptyState } from "../../components/ui";
import { Button } from "../../components/ui";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 3.3 Verification Detail / FR-8 through FR-11: renders every
// evidence field submitted for the request (the payload jsonb snapshot),
// approve/reject enabled only while pending, an already actioned request
// renders as read only history. Approve/reject call the SECURITY DEFINER
// RPCs from supabase/migrations/0007_admin_verification_rpcs.sql: the admin
// client cannot write public.audit_log directly (RLS.md: audit_log has no
// authenticated write policy at all), so those RPCs are the only path that
// satisfies FR-9/FR-10's "writes one audit_log entry" alongside the status
// change, in one transaction.
type LoadState = "loading" | "error" | "ready" | "not_found";

function formatFieldLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function VerificationShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [request, setRequest] = useState<Db.VerificationRequestRow | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!id) return;
    setState("loading");
    const { data, error } = await supabaseClient
      .from("verification_requests")
      .select("id,applicant_type,applicant_id,status,payload,reviewer_id,rejection_reason,reviewed_at,created_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      setState("error");
      return;
    }
    if (!data) {
      setState("not_found");
      return;
    }
    setRequest(data as Db.VerificationRequestRow);
    setState("ready");
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function onApprove() {
    if (!request) return;
    setSubmitting(true);
    setActionError(null);
    const { error } = await supabaseClient.rpc("admin_approve_verification_request", {
      p_request_id: request.id,
    });
    setSubmitting(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    await load();
  }

  async function onReject() {
    if (!request) return;
    if (rejectReason.trim().length === 0) {
      setActionError("A rejection reason is required.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    const { error } = await supabaseClient.rpc("admin_reject_verification_request", {
      p_request_id: request.id,
      p_reason: rejectReason.trim(),
    });
    setSubmitting(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    setShowRejectForm(false);
    setRejectReason("");
    await load();
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading request...</div>;
  }

  if (state === "not_found") {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Request not found"
          description="This verification request does not exist or was removed."
        />
      </Card>
    );
  }

  if (state === "error" || !request) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Could not load this request"
          description="Something went wrong reading this verification request. Try again."
        />
      </Card>
    );
  }

  const isPending = request.status === "pending_review";
  const payloadEntries = Object.entries(request.payload ?? {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 640 }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          border: "none",
          background: "none",
          color: "var(--color-text-secondary)",
          fontSize: 14,
          cursor: "pointer",
          padding: 0,
          alignSelf: "flex-start",
        }}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        Back to queue
      </button>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
          <div>
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
              {request.applicant_type} application
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>
              {String((request.payload as Record<string, unknown>)?.name ?? request.applicant_id)}
            </h1>
          </div>
          <Badge tone={request.status === "approved" ? "success" : request.status === "rejected" ? "danger" : "warning"}>
            {request.status}
          </Badge>
        </div>

        <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
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
            Submitted evidence
          </p>
          {payloadEntries.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
              No evidence fields were submitted with this request.
            </p>
          ) : (
            <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: "var(--space-sm)", margin: 0 }}>
              {payloadEntries.map(([key, value]) => (
                <div key={key} style={{ display: "contents" }}>
                  <dt style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{formatFieldLabel(key)}</dt>
                  <dd style={{ fontSize: 14, margin: 0 }}>
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div
          style={{
            marginTop: "var(--space-lg)",
            paddingTop: "var(--space-lg)",
            borderTop: "1px solid var(--color-border)",
            fontSize: 13,
            color: "var(--color-text-secondary)",
          }}
        >
          Submitted {new Date(request.created_at).toLocaleString()}
          {request.reviewed_at ? (
            <>
              , reviewed {new Date(request.reviewed_at).toLocaleString()}
              {request.rejection_reason ? `. Reason, ${request.rejection_reason}` : ""}
            </>
          ) : null}
        </div>
      </Card>

      {isPending ? (
        <Card>
          {actionError ? (
            <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "0 0 var(--space-md)" }}>{actionError}</p>
          ) : null}

          {!showRejectForm ? (
            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              <Button onClick={onApprove} disabled={submitting}>
                <Check size={16} strokeWidth={1.75} />
                Approve
              </Button>
              <Button variant="destructive" onClick={() => setShowRejectForm(true)} disabled={submitting}>
                <X size={16} strokeWidth={1.75} />
                Reject
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Rejection reason, required</span>
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  rows={3}
                  style={{
                    padding: "var(--space-sm) var(--space-md)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                    backgroundColor: "var(--color-surface-muted)",
                    color: "var(--color-text)",
                    fontSize: 14,
                    resize: "vertical",
                  }}
                />
              </label>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <Button variant="destructive" onClick={onReject} disabled={submitting}>
                  Confirm reject
                </Button>
                <Button variant="secondary" onClick={() => setShowRejectForm(false)} disabled={submitting}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
            This request was already {request.status}. Approve and reject are only available while a request is
            pending review.
          </p>
        </Card>
      )}
    </div>
  );
}
