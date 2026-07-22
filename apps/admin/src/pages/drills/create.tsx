import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card } from "../../components/ui";
import { drillApi, type CommerceError, type DrillInput } from "./api";
import { DrillForm } from "./form";

// AT-133, PRD-04 FR-49. Create a drill through admin_upsert_drill (p_id null),
// which writes exactly one drill.create audit_log row in the same transaction.
// On success we land on the new drill's Edit screen so the admin can activate,
// deactivate or keep editing without a round trip to the list.

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

export function DrillCreate() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(input: DrillInput) {
    setBusy(true);
    setError(null);
    try {
      const created = await drillApi.upsertDrill({ ...input, id: null });
      navigate(`/drills/show/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
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

      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>New drill</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          A new drill is active and available to players as soon as you save it.
        </p>
      </div>

      {error ? (
        <Card style={{ borderColor: "var(--color-danger)", padding: "var(--space-md) var(--space-lg)" }}>
          <p style={{ fontSize: 14, color: "var(--color-danger)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}

      <Card>
        <DrillForm submitLabel="Create drill" busy={busy} onSubmit={submit} />
      </Card>
    </div>
  );
}
