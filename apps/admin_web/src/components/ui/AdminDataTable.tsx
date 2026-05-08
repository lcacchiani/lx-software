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
  /**
   * When true, omit the outer card (for nesting inside `AdminEditorSection` or similar).
   * Uses slightly roomier table density than the standalone card.
   */
  readonly embedded?: boolean;
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
  embedded = false,
}: AdminDataTableProps) {
  const filterId = useId();

  const filterBlock = (
    <div className={embedded ? "pb-3 border-bottom" : "card-body py-2 border-bottom"}>
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
  );

  const tableBlock = (
    <div className={embedded ? "table-responsive pt-3" : "table-responsive"}>
      <table
        className={`table table-striped mb-0 align-middle ${embedded ? "" : "table-sm"}`}
      >
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
  );

  if (embedded) {
    return (
      <>
        {filterBlock}
        {tableBlock}
      </>
    );
  }

  return (
    <div className="card shadow-sm">
      {filterBlock}
      {tableBlock}
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
