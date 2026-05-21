import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { convertAmountToBase } from "../lib/frankfurterRates";
import { parseAmount } from "../lib/formParse";
import {
  buildDerivedExpenseLedgerRowsFromTaggedIncome,
  ledgerMonthlyAmount,
  newStatementLineId,
  type ExpenseIncomeAllocationPercents,
  type ExpenseLedgerFlagField,
  type FinanceAllocationRecord,
  type FinanceLedgerAmountPeriod,
  type FinanceLedgerRecord,
  type HouseKey,
  type IncomeLedgerFlagField,
  syntheticIncomeLedgerRowsFromAllocations,
} from "../lib/financeModel";
import { scheduleFocusRecordEditor } from "../lib/focusRecordEditor";
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

import { FinanceLedgerTaggedIncomeAllocationSection } from "./FinanceLedgerTaggedIncomeAllocationSection";
import {
  compareLedgerRecords,
  expenseLedgerFlagLabels,
  incomeLedgerFlagLabels,
  type LedgerSortColumnKey,
} from "./FinanceLedgerSheetPanel.utils";

type LineFormState = {
  category: string;
  description: string;
  amount: string;
  currency: string;
  amountPeriod: FinanceLedgerAmountPeriod;
  relatedHouse: HouseKey | "";
  isTax: boolean;
  isSaving: boolean;
  isInvestment: boolean;
  isAllocate: boolean;
};

export type FinanceLedgerSheetPanelProps = {
  readonly sheetId: string;
  readonly categories: readonly string[];
  readonly records: readonly FinanceLedgerRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinanceLedgerRecord[]) => FinanceLedgerRecord[],
  ) => void;
  readonly formSectionTitle: string;
  readonly tableSectionTitle: string;
  readonly deleteConfirmMessage: string;
  readonly emptyMessage: string;
  readonly filterPlaceholder?: string;
  readonly sortTableRowsByCurrencyCategoryDescription?: boolean;
  readonly alphabetizeCategoryDropdown?: boolean;
  readonly relatedHouseOptions?: ReadonlyArray<{
    readonly value: HouseKey;
    readonly label: string;
  }>;
  readonly incomeFlagFields?: ReadonlyArray<{
    readonly field: IncomeLedgerFlagField;
    readonly label: string;
  }>;
  readonly expenseFlagFields?: ReadonlyArray<{
    readonly field: ExpenseLedgerFlagField;
    readonly label: string;
  }>;
  readonly expenseIncomeAllocationPercents?: ExpenseIncomeAllocationPercents;
  readonly onPatchExpenseIncomeAllocationPercents?: (
    next: ExpenseIncomeAllocationPercents,
  ) => void;
  readonly incomeRecordsForDerivedExpenses?: readonly FinanceLedgerRecord[];
  readonly allocationRecordsForSyntheticIncome?: readonly FinanceAllocationRecord[];
};

export function FinanceLedgerSheetPanel({
  sheetId,
  categories,
  records,
  onPatch,
  formSectionTitle,
  tableSectionTitle,
  deleteConfirmMessage,
  emptyMessage,
  filterPlaceholder = "Filter records…",
  sortTableRowsByCurrencyCategoryDescription = true,
  alphabetizeCategoryDropdown = false,
  relatedHouseOptions,
  incomeFlagFields,
  expenseFlagFields,
  expenseIncomeAllocationPercents,
  onPatchExpenseIncomeAllocationPercents,
  incomeRecordsForDerivedExpenses,
  allocationRecordsForSyntheticIncome,
}: FinanceLedgerSheetPanelProps) {
  const showRelatedHouseCol = Boolean(relatedHouseOptions?.length);
  const showIncomeFlagsCol = Boolean(incomeFlagFields?.length);
  const showExpenseFlagsCol = Boolean(expenseFlagFields?.length);

  const relatedHouseLabelByValue = useMemo(() => {
    const m = new Map<HouseKey, string>();
    if (!relatedHouseOptions) return m;
    for (const o of relatedHouseOptions) {
      m.set(o.value, o.label);
    }
    return m;
  }, [relatedHouseOptions]);

  const showExpenseAllocationBlock =
    sheetId === "expenses" &&
    Boolean(
      expenseIncomeAllocationPercents &&
        onPatchExpenseIncomeAllocationPercents &&
        incomeRecordsForDerivedExpenses,
    );

  const tableSourceRecords = useMemo((): readonly FinanceLedgerRecord[] => {
    if (sheetId === "income" && allocationRecordsForSyntheticIncome?.length) {
      const synthetic = syntheticIncomeLedgerRowsFromAllocations(
        allocationRecordsForSyntheticIncome,
      );
      return [...synthetic, ...records];
    }
    if (
      sheetId !== "expenses" ||
      !expenseIncomeAllocationPercents ||
      !incomeRecordsForDerivedExpenses ||
      !relatedHouseOptions?.length
    ) {
      return records;
    }
    const derived = buildDerivedExpenseLedgerRowsFromTaggedIncome(
      incomeRecordsForDerivedExpenses,
      expenseIncomeAllocationPercents,
      relatedHouseOptions,
    );
    return [...derived, ...records];
  }, [
    sheetId,
    records,
    allocationRecordsForSyntheticIncome,
    expenseIncomeAllocationPercents,
    incomeRecordsForDerivedExpenses,
    relatedHouseOptions,
  ]);

  const [sortKey, setSortKey] = useState<LedgerSortColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const onLedgerSort = useCallback((key: LedgerSortColumnKey) => {
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
      key: LedgerSortColumnKey,
    ): "ascending" | "descending" | "none" | "other" | undefined => {
      if (!manualSort) return undefined;
      if (sortKey === key) return sortDir === "asc" ? "ascending" : "descending";
      return "none";
    };
    const dirFor = (key: LedgerSortColumnKey): "asc" | "desc" | null =>
      sortKey === key ? sortDir : null;

    const cols: AdminDataTableColumn[] = [
      {
        key: "cat",
        header: (
          <TableSortHeaderButton
            label="Category"
            isActive={sortKey === "cat"}
            direction={dirFor("cat")}
            onClick={() => onLedgerSort("cat")}
          />
        ),
        className: "small",
        thAriaSort: thAria("cat"),
      },
      {
        key: "desc",
        header: (
          <TableSortHeaderButton
            label="Description"
            isActive={sortKey === "desc"}
            direction={dirFor("desc")}
            onClick={() => onLedgerSort("desc")}
          />
        ),
        className: "small",
        thAriaSort: thAria("desc"),
      },
    ];
    if (showIncomeFlagsCol || showExpenseFlagsCol) {
      cols.push({
        key: "flags",
        header: <span className="fw-semibold text-nowrap">Tags</span>,
        className: "small",
      });
    }
    if (showRelatedHouseCol) {
      cols.push({
        key: "house",
        header: (
          <TableSortHeaderButton
            label="Related property"
            isActive={sortKey === "house"}
            direction={dirFor("house")}
            onClick={() => onLedgerSort("house")}
          />
        ),
        className: "small",
        thAriaSort: thAria("house"),
      });
    }
    cols.push(
      {
        key: "amt",
        header: (
          <TableSortHeaderButton
            label="Monthly amount"
            isActive={sortKey === "amt"}
            direction={dirFor("amt")}
            onClick={() => onLedgerSort("amt")}
            align="end"
          />
        ),
        className: "small text-end",
        headerClassName: "small text-end",
        thAriaSort: thAria("amt"),
      },
      {
        key: "ccy",
        header: (
          <TableSortHeaderButton
            label="Currency"
            isActive={sortKey === "ccy"}
            direction={dirFor("ccy")}
            onClick={() => onLedgerSort("ccy")}
          />
        ),
        className: "small",
        thAriaSort: thAria("ccy"),
      },
      {
        key: "ops",
        header: <span className="visually-hidden">Operations</span>,
        className: "text-end text-nowrap",
        headerClassName: "text-end",
      },
    );
    return cols;
  }, [showRelatedHouseCol, showIncomeFlagsCol, showExpenseFlagsCol, sortKey, sortDir, onLedgerSort]);
  const colSpan = tableColumns.length;

  const formId = `${sheetId}-ledger-form`;
  const categoryOptions = useMemo(() => {
    const list = [...categories];
    if (alphabetizeCategoryDropdown) {
      list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    return list;
  }, [categories, alphabetizeCategoryDropdown]);
  const defaultCategory = categoryOptions[0] ?? "";
  const emptyForm = (): LineFormState => ({
    category: defaultCategory,
    description: "",
    amount: "",
    currency: GLOBAL_DEFAULT_CURRENCY,
    amountPeriod: "month",
    relatedHouse: "",
    isTax: false,
    isSaving: false,
    isInvestment: false,
    isAllocate: false,
  });

  const recordEditorSectionRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState<LineFormState>(() => emptyForm());
  const [tableFilter, setTableFilter] = useState("");
  const [totalDisplayCurrency, setTotalDisplayCurrency] = useState<CurrencyCode>(
    GLOBAL_DEFAULT_CURRENCY,
  );

  const filtered = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const list = !q
      ? [...tableSourceRecords]
      : tableSourceRecords.filter((r) => {
          const houseHay =
            r.relatedHouse && relatedHouseLabelByValue.get(r.relatedHouse)
              ? relatedHouseLabelByValue.get(r.relatedHouse)
              : r.relatedHouse ?? "";
          const flagHay = incomeLedgerFlagLabels(r, incomeFlagFields).toLowerCase();
          const expenseFlagHay = expenseLedgerFlagLabels(r, expenseFlagFields).toLowerCase();
          const derivedAllocHay = r.isDerivedFromTaggedIncome ? "allocate" : "";
          const derivedIncHay = r.isDerivedFromAllocation ? "allocation" : "";
          const hay = [
            r.category,
            r.description,
            r.currency,
            r.amountPeriod,
            String(r.amount),
            houseHay ?? "",
            flagHay,
            expenseFlagHay,
            derivedAllocHay,
            derivedIncHay,
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    if (sortKey !== null) {
      list.sort((a, b) =>
        compareLedgerRecords(a, b, sortKey, sortDir, relatedHouseLabelByValue),
      );
    } else if (sortTableRowsByCurrencyCategoryDescription) {
      list.sort((a, b) => {
        const byCcy = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
        if (byCcy !== 0) return byCcy;
        const byCat = a.category.localeCompare(b.category, undefined, { sensitivity: "base" });
        if (byCat !== 0) return byCat;
        const byHouse = (a.relatedHouse ?? "").localeCompare(b.relatedHouse ?? "", undefined, {
          sensitivity: "base",
        });
        if (byHouse !== 0) return byHouse;
        return a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      });
    }
    return list;
  }, [
    tableSourceRecords,
    tableFilter,
    sortTableRowsByCurrencyCategoryDescription,
    relatedHouseLabelByValue,
    sortKey,
    sortDir,
    incomeFlagFields,
    expenseFlagFields,
  ]);

  const recordCurrencies = useMemo(
    () => filtered.map((r) => r.currency),
    [filtered],
  );

  const { needsFx, ratesQuery, fxLoading, fxError } = useFrankfurterRatesForTotals(
    totalDisplayCurrency,
    recordCurrencies,
  );

  const convertedTotal = useMemo(() => {
    if (filtered.length === 0) {
      return tableSourceRecords.length === 0 ? null : 0;
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
            ledgerMonthlyAmount(r),
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
    tableSourceRecords.length,
    needsFx,
    ratesQuery.isSuccess,
    ratesQuery.data,
    totalDisplayCurrency,
  ]);

  function resetForm() {
    setEditingId(null);
    setFormError(null);
    setLineForm(emptyForm());
  }

  function openEdit(row: FinanceLedgerRecord) {
    if (row.isDerivedFromTaggedIncome || row.isDerivedFromAllocation) {
      return;
    }
    setEditingId(row.id);
    setFormError(null);
    setLineForm({
      category: row.category,
      description: row.description,
      amount: String(row.amount),
      currency: row.currency,
      amountPeriod: row.amountPeriod,
      relatedHouse: row.relatedHouse ?? "",
      isTax: row.isTax === true,
      isSaving: row.isSaving === true,
      isInvestment: row.isInvestment === true,
      isAllocate: row.isAllocate === true,
    });
    scheduleFocusRecordEditor(() => recordEditorSectionRef.current);
  }

  function submitLine(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(lineForm.amount);
    if (!lineForm.description.trim()) {
      setFormError("Description is required.");
      return;
    }
    if (amount === null) {
      setFormError("Amount must be a valid number.");
      return;
    }
    if (!categories.includes(lineForm.category)) {
      setFormError("Pick a valid category.");
      return;
    }
    const currency = coerceSupportedCurrency(lineForm.currency, GLOBAL_DEFAULT_CURRENCY);
    const row: FinanceLedgerRecord = {
      id: editingId ?? newStatementLineId(),
      category: lineForm.category,
      description: lineForm.description.trim(),
      amount,
      currency,
      amountPeriod: lineForm.amountPeriod,
      ...(lineForm.relatedHouse === "hillmarton" || lineForm.relatedHouse === "morrison"
        ? { relatedHouse: lineForm.relatedHouse }
        : {}),
      ...(incomeFlagFields?.length
        ? {
            isTax: lineForm.isTax,
            isSaving: lineForm.isSaving,
            isInvestment: lineForm.isInvestment,
          }
        : {}),
      ...(expenseFlagFields?.length ? { isAllocate: lineForm.isAllocate } : {}),
    };

    onPatch((prev) => {
      if (editingId) {
        return prev.map((r) => (r.id === editingId ? row : r));
      }
      return [...prev, row];
    });

    resetForm();
  }

  function deleteRow(id: string) {
    const row = tableSourceRecords.find((r) => r.id === id);
    if (row?.isDerivedFromTaggedIncome || row?.isDerivedFromAllocation) {
      return;
    }
    if (!window.confirm(deleteConfirmMessage)) return;
    onPatch((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) {
      resetForm();
    }
  }

  return (
    <div>
      {showExpenseAllocationBlock &&
      expenseIncomeAllocationPercents &&
      onPatchExpenseIncomeAllocationPercents ? (
        <FinanceLedgerTaggedIncomeAllocationSection
          key={JSON.stringify(expenseIncomeAllocationPercents)}
          sheetId={sheetId}
          percents={expenseIncomeAllocationPercents}
          onSave={onPatchExpenseIncomeAllocationPercents}
        />
      ) : null}
      <AdminEditorSection
        containerRef={recordEditorSectionRef}
        title={formSectionTitle}
        footer={
          <>
            <button type="submit" form={formId} className="btn btn-primary btn-sm">
              {editingId ? "Update record" : "Add record"}
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetForm}>
              Clear
            </button>
          </>
        }
      >
        <form id={formId} onSubmit={submitLine}>
          {formError ? (
            <div className="alert alert-danger py-2 small" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="row g-3">
            <div className={showRelatedHouseCol ? "col-md-2" : "col-md-3"}>
              <label className="form-label small" htmlFor={`${sheetId}-ledger-cat`}>
                Category
              </label>
              <select
                id={`${sheetId}-ledger-cat`}
                className="form-select form-select-sm"
                value={lineForm.category}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, category: ev.target.value }))
                }
              >
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className={showRelatedHouseCol ? "col-md-2" : "col-md-3"}>
              <label className="form-label small" htmlFor={`${sheetId}-ledger-desc`}>
                Description
              </label>
              <input
                id={`${sheetId}-ledger-desc`}
                type="text"
                className="form-control form-control-sm"
                required
                value={lineForm.description}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, description: ev.target.value }))
                }
              />
            </div>
            {showRelatedHouseCol ? (
              <div className="col-md-2">
                <label className="form-label small" htmlFor={`${sheetId}-ledger-house`}>
                  Related property
                </label>
                <select
                  id={`${sheetId}-ledger-house`}
                  className="form-select form-select-sm"
                  value={lineForm.relatedHouse}
                  onChange={(ev) =>
                    setLineForm((f) => ({
                      ...f,
                      relatedHouse: ev.target.value as HouseKey | "",
                    }))
                  }
                >
                  <option value="">— None —</option>
                  {(relatedHouseOptions ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-ledger-amt`}>
                Amount
              </label>
              <input
                id={`${sheetId}-ledger-amt`}
                type="number"
                step="0.01"
                className="form-control form-control-sm"
                required
                value={lineForm.amount}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, amount: ev.target.value }))
                }
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-ledger-period`}>
                Amount is
              </label>
              <select
                id={`${sheetId}-ledger-period`}
                className="form-select form-select-sm"
                value={lineForm.amountPeriod}
                onChange={(ev) =>
                  setLineForm((f) => ({
                    ...f,
                    amountPeriod: ev.target.value as FinanceLedgerAmountPeriod,
                  }))
                }
              >
                <option value="month">Per month</option>
                <option value="year">Per year</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-ledger-ccy`}>
                Currency
              </label>
              <CurrencySelect
                id={`${sheetId}-ledger-ccy`}
                value={lineForm.currency}
                onChange={(code) =>
                  setLineForm((f) => ({ ...f, currency: code }))
                }
              />
            </div>
          </div>
          {showIncomeFlagsCol && incomeFlagFields ? (
            <div className="row g-3 mt-0">
              <div className="col-12">
                <span className="form-label small d-block mb-1">Tags</span>
                <div className="d-flex flex-wrap gap-3">
                  {incomeFlagFields.map(({ field, label }) => (
                    <div key={field} className="form-check mb-0">
                      <input
                        id={`${sheetId}-ledger-${field}`}
                        type="checkbox"
                        className="form-check-input"
                        checked={lineForm[field]}
                        onChange={(ev) =>
                          setLineForm((f) => ({ ...f, [field]: ev.target.checked }))
                        }
                      />
                      <label
                        className="form-check-label small"
                        htmlFor={`${sheetId}-ledger-${field}`}
                      >
                        {label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {showExpenseFlagsCol && expenseFlagFields ? (
            <div className="row g-3 mt-0">
              <div className="col-12">
                <span className="form-label small d-block mb-1">Tags</span>
                <div className="d-flex flex-wrap gap-3">
                  {expenseFlagFields.map(({ field, label }) => (
                    <div key={field} className="form-check mb-0">
                      <input
                        id={`${sheetId}-ledger-${field}`}
                        type="checkbox"
                        className="form-check-input"
                        checked={lineForm[field]}
                        onChange={(ev) =>
                          setLineForm((f) => ({ ...f, [field]: ev.target.checked }))
                        }
                      />
                      <label
                        className="form-check-label small"
                        htmlFor={`${sheetId}-ledger-${field}`}
                      >
                        {label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </form>
      </AdminEditorSection>

      <AdminEditorSection title={tableSectionTitle}>
        <AdminDataTable
          embedded
          columns={tableColumns}
          filterValue={tableFilter}
          onFilterChange={setTableFilter}
          filterPlaceholder={filterPlaceholder}
        >
          {filtered.length ? (
            filtered.map((r) => (
              <tr key={r.id}>
                <td className="small">{r.category}</td>
                <td className="small">{r.description}</td>
                {showIncomeFlagsCol || showExpenseFlagsCol ? (
                  <td className="small text-muted">
                    {showIncomeFlagsCol ? (
                      r.isDerivedFromAllocation ? (
                        "Allocation"
                      ) : (
                        incomeLedgerFlagLabels(r, incomeFlagFields) || "—"
                      )
                    ) : r.isDerivedFromTaggedIncome ? (
                      "Allocate"
                    ) : (
                      expenseLedgerFlagLabels(r, expenseFlagFields) || "—"
                    )}
                  </td>
                ) : null}
                {showRelatedHouseCol ? (
                  <td className="small text-muted">
                    {r.relatedHouse
                      ? (relatedHouseLabelByValue.get(r.relatedHouse) ?? r.relatedHouse)
                      : "—"}
                  </td>
                ) : null}
                <td className="small text-end">
                  <MoneyAmount
                    amount={ledgerMonthlyAmount(r)}
                    currency={r.currency}
                    amountOnly
                  />
                </td>
                <td className="small">{r.currency}</td>
                <td className="small text-end">
                  {r.isDerivedFromTaggedIncome ? (
                    <span className="text-muted small">Derived</span>
                  ) : r.isDerivedFromAllocation ? (
                    <span className="visually-hidden">No operations</span>
                  ) : (
                    <>
                      <TableIconButton
                        iconClassName="bi bi-pencil"
                        ariaLabel="Edit record"
                        onClick={() => openEdit(r)}
                      />
                      <TableIconButton
                        iconClassName="bi bi-trash"
                        ariaLabel="Delete record"
                        variant="danger"
                        onClick={() => deleteRow(r.id)}
                      />
                    </>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <AdminDataTableEmptyRow
              colSpan={colSpan}
              message={
                tableSourceRecords.length
                  ? "No records match the filter."
                  : emptyMessage
              }
            />
          )}
          {tableSourceRecords.length > 0 ? (
            <tr className="table-group-divider table-secondary fw-semibold">
              <td className="small">Total</td>
              <td className="small text-muted fw-normal">
                <FrankfurterRatesFooterNote
                  needsFx={needsFx}
                  fxError={fxError}
                  fxLoading={fxLoading}
                  ratesQuery={ratesQuery}
                />
              </td>
              {showIncomeFlagsCol || showExpenseFlagsCol ? <td className="small" /> : null}
              {showRelatedHouseCol ? <td className="small" /> : null}
              <td className="small text-end">
                {convertedTotal !== null ? (
                  <MoneyAmount
                    amount={convertedTotal}
                    currency={totalDisplayCurrency}
                    amountOnly
                  />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="small">
                <CurrencySelect
                  id={`${sheetId}-ledger-total-ccy`}
                  className="form-select form-select-sm"
                  value={totalDisplayCurrency}
                  onChange={(code) => setTotalDisplayCurrency(code)}
                  disabled={fxLoading}
                />
              </td>
              <td className="small text-end" />
            </tr>
          ) : null}
        </AdminDataTable>
      </AdminEditorSection>
    </div>
  );
}
