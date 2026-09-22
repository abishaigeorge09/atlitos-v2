import { useNotification } from "@refinedev/core";
import { Check, Heart, MessageCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { EmptyState } from "../../components/kit/EmptyState";
import { Field } from "../../components/kit/Field";
import { PageHeader } from "../../components/kit/PageHeader";
import { DetailSkeleton } from "../../components/kit/Skeleton";
import { Textarea } from "../../components/kit/Textarea";
import { Mono } from "../../components/mono";
import { supabaseClient } from "../../providers/supabaseClient";
import {
  fetchModerationUrl,
  moderationApi,
  type ClipQueueRow,
  type CommerceError,
  type ModerationUrl,
} from "./api";
import { clipStatusLabel, clipStatusTone } from "./status";
import "./moderation.css";

// AT-102, PRD-04 FR-28, FR-29, FR-30, FR-53. Moderation Detail: inline preview
// through the admin-only signed URL grant, approve to publish, reject with a
// required reason. Both actions route through the moderate_clip RPC (Track A),
// which writes the audit_log row; this screen never sets clips.status itself.
//
// The reject action is a named, two step confirm (Reject reveals a required
// reason field, then Confirm reject submits) rather than the kit's
// ConfirmDialog, because that dialog has no slot for the reason textarea and
// is a shared file this track does not edit; the reveal step is the confirm.
//
// The preview is the admin-only mint `get-clip-moderation-url` (Track B), NOT a
// public URL and NOT the stored path (the bucket is private). Fixture clips
// carry placeholder bytes, so the player may not actually play; what this
// screen proves is that the URL is minted and gated correctly and that the
// transition plus audit write happen.
//
// Only a `ready` clip can be approved (the machine allows ready to published
// only); a clip in uploading or processing can still be rejected.

type LoadState = "loading" | "error" | "ready" | "not_found";

const PENDING = new Set(["uploading", "processing", "ready"]);

export function ModerationShow() {
  const { id } = useParams<{ id: string }>();
  const { open } = useNotification();

  const [clip, setClip] = useState<ClipQueueRow | null>(null);
  const [creator, setCreator] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [preview, setPreview] = useState<ModerationUrl | null>(null);
  const [previewError, setPreviewError] = useState<CommerceError | null>(null);

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectReasonError, setRejectReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    try {
      await moderationApi.approveClip(clip.id);
      open?.({
        type: "success",
        message: "Clip approved and published to the feed.",
      });
      await load();
    } catch (err) {
      const e = err as CommerceError;
      open?.({ type: "error", message: e.code, description: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    if (!clip) return;
    if (rejectReason.trim().length === 0) {
      setRejectReasonError("A rejection reason is required.");
      return;
    }
    setRejectReasonError(null);
    setBusy(true);
    try {
      await moderationApi.rejectClip(clip.id, rejectReason.trim());
      open?.({
        type: "success",
        message: "Clip rejected. The creator has been notified with the reason.",
      });
      setShowRejectForm(false);
      setRejectReason("");
      await load();
    } catch (err) {
      const e = err as CommerceError;
      open?.({ type: "error", message: e.code, description: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Community", to: "/moderation" }, { label: "Moderation" }]} title="Loading clip" />
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "not_found" || state === "error" || !clip) {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Community", to: "/moderation" }, { label: "Moderation" }]} title="Clip" />
        <Card>
          <EmptyState
            title={state === "not_found" ? "Clip not found" : "Could not load this clip"}
            body={
              state === "not_found"
                ? "This clip does not exist or was removed."
                : "Something went wrong reading this clip. Try again."
            }
          />
        </Card>
      </div>
    );
  }

  const isPending = PENDING.has(clip.status);
  const canApprove = clip.status === "ready";

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Community", to: "/moderation" }, { label: "Moderation", to: "/moderation" }]}
        title={clip.caption}
        description={`${clip.sport}, submitted by ${creator ?? clip.owner_id}`}
      />

      <DetailLayout
        main={
          <>
            <Card>
              <p className="ak-mod-eyebrow">Preview</p>
              {preview ? (
                <div>
                  <video
                    src={preview.url}
                    poster={preview.thumbUrl ?? undefined}
                    controls
                    playsInline
                    className="ak-mod-preview-video"
                  />
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-sm)" }}>
                    Signed preview link, expires in <Mono>{preview.expiresIn}</Mono> seconds. Fixture clips carry
                    placeholder video, so the player may show nothing. The link being minted and gated is the proof.
                  </p>
                </div>
              ) : previewError ? (
                <div className="ak-mod-error-box">
                  <Mono style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", color: "var(--color-danger-ink)" }}>
                    {previewError.code}
                  </Mono>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-danger-ink)", margin: "var(--space-xs) 0 0" }}>
                    {clip.status === "removed" || clip.status === "rejected"
                      ? "This clip is terminal, so the preview link is refused by design."
                      : previewError.message}
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Minting preview link...</p>
              )}
            </Card>

            {clip.rejection_reason ? (
              <Card>
                <p className="ak-mod-eyebrow">Rejection reason</p>
                <p style={{ fontSize: "var(--text-sm)", margin: "var(--space-xs) 0 0" }}>{clip.rejection_reason}</p>
              </Card>
            ) : null}
          </>
        }
        side={
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="ak-mod-eyebrow">Status</p>
              <Badge tone={clipStatusTone(clip.status)}>{clipStatusLabel(clip.status)}</Badge>
            </div>

            <div className="ak-mod-meta-row" style={{ flexDirection: "column", gap: "var(--space-sm)" }}>
              <span className="ak-mod-meta-item">
                <Heart size={14} strokeWidth={1.75} /> <Mono>{clip.likes_count}</Mono> likes
              </span>
              <span className="ak-mod-meta-item">
                <MessageCircle size={14} strokeWidth={1.75} /> <Mono>{clip.comment_count}</Mono> comments
              </span>
              <span className="ak-mod-meta-item">
                Submitted <Mono>{new Date(clip.created_at).toLocaleString()}</Mono>
              </span>
            </div>

            {isPending ? (
              !showRejectForm ? (
                <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-lg)" }}>
                  {canApprove ? (
                    <Button variant="primary" onClick={onApprove} disabled={busy}>
                      <Check size={16} strokeWidth={1.75} />
                      Approve and publish
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    onClick={() => {
                      setRejectReason("");
                      setRejectReasonError(null);
                      setShowRejectForm(true);
                    }}
                    disabled={busy}
                  >
                    <X size={16} strokeWidth={1.75} />
                    Reject
                  </Button>
                </div>
              ) : (
                <div className="ak-mod-reject-stack" style={{ marginTop: "var(--space-lg)" }}>
                  <Field label="Rejection reason, required" error={rejectReasonError ?? undefined}>
                    <Textarea value={rejectReason} onChange={setRejectReason} placeholder="Sent to the creator" />
                  </Field>
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
                    Rejecting <strong>{clip.caption}</strong>. The reason is sent to the creator and recorded in
                    the audit log.
                  </p>
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <Button variant="danger" onClick={onReject} disabled={busy}>
                      Confirm reject
                    </Button>
                    <Button variant="secondary" onClick={() => setShowRejectForm(false)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-lg)" }}>
                This clip is {clipStatusLabel(clip.status).toLowerCase()}. Approve and reject are only available
                while a clip is awaiting review.
              </p>
            )}
          </Card>
        }
      />
    </div>
  );
}
