import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Mono } from "../mono";
import { EmptyState } from "./EmptyState";
import { TableSkeleton } from "./Skeleton";
import "./DataTable.css";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Right aligned mono numeric columns (CLAUDE.md numeric readout rule). */
  numeric?: boolean;
  render: (row: T) => ReactNode;
  width?: string;
}

export type DataTableDensity = "compact" | "comfortable";

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Whole row is a link; Enter opens (Part B plan B0.3). */
  rowHref?: (row: T) => string;
  density?: DataTableDensity;
  loading?: boolean;
  skeletonRows?: number;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  density = "comfortable",
  loading = false,
  skeletonRows = 6,
  emptyTitle = "Nothing here yet",
  emptyBody = "Once there is data it will show up in this table.",
  emptyAction,
}: DataTableProps<T>) {
  const navigate = useNavigate();

  if (loading) {
    return <TableSkeleton columns={columns.length} rows={skeletonRows} />;
  }

  if (rows.length === 0) {
    return (
      <div className="ak-table-empty-wrap">
        <EmptyState title={emptyTitle} body={emptyBody} action={emptyAction} />
      </div>
    );
  }

  return (
    <div className={`ak-table-wrap ak-table-${density}`}>
      <table className="ak-table" role="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? "ak-table-th-numeric" : undefined}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr
                key={rowKey(row)}
                className={href ? "ak-table-row-link" : undefined}
                onClick={
                  href
                    ? (event) => {
                        // The first cell carries a real anchor. Let its own
                        // click (and cmd click, middle click, open in new tab)
                        // do the work; the row click is only the convenience
                        // of hitting anywhere else in the row.
                        if ((event.target as HTMLElement).closest("a")) return;
                        navigate(href);
                      }
                    : undefined
                }
              >
                {columns.map((col, index) => {
                  const content = col.numeric ? <Mono>{col.render(row)}</Mono> : col.render(row);
                  return (
                    <td key={col.key} className={col.numeric ? "ak-table-td-numeric" : undefined}>
                      {href && index === 0 ? (
                        // A real link, not a click handler on a <tr>: it is what
                        // gives the row a keyboard stop, an accessible name, and
                        // open in a new tab. The row handler above cannot.
                        <Link className="ak-table-cell-link" to={href}>
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
