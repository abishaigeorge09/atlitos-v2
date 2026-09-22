import { useFieldControl } from "./Field";
import "./Field.css";

export function Textarea({
  value,
  onChange,
  placeholder,
  id,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  rows?: number;
}) {
  const field = useFieldControl(id);
  return (
    <textarea
      id={field.id}
      value={value}
      placeholder={placeholder}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      className="ak-textarea"
      aria-invalid={field.invalid || undefined}
      aria-describedby={field.describedBy}
    />
  );
}
