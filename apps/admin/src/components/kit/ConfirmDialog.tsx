import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

import { Button } from "./Button";
import "./ConfirmDialog.css";

export interface ConfirmDialogHandle {
  open: () => void;
  close: () => void;
}

export interface ConfirmDialogProps {
  title: string;
  body: string;
  /** Name the record so the destructive action is unambiguous (B0.7). */
  recordName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  loading?: boolean;
}

/** Native <dialog> + showModal(), Esc closes, danger primary. Part B B1. */
export const ConfirmDialog = forwardRef<ConfirmDialogHandle, ConfirmDialogProps>(function ConfirmDialog(
  { title, body, recordName, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = true, onConfirm, loading = false },
  ref,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.showModal(),
    close: () => dialogRef.current?.close(),
  }));

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const handleCancel = (event: Event) => {
      // Native <dialog> already closes on Esc; nothing extra needed, this
      // just keeps the intent documented and available for a future guard.
      void event;
    };
    node.addEventListener("cancel", handleCancel);
    return () => node.removeEventListener("cancel", handleCancel);
  }, []);

  return (
    <dialog ref={dialogRef} className="ak-confirm-dialog" aria-labelledby="ak-confirm-title">
      <h2 id="ak-confirm-title" className="ak-confirm-title">
        {title}
      </h2>
      <p className="ak-confirm-body">
        {body}
        {recordName ? <strong className="ak-confirm-record"> {recordName}</strong> : null}
      </p>
      <div className="ak-confirm-actions">
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
});
