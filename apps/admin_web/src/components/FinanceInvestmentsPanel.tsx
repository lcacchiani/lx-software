import { type FormEvent, useCallback, useMemo, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { convertAmountToBase } from "../lib/frankfurterRates";
import {
  INVESTMENT_ASSET_TYPES,
  INVESTMENT_CATEGORIES,
  INVESTMENT_CRYPTO_CURRENCY_MAX_LEN,
  INVESTMENT_TICKER_MAX_LEN,
  investmentDetailsDisplay,
  newStatementLineId,
  type FinanceInvestmentRecord,
  type HouseKey,
  type InvestmentAssetType,
  type InvestmentCategory,
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

type InvSortKey = "cat" | "details" | "atype" | "prov" | "amt" | "ccy";

function compareInv(
  a: FinanceInvestmentRecord,
  b: FinanceInvestmentRecord,
  sortKey: InvSortKey,
  sortDir: "asc" | "desc",
  houseLabelByValue: ReadonlyMap<HouseKey, string>,
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "cat":
      cmp = a.category.localeCompare(b.category, undefined, { sensitivity: "base" });
      break;
    case "details":
      cmp = investmentDetailsDisplay(a, houseLabelByValue).localeCompare(
        investmentDetailsDisplay(b, houseLabelByValue),
        undefined,
        { sensitivity: "base" },
      );
      break;
    case "atype":
      cmp = a.assetType.localeCompare(b.assetType, undefined, { sensitivity: "base" });
      break;
    case "prov":
      cmp = a.provider.localeCompare(b.provider, undefined, { sensitivity: "base" });
      break;
    case "amt": {
      const ma = a.principalAmount;
      const mb = b.principalAmount;
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

type SortHeaderProps = {
  label: string;
  isActive: boolean;
  direction: "asc" | "desc" | null;
  onClick: () => void;
  align?: "start" | "end";
};

function SortHeader({
  label,
  isActive,
  direction,
  onClick,
  align = "start",
}: SortHeaderProps) {
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

type FormState = {
  category: InvestmentCategory;
  assetType: InvestmentAssetType;
  provider: string;
  principal: string;
  currency: string;
  relatedHouse: HouseKey | "";
  ticker: string;
  cryptoCurrency: string;
};

export type FinanceInvestmentsPanelProps = {
  readonly records: readonly FinanceInvestmentRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinanceInvestmentRecord[]) => FinanceInvestmentRecord[],
  ) => void;
  readonly relatedHouseOptions: ReadonlyArray<{
    readonly value: HouseKey;
    readonly label: string;
  }>;
};

export function FinanceInvestmentsPanel({
  records,
  onPatch,
  relatedHouseOptions,
}: FinanceInvestmentsPanelProps) {
  const sheetId = "investments";
  const defaultCategory = INVESTMENT_CATEGORIES[0];
  const hasHouseOptions = relatedHouseOptions.length > 0;
  const relatedHouseLabelByValue = useMemo(() => {
    const m = new Map<HouseKey, string>();
    for (const o of relatedHouseOptions) {
      m.set(o.value, o.label);
    }
    return m;
  }, [relatedHouseOptions]);

  const emptyForm = (): FormState => ({
    category: defaultCategory,
    assetType: "Fixed",
    provider: "",
    principal: "",
    currency: GLOBAL_DEFAULT_CURRENCY,
    relatedHouse: "",
    ticker: "",
    cryptoCurrency: "",
  });

  const [sortKey, setSortKey] = useState<InvSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const onSort = useCallback((key: InvSortKey) => {
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
      key: InvSortKey,
    ): "ascending" | "descending" | "none" | "other" | undefined => {
      if (!manualSort) return undefined;
      if (sortKey === key) return sortDir === "asc" ? "ascending" : "descending";
      return "none";
    };
    const dirFor = (key: InvSortKey): "asc" | "desc" | null =>
      sortKey === key ? sortDir : null;

    const cols: AdminDataTableColumn[] = [
      {
        key: "cat",
        header: (
          <SortHeader
            label="Category"
            isActive={sortKey === "cat"}
            direction={dirFor("cat")}
            onClick={() => onSort("cat")}
          />
        ),
        className: "small",
        thAriaSort: thAria("cat"),
      },
    ];
    cols.push({
      key: "details",
      header: (
        <SortHeader
          label="Details"
          isActive={sortKey === "details"}
          direction={dirFor("details")}
          onClick={() => onSort("details")}
        />
      ),
      className: "small",
      thAriaSort: thAria("details"),
    });
    cols.push(
      {
        key: "atype",
        header: (
          <SortHeader
            label="Asset type"
            isActive={sortKey === "atype"}
            direction={dirFor("atype")}
            onClick={() => onSort("atype")}
          />
        ),
        className: "small",
        thAriaSort: thAria("atype"),
      },
      {
        key: "prov",
        header: (
          <SortHeader
            label="Provider"
            isActive={sortKey === "prov"}
            direction={dirFor("prov")}
            onClick={() => onSort("prov")}
          />
        ),
        className: "small",
        thAriaSort: thAria("prov"),
      },
      {
        key: "amt",
        header: (
          <SortHeader
            label="Principal"
            isActive={sortKey === "amt"}
            direction={dirFor("amt")}
            onClick={() => onSort("amt")}
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
          <SortHeader
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
        key: "ops",
        header: <span className="visually-hidden">Operations</span>,
        className: "text-end text-nowrap",
        headerClassName: "text-end",
      },
    );
    return cols;
  }, [sortKey, sortDir, onSort]);

  const colSpan = tableColumns.length;
  const formId = `${sheetId}-form`;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [tableFilter, setTableFilter] = useState("");
  const [totalDisplayCurrency, setTotalDisplayCurrency] = useState<CurrencyCode>(
    GLOBAL_DEFAULT_CURRENCY,
  );

  const filtered = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const list = !q
      ? [...records]
      : records.filter((r) => {
          const detailsHay = investmentDetailsDisplay(r, relatedHouseLabelByValue);
          const hay = [
            r.category,
            r.assetType,
            r.provider,
            r.currency,
            String(r.principalAmount),
            detailsHay,
            r.relatedHouse ?? "",
            r.ticker ?? "",
            r.cryptoCurrency ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    if (sortKey !== null) {
      list.sort((a, b) => compareInv(a, b, sortKey, sortDir, relatedHouseLabelByValue));
    } else {
      list.sort((a, b) => {
        const byCcy = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
        if (byCcy !== 0) return byCcy;
        const byCat = a.category.localeCompare(b.category, undefined, { sensitivity: "base" });
        if (byCat !== 0) return byCat;
        const byDetails = investmentDetailsDisplay(a, relatedHouseLabelByValue).localeCompare(
          investmentDetailsDisplay(b, relatedHouseLabelByValue),
          undefined,
          { sensitivity: "base" },
        );
        if (byDetails !== 0) return byDetails;
        return a.provider.localeCompare(b.provider, undefined, { sensitivity: "base" });
      });
    }
    return list;
  }, [records, tableFilter, sortKey, sortDir, relatedHouseLabelByValue]);

  const recordCurrencies = useMemo(() => records.map((r) => r.currency), [records]);
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
          convertAmountToBase(r.principalAmount, r.currency, totalDisplayCurrency, map),
        0,
      );
    } catch {
      return null;
    }
  }, [records, needsFx, ratesQuery.isSuccess, ratesQuery.data, totalDisplayCurrency]);

  const fxLoading = needsFx && ratesQuery.isPending;
  const fxError = needsFx && ratesQuery.isError;

  function resetForm() {
    setEditingId(null);
    setFormError(null);
    setForm(emptyForm());
  }

  function openEdit(row: FinanceInvestmentRecord) {
    setEditingId(row.id);
    setFormError(null);
    setForm({
      category: row.category,
      assetType: row.assetType,
      provider: row.provider,
      principal: String(row.principalAmount),
      currency: row.currency,
      relatedHouse:
        row.category === "Real Estate" &&
        (row.relatedHouse === "hillmarton" || row.relatedHouse === "morrison")
          ? row.relatedHouse
          : "",
      ticker: row.category === "ETF" ? (row.ticker ?? "") : "",
      cryptoCurrency: row.category === "Crypto" ? (row.cryptoCurrency ?? "") : "",
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const principalAmount = parseAmount(form.principal);
    if (!form.provider.trim()) {
      setFormError("Provider is required.");
      return;
    }
    if (principalAmount === null) {
      setFormError("Principal must be a valid number.");
      return;
    }
    if (!INVESTMENT_CATEGORIES.includes(form.category)) {
      setFormError("Pick a valid category.");
      return;
    }
    if (!INVESTMENT_ASSET_TYPES.includes(form.assetType)) {
      setFormError("Pick a valid asset type.");
      return;
    }
    const currency = coerceSupportedCurrency(form.currency, GLOBAL_DEFAULT_CURRENCY);
    const tickerTrim = form.ticker.trim();
    const cryptoTrim = form.cryptoCurrency.trim();
    const row: FinanceInvestmentRecord = {
      id: editingId ?? newStatementLineId(),
      category: form.category,
      assetType: form.assetType,
      provider: form.provider.trim(),
      principalAmount,
      currency,
      ...(form.category === "Real Estate" &&
      (form.relatedHouse === "hillmarton" || form.relatedHouse === "morrison")
        ? { relatedHouse: form.relatedHouse }
        : {}),
      ...(form.category === "ETF" && tickerTrim ? { ticker: tickerTrim } : {}),
      ...(form.category === "Crypto" && cryptoTrim ? { cryptoCurrency: cryptoTrim } : {}),
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
    if (!window.confirm("Delete this investment record?")) return;
    onPatch((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) {
      resetForm();
    }
  }

  return (
    <div>
      <AdminEditorSection
        title="Investment record"
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
        <form id={formId} onSubmit={submit}>
          {formError ? (
            <div className="alert alert-danger py-2 small" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label small" htmlFor={`${sheetId}-cat`}>
                Category
              </label>
              <select
                id={`${sheetId}-cat`}
                className="form-select form-select-sm"
                value={form.category}
                onChange={(ev) => {
                  const category = ev.target.value as InvestmentCategory;
                  setForm((f) => ({
                    ...f,
                    category,
                    relatedHouse: "",
                    ticker: "",
                    cryptoCurrency: "",
                  }));
                }}
              >
                {INVESTMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-atype`}>
                Asset type
              </label>
              <select
                id={`${sheetId}-atype`}
                className="form-select form-select-sm"
                value={form.assetType}
                onChange={(ev) =>
                  setForm((f) => ({ ...f, assetType: ev.target.value as InvestmentAssetType }))
                }
              >
                {INVESTMENT_ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-principal`}>
                Principal
              </label>
              <input
                id={`${sheetId}-principal`}
                type="number"
                step="0.01"
                className="form-control form-control-sm"
                required
                value={form.principal}
                onChange={(ev) => setForm((f) => ({ ...f, principal: ev.target.value }))}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-ccy`}>
                Currency
              </label>
              <CurrencySelect
                id={`${sheetId}-ccy`}
                value={form.currency}
                onChange={(code) => setForm((f) => ({ ...f, currency: code }))}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small" htmlFor={`${sheetId}-prov`}>
                Provider
              </label>
              <input
                id={`${sheetId}-prov`}
                type="text"
                className="form-control form-control-sm"
                required
                value={form.provider}
                onChange={(ev) => setForm((f) => ({ ...f, provider: ev.target.value }))}
              />
            </div>
          </div>
          {form.category === "Real Estate" && hasHouseOptions ? (
            <div className="row g-3 mt-0">
              <div className="col-md-4">
                <label className="form-label small" htmlFor={`${sheetId}-house`}>
                  Property <span className="text-muted fw-normal">(optional)</span>
                </label>
                <select
                  id={`${sheetId}-house`}
                  className="form-select form-select-sm"
                  value={form.relatedHouse}
                  onChange={(ev) =>
                    setForm((f) => ({
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
          {form.category === "ETF" ? (
            <div className="row g-3 mt-0">
              <div className="col-md-4">
                <label className="form-label small" htmlFor={`${sheetId}-ticker`}>
                  Ticker
                </label>
                <input
                  id={`${sheetId}-ticker`}
                  type="text"
                  className="form-control form-control-sm"
                  maxLength={INVESTMENT_TICKER_MAX_LEN}
                  value={form.ticker}
                  onChange={(ev) => setForm((f) => ({ ...f, ticker: ev.target.value }))}
                />
              </div>
            </div>
          ) : null}
          {form.category === "Crypto" ? (
            <div className="row g-3 mt-0">
              <div className="col-md-4">
                <label className="form-label small" htmlFor={`${sheetId}-crypto-ccy`}>
                  Crypto Currency
                </label>
                <input
                  id={`${sheetId}-crypto-ccy`}
                  type="text"
                  className="form-control form-control-sm"
                  maxLength={INVESTMENT_CRYPTO_CURRENCY_MAX_LEN}
                  value={form.cryptoCurrency}
                  onChange={(ev) =>
                    setForm((f) => ({ ...f, cryptoCurrency: ev.target.value }))
                  }
                />
              </div>
            </div>
          ) : null}
        </form>
      </AdminEditorSection>

      <AdminEditorSection title="Investments">
        <AdminDataTable
          embedded
          columns={tableColumns}
          filterValue={tableFilter}
          onFilterChange={setTableFilter}
          filterPlaceholder="Filter records…"
        >
          {filtered.length ? (
            filtered.map((r) => (
              <tr key={r.id}>
                <td className="small">{r.category}</td>
                <td className="small text-muted">
                  {investmentDetailsDisplay(r, relatedHouseLabelByValue) || "—"}
                </td>
                <td className="small">{r.assetType}</td>
                <td className="small">{r.provider}</td>
                <td className="small text-end">
                  <MoneyAmount amount={r.principalAmount} currency={r.currency} amountOnly />
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
                records.length ? "No records match the filter." : "No investment records yet."
              }
            />
          )}
          {records.length > 0 ? (
            <tr className="table-group-divider table-secondary fw-semibold">
              <td className="small">Total</td>
              <td className="small" />
              <td className="small" />
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
                  id={`${sheetId}-total-ccy`}
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
