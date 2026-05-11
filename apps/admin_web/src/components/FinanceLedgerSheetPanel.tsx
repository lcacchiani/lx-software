import { type FormEvent, useCallback, useMemo, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { convertAmountToBase } from "../lib/frankfurterRates";
import {
  buildDerivedExpenseLedgerRowsFromTaggedIncome,
  ledgerMonthlyAmount,
  newStatementLineId,
  type ExpenseIncomeAllocationPercents,
  type FinanceLedgerAmountPeriod,
  type FinanceLedgerRecord,
  type HouseKey,
  type IncomeLedgerFlagField,
} from "../lib/financeModel";
import { useFrankfurterRatesToBase } from "../hooks/useFrankfurterRatesToBase";
import {
  AdminDataTable,
  AdminDataTableEmptyRow,
  type AdminDataTableColumn,
  AdminEditorSection,
  CurrencySelect,
  MoneyAmount,
  TableIconButton,
} from "./ui";

function parseAmount(raw: string): number | null {
  const n = Number.parseFloat(raw.trim());
  return Number.isFinite(n) ? n : null;
}

type LedgerSortColumnKey = "cat" | "desc" | "house" | "amt" | "ccy";

function relatedHouseSortLabel(
  record: FinanceLedgerRecord,
  relatedHouseLabelByValue: ReadonlyMap<HouseKey, string>,
): string {
  if (!record.relatedHouse) return "";
  return relatedHouseLabelByValue.get(record.relatedHouse) ?? record.relatedHouse;
}

function compareLedgerRecords(
  a: FinanceLedgerRecord,
  b: FinanceLedgerRecord,
  sortKey: LedgerSortColumnKey,
  sortDir: "asc" | "desc",
  relatedHouseLabelByValue: ReadonlyMap<HouseKey, string>,
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "cat":
      cmp = a.category.localeCompare(b.category, undefined, { sensitivity: "base" });
      break;
    case "desc":
      cmp = a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      break;
    case "house":
      cmp = relatedHouseSortLabel(a, relatedHouseLabelByValue).localeCompare(
        relatedHouseSortLabel(b, relatedHouseLabelByValue),
        undefined,
        { sensitivity: "base" },
      );
      break;
    case "amt": {
      const ma = ledgerMonthlyAmount(a);
      const mb = ledgerMonthlyAmount(b);
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "ccy":
      cmp = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
      break;
    default:
      break;
  }
  if (cmp !== 0) return dir * cmp;
  return a.id.localeCompare(b.id);
}

type LedgerSortHeaderProps = {
  label: string;
  isActive: boolean;
  direction: "asc" | "desc" | null;
  onClick: () => void;
  align?: "start" | "end";
};

function LedgerSortHeader({
  label,
  isActive,
  direction,
  onClick,
  align = "start",
}: LedgerSortHeaderProps) {
  const iconClass =
    direction === "asc"
      ? "bi bi-arrow-up"
      : direction === "desc"
        ? "bi bi-arrow-down"
        : "";
  return (
    <button
      type="button"
      className={`btn btn-link link-dark p-0 text-decoration-none small fw-semibold ${
        align === "end" ? "w-100 text-end" : "text-start"
      }`}
      onClick={onClick}
      aria-label={
        isActive
          ? `Sorted by ${label}, ${direction === "asc" ? "ascending" : "descending"}. Click to reverse.`
          : `Sort by ${label}`
      }
    >
      <span className="text-nowrap">{label}</span>
      {iconClass ? <i className={`${iconClass} ms-1`} aria-hidden /> : null}
    </button>
  );
}

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
  /**
   * When true (default), table rows are sorted by currency, category, related property, then
   * description (A–Z). Set false to preserve the records array order from the API.
   * After you sort via a column header, that single-column order takes precedence until you
   * reload the page.
   */
  readonly sortTableRowsByCurrencyCategoryDescription?: boolean;
  /** When true, category `<select>` options are listed A–Z (default option is first alphabetically). */
  readonly alphabetizeCategoryDropdown?: boolean;
  /** When set, shows an optional “related property” control and table column. */
  readonly relatedHouseOptions?: ReadonlyArray<{
    readonly value: HouseKey;
    readonly label: string;
  }>;
  /** Income sheet only: Tax / Saving / Investment toggles stored on each row. */
  readonly incomeFlagFields?: ReadonlyArray<{
    readonly field: IncomeLedgerFlagField;
    readonly label: string;
  }>;
  /** Expenses sheet: persisted allocation rates for derived rows (optional). */
  readonly expenseIncomeAllocationPercents?: ExpenseIncomeAllocationPercents;
  readonly onPatchExpenseIncomeAllocationPercents?: (
    next: ExpenseIncomeAllocationPercents,
  ) => void;
  /** Expenses sheet: income ledger rows used to compute derived expense amounts. */
  readonly incomeRecordsForDerivedExpenses?: readonly FinanceLedgerRecord[];
};

function incomeLedgerFlagLabels(
  record: FinanceLedgerRecord,
  defs: FinanceLedgerSheetPanelProps["incomeFlagFields"],
): string {
  if (!defs?.length) return "";
  const parts: string[] = [];
  for (const { field, label } of defs) {
    if (record[field]) parts.push(label);
  }
  return parts.join(", ");
}

type TaggedIncomeAllocationSectionProps = {
  readonly sheetId: string;
  readonly percents: ExpenseIncomeAllocationPercents;
  readonly onSave: (next: ExpenseIncomeAllocationPercents) => void;
};

function TaggedIncomeAllocationSection({
  sheetId,
  percents,
  onSave,
}: TaggedIncomeAllocationSectionProps) {
  const [draft, setDraft] = useState<ExpenseIncomeAllocationPercents>(percents);
  return (
    <AdminEditorSection
      title="Allocation from tagged income"
      footer={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(draft)}>
          Save allocation rates
        </button>
      }
    >
      <p className="small text-muted mb-3">
        Each rate applies to monthly income on the Income tab for the same related property,
        using rows marked <strong>Tax</strong>, <strong>Investment</strong>, or{" "}
        <strong>Saving</strong>. Derived expense lines appear in the table below and cannot be
        edited or deleted.
      </p>
      <div className="row g-3">
        <div className="col-md-4">
          <label className="form-label small" htmlFor={`${sheetId}-alloc-tax`}>
            Tax on Income (% of Tax-tagged income)
          </label>
          <input
            id={`${sheetId}-alloc-tax`}
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="form-control form-control-sm"
            value={draft.taxOnIncomePercent}
            onChange={(ev) => {
              const raw = ev.target.value;
              const n = raw === "" ? 0 : Number.parseFloat(raw);
              setDraft((d) => ({
                ...d,
                taxOnIncomePercent: Number.isFinite(n)
                  ? Math.min(100, Math.max(0, n))
                  : d.taxOnIncomePercent,
              }));
            }}
          />
        </div>
        <div className="col-md-4">
          <label className="form-label small" htmlFor={`${sheetId}-alloc-inv`}>
            Investments on Income (% of Investment-tagged income)
          </label>
          <input
            id={`${sheetId}-alloc-inv`}
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="form-control form-control-sm"
            value={draft.investmentOnIncomePercent}
            onChange={(ev) => {
              const raw = ev.target.value;
              const n = raw === "" ? 0 : Number.parseFloat(raw);
              setDraft((d) => ({
                ...d,
                investmentOnIncomePercent: Number.isFinite(n)
                  ? Math.min(100, Math.max(0, n))
                  : d.investmentOnIncomePercent,
              }));
            }}
          />
        </div>
        <div className="col-md-4">
          <label className="form-label small" htmlFor={`${sheetId}-alloc-save`}>
            Savings on Income (% of Saving-tagged income)
          </label>
          <input
            id={`${sheetId}-alloc-save`}
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="form-control form-control-sm"
            value={draft.savingOnIncomePercent}
            onChange={(ev) => {
              const raw = ev.target.value;
              const n = raw === "" ? 0 : Number.parseFloat(raw);
              setDraft((d) => ({
                ...d,
                savingOnIncomePercent: Number.isFinite(n)
                  ? Math.min(100, Math.max(0, n))
                  : d.savingOnIncomePercent,
              }));
            }}
          />
        </div>
      </div>
    </AdminEditorSection>
  );
}

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
  expenseIncomeAllocationPercents,
  onPatchExpenseIncomeAllocationPercents,
  incomeRecordsForDerivedExpenses,
}: FinanceLedgerSheetPanelProps) {
  const showRelatedHouseCol = Boolean(relatedHouseOptions?.length);
  const showIncomeFlagsCol = Boolean(incomeFlagFields?.length);

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
          <LedgerSortHeader
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
          <LedgerSortHeader
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
    if (showIncomeFlagsCol) {
      cols.push({
        key: "flags",
        header: <span className="small fw-semibold">Tags</span>,
        className: "small",
      });
    }
    if (showRelatedHouseCol) {
      cols.push({
        key: "house",
        header: (
          <LedgerSortHeader
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
          <LedgerSortHeader
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
          <LedgerSortHeader
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
  }, [showRelatedHouseCol, showIncomeFlagsCol, sortKey, sortDir, onLedgerSort]);
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
  });

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
          const hay = [
            r.category,
            r.description,
            r.currency,
            r.amountPeriod,
            String(r.amount),
            houseHay ?? "",
            flagHay,
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
  ]);

  const recordCurrencies = useMemo(
    () => tableSourceRecords.map((r) => r.currency),
    [tableSourceRecords],
  );

  const needsFx = useMemo(() => {
    const bases = new Set(recordCurrencies.map((c) => c.trim().toUpperCase()));
    return bases.size > 0 && [...bases].some((c) => c !== totalDisplayCurrency);
  }, [recordCurrencies, totalDisplayCurrency]);

  const ratesQuery = useFrankfurterRatesToBase(totalDisplayCurrency, recordCurrencies);

  const convertedTotal = useMemo(() => {
    if (tableSourceRecords.length === 0) return null;
    let map: ReadonlyMap<string, number> = new Map();
    if (needsFx) {
      if (!ratesQuery.isSuccess) return null;
      const ratePayload = ratesQuery.data;
      if (!ratePayload) return null;
      map = ratePayload.rateByQuote;
    }
    try {
      return tableSourceRecords.reduce(
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
    tableSourceRecords,
    needsFx,
    ratesQuery.isSuccess,
    ratesQuery.data,
    totalDisplayCurrency,
  ]);

  const fxLoading = needsFx && ratesQuery.isPending;
  const fxError = needsFx && ratesQuery.isError;

  function resetForm() {
    setEditingId(null);
    setFormError(null);
    setLineForm(emptyForm());
  }

  function openEdit(row: FinanceLedgerRecord) {
    if (row.isDerivedFromTaggedIncome) {
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
    });
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
    if (row?.isDerivedFromTaggedIncome) {
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
        <TaggedIncomeAllocationSection
          key={JSON.stringify(expenseIncomeAllocationPercents)}
          sheetId={sheetId}
          percents={expenseIncomeAllocationPercents}
          onSave={onPatchExpenseIncomeAllocationPercents}
        />
      ) : null}
      <AdminEditorSection
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
            <div className="col-md-3">
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
            <div className="col-md-3">
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
                <span className="form-label small d-block mb-1">Classification</span>
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
          {relatedHouseOptions?.length ? (
            <div className="row g-3 mt-0">
              <div className="col-md-4">
                <label className="form-label small" htmlFor={`${sheetId}-ledger-house`}>
                  Related property <span className="text-muted fw-normal">(optional)</span>
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
                  {relatedHouseOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
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
                {showIncomeFlagsCol ? (
                  <td className="small text-muted">
                    {incomeLedgerFlagLabels(r, incomeFlagFields) || "—"}
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
                {fxError ? (
                  <span className="text-danger">
                    {(ratesQuery.error as Error)?.message ?? "Could not load exchange rates."}
                  </span>
                ) : fxLoading ? (
                  "Loading rates…"
                ) : needsFx && ratesQuery.isSuccess && ratesQuery.data.date ? (
                  <>Frankfurter · {ratesQuery.data.date}</>
                ) : (
                  "\u2014"
                )}
              </td>
              {showIncomeFlagsCol ? <td className="small" /> : null}
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
