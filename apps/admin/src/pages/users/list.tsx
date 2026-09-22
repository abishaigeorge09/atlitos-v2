import type { Db } from "@atlitos/types";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "../../components/kit/Badge";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Select } from "../../components/kit/Select";
import { relativeTime } from "../../lib/relative-time";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 3.7 User List / FR-34: every user with name, contact, roles, join
// date, and status, searchable by name and phone. Reads public.users (RLS
// users_select_admin) joined to public.user_roles (user_roles_select_admin),
// both admin-gated per RLS.md. `public.users` has no email column (email
// lives on `auth.users`, not client readable), so the search brief's "name
// or email" is "name or phone" here, matching what the row actually has.
// This app has no @refinedev/supabase useTable wiring for a joined query,
// so it fetches directly with the Supabase client, same pattern the P0
// shell used for the profiles placeholder it replaces.
type UserRow = Db.UserRow & { user_roles: Pick<Db.UserRoleRow, "role">[] };

type LoadState = "loading" | "error" | "ready";

export function UsersList() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");

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

  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) for (const r of row.user_roles) set.add(r.role);
    return Array.from(set).map((value) => ({ value, label: value }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesRole = !role || row.user_roles.some((r) => r.role === role);
      const matchesSearch =
        q.length === 0 || row.name.toLowerCase().includes(q) || (row.phone ?? "").toLowerCase().includes(q);
      return matchesRole && matchesSearch;
    });
  }, [rows, search, role]);

  const columns: DataTableColumn<UserRow>[] = [
    { key: "name", header: "Name", render: (row) => row.name },
    { key: "contact", header: "Contact", render: (row) => row.phone ?? "No phone on file" },
    {
      key: "roles",
      header: "Roles",
      render: (row) => (
        <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
          {row.user_roles.length === 0 ? (
            <Badge tone="neutral">none</Badge>
          ) : (
            row.user_roles.map((r) => (
              <Badge key={r.role} tone="neutral">
                {r.role}
              </Badge>
            ))
          )}
        </div>
      ),
    },
    { key: "joined", header: "Joined", render: (row) => relativeTime(row.created_at) },
  ];

  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Community" }]} title="Users" description="Every account on the platform, with its roles." />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name or phone"
        filters={<Select value={role} onChange={setRole} placeholder="All roles" options={roleOptions} />}
        resultCount={filtered.length}
        resultNoun={filtered.length === 1 ? "user" : "users"}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        rowHref={(row) => `/users/show/${row.id}`}
        loading={state === "loading"}
        emptyTitle={state === "error" ? "Could not load users" : "No users found"}
        emptyBody={
          state === "error"
            ? "Something went wrong reading the users table. Try again."
            : "No accounts match this search."
        }
      />
    </div>
  );
}
