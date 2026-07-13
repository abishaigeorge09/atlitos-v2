import type { Db } from "@atlitos/types";
import { AlertTriangle, Search, Users as UsersIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge, Card, EmptyState } from "../../components/ui";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 3.7 User List / FR-34: every user with name, contact, roles, join
// date, and status, searchable by name and email. Reads public.users (RLS
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
                {["Name", "Contact", "Roles", "Joined", "Status"].map((heading) => (
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
                <tr key={row.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
