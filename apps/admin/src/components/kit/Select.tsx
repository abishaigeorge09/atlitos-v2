import { useFieldControl } from "./Field";
import "./Field.css";

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
}) {
  const field = useFieldControl(id);
  return (
    <select id={field.id} value={value} onChange={(event) => onChange(event.target.value)} className="ak-select" aria-invalid={field.invalid || undefined} aria-describedby={field.describedBy}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
