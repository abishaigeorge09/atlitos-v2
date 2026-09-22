import type { ReactNode } from "react";

import type { StatusTone } from "../../lib/status";
import "./Badge.css";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`ak-badge ak-badge-${tone}`}>{children}</span>;
}
