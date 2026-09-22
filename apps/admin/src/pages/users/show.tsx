import type { Db } from "@atlitos/types";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Card } from "../../components/kit/Card";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { EmptyState } from "../../components/kit/EmptyState";
import { PageHeader } from "../../components/kit/PageHeader";
import { DetailSkeleton } from "../../components/kit/Skeleton";
import { Mono } from "../../components/mono";
import { relativeTime } from "../../lib/relative-time";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 FR-35, FR-53. User Detail: profile, roles, and a recent activity
// summary (bookings, sessions, orders, clips). Account enforcement
// (PRD-04 FR-36/FR-37, the suspend/reinstate action in ./api.ts) is out of
// this phase's scope per docs/PLAN-ADMIN-UX.md's "not in scope" list, so
// this screen is read only and renders no suspend, reinstate, or refund
// control anywhere (AD-06 asserts their absence). `usersApi.suspend` /
// `usersApi.reinstate` stay defined in ./api.ts (untouched, per this
// track's ownership) for whenever that scope reopens, just unused here.
//
// Every read below is scoped by this user's own id (`.eq("user_id", id)` /
// `.eq("owner_id", id)`), per CLAUDE.md's "RLS is not scoping" rule: the
// admin-read RLS policies on these tables return every row to an admin, so
// an unscoped select here would silently mix in every other user's
// activity.

type LoadState = "loading" | "error" | "ready" | "not_found";

type UserDetailRow = Pick<Db.UserRow, "id" | "name" | "phone" | "city" | "state" | "status" | "created_at">;

interface ActivitySummary {
  courtBookings: number;
  sessions: number;
  orders: number;
  clips: number;
}

export function UserShow() {
  const { id } = useParams<{ id: string }>();

  const [user, setUser] = useState<UserDetailRow | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!id) return;
      setState("loading");

      const { data: userData, error: userError } = await supabaseClient
        .from("users")
        .select("id,name,phone,city,state,status,created_at")
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;
      if (userError) {
        setState("error");
        return;
      }
      if (!userData) {
        setState("not_found");
        return;
      }

      setUser(userData as UserDetailRow);

      const [
        { data: roleRows },
        { count: courtBookingCount },
        { count: sessionCount },
        { count: orderCount },
        { count: clipCount },
      ] = await Promise.all([
        supabaseClient.from("user_roles").select("role").eq("user_id", id),
        supabaseClient.from("court_bookings").select("id", { count: "exact", head: true }).eq("user_id", id),
        supabaseClient.from("sessions").select("id", { count: "exact", head: true }).eq("player_id", id),
        supabaseClient.from("orders").select("id", { count: "exact", head: true }).eq("user_id", id),
        supabaseClient.from("clips").select("id", { count: "exact", head: true }).eq("owner_id", id),
      ]);

      if (cancelled) return;
      setRoles(((roleRows as { role: string }[]) ?? []).map((r) => r.role));
      setActivity({
        courtBookings: courtBookingCount ?? 0,
        sessions: sessionCount ?? 0,
        orders: orderCount ?? 0,
        clips: clipCount ?? 0,
      });
      setState("ready");
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state === "loading") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Community", to: "/users" }, { label: "Users" }]} title="Loading user" />
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "not_found" || state === "error" || !user) {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Community", to: "/users" }, { label: "Users" }]} title="User" />
        <Card>
          <EmptyState
            title={state === "not_found" ? "User not found" : "Could not load this user"}
            body={
              state === "not_found"
                ? "This account does not exist or was removed."
                : "Something went wrong reading this account. Try again."
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Community", to: "/users" }, { label: "Users", to: "/users" }]}
        title={user.name}
        description={user.phone ? `${user.phone}${user.city ? `, ${user.city}` : ""}` : "No phone on file"}
      />

      <DetailLayout
        main={
          <Card>
            <p
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-semibold)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                margin: "0 0 var(--space-md)",
              }}
            >
              Recent activity
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-md)" }}>
              {[
                { label: "Court bookings", value: activity?.courtBookings ?? 0 },
                { label: "Coaching sessions", value: activity?.sessions ?? 0 },
                { label: "Orders", value: activity?.orders ?? 0 },
                { label: "Clips", value: activity?.clips ?? 0 },
              ].map((tile) => (
                <div
                  key={tile.label}
                  style={{
                    padding: "var(--space-md)",
                    borderRadius: "var(--radius-md)",
                    backgroundColor: "var(--color-surface-muted)",
                  }}
                >
                  <Mono style={{ fontSize: "var(--type-numericLg-size)", fontWeight: "var(--weight-semibold)", display: "block" }}>
                    {tile.value}
                  </Mono>
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
                    {tile.label}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        }
        side={
          <Card>
            <p
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-semibold)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                margin: 0,
              }}
            >
              Profile
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Status</span>
                <Badge tone={user.status === "active" ? "success" : "neutral"}>{user.status}</Badge>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Joined</span>
                <Mono style={{ fontSize: "var(--text-sm)" }}>{relativeTime(user.created_at)}</Mono>
              </div>
            </div>

            <p
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-semibold)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                margin: "var(--space-lg) 0 var(--space-sm)",
              }}
            >
              Roles
            </p>
            <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
              {roles.length === 0 ? (
                <Badge tone="neutral">none</Badge>
              ) : (
                roles.map((r) => (
                  <Badge key={r} tone="neutral">
                    {r}
                  </Badge>
                ))
              )}
            </div>
          </Card>
        }
      />
    </div>
  );
}
