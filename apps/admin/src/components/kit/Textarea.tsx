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
  return (
    <textarea
      id={id}
      value={value}
      placeholder={placeholder}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      className="ak-textarea"
    />
  );
}
