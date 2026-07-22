import type { Db } from "@atlitos/types";
import { AlertTriangle, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { drillApi, fetchDrill, type CommerceError, type DrillInput } from "./api";
import { DrillForm } from "./form";

// AT-133, PRD-04 FR-50 (edit) and FR-51 (activate/deactivate). Every mutation
// goes through a 0061 admin RPC, never a direct table write, because each needs
// an audit_log row the client has no grant to write. Editing content and
// flipping active are two separate audited actions: the form calls
// admin_upsert_drill (drill.update), the toggle calls admin_set_drill_active
// (drill.activate / drill.deactivate).

type LoadState = "loading" | "error" | "ready" | "not_found";
type DrillRow = Db.DrillRow;

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

export function DrillShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [drill, setDrill] = useState<DrillRow | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function run(action: () => Promise<unknown>, successNotice: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successNotice);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading drill...</div>;
  }

  if (state === "not_found") {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Drill not found"
          description="This drill does not exist or was removed."
        />
      </Card>
    );
  }

  if (state === "error" || !drill) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Could not load this drill"
          description="Something went wrong reading this drill. Try again."
        />
      </Card>
    );
  }

  function saveDrill(input: DrillInput) {
    void run(() => drillApi.upsertDrill({ ...input, id: drill!.id }), "Drill saved.");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 720 }}>
      <button
        type="button"
        onClick={() => navigate("/drills")}
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
        Back to drills
      </button>

      {error ? (
        <Card style={{ borderColor: "var(--color-danger)", padding: "var(--space-md) var(--space-lg)" }}>
          <p style={{ fontSize: 14, color: "var(--color-danger)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}
      {notice ? (
        <Card style={{ borderColor: "var(--color-success)", padding: "var(--space-md) var(--space-lg)" }}>
          <p style={{ fontSize: 14, color: "var(--color-success)", margin: 0 }}>{notice}</p>
        </Card>
      ) : null}

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
              Drill
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>{drill.title}</h1>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
              Worth <Mono style={{ fontWeight: 600 }}>{drill.xp_value}</Mono> XP on completion.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <Badge tone={drill.active ? "success" : "neutral"}>
              {drill.active ? "active" : "inactive"}
            </Badge>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(
                  () => drillApi.setDrillActive(drill.id, !drill.active),
                  drill.active
                    ? "Drill hidden from players."
                    : "Drill restored and visible to players.",
                )
              }
            >
              {drill.active ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              {drill.active ? "Deactivate" : "Activate"}
            </Button>
          </div>
        </div>

        <div
          style={{
            marginTop: "var(--space-lg)",
            paddingTop: "var(--space-lg)",
            borderTop: "1px solid var(--color-border)",
          }}
        >
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
        </div>
      </Card>
    </div>
  );
}
