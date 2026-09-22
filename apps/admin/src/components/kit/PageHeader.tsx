import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import "./PageHeader.css";

export interface Breadcrumb {
  label: string;
  to?: string;
}

/**
 * PageHeader: breadcrumb, title, description, one primary action, secondary
 * actions. Part B rule B0.2: no page renders its own title outside this.
 */
export function PageHeader({
  breadcrumbs,
  title,
  description,
  primaryAction,
  secondaryActions,
}: {
  breadcrumbs?: Breadcrumb[];
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
}) {
  return (
    <div className="ak-page-header">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav className="ak-breadcrumb" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="ak-breadcrumb-item">
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span>{crumb.label}</span>}
              {i < breadcrumbs.length - 1 ? <ChevronRight size={14} strokeWidth={1.75} /> : null}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="ak-page-header-row">
        <div className="ak-page-header-titles">
          <h1 className="ak-page-header-title">{title}</h1>
          {description ? <p className="ak-page-header-description">{description}</p> : null}
        </div>
        <div className="ak-page-header-actions">
          {secondaryActions}
          {primaryAction}
        </div>
      </div>
    </div>
  );
}
