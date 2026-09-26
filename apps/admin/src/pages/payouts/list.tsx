import { useNotification } from "@refinedev/core";
import { Banknote, CheckCircle2, Eye, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { ConfirmDialog, type ConfirmDialogHandle } from "../../components/kit/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { Field } from "../../components/kit/Field";
import { Input } from "../../components/kit/Input";
import { PageHeader } from "../../components/kit/PageHeader";
import { Tabs } from "../../components/kit/Tabs";
import type { StatusTone } from "../../lib/status";
import { supabaseClient } from "../../providers/supabaseClient";
import "./payouts.css";

// Manual payouts (docs/PLAN-PAYOUTS-CLICKS-SEARCH.md Track 1, migration 0130).
//
// Razorpay Route is closed to ELSHEPH, so an admin pays coaches and venues by
// NEFT or UPI and records the bank reference here. Every action is an RPC
// that authorises itself (has_role admin) and writes audit_log; this page
// never touches payout_methods, transfers or ledger_entries directly, and the
// tables would refuse it anyway.
//
// The full account number is shown only after "Reveal", which requires a
// reason and writes one audit row. It is held in component state for the
// review panel and dropped when the panel closes.

interface DueRow {
  payout_account_id: string | null;
  owner_type: "coach" | "court_partner";
  owner_id: string;
  owner_name: string | null;
  owner_phone: string | null;
  payout_status: string;
  method_type: "bank_account" | "upi" | null;
  verification_status: "missing" | "unverified" | "verified" | "rejected";
  account_number_last4: string | null;
  ifsc: string | null;
  vpa: string | null;
  has_pan: boolean | null;
  balance: number;
  eligible_balance: number;
  in_flight: number;
}

interface InFlightRow {
  id: string;
  amount: number;
  external_reference: string | null;
  created_at: string;
  payout_account_id: string;
  payee: string;
}

interface Revealed {
  method_type: string;
  account_holder_name: string;
  account_number: string | null;
  ifsc: string | null;
  vpa: string | null;
  pan: string | null;
}

type TabKey = "ready" | "details" | "in_flight";
type Panel =
  | { kind: "review"; row: DueRow }
  | { kind: "pay"; row: DueRow }
  | { kind: "resolve"; transfer: InFlightRow; outcome: "paid" | "failed" };

const rupees = (n: number) => `Rs ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const verificationTone: Record<DueRow["verification_status"], StatusTone> = {
  missing: "danger",
  unverified: "warning",
  rejected: "danger",
  verified: "success",
};

const verificationLabel: Record<DueRow["verification_status"], string> = {
  missing: "No details",
  unverified: "Needs review",
  rejected: "Rejected",
  verified: "Verified",
};

function MethodCell({ row }: { row: DueRow }) {
  if (!row.method_type) return <span className="ak-payout-sub">Not provided</span>;
  return (
    <div className="ak-payout-payee">
      <span>{row.method_type === "bank_account" ? `Bank ending ${row.account_number_last4 ?? ""}` : "UPI"}</span>
      <span className="ak-payout-sub ak-payout-mono">{row.method_type === "bank_account" ? row.ifsc : row.vpa}</span>
    </div>
  );
}

function methodSummary(row: DueRow): string {
  if (row.method_type === "bank_account") return `Bank ending ${row.account_number_last4 ?? ""}, ${row.ifsc ?? ""}`;
  if (row.method_type === "upi") return `UPI ${row.vpa ?? ""}`;
  return "Not provided";
}

export function PayoutsList() {
  const { open } = useNotification();
  const [tab, setTab] = useState<TabKey>("ready");
  const [due, setDue] = useState<DueRow[]>([]);
  const [inFlight, setInFlight] = useState<InFlightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [panel, setPanel] = useState<Panel | null>(null);
  const [revealReason, setRevealReason] = useState("");
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<ConfirmDialogHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The panel renders under the table, which can be long, so opening it must
  // bring it into view or the click looks like it did nothing.
  useEffect(() => {
    if (panel) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [panel]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const dueRes = await supabaseClient.rpc("admin_payouts_due", { p_min_amount: 1 });
    if (dueRes.error) {
      setLoadError(dueRes.error.message);
      setLoading(false);
      return;
    }
    const rows = (dueRes.data as DueRow[]) ?? [];
    setDue(rows);

    const flight = await supabaseClient
      .from("transfers")
      .select("id, amount, external_reference, created_at, payout_account_id, payout_accounts(owner_type, owner_id)")
      .eq("method", "manual")
      .eq("status", "processing")
      .order("created_at", { ascending: true });
    if (flight.error) {
      setLoadError(flight.error.message);
      setLoading(false);
      return;
    }
    const transfers = (flight.data ?? []) as Array<Record<string, unknown>>;
    const owners = transfers.map((t) => (t.payout_accounts ?? {}) as { owner_type?: string; owner_id?: string });
    const coachIds = [...new Set(owners.filter((o) => o.owner_type === "coach").map((o) => o.owner_id as string))];
    const venueIds = [...new Set(owners.filter((o) => o.owner_type === "court_partner").map((o) => o.owner_id as string))];
    const [coachNames, venueNames] = await Promise.all([
      coachIds.length ? supabaseClient.from("users").select("id, name").in("id", coachIds) : Promise.resolve({ data: [] }),
      venueIds.length ? supabaseClient.from("venues").select("id, name").in("id", venueIds) : Promise.resolve({ data: [] }),
    ]);
    const nameById = new Map<string, string>();
    for (const r of [...((coachNames.data ?? []) as Array<{ id: string; name: string | null }>), ...((venueNames.data ?? []) as Array<{ id: string; name: string | null }>)]) {
      nameById.set(r.id, r.name ?? "Unnamed");
    }
    setInFlight(
      transfers.map((t, i) => ({
        id: t.id as string,
        amount: Number(t.amount),
        external_reference: (t.external_reference as string) ?? null,
        created_at: t.created_at as string,
        payout_account_id: t.payout_account_id as string,
        payee: nameById.get(owners[i]?.owner_id ?? "") ?? "Unnamed",
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const ready = useMemo(() => due.filter((r) => r.verification_status === "verified" && Number(r.eligible_balance) > 0), [due]);
  const needsDetails = useMemo(() => due.filter((r) => r.verification_status !== "verified"), [due]);

  function closePanel() {
    setPanel(null);
    setRevealed(null);
    setRevealReason("");
    setNote("");
    setAmount("");
    setReference("");
    setFormError(null);
  }

  function openPanel(next: Panel) {
    closePanel();
    setPanel(next);
    if (next.kind === "pay") setAmount(Number(next.row.eligible_balance).toFixed(2));
  }

  async function reveal(row: DueRow) {
    if (!row.payout_account_id) return;
    if (revealReason.trim().length < 3) {
      setFormError("Say why you are revealing these details.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabaseClient.rpc("admin_reveal_payout_method", {
      p_payout_account_id: row.payout_account_id,
      p_reason: revealReason.trim(),
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setFormError(null);
    setRevealed(data as Revealed);
  }

  async function verify(row: DueRow, decision: "verify" | "reject") {
    if (!row.payout_account_id) return;
    if (decision === "reject" && note.trim().length < 3) {
      setFormError("Tell the owner what to fix.");
      return;
    }
    setBusy(true);
    const { error } = await supabaseClient.rpc("admin_verify_payout_method", {
      p_payout_account_id: row.payout_account_id,
      p_decision: decision,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    open?.({ type: "success", message: decision === "verify" ? `${row.owner_name ?? "Payee"} verified.` : `${row.owner_name ?? "Payee"} asked to fix their details.` });
    closePanel();
    await load();
  }

  function validatePayout(row: DueRow): boolean {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError("Enter the amount you sent.");
      return false;
    }
    if (parsed > Number(row.eligible_balance)) {
      setFormError(`At most ${rupees(row.eligible_balance)} is eligible right now.`);
      return false;
    }
    if (!/^[A-Za-z0-9 ]{6,40}$/.test(reference.trim())) {
      setFormError("Enter the bank reference (UTR) from your NEFT or UPI receipt.");
      return false;
    }
    setFormError(null);
    return true;
  }

  async function confirmAction() {
    if (!panel) return;
    setBusy(true);
    if (panel.kind === "pay" && panel.row.payout_account_id) {
      const { error } = await supabaseClient.rpc("admin_record_manual_payout", {
        p_payout_account_id: panel.row.payout_account_id,
        p_amount: Number(amount),
        p_reference: reference.trim(),
        p_note: note.trim() || null,
      });
      setBusy(false);
      if (error) {
        confirmRef.current?.close();
        setFormError(error.message);
        return;
      }
      open?.({ type: "success", message: `Payout to ${panel.row.owner_name ?? "payee"} recorded. Mark it received once it lands.` });
    } else if (panel.kind === "resolve") {
      const { error } = await supabaseClient.rpc("admin_resolve_manual_payout", {
        p_transfer_id: panel.transfer.id,
        p_outcome: panel.outcome,
        p_note: note.trim() || null,
      });
      setBusy(false);
      if (error) {
        confirmRef.current?.close();
        setFormError(error.message);
        return;
      }
      open?.({
        type: "success",
        message: panel.outcome === "paid" ? "Payout marked received." : "Payout marked bounced. The amount is back on their balance.",
      });
    } else {
      setBusy(false);
    }
    confirmRef.current?.close();
    closePanel();
    await load();
  }

  const payeeCell = (row: DueRow) => (
    <div className="ak-payout-payee">
      <span className="ak-payout-name">{row.owner_name ?? "Unnamed"}</span>
      <span className="ak-payout-sub">
        {row.owner_type === "coach" ? "Coach" : "Venue"}
        {row.owner_phone ? `, ${row.owner_phone}` : ""}
      </span>
    </div>
  );

  const readyColumns: DataTableColumn<DueRow>[] = [
    { key: "payee", header: "Payee", render: payeeCell },
    { key: "method", header: "Pay to", nowrap: true, render: (r) => <MethodCell row={r} /> },
    { key: "pan", header: "PAN", render: (r) => (r.has_pan ? <Badge tone="success">On file</Badge> : <Badge tone="warning">Missing</Badge>) },
    { key: "eligible", header: "Eligible now", numeric: true, render: (r) => rupees(r.eligible_balance) },
    { key: "held", header: "Held back", numeric: true, render: (r) => rupees(Math.max(0, Number(r.balance) - Number(r.eligible_balance))) },
    {
      key: "act",
      header: "",
      nowrap: true,
      render: (r) => (
        <Button variant="primary" size="sm" onClick={() => openPanel({ kind: "pay", row: r })}>
          <Banknote size={14} strokeWidth={1.75} />
          Record payout
        </Button>
      ),
    },
  ];

  const detailsColumns: DataTableColumn<DueRow>[] = [
    { key: "payee", header: "Payee", render: payeeCell },
    { key: "status", header: "Details", render: (r) => <Badge tone={verificationTone[r.verification_status]}>{verificationLabel[r.verification_status]}</Badge> },
    { key: "method", header: "Pay to", nowrap: true, render: (r) => <MethodCell row={r} /> },
    { key: "owed", header: "Owed", numeric: true, render: (r) => rupees(r.balance) },
    {
      key: "act",
      header: "",
      nowrap: true,
      render: (r) =>
        r.verification_status === "unverified" ? (
          <Button variant="secondary" size="sm" onClick={() => openPanel({ kind: "review", row: r })}>
            <Eye size={14} strokeWidth={1.75} />
            Review
          </Button>
        ) : (
          <span className="ak-payout-sub">{r.verification_status === "missing" ? "Owner to add" : "Owner to fix"}</span>
        ),
    },
  ];

  const flightColumns: DataTableColumn<InFlightRow>[] = [
    { key: "payee", header: "Payee", render: (t) => t.payee },
    { key: "ref", header: "Reference", render: (t) => <span className="ak-payout-mono">{t.external_reference}</span> },
    { key: "sent", header: "Recorded", render: (t) => new Date(t.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
    { key: "amount", header: "Amount", numeric: true, render: (t) => rupees(t.amount) },
    {
      key: "act",
      header: "",
      nowrap: true,
      render: (t) => (
        <div className="ak-payout-actions">
          <Button variant="secondary" size="sm" onClick={() => openPanel({ kind: "resolve", transfer: t, outcome: "paid" })}>
            <CheckCircle2 size={14} strokeWidth={1.75} />
            Received
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openPanel({ kind: "resolve", transfer: t, outcome: "failed" })}>
            <RotateCcw size={14} strokeWidth={1.75} />
            Bounced
          </Button>
        </div>
      ),
    },
  ];

  const tabs = [
    { key: "ready", label: "Ready to pay", count: ready.length },
    { key: "details", label: "Needs details", count: needsDetails.length },
    { key: "in_flight", label: "Sent, not confirmed", count: inFlight.length },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Operations" }]}
        title="Payouts"
        description="Everyone the ledger says is owed. Pay them by NEFT or UPI from the company account, then record the bank reference here. Recent earnings are held for 24 hours, and court earnings until 24 hours after the slot is played."
      />

      {loadError ? (
        <Card>
          <p className="ak-payout-error">Could not load payouts. {loadError}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      ) : (
        <>
          <Tabs items={tabs} active={tab} onChange={(k) => setTab(k as TabKey)} />
          {tab === "ready" ? (
            <DataTable
              columns={readyColumns}
              rows={ready}
              rowKey={(r) => `${r.owner_type}:${r.owner_id}`}
              loading={loading}
              emptyTitle="Nobody is ready to be paid"
              emptyBody="Payees appear here once their details are verified and some of their earnings are past the hold."
            />
          ) : tab === "details" ? (
            <DataTable
              columns={detailsColumns}
              rows={needsDetails}
              rowKey={(r) => `${r.owner_type}:${r.owner_id}`}
              loading={loading}
              emptyTitle="Every payee has verified details"
              emptyBody="New or changed bank details land here for review."
            />
          ) : (
            <DataTable
              columns={flightColumns}
              rows={inFlight}
              rowKey={(t) => t.id}
              loading={loading}
              emptyTitle="No payouts waiting for confirmation"
              emptyBody="A recorded payout waits here until you mark it received or bounced."
            />
          )}
        </>
      )}

      {panel ? (
        <div ref={panelRef} className="ak-payout-panel-anchor">
        <Card className="ak-payout-panel">
          {panel.kind === "review" ? (
            <>
              <p className="ak-payout-panel-title">Review details for {panel.row.owner_name ?? "payee"}</p>
              <p className="ak-payout-sub">{methodSummary(panel.row)}. Check the full details against a Rs 1 test deposit before verifying.</p>
              {revealed ? (
                <dl className="ak-payout-revealed">
                  <dt>Holder</dt>
                  <dd>{revealed.account_holder_name}</dd>
                  {revealed.account_number ? (
                    <>
                      <dt>Account</dt>
                      <dd className="ak-payout-mono">{revealed.account_number}</dd>
                      <dt>IFSC</dt>
                      <dd className="ak-payout-mono">{revealed.ifsc}</dd>
                    </>
                  ) : (
                    <>
                      <dt>UPI</dt>
                      <dd className="ak-payout-mono">{revealed.vpa}</dd>
                    </>
                  )}
                  <dt>PAN</dt>
                  <dd className="ak-payout-mono">{revealed.pan ?? "Not provided"}</dd>
                </dl>
              ) : (
                <div className="ak-payout-row">
                  <div className="ak-payout-grow">
                    <Field label="Reason for revealing, recorded in the audit log">
                      <Input value={revealReason} onChange={setRevealReason} placeholder="Sending the Rs 1 test deposit" />
                    </Field>
                  </div>
                  <Button variant="secondary" onClick={() => void reveal(panel.row)} disabled={busy}>
                    <Eye size={14} strokeWidth={1.75} />
                    Reveal full details
                  </Button>
                </div>
              )}
              <Field label="Note to the owner, required to reject">
                <Input value={note} onChange={setNote} placeholder="The IFSC does not match the branch" />
              </Field>
              {formError ? <p className="ak-payout-error">{formError}</p> : null}
              <div className="ak-payout-actions">
                <Button variant="primary" onClick={() => void verify(panel.row, "verify")} disabled={busy}>
                  <CheckCircle2 size={14} strokeWidth={1.75} />
                  Verify
                </Button>
                <Button variant="secondary" onClick={() => void verify(panel.row, "reject")} disabled={busy}>
                  <XCircle size={14} strokeWidth={1.75} />
                  Reject
                </Button>
                <Button variant="secondary" onClick={closePanel}>
                  Close
                </Button>
              </div>
            </>
          ) : panel.kind === "pay" ? (
            <>
              <p className="ak-payout-panel-title">Record a payout to {panel.row.owner_name ?? "payee"}</p>
              <p className="ak-payout-sub">
                Send the money first, to {methodSummary(panel.row)}. Up to {rupees(panel.row.eligible_balance)} is eligible.
              </p>
              <div className="ak-payout-row">
                <div className="ak-payout-amount">
                  <Field label="Amount sent, rupees">
                    <Input value={amount} onChange={setAmount} mono />
                  </Field>
                </div>
                <div className="ak-payout-grow">
                  <Field label="Bank reference (UTR)">
                    <Input value={reference} onChange={setReference} mono placeholder="HDFCN52026092512345" />
                  </Field>
                </div>
              </div>
              <Field label="Note, optional">
                <Input value={note} onChange={setNote} placeholder="NEFT from the HDFC current account" />
              </Field>
              {formError ? <p className="ak-payout-error">{formError}</p> : null}
              <div className="ak-payout-actions">
                <Button variant="primary" onClick={() => validatePayout(panel.row) && confirmRef.current?.open()} disabled={busy}>
                  Record payout
                </Button>
                <Button variant="secondary" onClick={closePanel}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="ak-payout-panel-title">
                {panel.outcome === "paid" ? "Confirm the money arrived" : "Mark this payout as bounced"}
              </p>
              <p className="ak-payout-sub">
                {rupees(panel.transfer.amount)} to {panel.transfer.payee}, reference {panel.transfer.external_reference}.
                {panel.outcome === "failed" ? " The amount goes back on their balance so it can be paid again." : ""}
              </p>
              <Field label={panel.outcome === "failed" ? "Why it bounced, required" : "Note, optional"}>
                <Input value={note} onChange={setNote} placeholder={panel.outcome === "failed" ? "Beneficiary account closed" : ""} />
              </Field>
              {formError ? <p className="ak-payout-error">{formError}</p> : null}
              <div className="ak-payout-actions">
                <Button
                  variant="primary"
                  onClick={() => {
                    if (panel.outcome === "failed" && note.trim().length < 3) {
                      setFormError("Say why the payout bounced.");
                      return;
                    }
                    setFormError(null);
                    confirmRef.current?.open();
                  }}
                  disabled={busy}
                >
                  {panel.outcome === "paid" ? "Mark received" : "Mark bounced"}
                </Button>
                <Button variant="secondary" onClick={closePanel}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Card>
        </div>
      ) : null}

      <ConfirmDialog
        ref={confirmRef}
        title={
          panel?.kind === "pay"
            ? "Record this payout"
            : panel?.kind === "resolve" && panel.outcome === "failed"
              ? "Mark this payout as bounced"
              : "Mark this payout as received"
        }
        body={
          panel?.kind === "pay"
            ? "Only record money you have already sent. This debits their balance and is recorded in the audit log, for"
            : "This is recorded in the audit log, for"
        }
        recordName={
          panel?.kind === "pay"
            ? `${panel.row.owner_name ?? "payee"}, Rs ${amount}, reference ${reference.trim().toUpperCase()}`
            : panel?.kind === "resolve"
              ? `${panel.transfer.payee}, ${rupees(panel.transfer.amount)}`
              : undefined
        }
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        danger={panel?.kind === "resolve" && panel.outcome === "failed"}
        loading={busy}
        onConfirm={() => void confirmAction()}
      />
    </div>
  );
}
