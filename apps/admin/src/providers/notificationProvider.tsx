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

// An outcome toast has to leave on its own. Nothing here ever called `close`
// for a success, so "Request approved." stayed on screen for the rest of the
// session, covering the header controls it was painted over. An error stays
// until it is replaced, because the reader may need to act on it.
const AUTO_DISMISS_MS = 8000;

let toasts: Toast[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
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
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    if (params.type !== "error") {
      timers.set(
        key,
        setTimeout(() => {
          notificationProvider.close?.(key);
        }, AUTO_DISMISS_MS),
      );
    }
    emit();
  },
  close: (key) => {
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
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
