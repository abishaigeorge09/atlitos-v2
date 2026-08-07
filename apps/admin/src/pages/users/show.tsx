import type { Db } from "@atlitos/types";
import { AlertTriangle, ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Field, Input } from "../../components/form";
import { Mono } from "../../components/mono";
import { supabaseClient } from "../../providers/supabaseClient";
import { usersApi, type UserActionError } from "./api";

// PRD-04 FR-35, FR-36, FR-37, FR-38, FR-53. User Detail: roles, status, a
// recent activity summary (bookings, orders, clips), and the suspend /
// reinstate action (PHASE-4-STATUS.md CT-B, Track B).
//
// FR-38 ("suspending or reinstating a user never deletes or alters their
// historical bookings, orders, or ledger rows") holds structurally here: this
// screen only ever READS those tables to build the activity summary. The one
// mutation on the page is `usersApi.suspend` / `usersApi.reinstate`, which
// touches `users.status` / `suspended_reason` and nothing else (0096's
// `admin_suspend_user` / `admin_reinstate_user`), so there is no code path on
// this screen that could touch a booking, order, or ledger row.
//
// Every read below is scoped by this user's own id (`.eq("user_id", id)` /
// `.eq("owner_id", id)`), per CLAUDE.md's "RLS is not scoping" rule: the
// admin-read RLS policies on these tables return every row to an admin, so an
// unscoped select here would silently mix in every other user's activity.

type LoadState = "loading" | "error" | "ready" | "not_found";

type UserDetailRow = Pick<
  Db.UserRow,
  "id" | "name" | "phone" | "city" | "state" | "status" | "suspended_reason" | "created_at"
>;

interface ActivitySummary {
  courtBookings: number;
  sessions: number;
  orders: number;
  clips: number;
}

export function UserShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<UserDetailRow | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<UserActionError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    setState("loading");
    setActionError(null);
    setNotice(null);

    const { data: userData, error: userError } = await supabaseClient
      .from("users")
      .select("id,name,phone,city,state,status,suspended_reason,created_at")
      .eq("id", id)
      .maybeSingle();

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

    setRoles(((roleRows as { role: string }[]) ?? []).map((r) => r.role));
    setActivity({
      courtBookings: courtBookingCount ?? 0,
      sessions: sessionCount ?? 0,
      orders: orderCount ?? 0,
      clips: clipCount ?? 0,
    });
    setState("ready");
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function onSuspend() {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await usersApi.suspend(id, reason);
      setNotice("User suspended.");
      setReason("");
      await load();
    } catch (err) {
      setActionError(err as UserActionError);
    } finally {
      setBusy(false);
    }
  }

  async function onReinstate() {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await usersApi.reinstate(id, reason.trim() || null);
      setNotice("User reinstated.");
      setReason("");
      await load();
    } catch (err) {
      setActionError(err as UserActionError);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading user...</div>;
  }

  if (state === "not_found") {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="User not found"
          description="This account does not exist or was removed."
        />
      </Card>
    );
  }

  if (state === "error" || !user) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Could not load this user"
          description="Something went wrong reading this account. Try again."
        />
      </Card>
    );
  }

  const isSuspended = user.status === "suspended";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 760 }}>
      <button
        type="button"
        onClick={() => navigate("/users")}
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
        Back to users
      </button>

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
              User
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>{user.name}</h1>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
              {user.phone ?? "No phone on file"}
              {user.city ? `, ${user.city}` : ""}
            </p>
            <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", marginTop: "var(--space-sm)" }}>
              {roles.length === 0 ? <Badge>none</Badge> : roles.map((r) => <Badge key={r}>{r}</Badge>)}
            </div>
          </div>
          <Badge tone={isSuspended ? "danger" : "success"}>{user.status}</Badge>
        </div>
        {isSuspended && user.suspended_reason ? (
          <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "var(--space-md) 0 0" }}>
            Suspended: {user.suspended_reason}
          </p>
        ) : null}
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "var(--space-sm) 0 0" }}>
          Joined <Mono>{new Date(user.created_at).toLocaleDateString()}</Mono>
        </p>
      </Card>

      {/* FR-35 activity summary */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-lg)" }}>
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
            Recent activity
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: "1px solid var(--color-border)" }}>
          {[
            { label: "Court bookings", value: activity?.courtBookings ?? 0 },
            { label: "Coaching sessions", value: activity?.sessions ?? 0 },
            { label: "Orders", value: activity?.orders ?? 0 },
            { label: "Clips", value: activity?.clips ?? 0 },
          ].map((tile) => (
            <div key={tile.label} style={{ padding: "var(--space-lg)", borderRight: "1px solid var(--color-border)" }}>
              <Mono style={{ fontSize: 22, fontWeight: 700, display: "block" }}>{tile.value}</Mono>
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
                {tile.label}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* FR-36, FR-37 the suspend / reinstate action */}
      <Card>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
            margin: "0 0 var(--space-md)",
          }}
        >
          {isSuspended ? "Reinstate this user" : "Suspend this user"}
        </p>

        {actionError ? (
          <div
            style={{
              padding: "var(--space-md)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-danger)",
              backgroundColor: "var(--color-danger-tint)",
              marginBottom: "var(--space-md)",
            }}
          >
            <Mono style={{ fontSize: 12, fontWeight: 600, color: "var(--color-danger)" }}>{actionError.code}</Mono>
            <p style={{ fontSize: 14, color: "var(--color-danger)", margin: "var(--space-xs) 0 0" }}>
              {actionError.message}
            </p>
          </div>
        ) : null}

        {notice ? (
          <p style={{ fontSize: 14, color: "var(--color-success)", margin: "0 0 var(--space-md)" }}>{notice}</p>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <Field label={isSuspended ? "Reason (optional)" : "Reason (required)"}>
            <Input
              value={reason}
              onChange={setReason}
              placeholder={isSuspended ? "Appeal reviewed, restoring access" : "Repeated abusive messages"}
            />
          </Field>
          <div>
            {isSuspended ? (
              <Button variant="primary" disabled={busy} onClick={onReinstate}>
                <ShieldCheck size={16} strokeWidth={1.75} />
                Reinstate user
              </Button>
            ) : (
              <Button variant="destructive" disabled={busy || reason.trim().length === 0} onClick={onSuspend}>
                <ShieldAlert size={16} strokeWidth={1.75} />
                Suspend user
              </Button>
            )}
          </div>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
            {isSuspended
              ? "Restores sign in and every mutating action. Prior bookings, orders, and ledger rows are unchanged."
              : "Blocks sign in and every mutating action starting from the next request. Prior bookings, orders, and ledger rows are unchanged."}
          </p>
        </div>
      </Card>
    </div>
  );
}
