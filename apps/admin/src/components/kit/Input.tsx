import { useFieldControl } from "./Field";
import "./Field.css";

export function Input({
  value,
  onChange,
  placeholder,
  mono = false,
  disabled,
  invalid,
  id,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Set for prices, counts and SKUs. */
  mono?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  type?: string;
}) {
  const field = useFieldControl(id);
  return (
    <input
      id={field.id}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`ak-input${mono ? " ak-input-mono" : ""}`}
      aria-invalid={invalid || field.invalid || undefined}
      aria-describedby={field.describedBy}
    />
  );
}
