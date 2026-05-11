import { type FormEvent, useMemo, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { convertAmountToBase } from "../lib/frankfurterRates";
import {
  ledgerMonthlyAmount,
  newStatementLineId,
  type FinanceLedgerAmountPeriod,
  type FinanceLedgerRecord,
  type HouseKey,
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

type LineFormState = {
  category: string;
  description: string;
  amount: string;
  currency: string;
  amountPeriod: FinanceLedgerAmountPeriod;
  relatedHouse: HouseKey | "";
};

const BASE_TABLE_COLUMNS: AdminDataTableColumn[] = [
  { key: "cat", header: "Category", className: "small" },
  { key: "desc", header: "Description", className: "small" },
];

const RELATED_HOUSE_TABLE_COLUMN: AdminDataTableColumn = {
  key: "house",
  header: "Related property",
  className: "small",
};

const AMOUNT_CCY_OPS_COLUMNS: AdminDataTableColumn[] = [
  {
    key: "amt",
    header: "Monthly amount",
    className: "small text-end",
    headerClassName: "small text-end",
  },
  { key: "ccy", header: "Currency", className: "small" },
  {
    key: "ops",
    header: <span className="visually-hidden">Operations</span>,
    className: "text-end text-nowrap",
    headerClassName: "text-end",
  },
];

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
   * When true (default), table rows are sorted by currency, category, then description (A–Z).
   * Set false to preserve the records array order from the API.
   */
  readonly sortTableRowsByCurrencyCategoryDescription?: boolean;
  /** When true, category `<select>` options are listed A–Z (default option is first alphabetically). */
  readonly alphabetizeCategoryDropdown?: boolean;
  /** When set, shows an optional “related property” control and table column. */
  readonly relatedHouseOptions?: ReadonlyArray<{
    readonly value: HouseKey;
    readonly label: string;
  }>;
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
}: FinanceLedgerSheetPanelProps) {
  const showRelatedHouseCol = Boolean(relatedHouseOptions?.length);
  const tableColumns = useMemo(
    () =>
      showRelatedHouseCol
        ? [...BASE_TABLE_COLUMNS, RELATED_HOUSE_TABLE_COLUMN, ...AMOUNT_CCY_OPS_COLUMNS]
        : [...BASE_TABLE_COLUMNS, ...AMOUNT_CCY_OPS_COLUMNS],
    [showRelatedHouseCol],
  );
  const colSpan = tableColumns.length;

  const relatedHouseLabelByValue = useMemo(() => {
    const m = new Map<HouseKey, string>();
    if (!relatedHouseOptions) return m;
    for (const o of relatedHouseOptions) {
      m.set(o.value, o.label);
    }
    return m;
  }, [relatedHouseOptions]);
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
      ? [...records]
      : records.filter((r) => {
          const houseHay =
            r.relatedHouse && relatedHouseLabelByValue.get(r.relatedHouse)
              ? relatedHouseLabelByValue.get(r.relatedHouse)
              : r.relatedHouse ?? "";
          const hay = [
            r.category,
            r.description,
            r.currency,
            r.amountPeriod,
            String(r.amount),
            houseHay ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    if (sortTableRowsByCurrencyCategoryDescription) {
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
  }, [records, tableFilter, sortTableRowsByCurrencyCategoryDescription, relatedHouseLabelByValue]);

  const recordCurrencies = useMemo(
    () => records.map((r) => r.currency),
    [records],
  );

  const needsFx = useMemo(() => {
    const bases = new Set(recordCurrencies.map((c) => c.trim().toUpperCase()));
    return bases.size > 0 && [...bases].some((c) => c !== totalDisplayCurrency);
  }, [recordCurrencies, totalDisplayCurrency]);

  const ratesQuery = useFrankfurterRatesToBase(totalDisplayCurrency, recordCurrencies);

  const convertedTotal = useMemo(() => {
    if (records.length === 0) return null;
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
    records,
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
    setEditingId(row.id);
    setFormError(null);
    setLineForm({
      category: row.category,
      description: row.description,
      amount: String(row.amount),
      currency: row.currency,
      amountPeriod: row.amountPeriod,
      relatedHouse: row.relatedHouse ?? "",
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
    if (!window.confirm(deleteConfirmMessage)) return;
    onPatch((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) {
      resetForm();
    }
  }

  return (
    <div>
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
                </td>
              </tr>
            ))
          ) : (
            <AdminDataTableEmptyRow
              colSpan={colSpan}
              message={
                records.length ? "No records match the filter." : emptyMessage
              }
            />
          )}
          {records.length > 0 ? (
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
