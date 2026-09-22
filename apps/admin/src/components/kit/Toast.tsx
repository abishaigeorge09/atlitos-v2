import { CheckCircle2, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import "./Toast.css";

export type ToastType = "success" | "error" | "progress";

/**
 * One toast. role="status" on success (polite), role="alert" on error
 * (assertive) so the e2e harness and assistive tech both react correctly
 * (Part B B0.8; the e2e specs assert on role="alert" for failures).
 */
export function Toast({
  type,
  message,
  description,
}: {
  type: ToastType;
  message: ReactNode;
  description?: ReactNode;
}) {
  const isError = type === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`ak-toast ak-toast-${type}`}
    >
      {isError ? (
        <ShieldAlert size={16} strokeWidth={1.75} />
      ) : (
        <CheckCircle2 size={16} strokeWidth={1.75} />
      )}
      <div className="ak-toast-copy">
        <span className="ak-toast-message">{message}</span>
        {description ? <span className="ak-toast-description">{description}</span> : null}
      </div>
    </div>
  );
}

export function ToastViewport({ children }: { children: ReactNode }) {
  return (
    <div className="ak-toast-viewport" aria-live="polite">
      {children}
    </div>
  );
}
