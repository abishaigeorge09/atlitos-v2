import { AlertTriangle, ArrowLeft, Check, CircleCheck, Heart, MessageCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import {
  fetchModerationUrl,
  moderationApi,
  type ClipQueueRow,
  type CommerceError,
  type ModerationUrl,
} from "./api";
import { clipStatusLabel, clipStatusTone } from "./status";
import { supabaseClient } from "../../providers/supabaseClient";

// AT-102, PRD-04 FR-28, FR-29, FR-30, FR-53. Moderation Detail: inline preview
// through the admin-only signed URL grant, approve to publish, reject with a
// required reason. Both actions route through the moderate_clip RPC (Track A),
// which writes the audit_log row; this screen never sets clips.status itself.
//
// The preview is the admin-only mint `get-clip-moderation-url` (Track B), NOT a
// public URL and NOT the stored path (the bucket is private). NOTE: fixture
// clips carry placeholder bytes, so the player may not actually play; what this
// screen proves is that the URL is minted and gated correctly and that the
// transition plus audit write happen.
//
// Only a `ready` clip can be approved (the machine allows ready to published
// only); a clip in uploading or processing can still be rejected. Approve is
// therefore shown only for `ready`, and the RPC is the authority regardless: an
// illegal edge comes back as INVALID_TRANSITION and is shown verbatim.

type LoadState = "loading" | "error" | "ready" | "not_found";

const PENDING = new Set(["uploading", "processing", "ready"]);

export function ModerationShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [clip, setClip] = useState<ClipQueueRow | null>(null);
  const [creator, setCreator] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [preview, setPreview] = useState<ModerationUrl | null>(null);
  const [previewError, setPreviewError] = useState<CommerceError | null>(null);

  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<CommerceError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    setState("loading");

    const { data, error } = await supabaseClient
      .from("clips")
      .select(
        "id,owner_id,status,caption,sport,thumb_path,rejection_reason,likes_count,comment_count,created_at",
      )
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

    const row = data as ClipQueueRow;
    setClip(row);

    const { data: user } = await supabaseClient.from("users").select("name").eq("id", row.owner_id).maybeSingle();
    setCreator((user as { name: string } | null)?.name ?? null);
    setState("ready");

    // Mint the admin-only preview. removed/rejected clips refuse the mint by
    // design (the takedown's teeth), so only attempt it for a live clip.
    setPreview(null);
    setPreviewError(null);
    if (row.status !== "removed" && row.status !== "rejected") {
      try {
        const minted = await fetchModerationUrl(row.id);
        setPreview(minted);
      } catch (err) {
        setPreviewError(err as CommerceError);
      }
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function onApprove() {
    if (!clip) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await moderationApi.approveClip(clip.id);
      setNotice("Clip approved and published to the feed.");
      await load();
    } catch (err) {
      setActionError(err as CommerceError);
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    if (!clip) return;
    if (rejectReason.trim().length === 0) {
      setActionError({ code: "VALIDATION", message: "A rejection reason is required." });
      return;
    }
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await moderationApi.rejectClip(clip.id, rejectReason.trim());
      setNotice("Clip rejected. The creator has been notified with the reason.");
      setShowRejectForm(false);
      setRejectReason("");
      await load();
    } catch (err) {
      setActionError(err as CommerceError);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading clip...</div>;
  }

  if (state === "not_found") {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Clip not found"
          description="This clip does not exist or was removed."
        />
      </Card>
    );
  }

  if (state === "error" || !clip) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Could not load this clip"
          description="Something went wrong reading this clip. Try again."
        />
      </Card>
    );
  }

  const isPending = PENDING.has(clip.status);
  const canApprove = clip.status === "ready";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 640 }}>
      <button
        type="button"
        onClick={() => navigate("/moderation")}
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
              {clip.sport} clip
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>{clip.caption}</h1>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
              {creator ?? clip.owner_id}
            </p>
          </div>
          <Badge tone={clipStatusTone(clip.status)}>{clipStatusLabel(clip.status)}</Badge>
        </div>

        <div style={{ display: "flex", gap: "var(--space-lg)", marginTop: "var(--space-md)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", fontSize: 13, color: "var(--color-text-secondary)" }}>
            <Heart size={14} strokeWidth={1.75} />
            <Mono>{clip.likes_count}</Mono>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", fontSize: 13, color: "var(--color-text-secondary)" }}>
            <MessageCircle size={14} strokeWidth={1.75} />
            <Mono>{clip.comment_count}</Mono>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", fontSize: 13, color: "var(--color-text-secondary)" }}>
            Uploaded <Mono>{new Date(clip.created_at).toLocaleString()}</Mono>
          </span>
        </div>
      </Card>

      {/* FR-28 inline preview through the admin-only signed URL grant */}
      <Card>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
            margin: "0 0 var(--space-md)",
          }}
        >
          Preview
        </p>

        {preview ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <video
              src={preview.url}
              poster={preview.thumbUrl ?? undefined}
              controls
              playsInline
              style={{
                width: "100%",
                maxHeight: 420,
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--color-surface-muted)",
              }}
            />
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
              Signed preview link, expires in <Mono>{preview.expiresIn}</Mono> seconds. Fixture clips carry
              placeholder video, so the player may show nothing. The link being minted and gated is the proof.
            </p>
          </div>
        ) : previewError ? (
          <div
            style={{
              padding: "var(--space-md)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              backgroundColor: "var(--color-surface-muted)",
            }}
          >
            <Mono style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
              {previewError.code}
            </Mono>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
              {clip.status === "removed" || clip.status === "rejected"
                ? "This clip is terminal, so the preview link is refused by design."
                : previewError.message}
            </p>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>Minting preview link...</p>
        )}
      </Card>

      {clip.rejection_reason ? (
        <Card>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
              margin: "0 0 var(--space-xs)",
            }}
          >
            Rejection reason
          </p>
          <p style={{ fontSize: 14, margin: 0 }}>{clip.rejection_reason}</p>
        </Card>
      ) : null}

      {/* FR-29, FR-30 approve / reject */}
      {isPending ? (
        <Card>
          {actionError ? (
            <div
              style={{
                padding: "var(--space-md)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-danger)",
                backgroundColor: "var(--color-danger-tint)",
                marginBottom: "var(--space-md)",
              }}
            >
              <Mono style={{ fontSize: 12, fontWeight: 600, color: "var(--color-danger)" }}>{actionError.code}</Mono>
              <p style={{ fontSize: 14, color: "var(--color-danger)", margin: "var(--space-xs) 0 0" }}>
                {actionError.message}
              </p>
            </div>
          ) : null}

          {notice ? (
            <p
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-xs)",
                fontSize: 14,
                color: "var(--color-success)",
                margin: "0 0 var(--space-md)",
              }}
            >
              <CircleCheck size={16} strokeWidth={1.75} />
              {notice}
            </p>
          ) : null}

          {!showRejectForm ? (
            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              {canApprove ? (
                <Button onClick={onApprove} disabled={busy}>
                  <Check size={16} strokeWidth={1.75} />
                  Approve and publish
                </Button>
              ) : null}
              <Button variant="destructive" onClick={() => setShowRejectForm(true)} disabled={busy}>
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
                    fontFamily: "inherit",
                  }}
                />
              </label>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
                The reason is sent to the creator and recorded in the audit log.
              </p>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <Button variant="destructive" onClick={onReject} disabled={busy}>
                  Confirm reject
                </Button>
                <Button variant="secondary" onClick={() => setShowRejectForm(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
            This clip is {clipStatusLabel(clip.status).toLowerCase()}. Approve and reject are only available while a
            clip is awaiting review.
          </p>
        </Card>
      )}
    </div>
  );
}
