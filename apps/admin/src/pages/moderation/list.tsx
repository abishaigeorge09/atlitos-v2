import { Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Tabs } from "../../components/kit/Tabs";
import { relativeTime } from "../../lib/relative-time";
import { supabaseClient } from "../../providers/supabaseClient";
import type { ClipQueueRow } from "./api";
import { clipStatusLabel, clipStatusTone } from "./status";
import "./moderation.css";

// AT-102, PRD-04 FR-27, FR-33. The Moderation Queue: every clip whose status is
// uploading, processing, or ready, showing creator, caption, sport, and upload
// date, with a distinct empty state when nothing is pending.
//
// PERMISSIVE-OR SCOPING (CLAUDE.md, PHASE-5-STATUS.md trap 2). `clips` carries a
// public `published` policy beside the admin read-all policy, so an unscoped
// select would also return every published clip. This query carries its OWN
// `.in('status', pending)` filter; RLS is the ceiling, the filter is the scope.
//
// No thumbnail image is shown on purpose: the `clips` bucket is private and a
// thumbnail is only resolvable through the admin-only signed mint (FR-28),
// which the Detail screen does once per open. The list shows a placeholder
// tile instead of minting one URL per row.

const PENDING_STATUSES = ["uploading", "processing", "ready"] as const;

type StatusFilter = "all" | (typeof PENDING_STATUSES)[number];
type LoadState = "loading" | "error" | "ready";

export function ModerationList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("status") as StatusFilter | null) ?? "all";
  const [search, setSearch] = useState("");

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

  const tabbed = useMemo(
    () => clips.filter((c) => activeTab === "all" || c.status === activeTab),
    [clips, activeTab],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabbed;
    return tabbed.filter((c) => {
      const creator = (creatorNames[c.owner_id] ?? "").toLowerCase();
      return c.caption.toLowerCase().includes(q) || creator.includes(q);
    });
  }, [tabbed, search, creatorNames]);

  const columns: DataTableColumn<ClipQueueRow>[] = [
    {
      key: "thumb",
      header: "Clip",
      render: (row) => (
        <div className="ak-mod-clip-cell">
          <span className="ak-mod-thumb">
            <Video size={18} strokeWidth={1.75} />
          </span>
          <span className="ak-mod-caption">{row.caption}</span>
        </div>
      ),
    },
    { key: "creator", header: "Creator", render: (row) => creatorNames[row.owner_id] ?? row.owner_id },
    { key: "sport", header: "Sport", render: (row) => row.sport },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={clipStatusTone(row.status)}>{clipStatusLabel(row.status)}</Badge>,
    },
    { key: "submitted", header: "Submitted", render: (row) => relativeTime(row.created_at) },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Community" }]}
        title="Moderation queue"
        description="Clips awaiting review before they reach the feed. Approve to publish or reject with a reason."
      />

      <Tabs
        items={[
          { key: "all", label: "All", count: clips.length },
          ...PENDING_STATUSES.map((status) => ({
            key: status,
            label: clipStatusLabel(status),
            count: clips.filter((c) => c.status === status).length,
          })),
        ]}
        active={activeTab}
        onChange={(key) => setSearchParams(key === "all" ? {} : { status: key })}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by caption or creator"
        resultCount={filtered.length}
        resultNoun={filtered.length === 1 ? "clip" : "clips"}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        rowHref={(row) => `/moderation/show/${row.id}`}
        loading={state === "loading"}
        emptyTitle={state === "error" ? "Could not load the queue" : "Nothing to review"}
        emptyBody={
          state === "error"
            ? "Something went wrong reading pending clips. Try again."
            : "No clips are waiting for moderation right now."
        }
      />
    </div>
  );
}
