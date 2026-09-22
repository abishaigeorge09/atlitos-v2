import { useNotification } from "@refinedev/core";
import type { Db } from "@atlitos/types";
import { Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { ConfirmDialog, type ConfirmDialogHandle } from "../../components/kit/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { Field } from "../../components/kit/Field";
import { Input } from "../../components/kit/Input";
import { PageHeader } from "../../components/kit/PageHeader";
import { Mono } from "../../components/mono";
import { supabaseClient } from "../../providers/supabaseClient";
import "./fee-config.css";

// Admin additions task (AT-10, AT-11): Fee Config Editor (PRD-04 3.4, FR-39
// through FR-41). Reads public.fee_config (RLS: fee_config_select_authenticated,
// every authenticated role reads all rows) grouped by domain. Editing calls
// the admin_update_fee_config RPC (0013_admin_courts_bookings.sql), which
// re-validates the FR-41 range rule server side and writes exactly one
// audit_log row with before/after values, admin only, never a direct client
// update (fee_config's own RLS would in fact allow that, but it cannot also
// write audit_log, see the RPC's own header comment).
//
// fee_config.value is a raw fraction for 'percentage' rows (0.10 = 10
// percent) and a rupee amount for 'flat' rows. This page shows/edits
// percentage rows as a human percent (value * 100) and converts back to the
// fraction on save; flat rows show and edit as a plain rupee amount.
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
  if (row.value_type === "percentage") return `${(value * 100).toFixed(2)}%`;
  return `Rs ${value.toFixed(2)}`;
}

function toEditableString(row: FeeConfigRow): string {
  const value = Number(row.value);
  if (row.value_type === "percentage") return (value * 100).toFixed(2);
  return value.toFixed(2);
}

export function FeeConfigList() {
  const { open } = useNotification();
  const [rows, setRows] = useState<FeeConfigRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const [editingRow, setEditingRow] = useState<FeeConfigRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editNote, setEditNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<ConfirmDialogHandle>(null);

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
    setEditingRow(row);
    setEditValue(toEditableString(row));
    setEditNote("");
    setValidationError(null);
  }

  function validateAndOpen() {
    if (!editingRow) return;
    const parsed = Number(editValue);
    if (Number.isNaN(parsed)) {
      setValidationError("Enter a valid number.");
      return;
    }
    if (editingRow.value_type === "percentage" && (parsed < 0 || parsed > 100)) {
      setValidationError("Percentage fields must be between 0 and 100.");
      return;
    }
    if (editingRow.value_type === "flat" && parsed < 0) {
      setValidationError("Flat fee fields must be non negative.");
      return;
    }
    if (editNote.trim().length === 0) {
      setValidationError("A change note is required.");
      return;
    }
    setValidationError(null);
    dialogRef.current?.open();
  }

  async function confirmSave() {
    if (!editingRow) return;
    const parsed = Number(editValue);
    const rawValue = editingRow.value_type === "percentage" ? parsed / 100 : parsed;

    setSubmitting(true);
    const { error } = await supabaseClient.rpc("admin_update_fee_config", {
      p_id: editingRow.id,
      p_value: rawValue,
      p_note: editNote.trim(),
    });
    setSubmitting(false);

    if (error) {
      open?.({ type: "error", message: "Could not save fee config", description: error.message });
      return;
    }

    open?.({ type: "success", message: `${editingRow.key} updated.` });
    dialogRef.current?.close();
    setEditingRow(null);
    await load();
  }

  const columns: DataTableColumn<FeeConfigRow>[] = [
    { key: "key", header: "Key", render: (row) => row.key },
    {
      key: "type",
      header: "Type",
      render: (row) => <Badge tone="neutral">{row.value_type === "percentage" ? "percent" : "flat, rupees"}</Badge>,
    },
    { key: "value", header: "Value", numeric: true, render: (row) => displayValue(row) },
    {
      key: "edit",
      header: "",
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => startEdit(row)}>
          <Pencil size={14} strokeWidth={1.75} />
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Settings" }]}
        title="Fee config"
        description="Platform fees and rates, grouped by domain. Edits apply only to bookings, sessions, and orders created after the change."
      />

      {state === "loading" ? (
        <Card>
          <div style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-sm)" }}>Loading fee config...</div>
        </Card>
      ) : state === "error" ? (
        <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyTitle="Could not load fee config" emptyBody="Something went wrong reading the fee_config table. Try again." />
      ) : rows.length === 0 ? (
        <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyTitle="No fee config rows" emptyBody="No fee configuration exists yet." />
      ) : (
        Array.from(grouped.entries()).map(([domain, domainRows]) => (
          <div key={domain} className="ak-fee-domain-group">
            <p className="ak-fee-domain-label">{domainLabel[domain]}</p>
            <DataTable columns={columns} rows={domainRows} rowKey={(row) => row.id} />
          </div>
        ))
      )}

      {editingRow ? (
        <Card className="ak-fee-edit-card">
          <p className="ak-fee-domain-label" style={{ marginBottom: "var(--space-md)" }}>
            Editing {editingRow.key} ({domainLabel[editingRow.domain]})
          </p>
          <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ width: 200 }}>
              <Field label={editingRow.value_type === "percentage" ? "Value, percent (0 to 100)" : "Value, rupees"}>
                <Input value={editValue} onChange={setEditValue} mono />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Field label="Change note, required">
                <Input value={editNote} onChange={setEditNote} placeholder="Why is this changing" />
              </Field>
            </div>
          </div>
          {validationError ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-danger)", margin: "var(--space-sm) 0 0" }}>{validationError}</p>
          ) : null}
          <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
            <Button variant="primary" onClick={validateAndOpen}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditingRow(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        ref={dialogRef}
        title="Update this fee config value"
        body="Applies to bookings, sessions and orders created after this change. This is recorded in the audit log, for"
        recordName={editingRow ? `${editingRow.key}, ${displayValue(editingRow)} to ${editingRow.value_type === "percentage" ? `${editValue}%` : `Rs ${editValue}`}` : undefined}
        confirmLabel="Confirm update"
        cancelLabel="Cancel"
        danger={false}
        loading={submitting}
        onConfirm={confirmSave}
      />
    </div>
  );
}
