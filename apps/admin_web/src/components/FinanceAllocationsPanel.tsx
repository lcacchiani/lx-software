import { type FormEvent, Fragment, useCallback, useMemo, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { formatDateUtc } from "../lib/formatDisplay";
import { parseAmount } from "../lib/formParse";
import { convertAmountToBase } from "../lib/frankfurterRates";
import {
  type FinanceAllocationRecord,
  newCustomAllocationExpenseId,
} from "../lib/financeModel";
import { useFrankfurterRatesForTotals } from "../hooks/useFrankfurterRatesForTotals";
import {
  AdminDataTable,
  AdminDataTableEmptyRow,
  type AdminDataTableColumn,
  AdminEditorSection,
  CurrencySelect,
  FrankfurterRatesFooterNote,
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

/** Rebuild a row without income-tag fields (used when clearing the Income tag). */
function allocationRowWithoutIncomeTag(row: FinanceAllocationRecord): FinanceAllocationRecord {
  return {
    expenseId: row.expenseId,
    description: row.description,
    monthlyAmount: row.monthlyAmount,
    accumulatedAmount: row.accumulatedAmount,
    currency: row.currency,
    ...(row.lastUpdated !== undefined ? { lastUpdated: row.lastUpdated } : {}),
    ...(row.isCustomAllocation === true ? { isCustomAllocation: true as const } : {}),
    ...(row.relatedHouse !== undefined ? { relatedHouse: row.relatedHouse } : {}),
  };
}

function allocationMonthlyColumnDisplay(
  row: FinanceAllocationRecord,
): { readonly kind: "dash" } | { readonly kind: "amount"; readonly value: number; readonly currency: string } {
  if (row.isCustomAllocation === true) {
    if (row.isIncome === true) {
      return {
        kind: "amount",
        value: row.allocationIncomeMonthly ?? 0,
        currency: row.currency,
      };
    }
    return { kind: "dash" };
  }
  return { kind: "amount", value: row.monthlyAmount, currency: row.currency };
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
        key: "tags",
        header: <span className="fw-semibold text-nowrap">Tags</span>,
        className: "small text-muted",
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
  const [editDesc, setEditDesc] = useState("");
  const [editCcy, setEditCcy] = useState(GLOBAL_DEFAULT_CURRENCY);
  const [editIsIncome, setEditIsIncome] = useState(false);
  const [editIncomeMonthlyStr, setEditIncomeMonthlyStr] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [customDesc, setCustomDesc] = useState("");
  const [customCcy, setCustomCcy] = useState<CurrencyCode>(GLOBAL_DEFAULT_CURRENCY);
  const [customAccumStr, setCustomAccumStr] = useState("");
  const [customIsIncome, setCustomIsIncome] = useState(false);
  const [customIncomeMonthlyStr, setCustomIncomeMonthlyStr] = useState("");
  const [customFormError, setCustomFormError] = useState<string | null>(null);
  const [totalDisplayCurrency, setTotalDisplayCurrency] = useState<CurrencyCode>(
    GLOBAL_DEFAULT_CURRENCY,
  );

  const filtered = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const list = !q
      ? [...records]
      : records.filter((r) => {
          const hay = [r.description, r.currency, String(r.monthlyAmount), String(r.accumulatedAmount)]
            .join(" ")
            .toLowerCase();
          const tagHay = r.isIncome === true ? "income" : "";
          return `${hay} ${tagHay}`.includes(q);
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

  const recordCurrencies = useMemo(() => records.map((r) => r.currency), [records]);

  const { needsFx, ratesQuery, fxLoading, fxError } = useFrankfurterRatesForTotals(
    totalDisplayCurrency,
    recordCurrencies,
  );

  const convertedAccumulatedTotal = useMemo(() => {
    if (records.length === 0) {
      return null;
    }
    let map: ReadonlyMap<string, number> = new Map();
    if (needsFx) {
      if (!ratesQuery.isSuccess) return null;
      const ratePayload = ratesQuery.data;
      if (!ratePayload) return null;
      map = ratePayload.rateByQuote;
    }
    try {
      return records.reduce(
        (sum, r) =>
          sum +
          convertAmountToBase(
            r.accumulatedAmount,
            r.currency,
            totalDisplayCurrency,
            map,
          ),
        0,
      );
    } catch {
      return null;
    }
  }, [records, needsFx, ratesQuery.isSuccess, ratesQuery.data, totalDisplayCurrency]);

  const editingRow = useMemo(
    () => (editingExpenseId ? records.find((r) => r.expenseId === editingExpenseId) : undefined),
    [records, editingExpenseId],
  );

  const formId = "finance-allocations-edit-form";
  const addCustomFormId = "finance-allocations-add-custom-form";

  function resetForm() {
    setEditingExpenseId(null);
    setAccumStr("");
    setEditDesc("");
    setEditCcy(GLOBAL_DEFAULT_CURRENCY);
    setEditIsIncome(false);
    setEditIncomeMonthlyStr("");
    setFormError(null);
  }

  function openEdit(row: FinanceAllocationRecord) {
    setEditingExpenseId(row.expenseId);
    setAccumStr(String(row.accumulatedAmount));
    setFormError(null);
    setEditIsIncome(row.isIncome === true);
    setEditIncomeMonthlyStr(
      row.isCustomAllocation === true && row.allocationIncomeMonthly !== undefined
        ? String(row.allocationIncomeMonthly)
        : "",
    );
    if (row.isCustomAllocation === true) {
      setEditDesc(row.description);
      setEditCcy(coerceSupportedCurrency(row.currency, GLOBAL_DEFAULT_CURRENCY));
    } else {
      setEditDesc("");
      setEditCcy(GLOBAL_DEFAULT_CURRENCY);
    }
  }

  function submitAllocationEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingExpenseId || !editingRow) return;
    const n = parseAmount(accumStr);
    if (n === null) {
      setFormError("Accumulated amount must be a valid number.");
      return;
    }
    if (editingRow.isCustomAllocation === true) {
      const d = editDesc.trim();
      if (!d) {
        setFormError("Description is required.");
        return;
      }
      const ccy = coerceSupportedCurrency(editCcy, GLOBAL_DEFAULT_CURRENCY);
      if (editIsIncome) {
        const inc = parseAmount(editIncomeMonthlyStr);
        if (inc === null) {
          setFormError("Monthly income amount must be a valid number.");
          return;
        }
        if (inc <= 0) {
          setFormError("Monthly income amount must be positive when Income is checked.");
          return;
        }
        onPatch((prev) =>
          prev.map((r) =>
            r.expenseId === editingExpenseId
              ? {
                  ...allocationRowWithoutIncomeTag(r),
                  description: d,
                  currency: ccy,
                  accumulatedAmount: n,
                  monthlyAmount: 0,
                  isCustomAllocation: true as const,
                  isIncome: true as const,
                  allocationIncomeMonthly: inc,
                }
              : r,
          ),
        );
      } else {
        onPatch((prev) =>
          prev.map((r) =>
            r.expenseId === editingExpenseId
              ? {
                  ...allocationRowWithoutIncomeTag(r),
                  description: d,
                  currency: ccy,
                  accumulatedAmount: n,
                  monthlyAmount: 0,
                  isCustomAllocation: true as const,
                }
              : r,
          ),
        );
      }
    } else {
      if (editIsIncome) {
        onPatch((prev) =>
          prev.map((r) =>
            r.expenseId === editingExpenseId
              ? { ...allocationRowWithoutIncomeTag(r), accumulatedAmount: n, isIncome: true as const }
              : r,
          ),
        );
      } else {
        onPatch((prev) =>
          prev.map((r) =>
            r.expenseId === editingExpenseId
              ? { ...allocationRowWithoutIncomeTag(r), accumulatedAmount: n }
              : r,
          ),
        );
      }
    }
    resetForm();
  }

  function submitAddCustom(e: FormEvent) {
    e.preventDefault();
    const d = customDesc.trim();
    if (!d) {
      setCustomFormError("Description is required.");
      return;
    }
    const n = parseAmount(customAccumStr);
    if (n === null) {
      setCustomFormError("Accumulated amount must be a valid number.");
      return;
    }
    const ccy = coerceSupportedCurrency(customCcy, GLOBAL_DEFAULT_CURRENCY);
    if (customIsIncome) {
      const inc = parseAmount(customIncomeMonthlyStr);
      if (inc === null) {
        setCustomFormError("Monthly income amount must be a valid number.");
        return;
      }
      if (inc <= 0) {
        setCustomFormError("Monthly income amount must be positive when Income is checked.");
        return;
      }
      onPatch((prev) => [
        ...prev,
        {
          expenseId: newCustomAllocationExpenseId(),
          description: d,
          monthlyAmount: 0,
          accumulatedAmount: n,
          currency: ccy,
          isCustomAllocation: true as const,
          isIncome: true as const,
          allocationIncomeMonthly: inc,
        },
      ]);
    } else {
      onPatch((prev) => [
        ...prev,
        {
          expenseId: newCustomAllocationExpenseId(),
          description: d,
          monthlyAmount: 0,
          accumulatedAmount: n,
          currency: ccy,
          isCustomAllocation: true as const,
        },
      ]);
    }
    setCustomDesc("");
    setCustomCcy(GLOBAL_DEFAULT_CURRENCY);
    setCustomAccumStr("");
    setCustomIsIncome(false);
    setCustomIncomeMonthlyStr("");
    setCustomFormError(null);
  }

  function deleteCustomRow(expenseId: string) {
    if (!window.confirm("Delete this custom allocation?")) return;
    onPatch((prev) => prev.filter((r) => r.expenseId !== expenseId));
    if (editingExpenseId === expenseId) {
      resetForm();
    }
  }

  return (
    <div>
      <p className="text-muted small mb-3">
        Linked rows come from expenses tagged <strong>Allocate</strong> on the Expenses tab or from
        derived allocation lines (also labeled Allocate there); for those you only set accumulated
        amounts here—the monthly column follows the expense ledger. Check <strong>Income</strong> to
        mirror that monthly amount on the Income tab (for custom lines, enter the monthly income
        when Income is checked). <strong>Custom allocations</strong> are lines you add below: set
        description, currency, and accumulated amount; monthly is optional when tagged as income.
      </p>

      <AdminEditorSection
        title="Custom allocation"
        footer={
          <>
            <button type="submit" form={addCustomFormId} className="btn btn-primary btn-sm">
              Add allocation
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                setCustomDesc("");
                setCustomCcy(GLOBAL_DEFAULT_CURRENCY);
                setCustomAccumStr("");
                setCustomIsIncome(false);
                setCustomIncomeMonthlyStr("");
                setCustomFormError(null);
              }}
            >
              Clear
            </button>
          </>
        }
      >
        <form id={addCustomFormId} onSubmit={submitAddCustom}>
          {customFormError ? (
            <div className="alert alert-danger py-2 small" role="alert">
              {customFormError}
            </div>
          ) : null}
          <div className="row g-3 align-items-end">
            <div className="col-md-4">
              <label className="form-label small" htmlFor="alloc-add-desc">
                Description
              </label>
              <input
                id="alloc-add-desc"
                type="text"
                className="form-control form-control-sm"
                required
                value={customDesc}
                onChange={(ev) => setCustomDesc(ev.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor="alloc-add-ccy">
                Currency
              </label>
              <CurrencySelect
                id="alloc-add-ccy"
                value={customCcy}
                onChange={(code) =>
                  setCustomCcy(coerceSupportedCurrency(code, GLOBAL_DEFAULT_CURRENCY))
                }
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor="alloc-add-accum">
                Accumulated amount
              </label>
              <input
                id="alloc-add-accum"
                type="number"
                step="0.01"
                className="form-control form-control-sm"
                required
                value={customAccumStr}
                onChange={(ev) => setCustomAccumStr(ev.target.value)}
              />
            </div>
          </div>
          <div className="row g-3 mt-2 align-items-end">
            <div className="col-12">
              <div className="form-check mb-0">
                <input
                  id="alloc-add-income"
                  type="checkbox"
                  className="form-check-input"
                  checked={customIsIncome}
                  onChange={(ev) => setCustomIsIncome(ev.target.checked)}
                />
                <label className="form-check-label small" htmlFor="alloc-add-income">
                  Income (show on Income tab with monthly amount below)
                </label>
              </div>
            </div>
            {customIsIncome ? (
              <div className="col-md-2">
                <label className="form-label small" htmlFor="alloc-add-income-monthly">
                  Monthly income
                </label>
                <input
                  id="alloc-add-income-monthly"
                  type="number"
                  step="0.01"
                  className="form-control form-control-sm"
                  required={customIsIncome}
                  value={customIncomeMonthlyStr}
                  onChange={(ev) => setCustomIncomeMonthlyStr(ev.target.value)}
                />
              </div>
            ) : null}
          </div>
        </form>
      </AdminEditorSection>

      {editingRow ? (
        <AdminEditorSection
          title={
            editingRow.isCustomAllocation === true
              ? "Edit custom allocation"
              : "Edit accumulated amount"
          }
          footer={
            <>
              <button type="submit" form={formId} className="btn btn-primary btn-sm">
                {editingRow.isCustomAllocation === true ? "Save changes" : "Save accumulated amount"}
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetForm}>
                Cancel
              </button>
            </>
          }
        >
          <form id={formId} onSubmit={submitAllocationEdit}>
            {formError ? (
              <div className="alert alert-danger py-2 small" role="alert">
                {formError}
              </div>
            ) : null}
            {editingRow.isCustomAllocation === true ? (
              <Fragment>
              <div className="row g-3 align-items-end">
                <div className="col-md-4">
                  <label className="form-label small" htmlFor="alloc-edit-desc">
                    Description
                  </label>
                  <input
                    id="alloc-edit-desc"
                    type="text"
                    className="form-control form-control-sm"
                    required
                    value={editDesc}
                    onChange={(ev) => setEditDesc(ev.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="alloc-edit-ccy">
                    Currency
                  </label>
                  <CurrencySelect
                    id="alloc-edit-ccy"
                    value={editCcy}
                    onChange={(code) =>
                      setEditCcy(coerceSupportedCurrency(code, GLOBAL_DEFAULT_CURRENCY))
                    }
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="alloc-edit-income-monthly">
                    Monthly income
                  </label>
                  <input
                    id="alloc-edit-income-monthly"
                    type="number"
                    step="0.01"
                    className="form-control form-control-sm"
                    required={editIsIncome}
                    disabled={!editIsIncome}
                    value={editIncomeMonthlyStr}
                    onChange={(ev) => setEditIncomeMonthlyStr(ev.target.value)}
                  />
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
              <div className="row g-3 mt-2">
                <div className="col-12">
                  <div className="form-check mb-0">
                    <input
                      id="alloc-edit-income"
                      type="checkbox"
                      className="form-check-input"
                      checked={editIsIncome}
                      onChange={(ev) => {
                        setEditIsIncome(ev.target.checked);
                        if (!ev.target.checked) {
                          setEditIncomeMonthlyStr("");
                        }
                      }}
                    />
                    <label className="form-check-label small" htmlFor="alloc-edit-income">
                      Income (show on Income tab)
                    </label>
                  </div>
                </div>
              </div>
              </Fragment>
            ) : (
              <Fragment>
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
              <div className="row g-3 mt-2">
                <div className="col-12">
                  <div className="form-check mb-0">
                    <input
                      id="alloc-edit-linked-income"
                      type="checkbox"
                      className="form-check-input"
                      checked={editIsIncome}
                      onChange={(ev) => setEditIsIncome(ev.target.checked)}
                    />
                    <label className="form-check-label small" htmlFor="alloc-edit-linked-income">
                      Income (show monthly amount from the expense on the Income tab)
                    </label>
                  </div>
                </div>
              </div>
              </Fragment>
            )}
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
            filtered.map((r) => {
              const monthlyCol = allocationMonthlyColumnDisplay(r);
              return (
              <tr key={r.expenseId}>
                <td className="small">{r.description}</td>
                <td className="small text-muted">{r.isIncome === true ? "Income" : "—"}</td>
                <td className="small text-end">
                  {monthlyCol.kind === "dash" ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <MoneyAmount
                      amount={monthlyCol.value}
                      currency={monthlyCol.currency}
                      amountOnly
                    />
                  )}
                </td>
                <td className="small text-end">
                  <MoneyAmount amount={r.accumulatedAmount} currency={r.currency} amountOnly />
                </td>
                <td className="small">{r.currency}</td>
                <td className="small text-nowrap">{allocationLastUpdatedDisplay(r.lastUpdated)}</td>
                <td className="small text-end">
                  <TableIconButton
                    iconClassName="bi bi-pencil"
                    ariaLabel={
                      r.isCustomAllocation === true
                        ? "Edit custom allocation"
                        : "Edit accumulated amount"
                    }
                    onClick={() => openEdit(r)}
                  />
                  {r.isCustomAllocation === true ? (
                    <TableIconButton
                      iconClassName="bi bi-trash"
                      ariaLabel="Delete custom allocation"
                      variant="danger"
                      onClick={() => deleteCustomRow(r.expenseId)}
                    />
                  ) : null}
                </td>
              </tr>
            );
            })
          ) : (
            <AdminDataTableEmptyRow
              colSpan={colSpan}
              message={
                records.length
                  ? "No records match the filter."
                  : "No allocation rows yet. Tag an expense with Allocate, add derived lines via tagged income and allocation rates on Expenses, or create a custom allocation above."
              }
            />
          )}
          {records.length > 0 ? (
            <tr className="table-group-divider table-secondary fw-semibold">
              <td className="small">Total (accumulated)</td>
              <td className="small" />
              <td className="small text-muted fw-normal">
                <FrankfurterRatesFooterNote
                  needsFx={needsFx}
                  fxError={fxError}
                  fxLoading={fxLoading}
                  ratesQuery={ratesQuery}
                />
              </td>
              <td className="small text-end">
                {convertedAccumulatedTotal !== null ? (
                  <MoneyAmount
                    amount={convertedAccumulatedTotal}
                    currency={totalDisplayCurrency}
                    amountOnly
                  />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="small">
                <CurrencySelect
                  id="finance-allocations-total-ccy"
                  className="form-select form-select-sm"
                  value={totalDisplayCurrency}
                  onChange={(code) =>
                    setTotalDisplayCurrency(coerceSupportedCurrency(code, GLOBAL_DEFAULT_CURRENCY))
                  }
                  disabled={fxLoading}
                />
              </td>
              <td className="small" />
              <td className="small text-end" />
            </tr>
          ) : null}
        </AdminDataTable>
      </AdminEditorSection>
    </div>
  );
}
