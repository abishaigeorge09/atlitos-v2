import type { ReactNode } from "react";

import "./Field.css";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="ak-field">
      <label className="ak-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="ak-field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="ak-field-hint">{hint}</span>
      ) : null}
    </div>
  );
}
