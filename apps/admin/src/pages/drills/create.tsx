import { useNotification } from "@refinedev/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "../../components/kit/PageHeader";
import { drillApi, type CommerceError, type DrillInput } from "./api";
import { DrillForm } from "./form";

// AT-133, PRD-04 FR-49. Create a drill through admin_upsert_drill (p_id
// null), which writes exactly one drill.create audit_log row in the same
// transaction. On success, lands on the new drill's detail page so the
// admin can activate, deactivate or keep editing without a round trip.

export function DrillCreate() {
  const navigate = useNavigate();
  const { open } = useNotification();
  const [busy, setBusy] = useState(false);

  async function submit(input: DrillInput) {
    setBusy(true);
    try {
      const created = await drillApi.upsertDrill({ ...input, id: null });
      open?.({ type: "success", message: "Drill created." });
      navigate(`/drills/show/${created.id}`);
    } catch (err) {
      const e = err as CommerceError;
      open?.({ type: "error", message: e.code ?? "Could not create drill", description: e.message });
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Community", to: "/drills" }, { label: "Drills", to: "/drills" }]}
        title="Add drill"
        description="A new drill is active and available to players as soon as you save it."
      />
      <DrillForm submitLabel="Create drill" busy={busy} onSubmit={submit} />
    </div>
  );
}
