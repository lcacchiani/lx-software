import { useId, type ReactNode } from "react";

export type AdminDataTableColumn = {
  readonly key: string;
  readonly header: ReactNode;
  readonly className?: string;
  readonly headerClassName?: string;
};

export type AdminDataTableProps = {
  readonly columns: readonly AdminDataTableColumn[];
  readonly filterValue: string;
  readonly onFilterChange: (value: string) => void;
  readonly filterPlaceholder?: string;
  readonly children: ReactNode;
};

/**
 * Standard admin table: filter field, striped rows, last column reserved for operations.
 * Pass table body rows as `children` (typically `<tr>` elements).
 */
export function AdminDataTable({
  columns,
  filterValue,
  onFilterChange,
  filterPlaceholder = "Filter rows…",
  children,
}: AdminDataTableProps) {
  const filterId = useId();

  return (
    <div className="card shadow-sm">
      <div className="card-body py-2 border-bottom">
        <label className="visually-hidden" htmlFor={filterId}>
          Filter table
        </label>
        <input
          id={filterId}
          type="search"
          className="form-control form-control-sm"
          placeholder={filterPlaceholder}
          autoComplete="off"
          value={filterValue}
          onChange={(ev) => onFilterChange(ev.target.value)}
        />
      </div>
      <div className="table-responsive">
        <table className="table table-sm table-striped mb-0 align-middle">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={col.headerClassName ?? col.className}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export type AdminDataTableEmptyProps = {
  readonly colSpan: number;
  readonly message: string;
};

export function AdminDataTableEmptyRow({ colSpan, message }: AdminDataTableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-muted text-center py-4">
        {message}
      </td>
    </tr>
  );
}
