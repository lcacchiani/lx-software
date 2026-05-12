import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { formatDateUtc } from "../lib/formatDisplay";
import { parseAmount } from "../lib/formParse";
import { convertAmountToBase } from "../lib/frankfurterRates";
import { scheduleFocusRecordEditor } from "../lib/focusRecordEditor";
import {
  CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX,
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

/** Linked rows mirror an expense tagged Allocate; custom rows are created on the Allocations tab. */
function allocationTagsCellLabel(r: FinanceAllocationRecord): string {
  const isCustom =
    r.isCustomAllocation === true || r.expenseId.startsWith(CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX);
  const parts: string[] = [];
  if (!isCustom) {
    parts.push("Expenses");
  } else if (r.isIncome === true) {
    parts.push("Income");
  }
  if (r.isPension === true) {
    parts.push("Pension");
  }
  if (parts.length === 0) {
    return "—";
  }
  return parts.join(", ");
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

/** Linked row patch from editor: optional Income and Pension tags (omit when unchecked). */
function linkedStoredRowPatch(
  row: FinanceAllocationRecord,
  accumulatedAmount: number,
  flags: { readonly isIncome: boolean; readonly isPension: boolean },
): FinanceAllocationRecord {
  return {
    expenseId: row.expenseId,
    description: row.description,
    monthlyAmount: row.monthlyAmount,
    accumulatedAmount,
    currency: row.currency,
    ...(row.lastUpdated !== undefined ? { lastUpdated: row.lastUpdated } : {}),
    ...(row.relatedHouse !== undefined ? { relatedHouse: row.relatedHouse } : {}),
    ...(flags.isIncome ? { isIncome: true as const } : {}),
    ...(flags.isPension ? { isPension: true as const } : {}),
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
  const allocationEditorSectionRef = useRef<HTMLDivElement | null>(null);
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
  const [editingCustomExpenseId, setEditingCustomExpenseId] = useState<string | null>(null);
  const [editingLinkedExpenseId, setEditingLinkedExpenseId] = useState<string | null>(null);
  const [linkedAccumStr, setLinkedAccumStr] = useState("");
  const [linkedIsIncome, setLinkedIsIncome] = useState(false);
  const [linkedIsPension, setLinkedIsPension] = useState(false);
  const [linkedFormError, setLinkedFormError] = useState<string | null>(null);
  const [customDesc, setCustomDesc] = useState("");
  const [customCcy, setCustomCcy] = useState<CurrencyCode>(GLOBAL_DEFAULT_CURRENCY);
  const [customAccumStr, setCustomAccumStr] = useState("");
  const [customIsIncome, setCustomIsIncome] = useState(false);
  const [customIsPension, setCustomIsPension] = useState(false);
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
          const tagHay = allocationTagsCellLabel(r).toLowerCase();
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

  const recordCurrencies = useMemo(() => filtered.map((r) => r.currency), [filtered]);

  const { needsFx, ratesQuery, fxLoading, fxError } = useFrankfurterRatesForTotals(
    totalDisplayCurrency,
    recordCurrencies,
  );

  const convertedAccumulatedTotal = useMemo(() => {
    if (filtered.length === 0) {
      return records.length === 0 ? null : 0;
    }
    let map: ReadonlyMap<string, number> = new Map();
    if (needsFx) {
      if (!ratesQuery.isSuccess) return null;
      const ratePayload = ratesQuery.data;
      if (!ratePayload) return null;
      map = ratePayload.rateByQuote;
    }
    try {
      return filtered.reduce(
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
  }, [
    filtered,
    records.length,
    needsFx,
    ratesQuery.isSuccess,
    ratesQuery.data,
    totalDisplayCurrency,
  ]);

  const editingLinkedRow = useMemo(
    () =>
      editingLinkedExpenseId
        ? records.find((r) => r.expenseId === editingLinkedExpenseId)
        : undefined,
    [records, editingLinkedExpenseId],
  );

  const editorFormId = "finance-allocations-editor-form";

  function resetCustomForm() {
    setEditingCustomExpenseId(null);
    setCustomDesc("");
    setCustomCcy(GLOBAL_DEFAULT_CURRENCY);
    setCustomAccumStr("");
    setCustomIsIncome(false);
    setCustomIsPension(false);
    setCustomIncomeMonthlyStr("");
    setCustomFormError(null);
  }

  function resetLinkedForm() {
    setEditingLinkedExpenseId(null);
    setLinkedAccumStr("");
    setLinkedIsIncome(false);
    setLinkedIsPension(false);
    setLinkedFormError(null);
  }

  function openEdit(row: FinanceAllocationRecord) {
    if (row.isCustomAllocation === true) {
      setEditingLinkedExpenseId(null);
      setLinkedAccumStr("");
      setLinkedIsIncome(false);
      setLinkedIsPension(false);
      setLinkedFormError(null);
      setEditingCustomExpenseId(row.expenseId);
      setCustomFormError(null);
      setCustomDesc(row.description);
      setCustomCcy(coerceSupportedCurrency(row.currency, GLOBAL_DEFAULT_CURRENCY));
      setCustomAccumStr(String(row.accumulatedAmount));
      setCustomIsIncome(row.isIncome === true);
      setCustomIsPension(row.isPension === true);
      setCustomIncomeMonthlyStr(
        row.allocationIncomeMonthly !== undefined ? String(row.allocationIncomeMonthly) : "",
      );
      scheduleFocusRecordEditor(() => allocationEditorSectionRef.current);
    } else {
      resetCustomForm();
      setEditingLinkedExpenseId(row.expenseId);
      setLinkedFormError(null);
      setLinkedAccumStr(String(row.accumulatedAmount));
      setLinkedIsIncome(row.isIncome === true);
      setLinkedIsPension(row.isPension === true);
      scheduleFocusRecordEditor(() => allocationEditorSectionRef.current);
    }
  }

  function submitCustomAllocationCore() {
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
      if (editingCustomExpenseId) {
        onPatch((prev) =>
          prev.map((r) =>
            r.expenseId === editingCustomExpenseId
              ? {
                  expenseId: r.expenseId,
                  description: d,
                  currency: ccy,
                  accumulatedAmount: n,
                  monthlyAmount: 0,
                  isCustomAllocation: true as const,
                  isIncome: true as const,
                  allocationIncomeMonthly: inc,
                  ...(customIsPension ? { isPension: true as const } : {}),
                }
              : r,
          ),
        );
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
            isIncome: true as const,
            allocationIncomeMonthly: inc,
            ...(customIsPension ? { isPension: true as const } : {}),
          },
        ]);
      }
    } else if (editingCustomExpenseId) {
      onPatch((prev) =>
        prev.map((r) =>
          r.expenseId === editingCustomExpenseId
            ? {
                expenseId: r.expenseId,
                description: d,
                currency: ccy,
                accumulatedAmount: n,
                monthlyAmount: 0,
                isCustomAllocation: true as const,
                ...(customIsPension ? { isPension: true as const } : {}),
              }
            : r,
        ),
      );
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
          ...(customIsPension ? { isPension: true as const } : {}),
        },
      ]);
    }
    resetCustomForm();
  }

  function submitEditor(e: FormEvent) {
    e.preventDefault();
    if (editingLinkedExpenseId && editingLinkedRow) {
      submitLinkedAllocationEditCore();
      return;
    }
    submitCustomAllocationCore();
  }

  function submitLinkedAllocationEditCore() {
    if (!editingLinkedExpenseId || !editingLinkedRow) return;
    const n = parseAmount(linkedAccumStr);
    if (n === null) {
      setLinkedFormError("Accumulated amount must be a valid number.");
      return;
    }
    onPatch((prev) =>
      prev.map((r) =>
        r.expenseId === editingLinkedExpenseId
          ? linkedStoredRowPatch(r, n, {
              isIncome: linkedIsIncome,
              isPension: linkedIsPension,
            })
          : r,
      ),
    );
    resetLinkedForm();
  }

  function deleteCustomRow(expenseId: string) {
    if (!window.confirm("Delete this custom allocation?")) return;
    onPatch((prev) => prev.filter((r) => r.expenseId !== expenseId));
    if (editingCustomExpenseId === expenseId) {
      resetCustomForm();
    }
  }

  return (
    <div>
      <p className="text-muted small mb-3">
        Linked rows come from expenses tagged <strong>Allocate</strong> on the Expenses tab or from
        derived allocation lines (also labeled Allocate there); for those you only set accumulated
        amounts here—the monthly column follows the expense ledger. Check <strong>Income</strong> to
        mirror that monthly amount on the Income tab (for custom lines, enter the monthly income
        when Income is checked). Check <strong>Pension</strong> to show that row in the Pension tab
        table (accumulated amount appears as value). Use the editor below to add or change custom
        lines, or to adjust accumulated amounts and tag settings for linked rows.
      </p>

      <AdminEditorSection
        containerRef={allocationEditorSectionRef}
        title={editingLinkedRow ? "Edit accumulated amount" : "Custom allocation"}
        footer={
          editingLinkedRow ? (
            <>
              <button type="submit" form={editorFormId} className="btn btn-primary btn-sm">
                Save accumulated amount
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetLinkedForm}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="submit" form={editorFormId} className="btn btn-primary btn-sm">
                {editingCustomExpenseId ? "Update allocation" : "Add allocation"}
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetCustomForm}>
                Clear
              </button>
            </>
          )
        }
      >
        <form id={editorFormId} onSubmit={submitEditor}>
          {(editingLinkedRow ? linkedFormError : customFormError) ? (
            <div className="alert alert-danger py-2 small" role="alert">
              {editingLinkedRow ? linkedFormError : customFormError}
            </div>
          ) : null}
          {editingLinkedRow ? (
            <>
              <div className="row g-3 align-items-end">
                <div className="col-md-2">
                  <span className="form-label small d-block text-muted">Description (from expense)</span>
                  <div className="small fw-semibold">{editingLinkedRow.description}</div>
                </div>
                <div className="col-md-2">
                  <span className="form-label small d-block text-muted">Monthly amount</span>
                  <div className="small">
                    <MoneyAmount
                      amount={editingLinkedRow.monthlyAmount}
                      currency={editingLinkedRow.currency}
                      amountOnly
                    />
                  </div>
                </div>
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="alloc-linked-accum">
                    Accumulated amount
                  </label>
                  <input
                    id="alloc-linked-accum"
                    type="number"
                    step="0.01"
                    className="form-control form-control-sm"
                    required
                    value={linkedAccumStr}
                    onChange={(ev) => setLinkedAccumStr(ev.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <span className="form-label small d-block text-muted">Currency</span>
                  <div className="small">{editingLinkedRow.currency}</div>
                </div>
              </div>
              <div className="row g-3 mt-2">
                <div className="col-12">
                  <div className="form-check mb-0">
                    <input
                      id="alloc-linked-income"
                      type="checkbox"
                      className="form-check-input"
                      checked={linkedIsIncome}
                      onChange={(ev) => setLinkedIsIncome(ev.target.checked)}
                    />
                    <label className="form-check-label small" htmlFor="alloc-linked-income">
                      Income (show monthly amount from the expense on the Income tab)
                    </label>
                  </div>
                  <div className="form-check mb-0 mt-2">
                    <input
                      id="alloc-linked-pension"
                      type="checkbox"
                      className="form-check-input"
                      checked={linkedIsPension}
                      onChange={(ev) => setLinkedIsPension(ev.target.checked)}
                    />
                    <label className="form-check-label small" htmlFor="alloc-linked-pension">
                      Pension (show this row on the Pension tab)
                    </label>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="row g-3 align-items-end">
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="alloc-custom-desc">
                    Description
                  </label>
                  <input
                    id="alloc-custom-desc"
                    type="text"
                    className="form-control form-control-sm"
                    required
                    value={customDesc}
                    onChange={(ev) => setCustomDesc(ev.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="alloc-custom-accum">
                    Accumulated amount
                  </label>
                  <input
                    id="alloc-custom-accum"
                    type="number"
                    step="0.01"
                    className="form-control form-control-sm"
                    required
                    value={customAccumStr}
                    onChange={(ev) => setCustomAccumStr(ev.target.value)}
                  />
                </div>
                {customIsIncome ? (
                  <div className="col-md-2">
                    <label className="form-label small" htmlFor="alloc-custom-income-monthly">
                      Monthly income
                    </label>
                    <input
                      id="alloc-custom-income-monthly"
                      type="number"
                      step="0.01"
                      className="form-control form-control-sm"
                      required={customIsIncome}
                      value={customIncomeMonthlyStr}
                      onChange={(ev) => setCustomIncomeMonthlyStr(ev.target.value)}
                    />
                  </div>
                ) : null}
                <div className="col-md-2">
                  <label className="form-label small" htmlFor="alloc-custom-ccy">
                    Currency
                  </label>
                  <CurrencySelect
                    id="alloc-custom-ccy"
                    value={customCcy}
                    onChange={(code) =>
                      setCustomCcy(coerceSupportedCurrency(code, GLOBAL_DEFAULT_CURRENCY))
                    }
                  />
                </div>
              </div>
              <div className="row g-3 mt-2 align-items-end">
                <div className="col-12">
                  <div className="form-check mb-0">
                    <input
                      id="alloc-custom-income"
                      type="checkbox"
                      className="form-check-input"
                      checked={customIsIncome}
                      onChange={(ev) => {
                        setCustomIsIncome(ev.target.checked);
                        if (!ev.target.checked) {
                          setCustomIncomeMonthlyStr("");
                        }
                      }}
                    />
                    <label className="form-check-label small" htmlFor="alloc-custom-income">
                      Income (show on Income tab; monthly amount appears on the line above when checked)
                    </label>
                  </div>
                  <div className="form-check mb-0 mt-2">
                    <input
                      id="alloc-custom-pension"
                      type="checkbox"
                      className="form-check-input"
                      checked={customIsPension}
                      onChange={(ev) => setCustomIsPension(ev.target.checked)}
                    />
                    <label className="form-check-label small" htmlFor="alloc-custom-pension">
                      Pension (show this row on the Pension tab)
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </form>
      </AdminEditorSection>

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
                <td className="small text-muted">{allocationTagsCellLabel(r)}</td>
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
