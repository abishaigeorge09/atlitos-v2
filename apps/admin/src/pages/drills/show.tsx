import { useNotification } from "@refinedev/core";
import type { Db } from "@atlitos/types";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { EmptyState } from "../../components/kit/EmptyState";
import { DetailSkeleton } from "../../components/kit/Skeleton";
import { PageHeader } from "../../components/kit/PageHeader";
import { Mono } from "../../components/mono";
import { drillApi, fetchDrill, type CommerceError, type DrillInput } from "./api";
import { DrillForm } from "./form";

// AT-133, PRD-04 FR-50 (edit) and FR-51 (activate/deactivate). Every
// mutation goes through a 0061 admin RPC, never a direct table write,
// because each needs an audit_log row the client has no grant to write.
// Editing content and flipping active are two separate audited actions: the
// form calls admin_upsert_drill (drill.update), the toggle calls
// admin_set_drill_active (drill.activate / drill.deactivate).

type LoadState = "loading" | "error" | "ready" | "not_found";
type DrillRow = Db.DrillRow;

export function DrillShow() {
  const { id } = useParams<{ id: string }>();
  const { open } = useNotification();

  const [drill, setDrill] = useState<DrillRow | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    setState("loading");
    try {
      const row = await fetchDrill(id);
      if (!row) {
        setState("not_found");
        return;
      }
      setDrill(row);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      open?.({ type: "success", message: successMessage });
      await load();
    } catch (err) {
      const e = err as CommerceError;
      open?.({ type: "error", message: e.code ?? "Something went wrong", description: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Community", to: "/drills" }, { label: "Drills" }]} title="Loading drill" />
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "not_found" || state === "error" || !drill) {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Community", to: "/drills" }, { label: "Drills" }]} title="Drill" />
        <Card>
          <EmptyState
            title={state === "not_found" ? "Drill not found" : "Could not load this drill"}
            body={
              state === "not_found"
                ? "This drill does not exist or was removed."
                : "Something went wrong reading this drill. Try again."
            }
          />
        </Card>
      </div>
    );
  }

  function saveDrill(input: DrillInput) {
    void run(() => drillApi.upsertDrill({ ...input, id: drill!.id }), "Drill saved.");
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Community", to: "/drills" }, { label: "Drills", to: "/drills" }]}
        title={drill.title}
        description={`Worth ${drill.xp_value} XP on completion.`}
      />

      <DetailLayout
        main={
          <DrillForm
            key={drill.updated_at}
            initial={{
              title: drill.title,
              description: drill.description,
              sport: drill.sport,
              skillCategory: drill.skill_category,
              difficulty: drill.difficulty,
              xpValue: drill.xp_value,
              mediaUrl: drill.media_url,
            }}
            submitLabel="Save drill"
            busy={busy}
            onSubmit={saveDrill}
          />
        }
        side={
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary)" }}>
                State
              </span>
              <Badge tone={drill.active ? "success" : "neutral"}>{drill.active ? "active" : "inactive"}</Badge>
            </div>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-sm)" }}>
              XP value <Mono style={{ fontWeight: "var(--weight-semibold)" }}>{drill.xp_value}</Mono>
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              style={{ marginTop: "var(--space-lg)", width: "100%" }}
              onClick={() =>
                run(
                  () => drillApi.setDrillActive(drill.id, !drill.active),
                  drill.active ? "Drill hidden from players." : "Drill restored and visible to players.",
                )
              }
            >
              {drill.active ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              {drill.active ? "Deactivate" : "Activate"}
            </Button>
          </Card>
        }
      />
    </div>
  );
}
