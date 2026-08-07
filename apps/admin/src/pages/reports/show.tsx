import { AlertTriangle, ArrowLeft, CircleCheck, MessageCircleOff, Trash2, User, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
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

// AT-103, PRD-04 FR-31, FR-32, FR-53. Reports Detail: review the report and the
// content it targets, then resolve by takedown or dismissal, both with a
// required reason.
//
// Takedown routes through resolve_report's `remove` action, which reuses
// moderate_clip to set the clip `removed` and writes the audit_log row. A
// takedown makes the clip unplayable at once: playback is a fresh signed URL
// minted against the LIVE row (Track B), so the instant it is `removed` the
// public, owner, and moderation mints all refuse. Dismissal leaves the content
// untouched and only resolves the report row. This screen never sets a status
// itself; the RPC is the only write path (PRD-04 FR-26 analogue for clutch).
//
// Phase 4 LAUNCH Track C (CT-C, 0097_report_block.sql): a chat_message report
// resolves through admin_get_reported_entity (the only read path onto a chat
// message's content, Settled decision 6) and its `remove` action soft-deletes
// the message (removed_at/removed_reason) rather than reusing moderate_clip's
// takedown, which only knows about clips. A user report's `remove` action
// resolves the report as actioned with no further mutation here; account
// enforcement (suspend/ban) is Track B's separate admin_suspend_user action
// from the User Detail screen, intentionally a second, independently audited
// step (see 0097's header comment on resolve_report).

type LoadState = "loading" | "error" | "ready" | "not_found";
type ResolveAction = "remove" | "dismiss";

export function ReportShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<CommerceError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      // chat_message / user: the ONLY read path is admin_get_reported_entity
      // (0097, Settled decision 6). A refusal (non-admin, malformed report)
      // surfaces as the existing "could not be loaded" fallback below rather
      // than a screen-level error, same swallow-and-fallback shape the
      // clip/comment arms already use for a since-deleted row.
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

  async function onResolve() {
    if (!report || !action) return;
    if (reason.trim().length === 0) {
      setActionError({ code: "VALIDATION", message: "A reason is required to resolve a report." });
      return;
    }
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      if (action === "remove") {
        await moderationApi.removeReport(report.id, reason.trim());
        setNotice("Content taken down. It is no longer playable and the creator has been notified.");
      } else {
        await moderationApi.dismissReport(report.id, reason.trim());
        setNotice("Report dismissed. The content was left in place.");
      }
      setAction(null);
      setReason("");
      await load();
    } catch (err) {
      setActionError(err as CommerceError);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading report...</div>;
  }

  if (state === "not_found") {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Report not found"
          description="This report does not exist or was removed."
        />
      </Card>
    );
  }

  if (state === "error" || !report) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Could not load this report"
          description="Something went wrong reading this report. Try again."
        />
      </Card>
    );
  }

  const isPending = report.status === "pending";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 640 }}>
      <button
        type="button"
        onClick={() => navigate("/reports")}
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
              Report on a {entityTypeLabel[report.entity_type].toLowerCase()}
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>{report.reason}</h1>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
              Filed by {reporter ?? report.reporter_id} on{" "}
              <Mono>{new Date(report.created_at).toLocaleString()}</Mono>
            </p>
          </div>
          <Badge tone={reportStatusTone(report.status)}>{reportStatusLabel(report.status)}</Badge>
        </div>
      </Card>

      {/* The reported content */}
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
          Reported content
        </p>

        {report.entity_type === "clip" ? (
          clip ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)" }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{clip.caption}</span>
                <Badge tone={clipStatusTone(clip.status)}>{clipStatusLabel(clip.status)}</Badge>
              </div>
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
                    placeholder video, so the player may show nothing.
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
                  {clip.status === "removed"
                    ? "This clip is already removed, so no preview link is minted."
                    : "Preview link unavailable for this clip."}
                </p>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
              The reported clip could not be loaded. It may have been deleted.
            </p>
          )
        ) : report.entity_type === "comment" ? (
          commentText ? (
            <p style={{ fontSize: 15, margin: 0 }}>{commentText}</p>
          ) : (
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
              The reported comment could not be loaded. It may have been removed already.
            </p>
          )
        ) : report.entity_type === "chat_message" ? (
          chatMessage ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", color: "var(--color-text-tertiary)" }}>
                <MessageCircleOff size={14} strokeWidth={1.75} />
                <span style={{ fontSize: 12 }}>
                  Thread <Mono>{chatMessage.thread_id}</Mono>, sender <Mono>{chatMessage.sender_id}</Mono>
                </span>
              </div>
              {chatMessage.removed_at ? (
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
                  This message was already removed on{" "}
                  <Mono>{new Date(chatMessage.removed_at).toLocaleString()}</Mono>.
                </p>
              ) : (
                <p style={{ fontSize: 15, margin: 0 }}>{chatMessage.text}</p>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
              The reported message could not be loaded, or you do not have access to it.
            </p>
          )
        ) : reportedUser ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <User size={18} strokeWidth={1.75} color="var(--color-text-tertiary)" />
            <span style={{ fontSize: 15, fontWeight: 600 }}>{reportedUser.name}</span>
            <Mono style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{reportedUser.id}</Mono>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
            The reported account could not be loaded. It may have been deleted.
          </p>
        )}
      </Card>

      {report.entity_type === "user" && reportedUser ? (
        <Card>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
            Resolving this report does not suspend the account. Suspend or reinstate from the User Detail
            screen after reviewing this report.
          </p>
        </Card>
      ) : null}

      {/* FR-32 resolve: takedown or dismissal, both with a required reason */}
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

          {action === null ? (
            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              <Button variant="destructive" onClick={() => setAction("remove")} disabled={busy}>
                <Trash2 size={16} strokeWidth={1.75} />
                Take down
              </Button>
              <Button variant="secondary" onClick={() => setAction("dismiss")} disabled={busy}>
                <X size={16} strokeWidth={1.75} />
                Dismiss report
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {action === "remove" ? "Takedown reason, required" : "Dismissal reason, required"}
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
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
                {action === "remove"
                  ? report.entity_type === "clip"
                    ? "The clip becomes unplayable at once and the creator is notified. The reason is recorded in the audit log."
                    : report.entity_type === "chat_message"
                      ? "The message is replaced with a removed placeholder for every thread member. The reason is recorded in the audit log."
                      : report.entity_type === "user"
                        ? "The report is marked actioned. This does not suspend the account, that is a separate step from the User Detail screen. The reason is recorded in the audit log."
                        : "The comment is deleted. The reason is recorded in the audit log."
                  : "The content stays in place. The reason is recorded in the audit log."}
              </p>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <Button variant={action === "remove" ? "destructive" : "primary"} onClick={onResolve} disabled={busy}>
                  {action === "remove" ? "Confirm takedown" : "Confirm dismissal"}
                </Button>
                <Button variant="secondary" onClick={() => setAction(null)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
            This report was already resolved as {reportStatusLabel(report.status).toLowerCase()}
            {report.resolved_at ? (
              <>
                {" "}on <Mono>{new Date(report.resolved_at).toLocaleString()}</Mono>
              </>
            ) : null}
            . Resolution actions are only available while a report is pending.
          </p>
        </Card>
      )}
    </div>
  );
}
