import type { Db } from "@atlitos/types";
import { AlertTriangle, ArrowLeft, Check, MapPin, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
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

function statusTone(status: Db.VenueRow["status"]): "neutral" | "success" | "warning" | "danger" {
  if (status === "verified") return "success";
  if (status === "rejected") return "danger";
  return "warning";
}

export function VenueShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [venue, setVenue] = useState<Db.VenueRow | null>(null);
  const [courts, setCourts] = useState<Db.CourtRow[]>([]);
  const [partner, setPartner] = useState<Pick<Db.UserRow, "id" | "name" | "phone"> | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!id) return;
    setState("loading");

    const { data: venueData, error: venueError } = await supabaseClient
      .from("venues")
      .select("id,partner_user_id,name,address,city,pincode,lat,lng,description,status,rejection_reason,created_at,updated_at")
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
    setShowRejectForm(false);
    setRejectReason("");
    await load();
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading venue...</div>;
  }

  if (state === "not_found") {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Venue not found"
          description="This venue does not exist or was removed."
        />
      </Card>
    );
  }

  if (state === "error" || !venue) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Could not load this venue"
          description="Something went wrong reading this venue. Try again."
        />
      </Card>
    );
  }

  const canAction = venue.status === "pending" && pendingRequestId !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 720 }}>
      <button
        type="button"
        onClick={() => navigate("/venues")}
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
        Back to venues
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
              Venue
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>{venue.name}</h1>
            <p
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-xs)",
                fontSize: 14,
                color: "var(--color-text-secondary)",
                margin: "var(--space-xs) 0 0",
              }}
            >
              <MapPin size={14} strokeWidth={1.75} />
              {venue.address}, {venue.city}, {venue.pincode}
            </p>
          </div>
          <Badge tone={statusTone(venue.status)}>{venue.status}</Badge>
        </div>

        {venue.description ? (
          <p style={{ marginTop: "var(--space-md)", fontSize: 14, color: "var(--color-text-secondary)" }}>
            {venue.description}
          </p>
        ) : null}

        <div
          style={{
            marginTop: "var(--space-lg)",
            paddingTop: "var(--space-lg)",
            borderTop: "1px solid var(--color-border)",
            display: "grid",
            gridTemplateColumns: "160px 1fr",
            rowGap: "var(--space-sm)",
            fontSize: 14,
          }}
        >
          <span style={{ color: "var(--color-text-secondary)" }}>Partner</span>
          <span style={{ fontWeight: 600 }}>{partner?.name ?? venue.partner_user_id}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>Partner contact</span>
          <span>{partner?.phone ?? "No phone on file"}</span>
          {venue.rejection_reason ? (
            <>
              <span style={{ color: "var(--color-text-secondary)" }}>Rejection reason</span>
              <span>{venue.rejection_reason}</span>
            </>
          ) : null}
        </div>
      </Card>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-lg) var(--space-lg) 0" }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", margin: 0 }}>
            Courts
          </p>
        </div>
        {courts.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="No courts on this venue"
            description="This venue has not added any courts yet."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "var(--space-sm)" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Court", "Sport", "Capacity", "Base price / hour", "Active"].map((heading) => (
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
              {courts.map((court) => (
                <tr key={court.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                    {court.name}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)", textTransform: "capitalize" }}>
                    {court.sport}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                    {court.capacity ?? "Not set"}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                    Rs {Number(court.base_price_per_hour).toFixed(2)}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone={court.active ? "success" : "neutral"}>{court.active ? "active" : "inactive"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canAction ? (
        <Card>
          {actionError ? (
            <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "0 0 var(--space-md)" }}>{actionError}</p>
          ) : null}

          {!showRejectForm ? (
            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              <Button onClick={onApprove} disabled={submitting}>
                <Check size={16} strokeWidth={1.75} />
                Approve venue
              </Button>
              <Button variant="destructive" onClick={() => setShowRejectForm(true)} disabled={submitting}>
                <X size={16} strokeWidth={1.75} />
                Reject venue
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
      ) : venue.status === "pending" ? (
        <Card>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
            This venue is pending, but no matching verification request was found. Check the Verification queue.
          </p>
        </Card>
      ) : (
        <Card>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
            This venue was already {venue.status}. Approve and reject are only available while a venue is pending.
          </p>
        </Card>
      )}
    </div>
  );
}
