import "./Card.css";
import "./DataTable.css";
import "./Skeleton.css";

export function Skeleton({ width, height = 16, radius = "sm" }: { width?: string | number; height?: number; radius?: "sm" | "md" | "pill" }) {
  return (
    <span
      className={`ak-skeleton ak-skeleton-${radius}`}
      // Exception to kit/'s no-inline-style rule: width/height are per-call
      // dynamic content dimensions (matching the real content's shape), not
      // a design decision, so there is no token to route this through.
      style={{ width: width ?? "100%", height }}
      aria-hidden="true"
    />
  );
}

/** Shaped like a data table, never "Loading..." (Part B plan B0.9). */
export function TableSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="ak-table-wrap" role="status" aria-busy="true" aria-label="Loading table">
      <table className="ak-table">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i}>
                <Skeleton width={80} height={12} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c}>
                  <Skeleton width={c === 0 ? "70%" : "40%"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shaped like DetailLayout's 2fr/1fr grid. */
export function DetailSkeleton() {
  return (
    <div className="ak-detail-skeleton" role="status" aria-busy="true" aria-label="Loading detail">
      <div className="ak-detail-skeleton-main">
        <div className="ak-card ak-detail-skeleton-card">
          <Skeleton width={140} height={14} />
          <Skeleton width="90%" height={20} />
          <Skeleton width="70%" height={20} />
        </div>
        <div className="ak-card ak-detail-skeleton-card">
          <Skeleton width={160} height={14} />
          <Skeleton width="100%" height={80} radius="md" />
        </div>
      </div>
      <div className="ak-detail-skeleton-side">
        <div className="ak-card ak-detail-skeleton-card">
          <Skeleton width={100} height={14} />
          <Skeleton width="80%" height={16} />
          <Skeleton width="60%" height={16} />
        </div>
      </div>
    </div>
  );
}
