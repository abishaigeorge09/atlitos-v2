import type { ReactNode } from "react";

import "./DetailLayout.css";

/** 2fr/1fr grid, right column sticky, single column under 1024px. Part B B0.4. */
export function DetailLayout({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="ak-detail-layout">
      <div className="ak-detail-layout-main">{main}</div>
      <div className="ak-detail-layout-side">{side}</div>
    </div>
  );
}
