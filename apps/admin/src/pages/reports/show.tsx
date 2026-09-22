import { useNotification } from "@refinedev/core";
import { MessageCircleOff, Trash2, User, X } from "lucide-react";
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
import { fetchModerationUrl, moderationApi, type ClipQueueRow, type CommerceError, type ModerationUrl } from "../moderation/api";
import { clipStatusLabel, clipStatusTone, reportStatusLabel, reportStatusTone } from "../moderation/status";
import { supabaseClient } from "../../providers/supabaseClient";
import {
  entityTypeLabel,
  fetchReportedEntity,
  type ReportedChatMessage,
  type ReportedUser,
  type ReportQueueRow,
} from "./api";
import "./reports.css";

// AT-103, PRD-04 FR-31, FR-32, FR-53. Reports Detail: review the report and the
// content it targets, then resolve by takedown or dismissal, both with a
// required reason. Each action's final step is a kit ConfirmDialog naming the
// reported item, per this track's plan row; the reason is gathered first (an
// inline reveal, since ConfirmDialog has no slot for a textarea) and only the
// already-validated reason is carried into the dialog's onConfirm.
//
// Takedown routes through resolve_report's `remove` action, which reuses
// moderate_clip to set the clip `removed` and writes the audit_log row.
// Dismissal leaves the content untouched and only resolves the report row.
// This screen never sets a status itself; the RPC is the only write path.
//
// Phase 4 LAUNCH Track C (CT-C, 0097_report_block.sql): a chat_message report
// resolves through admin_get_reported_entity (the only read path onto a chat
// message's content, Settled decision 6) and its `remove` action soft-deletes
// the message. A user report's `remove` action resolves the report as
// actioned with no further mutation here; account enforcement is a separate,
// independently audited step from the User Detail screen.

type LoadState = "loading" | "error" | "ready" | "not_found";
type ResolveAction = "remove" | "dismiss";

export function ReportShow() {
  const { id } = useParams<{ id: string }>();
  const { open } = useNotification();

  const [report, setReport] = useState<ReportQueueRow | null>(null);
  const [reporter, setReporter] = useState<string | null>(null);
  const [clip, setClip] = useState<ClipQueueRow | null>(null);
  const [commentText, setCommentText] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState<ReportedChatMessage | null>(null);
  const [reportedUser, setReportedUser] = useState<ReportedUser | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [preview, setPreview] = useState<ModerationUrl | null>(null);

  const [action, setAction] = useState<ResolveAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<ConfirmDialogHandle>(null);

  async function load() {
    if (!id) return;
    setState("loading");

    const { data, error } = await supabaseClient
      .from("reports")
      .select("id,entity_type,entity_id,reporter_id,reason,status,resolved_by,resolved_at,created_at")
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

    const row = data as ReportQueueRow;
    setReport(row);

    const { data: user } = await supabaseClient.from("users").select("name").eq("id", row.reporter_id).maybeSingle();
    setReporter((user as { name: string } | null)?.name ?? null);

    setClip(null);
    setCommentText(null);
    setPreview(null);
    setChatMessage(null);
    setReportedUser(null);

    if (row.entity_type === "clip") {
      const { data: clipRow } = await supabaseClient
        .from("clips")
        .select("id,owner_id,status,caption,sport,thumb_path,rejection_reason,likes_count,comment_count,created_at")
        .eq("id", row.entity_id)
        .maybeSingle();
      const c = (clipRow as ClipQueueRow | null) ?? null;
      setClip(c);
      if (c && c.status !== "removed" && c.status !== "rejected") {
        try {
          setPreview(await fetchModerationUrl(c.id));
        } catch {
          setPreview(null);
        }
      }
    } else if (row.entity_type === "comment") {
      const { data: comment } = await supabaseClient
        .from("clip_comments")
        .select("text")
        .eq("id", row.entity_id)
        .maybeSingle();
      setCommentText((comment as { text: string } | null)?.text ?? null);
    } else {
      try {
        const entity = await fetchReportedEntity(row.id);
        if (entity?.entity_type === "chat_message") setChatMessage(entity);
        else if (entity?.entity_type === "user") setReportedUser(entity);
      } catch {
        // Falls through to the "could not be loaded" branch below.
      }
    }

    setState("ready");
  }

  useEffect(() => {
    void load();
  }, [id]);

  function reportedItemName(): string {
    if (!report) return "";
    if (report.entity_type === "clip") return clip?.caption ?? report.entity_id;
    if (report.entity_type === "comment") return commentText ?? report.entity_id;
    if (report.entity_type === "chat_message") return chatMessage?.text ?? report.entity_id;
    return reportedUser?.name ?? report.entity_id;
  }

  function startAction(next: ResolveAction) {
    setAction(next);
    setReason("");
    setReasonError(null);
  }

  function continueToConfirm() {
    if (reason.trim().length === 0) {
      setReasonError("A reason is required to resolve a report.");
      return;
    }
    setReasonError(null);
    dialogRef.current?.open();
  }

  async function onConfirmResolve() {
    if (!report || !action) return;
    setBusy(true);
    try {
      if (action === "remove") {
        await moderationApi.removeReport(report.id, reason.trim());
        open?.({ type: "success", message: "Content taken down. The creator has been notified." });
      } else {
        await moderationApi.dismissReport(report.id, reason.trim());
        open?.({ type: "success", message: "Report dismissed. The content was left in place." });
      }
      dialogRef.current?.close();
      setAction(null);
      setReason("");
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
        <PageHeader breadcrumbs={[{ label: "Community", to: "/reports" }, { label: "Reports" }]} title="Loading report" />
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "not_found" || state === "error" || !report) {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Community", to: "/reports" }, { label: "Reports" }]} title="Report" />
        <Card>
          <EmptyState
            title={state === "not_found" ? "Report not found" : "Could not load this report"}
            body={
              state === "not_found"
                ? "This report does not exist or was removed."
                : "Something went wrong reading this report. Try again."
            }
          />
        </Card>
      </div>
    );
  }

  const isPending = report.status === "pending";

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Community", to: "/reports" }, { label: "Reports", to: "/reports" }]}
        title={report.reason}
        description={`Report on a ${entityTypeLabel[report.entity_type].toLowerCase()}, filed by ${reporter ?? report.reporter_id}`}
      />

      <DetailLayout
        main={
          <Card>
            <p className="ak-report-eyebrow">Reported content</p>

            {report.entity_type === "clip" ? (
              clip ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)" }}>
                    <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>{clip.caption}</span>
                    <Badge tone={clipStatusTone(clip.status)}>{clipStatusLabel(clip.status)}</Badge>
                  </div>
                  {preview ? (
                    <div style={{ marginTop: "var(--space-sm)" }}>
                      <video src={preview.url} poster={preview.thumbUrl ?? undefined} controls playsInline className="ak-report-preview-video" />
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-sm)" }}>
                        Signed preview link, expires in <Mono>{preview.expiresIn}</Mono> seconds. Fixture clips carry
                        placeholder video, so the player may show nothing.
                      </p>
                    </div>
                  ) : (
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-sm)" }}>
                      {clip.status === "removed" ? "This clip is already removed, so no preview link is minted." : "Preview link unavailable for this clip."}
                    </p>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  The reported clip could not be loaded. It may have been deleted.
                </p>
              )
            ) : report.entity_type === "comment" ? (
              commentText ? (
                <p style={{ fontSize: "var(--text-md)" }}>{commentText}</p>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  The reported comment could not be loaded. It may have been removed already.
                </p>
              )
            ) : report.entity_type === "chat_message" ? (
              chatMessage ? (
                <div>
                  <span className="ak-report-meta-row">
                    <MessageCircleOff size={14} strokeWidth={1.75} />
                    Thread <Mono>{chatMessage.thread_id}</Mono>, sender <Mono>{chatMessage.sender_id}</Mono>
                  </span>
                  {chatMessage.removed_at ? (
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-sm)" }}>
                      This message was already removed on <Mono>{new Date(chatMessage.removed_at).toLocaleString()}</Mono>.
                    </p>
                  ) : (
                    <p style={{ fontSize: "var(--text-md)", marginTop: "var(--space-sm)" }}>{chatMessage.text}</p>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  The reported message could not be loaded, or you do not have access to it.
                </p>
              )
            ) : reportedUser ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                <User size={18} strokeWidth={1.75} color="var(--color-text-tertiary)" />
                <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>{reportedUser.name}</span>
                <Mono style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>{reportedUser.id}</Mono>
              </div>
            ) : (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                The reported account could not be loaded. It may have been deleted.
              </p>
            )}

            {report.entity_type === "user" && reportedUser ? (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", marginTop: "var(--space-md)" }}>
                Resolving this report does not suspend the account. Account enforcement is a separate step.
              </p>
            ) : null}
          </Card>
        }
        side={
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="ak-report-eyebrow">Status</p>
              <Badge tone={reportStatusTone(report.status)}>{reportStatusLabel(report.status)}</Badge>
            </div>

            {isPending ? (
              action === null ? (
                <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-lg)" }}>
                  <Button variant="danger" onClick={() => startAction("remove")}>
                    <Trash2 size={16} strokeWidth={1.75} />
                    Take down
                  </Button>
                  <Button variant="secondary" onClick={() => startAction("dismiss")}>
                    <X size={16} strokeWidth={1.75} />
                    Dismiss report
                  </Button>
                </div>
              ) : (
                <div className="ak-report-resolve-stack" style={{ marginTop: "var(--space-lg)" }}>
                  <Field
                    label={action === "remove" ? "Takedown reason, required" : "Dismissal reason, required"}
                    error={reasonError ?? undefined}
                  >
                    <Textarea value={reason} onChange={setReason} />
                  </Field>
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <Button variant={action === "remove" ? "danger" : "primary"} onClick={continueToConfirm}>
                      Continue
                    </Button>
                    <Button variant="secondary" onClick={() => setAction(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-lg)" }}>
                This report was already resolved as {reportStatusLabel(report.status).toLowerCase()}
                {report.resolved_at ? <> on <Mono>{new Date(report.resolved_at).toLocaleString()}</Mono></> : null}.
              </p>
            )}
          </Card>
        }
      />

      <ConfirmDialog
        ref={dialogRef}
        title={action === "remove" ? "Take this content down" : "Dismiss this report"}
        body={
          action === "remove"
            ? "The content becomes unplayable or is removed at once, and this is recorded in the audit log, for"
            : "The content stays in place and this is recorded in the audit log, for"
        }
        recordName={reportedItemName()}
        confirmLabel={action === "remove" ? "Confirm takedown" : "Confirm dismissal"}
        cancelLabel="Cancel"
        danger={action === "remove"}
        loading={busy}
        onConfirm={onConfirmResolve}
      />
    </div>
  );
}
