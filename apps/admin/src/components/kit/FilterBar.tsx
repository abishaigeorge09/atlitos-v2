import { Search } from "lucide-react";
import type { ReactNode } from "react";

import "./FilterBar.css";

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search",
  filters,
  resultCount,
  resultNoun = "results",
}: {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  resultCount?: number;
  resultNoun?: string;
}) {
  return (
    <div className="ak-filter-bar">
      <div className="ak-filter-bar-row">
        {onSearchChange ? (
          <label className="ak-filter-search">
            <Search size={16} strokeWidth={1.75} />
            <input
              type="search"
              value={searchValue ?? ""}
              placeholder={searchPlaceholder}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label={searchPlaceholder}
            />
          </label>
        ) : null}
        {filters ? <div className="ak-filter-bar-filters">{filters}</div> : null}
      </div>
      {typeof resultCount === "number" ? (
        <p className="ak-filter-bar-count">
          {resultCount} {resultNoun}
        </p>
      ) : null}
    </div>
  );
}
