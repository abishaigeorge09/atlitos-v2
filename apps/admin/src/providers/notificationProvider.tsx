import type { NotificationProvider, OpenNotificationParams } from "@refinedev/core";
import { useSyncExternalStore } from "react";

import { Toast, ToastViewport, type ToastType } from "../components/kit/Toast";

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
    <ToastViewport>
      {active.map((toast) => (
        <Toast
          key={toast.key}
          type={(toast.type as ToastType) ?? "success"}
          message={toast.message}
          description={toast.description}
        />
      ))}
    </ToastViewport>
  );
}
