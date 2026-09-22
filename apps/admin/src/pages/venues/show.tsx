import { formatINR } from "@atlitos/theme";
import type { Db } from "@atlitos/types";
import { useNotification } from "@refinedev/core";
import { Check, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { ConfirmDialog, type ConfirmDialogHandle } from "../../components/kit/ConfirmDialog";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { EmptyState } from "../../components/kit/EmptyState";
import { Field } from "../../components/kit/Field";
import { PageHeader } from "../../components/kit/PageHeader";
import { DetailSkeleton } from "../../components/kit/Skeleton";
import { Textarea } from "../../components/kit/Textarea";
import { Mono } from "../../components/mono";
import type { StatusTone } from "../../lib/status";
import { supabaseClient } from "../../providers/supabaseClient";

// Admin additions task (AT-4, AT-10): Venues detail. Shows the venue,
// its courts, and the partner's contact info (public.venues /
// public.courts / public.users, all admin readable per RLS). Approve/reject
// reuse the exact verification RPC pattern already shipped in
// verification/show.tsx (supabaseClient.rpc admin_approve_verification_request
// / admin_reject_verification_request from 0007_admin_verification_rpcs.sql,
// re-wired for the 'venue' branch by 0009_courts.sql): a venue's own pending
// verification_requests row (applicant_type='venue', applicant_id=venue.id,
// set by submit_venue_verification, 0009_courts.sql) is looked up here so
// the same admin RPCs can be called from this surface, not just from the
// Verification Queue tab.
type LoadState = "loading" | "error" | "ready" | "not_found";

// `lib/status.ts` (shared, not owned by this track) has no "verified" entry;
// same kit gap noted in list.tsx. Local mapping avoids editing the shared file.
function venueStatusTone(status: Db.VenueRow["status"]): StatusTone {
  if (status === "verified") return "success";
  if (status === "rejected") return "danger";
  return "warning";
}

function venueStatusLabel(status: Db.VenueRow["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function VenueShow() {
  const { id } = useParams<{ id: string }>();
  const { open } = useNotification();

  const [venue, setVenue] = useState<Db.VenueRow | null>(null);
  const [courts, setCourts] = useState<Db.CourtRow[]>([]);
  const [partner, setPartner] = useState<Pick<Db.UserRow, "id" | "name" | "phone"> | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const approveRef = useRef<ConfirmDialogHandle>(null);

  async function load() {
    if (!id) return;
    setState("loading");

    const { data: venueData, error: venueError } = await supabaseClient
      .from("venues")
      .select("id,partner_user_id,name,address,city,pincode,lat,lng,description,status,rejection_reason,booking_url,created_at,updated_at")
      .eq("id", id)
      .maybeSingle();

    if (venueError) {
      setState("error");
      return;
    }
    if (!venueData) {
      setState("not_found");
      return;
    }

    const venueRow = venueData as Db.VenueRow;
    setVenue(venueRow);

    const [{ data: courtRows }, { data: partnerData }, { data: requestRows }] = await Promise.all([
      supabaseClient
        .from("courts")
        .select("id,venue_id,sport,name,capacity,base_price_per_hour,active,created_at,updated_at")
        .eq("venue_id", venueRow.id)
        .order("created_at", { ascending: true }),
      supabaseClient.from("users").select("id,name,phone").eq("id", venueRow.partner_user_id).maybeSingle(),
      supabaseClient
        .from("verification_requests")
        .select("id")
        .eq("applicant_type", "venue")
        .eq("applicant_id", venueRow.id)
        .eq("status", "pending_review")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    setCourts((courtRows as Db.CourtRow[]) ?? []);
    setPartner((partnerData as Pick<Db.UserRow, "id" | "name" | "phone">) ?? null);
    setPendingRequestId(requestRows && requestRows.length > 0 ? (requestRows[0]?.id as string) : null);
    setState("ready");
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function onApprove() {
    if (!pendingRequestId) return;
    setSubmitting(true);
    setActionError(null);
    const { error } = await supabaseClient.rpc("admin_approve_verification_request", {
      p_request_id: pendingRequestId,
    });
    setSubmitting(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    open?.({ type: "success", message: "Venue approved." });
    approveRef.current?.close();
    await load();
  }

  async function onReject() {
    if (!pendingRequestId) return;
    if (rejectReason.trim().length === 0) {
      setActionError("A rejection reason is required.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    const { error } = await supabaseClient.rpc("admin_reject_verification_request", {
      p_request_id: pendingRequestId,
      p_reason: rejectReason.trim(),
    });
    setSubmitting(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    open?.({ type: "success", message: "Venue rejected." });
    setShowRejectForm(false);
    setRejectReason("");
    await load();
  }

  if (state === "loading") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Operations", to: "/venues" }, { label: "Venues" }]} title="Loading" />
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "not_found") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Operations", to: "/venues" }, { label: "Venues" }]} title="Not found" />
        <Card>
          <EmptyState title="Venue not found" body="This venue does not exist or was removed." />
        </Card>
      </div>
    );
  }

  if (state === "error" || !venue) {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Operations", to: "/venues" }, { label: "Venues" }]} title="Could not load" />
        <Card>
          <EmptyState title="Could not load this venue" body="Something went wrong reading this venue. Try again." />
        </Card>
      </div>
    );
  }

  const canAction = venue.status === "pending" && pendingRequestId !== null;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Operations", to: "/venues" }, { label: "Venues", to: "/venues" }]}
        title={venue.name}
        description={`${venue.address}, ${venue.city}, ${venue.pincode}`}
        secondaryActions={
          canAction && !showRejectForm ? (
            <>
              <Button variant="danger" disabled={submitting} onClick={() => setShowRejectForm(true)}>
                <X size={16} strokeWidth={1.75} />
                Reject
              </Button>
              <Button variant="primary" disabled={submitting} onClick={() => approveRef.current?.open()}>
                <Check size={16} strokeWidth={1.75} />
                Approve
              </Button>
            </>
          ) : undefined
        }
      />

      {actionError ? (
        <Card>
          <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: 0 }}>{actionError}</p>
        </Card>
      ) : null}

      {showRejectForm ? (
        <Card>
          <Field label="Rejection reason" error={actionError ?? undefined}>
            <Textarea value={rejectReason} onChange={setRejectReason} rows={3} placeholder="Why this venue is rejected" />
          </Field>
          <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
            <Button variant="danger" disabled={submitting} onClick={() => void onReject()}>
              Confirm reject
            </Button>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => {
                setShowRejectForm(false);
                setRejectReason("");
                setActionError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <DetailLayout
        main={
          <>
            <Card>
              <p style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: 0 }}>
                <MapPin size={14} strokeWidth={1.75} />
                {venue.address}, {venue.city}, {venue.pincode}
              </p>
              {venue.description ? (
                <p style={{ marginTop: "var(--space-md)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>{venue.description}</p>
              ) : null}
              {venue.booking_url ? (
                <p style={{ marginTop: "var(--space-sm)", fontSize: "var(--text-sm)" }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>Books externally at </span>
                  <a href={venue.booking_url} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>
                    {venue.booking_url}
                  </a>
                </p>
              ) : null}
              {venue.rejection_reason ? (
                <p style={{ marginTop: "var(--space-sm)", fontSize: "var(--text-sm)", color: "var(--color-danger)" }}>
                  Rejection reason: {venue.rejection_reason}
                </p>
              ) : null}
            </Card>

            <Card>
              <h3 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: "0 0 var(--space-md)" }}>Courts</h3>
              {courts.length === 0 ? (
                <EmptyState title="No courts on this venue" body="This venue has not added any courts yet." />
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Court", "Sport", "Capacity", "Price / hour", "State"].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            textAlign: heading === "Capacity" || heading === "Price / hour" ? "right" : "left",
                            padding: "var(--space-sm) var(--space-md)",
                            fontSize: "var(--text-xs)",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            color: "var(--color-text-tertiary)",
                            borderBottom: "1px solid var(--color-border)",
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {courts.map((court) => (
                      <tr key={court.id}>
                        <td style={{ padding: "var(--space-sm) var(--space-md)", fontSize: "var(--text-sm)", fontWeight: 600, borderBottom: "1px solid var(--color-border)" }}>
                          {court.name}
                        </td>
                        <td style={{ padding: "var(--space-sm) var(--space-md)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textTransform: "capitalize", borderBottom: "1px solid var(--color-border)" }}>
                          {court.sport}
                        </td>
                        <td style={{ padding: "var(--space-sm) var(--space-md)", textAlign: "right", borderBottom: "1px solid var(--color-border)" }}>
                          <Mono>{court.capacity ?? "Not set"}</Mono>
                        </td>
                        <td style={{ padding: "var(--space-sm) var(--space-md)", textAlign: "right", borderBottom: "1px solid var(--color-border)" }}>
                          <Mono>{formatINR(Number(court.base_price_per_hour))}</Mono>
                        </td>
                        <td style={{ padding: "var(--space-sm) var(--space-md)", borderBottom: "1px solid var(--color-border)" }}>
                          <Badge tone={court.active ? "success" : "neutral"}>{court.active ? "Active" : "Inactive"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        }
        side={
          <Card>
            <Field label="Status">
              <Badge tone={venueStatusTone(venue.status)}>{venueStatusLabel(venue.status)}</Badge>
            </Field>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-xs) 0", fontSize: "var(--text-sm)" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>Partner</span>
              <span>{partner?.name ?? venue.partner_user_id}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-xs) 0", fontSize: "var(--text-sm)" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>Contact</span>
              <span>{partner?.phone ?? "No phone on file"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-xs) 0", fontSize: "var(--text-sm)" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>Created</span>
              <span>{new Date(venue.created_at).toLocaleDateString()}</span>
            </div>
            {!canAction && venue.status === "pending" ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-md)" }}>
                This venue is pending, but no matching verification request was found. Check the Verification queue.
              </p>
            ) : null}
            {venue.status !== "pending" ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-md)" }}>
                This venue was already {venue.status}. Approve and reject are only available while a venue is pending.
              </p>
            ) : null}
          </Card>
        }
      />

      <ConfirmDialog
        ref={approveRef}
        title="Approve this venue"
        body="This venue becomes visible to athletes for"
        recordName={venue.name}
        confirmLabel="Approve"
        danger={false}
        onConfirm={() => void onApprove()}
        loading={submitting}
      />

    </div>
  );
}
