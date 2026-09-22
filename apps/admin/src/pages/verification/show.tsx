import type { Db } from "@atlitos/types";
import { useNotification } from "@refinedev/core";
import { AlertTriangle, Check, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { DetailSkeleton } from "../../components/kit/Skeleton";
import { EmptyState } from "../../components/kit/EmptyState";
import { Field } from "../../components/kit/Field";
import { PageHeader } from "../../components/kit/PageHeader";
import { Textarea } from "../../components/kit/Textarea";
import { statusLabel, statusTone } from "../../lib/status";
import { supabaseClient } from "../../providers/supabaseClient";
import "./verification.css";

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

function isDocumentUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

/**
 * Who applied, by name. The list page resolves coach applicants against
 * public.users; this screen used to fall straight back to the raw uuid, so a
 * venue or UPA request was titled with a uuid while its own name sat one card
 * over in the evidence. No payload carries a `name` key: a venue carries
 * `venue_name`, a UPA application carries `school`. Found by the ux-critic on
 * the A2 gate, 2026-09-22.
 *
 * `applicant_id` points at a different table per type, so the lookup is keyed
 * on the type rather than guessed.
 */
async function resolveApplicantName(row: Db.VerificationRequestRow): Promise<string | null> {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  for (const key of ["name", "venue_name", "school", "organisation", "title"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  try {
    if (row.applicant_type === "venue") {
      const { data } = await supabaseClient.from("venues").select("name").eq("id", row.applicant_id).maybeSingle();
      const name = (data as { name?: string } | null)?.name;
      if (name) return name;
    } else {
      const { data } = await supabaseClient.from("users").select("name").eq("id", row.applicant_id).maybeSingle();
      const name = (data as { name?: string } | null)?.name;
      if (name) return name;
    }
  } catch {
    // Fall through to the id: a missing lookup is not worth failing the page.
  }
  return null;
}

export function VerificationShow() {
  const { id } = useParams<{ id: string }>();
  const { open } = useNotification();

  const [request, setRequest] = useState<Db.VerificationRequestRow | null>(null);
  const [applicantName, setApplicantName] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
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
    const row = data as Db.VerificationRequestRow;
    setRequest(row);
    setState("ready");
    void resolveApplicantName(row).then(setApplicantName);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onApprove() {
    if (!request) return;
    setSubmitting(true);
    const { error } = await supabaseClient.rpc("admin_approve_verification_request", {
      p_request_id: request.id,
    });
    setSubmitting(false);
    if (error) {
      open?.({ type: "error", message: "Could not approve this request.", description: error.message, key: "verification-action" });
      return;
    }
    open?.({ type: "success", message: "Request approved.", key: "verification-action" });
    await load();
  }

  async function onReject() {
    if (!request) return;
    if (rejectReason.trim().length === 0) {
      setReasonError("A rejection reason is required.");
      return;
    }
    setReasonError(null);
    setSubmitting(true);
    const { error } = await supabaseClient.rpc("admin_reject_verification_request", {
      p_request_id: request.id,
      p_reason: rejectReason.trim(),
    });
    setSubmitting(false);
    if (error) {
      open?.({ type: "error", message: "Could not reject this request.", description: error.message, key: "verification-action" });
      return;
    }
    setShowRejectForm(false);
    setRejectReason("");
    open?.({ type: "success", message: "Request rejected.", key: "verification-action" });
    await load();
  }

  if (state === "loading") {
    return (
      <div className="ak-page-stack">
        <PageHeader breadcrumbs={[{ label: "Verification queue", to: "/verification" }]} title="Loading request" />
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "not_found") {
    return (
      <div className="ak-page-stack">
        <PageHeader breadcrumbs={[{ label: "Verification queue", to: "/verification" }]} title="Request not found" />
        <Card>
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Request not found"
            body="This verification request does not exist or was removed."
          />
        </Card>
      </div>
    );
  }

  if (state === "error" || !request) {
    return (
      <div className="ak-page-stack">
        <PageHeader breadcrumbs={[{ label: "Verification queue", to: "/verification" }]} title="Could not load this request" />
        <Card>
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load this request"
            body="Something went wrong reading this verification request. Try again."
          />
        </Card>
      </div>
    );
  }

  const isPending = request.status === "pending_review";
  const payloadEntries = Object.entries(request.payload ?? {});
  const documentEntries = payloadEntries.filter(([, value]) => isDocumentUrl(value));
  const fieldEntries = payloadEntries.filter(([key]) => !documentEntries.some(([docKey]) => docKey === key));
  const title = applicantName ?? request.applicant_id;

  return (
    <div className="ak-page-stack">
      <PageHeader
        breadcrumbs={[{ label: "Verification queue", to: "/verification" }]}
        title={title}
        description={`${formatFieldLabel(request.applicant_type)} application`}
      />

      <DetailLayout
        main={
          <>
            <Card>
              <h3 className="ak-verification-subhead">Submitted evidence</h3>
              {fieldEntries.length === 0 ? (
                <p className="ak-verification-muted">No evidence fields were submitted with this request.</p>
              ) : (
                <dl className="ak-verification-fields">
                  {fieldEntries.map(([key, value]) => (
                    <div key={key} className="ak-verification-field-row">
                      <dt>{formatFieldLabel(key)}</dt>
                      <dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>

            {documentEntries.length > 0 ? (
              <Card>
                <h3 className="ak-verification-subhead">Documents</h3>
                <div className="ak-verification-documents">
                  {documentEntries.map(([key, value]) => (
                    <a key={key} href={String(value)} target="_blank" rel="noreferrer" className="ak-verification-document-link">
                      <FileText size={16} strokeWidth={1.75} />
                      {formatFieldLabel(key)}
                    </a>
                  ))}
                </div>
              </Card>
            ) : null}
          </>
        }
        side={
          <Card>
            <div className="ak-verification-side-header">
              <Badge tone={statusTone(request.status)}>{statusLabel(request.status)}</Badge>
            </div>
            <div className="ak-verification-meta">
              <Field label="Applicant"><span>{applicantName}</span></Field>
              <Field label="Submitted"><span>{new Date(request.created_at).toLocaleString()}</span></Field>
              {request.reviewed_at ? (
                <Field label="Reviewed"><span>{new Date(request.reviewed_at).toLocaleString()}</span></Field>
              ) : null}
              {request.rejection_reason ? (
                <Field label="Rejection reason"><span>{request.rejection_reason}</span></Field>
              ) : null}
            </div>

            {isPending ? (
              <div className="ak-verification-actions">
                {!showRejectForm ? (
                  <div className="ak-verification-action-row">
                    <Button onClick={() => void onApprove()} disabled={submitting}>
                      <Check size={16} strokeWidth={1.75} />
                      Approve
                    </Button>
                    <Button variant="danger" onClick={() => setShowRejectForm(true)} disabled={submitting}>
                      <X size={16} strokeWidth={1.75} />
                      Reject
                    </Button>
                  </div>
                ) : (
                  <div className="ak-verification-reject-form">
                    <Field label="Rejection reason" error={reasonError ?? undefined}>
                      <Textarea
                        value={rejectReason}
                        onChange={(value) => {
                          setRejectReason(value);
                          if (reasonError) setReasonError(null);
                        }}
                        rows={3}
                      />
                    </Field>
                    <div className="ak-verification-action-row">
                      <Button variant="danger" onClick={() => void onReject()} disabled={submitting}>
                        Confirm reject
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setShowRejectForm(false);
                          setRejectReason("");
                          setReasonError(null);
                        }}
                        disabled={submitting}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="ak-verification-muted">
                This request was already {statusLabel(request.status).toLowerCase()}. Approve and reject are only
                available while a request is pending review.
              </p>
            )}
          </Card>
        }
      />
    </div>
  );
}
