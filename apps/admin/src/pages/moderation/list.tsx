import { AlertTriangle, Film, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { supabaseClient } from "../../providers/supabaseClient";
import { clipStatusLabel, clipStatusTone } from "./status";
import type { ClipQueueRow } from "./api";

// AT-102, PRD-04 FR-27, FR-33. The Moderation Queue: every clip whose status is
// uploading, processing, or ready, showing creator, caption, sport, and upload
// date, with a distinct empty state when nothing is pending.
//
// PERMISSIVE-OR SCOPING (CLAUDE.md, PHASE-5-STATUS.md trap 2). `clips` carries a
// public `published` policy beside the admin read-all policy, so an unscoped
// select would also return every published clip. This query carries its OWN
// `.in('status', pending)` filter; RLS is the ceiling, the filter is the scope.
//
// No thumbnail image is shown in the list on purpose: the `clips` bucket is
// private and a thumbnail is only resolvable through the admin-only signed mint
// (FR-28), which the Detail screen does once per open. Minting one URL per list
// row would be wasteful, so the list uses a placeholder tile and the real
// preview lives on the Detail screen.

const PENDING_STATUSES = ["uploading", "processing", "ready"] as const;

type LoadState = "loading" | "error" | "ready";

export function ModerationList() {
  const navigate = useNavigate();
  const [clips, setClips] = useState<ClipQueueRow[]>([]);
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const { data, error } = await supabaseClient
        .from("clips")
        .select(
          "id,owner_id,status,caption,sport,thumb_path,rejection_reason,likes_count,comment_count,created_at",
        )
        .in("status", PENDING_STATUSES as unknown as string[])
        .order("created_at", { ascending: true });

      if (cancelled) return;
      if (error) {
        setState("error");
        return;
      }

      const rows = (data as ClipQueueRow[]) ?? [];
      setClips(rows);

      const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));
      if (ownerIds.length > 0) {
        const { data: users } = await supabaseClient.from("users").select("id,name").in("id", ownerIds);
        if (!cancelled && users) {
          setCreatorNames(Object.fromEntries(users.map((u) => [u.id, u.name as string])));
        }
      }

      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Moderation queue</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Clips awaiting review before they reach the feed. Approve to publish or reject with a reason.
        </p>
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>
            Loading queue...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load the queue"
            description="Something went wrong reading pending clips. Try again."
          />
        ) : clips.length === 0 ? (
          <EmptyState
            icon={<Film size={32} strokeWidth={1.75} />}
            title="Nothing to review"
            description="No clips are waiting for moderation right now."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Clip", "Creator", "Sport", "Uploaded", "Status"].map((heading) => (
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
              {clips.map((clip) => (
                <tr
                  key={clip.id}
                  onClick={() => navigate(`/moderation/show/${clip.id}`)}
                  style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 44,
                          height: 44,
                          flexShrink: 0,
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--color-surface-muted)",
                          color: "var(--color-text-tertiary)",
                        }}
                      >
                        <Video size={20} strokeWidth={1.75} />
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{clip.caption}</span>
                    </div>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {creatorNames[clip.owner_id] ?? clip.owner_id}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {clip.sport}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {new Date(clip.created_at).toLocaleDateString()}
                    </Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone={clipStatusTone(clip.status)}>{clipStatusLabel(clip.status)}</Badge>
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
