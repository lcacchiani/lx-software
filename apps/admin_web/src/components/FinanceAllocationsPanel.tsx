import { type FormEvent, useCallback, useMemo, useState } from "react";
import { formatDateUtc } from "../lib/formatDisplay";
import { parseAmount } from "../lib/formParse";
import { type FinanceAllocationRecord } from "../lib/financeModel";
import {
  AdminDataTable,
  AdminDataTableEmptyRow,
  type AdminDataTableColumn,
  AdminEditorSection,
  MoneyAmount,
  TableIconButton,
  TableSortHeaderButton,
} from "./ui";

type AllocSortKey = "desc" | "monthly" | "accum" | "ccy" | "last";

function allocationLastUpdatedDisplay(lastUpdated: string | undefined): string {
  if (!lastUpdated) {
    return "—";
  }
  return formatDateUtc(`${lastUpdated}T00:00:00.000Z`);
}

function compareAllocations(
  a: FinanceAllocationRecord,
  b: FinanceAllocationRecord,
  sortKey: AllocSortKey,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "desc":
      cmp = a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      break;
    case "monthly": {
      const ma = a.monthlyAmount;
      const mb = b.monthlyAmount;
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "accum": {
      const ma = a.accumulatedAmount;
      const mb = b.accumulatedAmount;
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "ccy":
      cmp = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
      break;
    case "last": {
      const sa = a.lastUpdated ?? "";
      const sb = b.lastUpdated ?? "";
      if (!sa && !sb) {
        cmp = 0;
      } else if (!sa) {
        cmp = 1;
      } else if (!sb) {
        cmp = -1;
      } else {
        cmp = sa.localeCompare(sb);
      }
      break;
    }
    default:
      break;
  }
  if (cmp !== 0) return dir * cmp;
  return a.expenseId.localeCompare(b.expenseId);
}

export function FinanceAllocationsPanel(props: {
  readonly records: readonly FinanceAllocationRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinanceAllocationRecord[]) => FinanceAllocationRecord[],
  ) => void;
}) {
  const { records, onPatch } = props;
  const [sortKey, setSortKey] = useState<AllocSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const onSort = useCallback((key: AllocSortKey) => {
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir("asc");
        return key;
      }
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return prevKey;
    });
  }, []);

  const tableColumns = useMemo((): AdminDataTableColumn[] => {
    const manualSort = sortKey !== null;
    const thAria = (
      key: AllocSortKey,
    ): "ascending" | "descending" | "none" | "other" | undefined => {
      if (!manualSort) return undefined;
      if (sortKey === key) return sortDir === "asc" ? "ascending" : "descending";
      return "none";
    };
    const dirFor = (key: AllocSortKey): "asc" | "desc" | null =>
      sortKey === key ? sortDir : null;

    return [
      {
        key: "desc",
        header: (
          <TableSortHeaderButton
            label="Description"
            isActive={sortKey === "desc"}
            direction={dirFor("desc")}
            onClick={() => onSort("desc")}
          />
        ),
        className: "small",
        thAriaSort: thAria("desc"),
      },
      {
        key: "monthly",
        header: (
          <TableSortHeaderButton
            label="Monthly amount"
            isActive={sortKey === "monthly"}
            direction={dirFor("monthly")}
            align="end"
            onClick={() => onSort("monthly")}
          />
        ),
        className: "small text-end",
        headerClassName: "small text-end",
        thAriaSort: thAria("monthly"),
      },
      {
        key: "accum",
        header: (
          <TableSortHeaderButton
            label="Accumulated amount"
            isActive={sortKey === "accum"}
            direction={dirFor("accum")}
            align="end"
            onClick={() => onSort("accum")}
          />
        ),
        className: "small text-end",
        headerClassName: "small text-end",
        thAriaSort: thAria("accum"),
      },
      {
        key: "ccy",
        header: (
          <TableSortHeaderButton
            label="Currency"
            isActive={sortKey === "ccy"}
            direction={dirFor("ccy")}
            onClick={() => onSort("ccy")}
          />
        ),
        className: "small",
        thAriaSort: thAria("ccy"),
      },
      {
        key: "last",
        header: (
          <TableSortHeaderButton
            label="Last update"
            isActive={sortKey === "last"}
            direction={dirFor("last")}
            onClick={() => onSort("last")}
          />
        ),
        className: "small text-nowrap",
        thAriaSort: thAria("last"),
      },
      {
        key: "ops",
        header: <span className="visually-hidden">Operations</span>,
        className: "text-end text-nowrap",
        headerClassName: "text-end",
      },
    ];
  }, [sortKey, sortDir, onSort]);

  const colSpan = tableColumns.length;

  const [tableFilter, setTableFilter] = useState("");
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [accumStr, setAccumStr] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const list = !q
      ? [...records]
      : records.filter((r) => {
          const hay = [r.description, r.currency, String(r.monthlyAmount), String(r.accumulatedAmount)]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    if (sortKey !== null) {
      list.sort((a, b) => compareAllocations(a, b, sortKey, sortDir));
    } else {
      list.sort((a, b) =>
        a.description.localeCompare(b.description, undefined, { sensitivity: "base" }),
      );
    }
    return list;
  }, [records, tableFilter, sortKey, sortDir]);

  const editingRow = useMemo(
    () => (editingExpenseId ? records.find((r) => r.expenseId === editingExpenseId) : undefined),
    [records, editingExpenseId],
  );

  const formId = "finance-allocations-edit-form";

  function resetForm() {
    setEditingExpenseId(null);
    setAccumStr("");
    setFormError(null);
  }

  function openEdit(row: FinanceAllocationRecord) {
    setEditingExpenseId(row.expenseId);
    setAccumStr(String(row.accumulatedAmount));
    setFormError(null);
  }

  function submitAccumulated(e: FormEvent) {
    e.preventDefault();
    if (!editingExpenseId) return;
    const n = parseAmount(accumStr);
    if (n === null) {
      setFormError("Accumulated amount must be a valid number.");
      return;
    }
    onPatch((prev) =>
      prev.map((r) =>
        r.expenseId === editingExpenseId ? { ...r, accumulatedAmount: n } : r,
      ),
    );
    resetForm();
  }

  return (
    <div>
      <p className="text-muted small mb-3">
        Rows are expense ledger lines tagged <strong>Allocate</strong> on the Expenses tab. Tag or
        untag there; here you can only edit each row&apos;s accumulated amount.
      </p>

      {editingRow ? (
        <AdminEditorSection
          title="Edit accumulated amount"
          footer={
            <>
              <button type="submit" form={formId} className="btn btn-primary btn-sm">
                Save accumulated amount
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetForm}>
                Cancel
              </button>
            </>
          }
        >
          <form id={formId} onSubmit={submitAccumulated}>
            {formError ? (
              <div className="alert alert-danger py-2 small" role="alert">
                {formError}
              </div>
            ) : null}
            <div className="row g-3 align-items-end">
              <div className="col-md-4">
                <span className="form-label small d-block text-muted">Description (from expense)</span>
                <div className="small fw-semibold">{editingRow.description}</div>
              </div>
              <div className="col-md-2">
                <span className="form-label small d-block text-muted">Monthly amount</span>
                <div className="small">
                  <MoneyAmount
                    amount={editingRow.monthlyAmount}
                    currency={editingRow.currency}
                    amountOnly
                  />
                </div>
              </div>
              <div className="col-md-2">
                <span className="form-label small d-block text-muted">Currency</span>
                <div className="small">{editingRow.currency}</div>
              </div>
              <div className="col-md-2">
                <label className="form-label small" htmlFor="alloc-accum-input">
                  Accumulated amount
                </label>
                <input
                  id="alloc-accum-input"
                  type="number"
                  step="0.01"
                  className="form-control form-control-sm"
                  required
                  value={accumStr}
                  onChange={(ev) => setAccumStr(ev.target.value)}
                />
              </div>
            </div>
          </form>
        </AdminEditorSection>
      ) : null}

      <AdminEditorSection title="Allocations">
        <AdminDataTable
          embedded
          columns={tableColumns}
          filterValue={tableFilter}
          onFilterChange={setTableFilter}
          filterPlaceholder="Filter records…"
        >
          {filtered.length ? (
            filtered.map((r) => (
              <tr key={r.expenseId}>
                <td className="small">{r.description}</td>
                <td className="small text-end">
                  <MoneyAmount amount={r.monthlyAmount} currency={r.currency} amountOnly />
                </td>
                <td className="small text-end">
                  <MoneyAmount amount={r.accumulatedAmount} currency={r.currency} amountOnly />
                </td>
                <td className="small">{r.currency}</td>
                <td className="small text-nowrap">{allocationLastUpdatedDisplay(r.lastUpdated)}</td>
                <td className="small text-end">
                  <TableIconButton
                    iconClassName="bi bi-pencil"
                    ariaLabel="Edit accumulated amount"
                    onClick={() => openEdit(r)}
                  />
                </td>
              </tr>
            ))
          ) : (
            <AdminDataTableEmptyRow
              colSpan={colSpan}
              message={
                records.length
                  ? "No records match the filter."
                  : "No expenses are tagged Allocate yet. Use the Expenses tab to tag rows."
              }
            />
          )}
        </AdminDataTable>
      </AdminEditorSection>
    </div>
  );
}
