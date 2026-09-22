import { createContext, useContext, useId, type ReactNode } from "react";

import "./Field.css";

// A label needs something to point at. Every control in this kit is a bare
// <input>/<select>/<textarea> rendered as Field's child, so unless an id is
// threaded through, the label points nowhere: axe reported `select-name`
// (critical) on every filter bar and form in the admin, and `label` on the
// kitchen sink's inputs. Field now mints an id and hands it down through this
// context; Input, Select and Textarea take it when no explicit id is passed.
// Pages did not have to change for this, which is the point of the kit.
interface FieldContextValue {
  id: string;
  invalid: boolean;
  describedBy?: string;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldControl(explicitId?: string) {
  const ctx = useContext(FieldContext);
  return {
    id: explicitId ?? ctx?.id,
    invalid: ctx?.invalid ?? false,
    describedBy: ctx?.describedBy,
  };
}

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
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const messageId = error || hint ? `${id}-message` : undefined;

  return (
    <FieldContext.Provider value={{ id, invalid: Boolean(error), describedBy: messageId }}>
      <div className="ak-field">
        <label className="ak-field-label" htmlFor={id}>
          {label}
        </label>
        {children}
        {error ? (
          <span className="ak-field-error" id={messageId} role="alert">
            {error}
          </span>
        ) : hint ? (
          <span className="ak-field-hint" id={messageId}>
            {hint}
          </span>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
