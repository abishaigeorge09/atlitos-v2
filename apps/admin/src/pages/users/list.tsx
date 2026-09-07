import type { Db } from "@atlitos/types";
import { AlertTriangle, Search, Users as UsersIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Field, Input } from "../../components/form";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 3.7 User List / FR-34: every user with name, contact, roles, join
// date, and status, searchable by name and email.
//
// FR-35..FR-38 suspend/reinstate (SEC-F4, security audit 2026-09-04). Before
// this, `status` was rendered here and could be set by nothing: no RPC, no
// action, no route. PHASE-A-GAP-INVENTORY.md catalogued the whole User Detail
// screen as absent, and the audit found the deeper half of the same gap, that
// even if an operator HAD set the column, no code read it.
//
// The action lives inline on this list rather than behind the separate User
// Detail route the PRD sketches. Suspend/reinstate needs a row, a reason and a
// confirmation, all of which fit here; a detail screen carrying activity
// summaries is a product story, not part of closing the enforcement gap, and
// building it speculatively would be scope this change did not earn.
//
// Both actions go through admin_suspend_user / admin_reinstate_user (0090),
// which are SECURITY DEFINER, admin-gated, and write the audit_log row and the
// member notification inside the SAME transaction as the status change (SEC-F5).
// This component never writes users.status directly, and could not: 0065's
// trigger refuses a non-admin, and RLS refuses the column to this bundle's anon
// key regardless. Reads public.users (RLS
// users_select_admin) joined to public.user_roles (user_roles_select_admin),
// both admin-gated per RLS.md. This app has no @refinedev/supabase useTable
// wiring for a joined query, so it fetches directly with the Supabase client,
// same pattern the P0 shell used for the profiles placeholder it replaces.
type UserRow = Db.UserRow & { email: string | null; user_roles: Pick<Db.UserRoleRow, "role">[] };

type LoadState = "loading" | "error" | "ready";

export function UsersList() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [search, setSearch] = useState("");
  /** Row id whose reason prompt is open. Only ever one at a time. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openPrompt(id: string) {
    setPendingId(id);
    setReason("");
    setActionError(null);
  }

  async function submitAction(row: UserRow) {
    const suspending = row.status === "active";
    // The RPC raises REASON_REQUIRED anyway; checking here keeps the operator
    // from a round trip to be told what the empty field already shows.
    if (suspending && reason.trim() === "") {
      setActionError("A reason is required to suspend an account.");
      return;
    }

    setBusy(true);
    setActionError(null);

    const { error } = suspending
      ? await supabaseClient.rpc("admin_suspend_user", {
          p_user_id: row.id,
          p_reason: reason.trim(),
        })
      : await supabaseClient.rpc("admin_reinstate_user", {
          p_user_id: row.id,
          p_reason: reason.trim() === "" ? null : reason.trim(),
        });

    setBusy(false);

    if (error) {
      setActionError(error.message);
      return;
    }

    // Reflect the new state locally rather than refetching the whole table:
    // the RPC returns the updated row and nothing else on the page depends on
    // a fresh read.
    setRows((current) =>
      current.map((candidate) =>
        candidate.id === row.id
          ? { ...candidate, status: suspending ? "suspended" : "active" }
          : candidate,
      ),
    );
    setPendingId(null);
    setReason("");
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const { data, error } = await supabaseClient
        .from("users")
        .select("id,name,phone,city,state,status,created_at,updated_at,user_roles(role)")
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setState("error");
        return;
      }

      setRows((data as unknown as UserRow[]) ?? []);
      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) => row.name.toLowerCase().includes(q) || (row.phone ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Users</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Every account on the platform, with its roles and status.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", maxWidth: 320 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface-muted)",
            width: "100%",
          }}
        >
          <Search size={16} strokeWidth={1.75} color="var(--color-text-tertiary)" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or phone"
            style={{
              border: "none",
              outline: "none",
              backgroundColor: "transparent",
              fontSize: 14,
              color: "var(--color-text)",
              width: "100%",
            }}
          />
        </div>
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>
            Loading users...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load users"
            description="Something went wrong reading the users table. Try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={32} strokeWidth={1.75} />}
            title="No users found"
            description="No accounts match this search."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Name", "Contact", "Roles", "Joined", "Status", "Action"].map((heading) => (
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
              {filtered.map((row) => (
                <Fragment key={row.id}>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                    {row.name}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {row.phone ?? "No phone on file"}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                      {row.user_roles.length === 0 ? (
                        <Badge>none</Badge>
                      ) : (
                        row.user_roles.map((r) => <Badge key={r.role}>{r.role}</Badge>)
                      )}
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "var(--space-md) var(--space-lg)",
                      fontSize: 13,
                      fontFamily: "JetBrains Mono, monospace",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {new Date(row.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone={row.status === "active" ? "success" : "danger"}>{row.status}</Badge>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Button
                      variant={row.status === "active" ? "destructive" : "secondary"}
                      onClick={() => openPrompt(row.id)}
                      disabled={busy}
                    >
                      {row.status === "active" ? "Suspend" : "Reinstate"}
                    </Button>
                  </td>
                </tr>
                {pendingId === row.id ? (
                  <tr key={`${row.id}-prompt`} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td colSpan={6} style={{ padding: "var(--space-lg)", backgroundColor: "var(--color-surface-muted)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", maxWidth: 520 }}>
                        <Field
                          label={
                            row.status === "active"
                              ? "Reason for suspending, shown to the member"
                              : "Note for the audit log, optional"
                          }
                        >
                          <Input
                            value={reason}
                            onChange={setReason}
                            placeholder={
                              row.status === "active"
                                ? "Repeated policy violations after warning"
                                : "Appeal upheld"
                            }
                          />
                        </Field>
                        {actionError ? (
                          <p style={{ fontSize: 13, color: "var(--color-danger)", margin: 0 }}>{actionError}</p>
                        ) : null}
                        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
                          {row.status === "active"
                            ? "Suspending signs this member out at their next token refresh, blocks every protected API immediately, and notifies them with this reason."
                            : "Reinstating clears the suspension and restores access."}
                        </p>
                        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                          <Button
                            variant={row.status === "active" ? "destructive" : "primary"}
                            onClick={() => void submitAction(row)}
                            disabled={busy}
                          >
                            {busy
                              ? "Working..."
                              : row.status === "active"
                                ? "Confirm suspension"
                                : "Confirm reinstatement"}
                          </Button>
                          <Button variant="secondary" onClick={() => setPendingId(null)} disabled={busy}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
