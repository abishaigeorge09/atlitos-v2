import type { Db } from "@atlitos/types";
import { AlertTriangle, Percent, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { supabaseClient } from "../../providers/supabaseClient";

// Admin additions task (AT-10, AT-11): Fee Config Editor (PRD-04 3.4,
// FR-39 through FR-41). Reads public.fee_config (RLS:
// fee_config_select_authenticated, every authenticated role reads all
// rows) grouped by domain. Editing calls the admin_update_fee_config RPC
// (0013_admin_courts_bookings.sql), which re-validates the FR-41 range
// rule server side and writes exactly one audit_log row with before/after
// values, admin only, never a direct client update (fee_config's own
// RLS would in fact allow that, but it cannot also write audit_log, see
// the RPC's own header comment).
//
// fee_config.value is a raw fraction for 'percentage' rows (0.10 = 10
// percent, matching the seed in 0010_payments_core.sql) and a rupee amount
// for 'flat' rows. This page shows/edits percentage rows as a human
// percent (value * 100) and converts back to the fraction on save, so the
// FR-41 "between 0 and 100" rule reads naturally on screen; flat rows show
// and edit as a plain rupee amount with 2 decimal places.
type FeeConfigRow = Db.FeeConfigRow;

type LoadState = "loading" | "error" | "ready";

const domainLabel: Record<FeeConfigRow["domain"], string> = {
  courts: "Courts",
  sessions: "Sessions",
  commerce: "Commerce",
  donations: "Donations",
};

function displayValue(row: FeeConfigRow): string {
  const value = Number(row.value);
  if (row.value_type === "percentage") return `${(value * 100).toFixed(2)} percent`;
  return `Rs ${value.toFixed(2)}`;
}

function toEditableString(row: FeeConfigRow): string {
  const value = Number(row.value);
  if (row.value_type === "percentage") return (value * 100).toFixed(2);
  return value.toFixed(2);
}

export function FeeConfigList() {
  const [rows, setRows] = useState<FeeConfigRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editNote, setEditNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setState("loading");
    const { data, error } = await supabaseClient
      .from("fee_config")
      .select("id,domain,key,value_type,value,effective_from,created_at")
      .order("domain", { ascending: true })
      .order("key", { ascending: true });

    if (error) {
      setState("error");
      return;
    }

    setRows((data as FeeConfigRow[]) ?? []);
    setState("ready");
  }

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map<FeeConfigRow["domain"], FeeConfigRow[]>();
    for (const row of rows) {
      const list = groups.get(row.domain) ?? [];
      list.push(row);
      groups.set(row.domain, list);
    }
    return groups;
  }, [rows]);

  function startEdit(row: FeeConfigRow) {
    setEditingId(row.id);
    setEditValue(toEditableString(row));
    setEditNote("");
    setValidationError(null);
    setActionError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
    setEditNote("");
    setValidationError(null);
  }

  async function saveEdit(row: FeeConfigRow) {
    setValidationError(null);
    setActionError(null);

    const parsed = Number(editValue);
    if (Number.isNaN(parsed)) {
      setValidationError("Enter a valid number.");
      return;
    }

    if (row.value_type === "percentage" && (parsed < 0 || parsed > 100)) {
      setValidationError("Percentage fields must be between 0 and 100.");
      return;
    }

    if (row.value_type === "flat" && parsed < 0) {
      setValidationError("Flat fee fields must be non negative.");
      return;
    }

    if (editNote.trim().length === 0) {
      setValidationError("A change note is required.");
      return;
    }

    const rawValue = row.value_type === "percentage" ? parsed / 100 : parsed;

    setSubmitting(true);
    const { error } = await supabaseClient.rpc("admin_update_fee_config", {
      p_id: row.id,
      p_value: rawValue,
      p_note: editNote.trim(),
    });
    setSubmitting(false);

    if (error) {
      setActionError(error.message);
      return;
    }

    cancelEdit();
    await load();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Fee config</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Platform fees and rates, grouped by domain. Edits apply only to bookings, sessions, and orders created
          after the change.
        </p>
      </div>

      {actionError ? (
        <p style={{ fontSize: 13, color: "var(--color-danger)", margin: 0 }}>{actionError}</p>
      ) : null}

      {state === "loading" ? (
        <Card>
          <div style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>Loading fee config...</div>
        </Card>
      ) : state === "error" ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load fee config"
            description="Something went wrong reading the fee_config table. Try again."
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Percent size={32} strokeWidth={1.75} />}
            title="No fee config rows"
            description="No fee configuration exists yet."
          />
        </Card>
      ) : (
        Array.from(grouped.entries()).map(([domain, domainRows]) => (
          <Card key={domain} style={{ padding: 0 }}>
            <div style={{ padding: "var(--space-lg) var(--space-lg) 0" }}>
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
                {domainLabel[domain]}
              </p>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "var(--space-sm)" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                  {["Key", "Type", "Value", ""].map((heading) => (
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
                {domainRows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                      {row.key}
                    </td>
                    <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                      <Badge>{row.value_type === "percentage" ? "percent" : "flat, rupees"}</Badge>
                    </td>
                    <td
                      style={{
                        padding: "var(--space-md) var(--space-lg)",
                        fontSize: 14,
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {editingId === row.id ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", maxWidth: 320 }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                            <span style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "var(--color-text-secondary)" }}>
                              {row.value_type === "percentage" ? "Value, percent (0 to 100)" : "Value, rupees"}
                            </span>
                            <input
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              inputMode="decimal"
                              style={{
                                padding: "var(--space-sm) var(--space-md)",
                                borderRadius: "var(--radius-sm)",
                                border: "1px solid var(--color-border)",
                                backgroundColor: "var(--color-surface-muted)",
                                color: "var(--color-text)",
                                fontSize: 14,
                                fontFamily: "JetBrains Mono, monospace",
                              }}
                            />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                            <span style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "var(--color-text-secondary)" }}>
                              Change note, required
                            </span>
                            <input
                              value={editNote}
                              onChange={(event) => setEditNote(event.target.value)}
                              placeholder="Why is this changing"
                              style={{
                                padding: "var(--space-sm) var(--space-md)",
                                borderRadius: "var(--radius-sm)",
                                border: "1px solid var(--color-border)",
                                backgroundColor: "var(--color-surface-muted)",
                                color: "var(--color-text)",
                                fontSize: 14,
                              }}
                            />
                          </label>
                          {validationError ? (
                            <p style={{ fontSize: 13, color: "var(--color-danger)", margin: 0 }}>{validationError}</p>
                          ) : null}
                          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                            <Button onClick={() => saveEdit(row)} disabled={submitting} style={{ fontFamily: "Inter, sans-serif" }}>
                              Save
                            </Button>
                            <Button variant="secondary" onClick={cancelEdit} disabled={submitting} style={{ fontFamily: "Inter, sans-serif" }}>
                              <X size={16} strokeWidth={1.75} />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        displayValue(row)
                      )}
                    </td>
                    <td style={{ padding: "var(--space-md) var(--space-lg)", textAlign: "right" }}>
                      {editingId !== row.id ? (
                        <Button variant="secondary" onClick={() => startEdit(row)}>
                          <Pencil size={16} strokeWidth={1.75} />
                          Edit
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </div>
  );
}
