import type { NotificationProvider, OpenNotificationParams } from "@refinedev/core";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useSyncExternalStore } from "react";

// BUG-014 fix. apps/admin had no notificationProvider registered, so
// useLogin's built in open notification on a failed sign in (see
// @refinedev/core useLogin onSuccess -> open(buildNotification(error)))
// resolved to a no op and a wrong credential silently showed nothing.
// This registers a minimal, token compliant, DOM rendered notification
// surface so every open call renders a visible, accessible alert carrying
// the exact error copy the authProvider returns (PRD-04 3.1 login states:
// invalid credentials, not an admin). No external UI library: apps/admin is
// a plain Vite shell with no antd/shadcn pipeline.

type Toast = OpenNotificationParams & { key: string };

let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return toasts;
}

export const notificationProvider: NotificationProvider = {
  open: (params) => {
    const key = params.key ?? `${params.type}-${Date.now()}`;
    // Replace any existing toast sharing this key (Refine reuses the
    // "login-error" key across attempts) so the surface never stacks stale
    // copies of the same error.
    toasts = [...toasts.filter((toast) => toast.key !== key), { ...params, key }];
    emit();
  },
  close: (key) => {
    toasts = toasts.filter((toast) => toast.key !== key);
    emit();
  },
};

// Rendered once inside <Refine>. Subscribes to the store and paints each
// active notification. role="alert" so assistive tech and the QA harness
// (AUTH-11 / AD-01) both see the exact copy the moment it appears.
export function Notifications() {
  const active = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (active.length === 0) return null;

  return (
    <div
      aria-live="assertive"
      style={{
        position: "fixed",
        top: "var(--space-lg)",
        right: "var(--space-lg)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        zIndex: 1000,
        maxWidth: 380,
      }}
    >
      {active.map((toast) => {
        const isError = toast.type === "error";
        return (
          <div
            key={toast.key}
            role="alert"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--space-sm)",
              padding: "var(--space-md) var(--space-lg)",
              borderRadius: "var(--radius-sm)",
              backgroundColor: isError ? "var(--color-danger-tint)" : "var(--color-surface)",
              color: isError ? "var(--color-danger)" : "var(--color-text)",
              border: `1px solid ${isError ? "var(--color-danger)" : "var(--color-border)"}`,
              fontSize: 13,
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.12)",
            }}
          >
            {isError ? (
              <ShieldAlert size={16} strokeWidth={1.75} />
            ) : (
              <CheckCircle2 size={16} strokeWidth={1.75} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
              <span style={{ fontWeight: 600 }}>{toast.message}</span>
              {toast.description ? <span>{toast.description}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
