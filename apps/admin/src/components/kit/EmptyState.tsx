import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

import "./EmptyState.css";

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ak-empty-state">
      <span className="ak-empty-state-icon">{icon ?? <Inbox size={32} strokeWidth={1.75} />}</span>
      <p className="ak-empty-state-title">{title}</p>
      {body ? <p className="ak-empty-state-body">{body}</p> : null}
      {action ? <div className="ak-empty-state-action">{action}</div> : null}
    </div>
  );
}
