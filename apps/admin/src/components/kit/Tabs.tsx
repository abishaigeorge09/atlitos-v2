import "./Tabs.css";

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="ak-tabs" role="tablist">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`ak-tab${isActive ? " ak-tab-active" : ""}`}
            onClick={() => onChange(item.key)}
          >
            {item.label}
            {typeof item.count === "number" ? <span className="ak-tab-count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
