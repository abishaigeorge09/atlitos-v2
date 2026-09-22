import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

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
                tabIndex={href ? 0 : undefined}
                className={href ? "ak-table-row-link" : undefined}
                onClick={href ? () => navigate(href) : undefined}
                onKeyDown={
                  href
                    ? (event) => {
                        if (event.key === "Enter") navigate(href);
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.numeric ? "ak-table-td-numeric" : undefined}>
                    {col.numeric ? <Mono>{col.render(row)}</Mono> : col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
