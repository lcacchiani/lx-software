import { type FormEvent, useCallback, useMemo, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { convertAmountToBase, convertAmountWithBase } from "../lib/frankfurterRates";
import { parseAmount } from "../lib/formParse";
import {
  INVESTMENT_ASSET_TYPES,
  INVESTMENT_CATEGORIES,
  INVESTMENT_CRYPTO_CURRENCY_MAX_LEN,
  INVESTMENT_TICKER_MAX_LEN,
  investmentDetailsDisplay,
  investmentMarketSourceCurrency,
  investmentRecordCurrentValueInRowCurrency,
  investmentRecordFiatNotionalInQuoteCurrency,
  isInvestmentMarketPriced,
  newStatementLineId,
  type FinanceInvestmentRecord,
  type HouseKey,
  type InvestmentAssetType,
  type InvestmentCategory,
} from "../lib/financeModel";
import { useFrankfurterRatesForTotals } from "../hooks/useFrankfurterRatesForTotals";
import { formatDateUtc } from "../lib/formatDisplay";
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

function parseOptionalUnit(raw: string): number | undefined | null {
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function investmentLastUpdatedDisplay(lastUpdated: string | undefined): string {
  if (!lastUpdated) {
    return "—";
  }
  return formatDateUtc(`${lastUpdated}T00:00:00.000Z`);
}

function formatUnitCell(unit: number | undefined): string {
  if (unit === undefined) {
    return "—";
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(unit);
}

/**
 * For **sorting** by Current Value: notional in {@link displayCurrency} (Frankfurter when the
 * row currency differs). Table cells show notional in the row’s own currency instead.
 *
 * For market-priced Crypto/ETF rows (positive units + crypto currency / ticker), the notional
 * in the row currency is `unit × rate(1 source → row.currency)` where the rate is fetched
 * via Frankfurter. The result is then converted to {@link displayCurrency} for sorting.
 */
function investmentNotionalInDisplayCurrency(
  r: FinanceInvestmentRecord,
  displayCurrency: CurrencyCode,
  rateByQuote: ReadonlyMap<string, number>,
  needsFxGlobal: boolean,
  ratesFetchSucceeded: boolean,
): number {
  const ratesAvailable = !needsFxGlobal || ratesFetchSucceeded;
  const valueInRowCcy = ratesAvailable
    ? investmentRecordCurrentValueInRowCurrency(r, (from, to) => {
        try {
          return convertAmountWithBase(1, from, to, displayCurrency, rateByQuote);
        } catch {
          return undefined;
        }
      })
    : undefined;
  const notional =
    valueInRowCcy !== undefined ? valueInRowCcy : investmentRecordFiatNotionalInQuoteCurrency(r);
  const rowNeedsFx =
    r.currency.trim().toUpperCase() !== displayCurrency.trim().toUpperCase();
  if (!rowNeedsFx) return notional;
  if (needsFxGlobal && !ratesFetchSucceeded) return notional;
  try {
    return convertAmountToBase(notional, r.currency, displayCurrency, rateByQuote);
  } catch {
    return notional;
  }
}

type InvSortKey =
  | "cat"
  | "details"
  | "atype"
  | "prov"
  | "amt"
  | "ccy"
  | "unit"
  | "currVal"
  | "lastUpd";

function compareInv(
  a: FinanceInvestmentRecord,
  b: FinanceInvestmentRecord,
  sortKey: InvSortKey,
  sortDir: "asc" | "desc",
  houseLabelByValue: ReadonlyMap<HouseKey, string>,
  rowNotionalInDisplayCurrencyForSort: (r: FinanceInvestmentRecord) => number,
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
    case "unit": {
      const ua = a.unit;
      const ub = b.unit;
      if (ua === undefined && ub === undefined) {
        cmp = 0;
      } else if (ua === undefined) {
        cmp = 1;
      } else if (ub === undefined) {
        cmp = -1;
      } else {
        cmp = ua === ub ? 0 : ua < ub ? -1 : 1;
      }
      break;
    }
    case "currVal": {
      const va = rowNotionalInDisplayCurrencyForSort(a);
      const vb = rowNotionalInDisplayCurrencyForSort(b);
      cmp = va === vb ? 0 : va < vb ? -1 : 1;
      break;
    }
    case "lastUpd": {
      const sa = a.lastUpdated ?? "";
      const sb = b.lastUpdated ?? "";
      cmp = sa.localeCompare(sb, undefined, { sensitivity: "base" });
      break;
    }
    default:
      break;
  }
  if (cmp !== 0) return dir * cmp;
  return a.id.localeCompare(b.id);
}

type FormState = {
  category: InvestmentCategory;
  assetType: InvestmentAssetType;
  provider: string;
  principal: string;
  currency: string;
  unit: string;
  currentValue: string;
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
    unit: "",
    currentValue: "",
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
          <TableSortHeaderButton
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
        <TableSortHeaderButton
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
          <TableSortHeaderButton
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
          <TableSortHeaderButton
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
          <TableSortHeaderButton
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
        key: "unit",
        header: (
          <TableSortHeaderButton
            label="Units"
            isActive={sortKey === "unit"}
            direction={dirFor("unit")}
            onClick={() => onSort("unit")}
            align="end"
          />
        ),
        className: "small text-end",
        headerClassName: "small text-end",
        thAriaSort: thAria("unit"),
      },
      {
        key: "currVal",
        header: (
          <TableSortHeaderButton
            label="Current Value"
            isActive={sortKey === "currVal"}
            direction={dirFor("currVal")}
            onClick={() => onSort("currVal")}
            align="end"
          />
        ),
        className: "small text-end",
        headerClassName: "small text-end",
        thAriaSort: thAria("currVal"),
      },
      {
        key: "lastUpd",
        header: (
          <TableSortHeaderButton
            label="Last Update"
            isActive={sortKey === "lastUpd"}
            direction={dirFor("lastUpd")}
            onClick={() => onSort("lastUpd")}
          />
        ),
        className: "small text-nowrap",
        thAriaSort: thAria("lastUpd"),
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

  const fxQuoteCurrencies = useMemo(() => {
    const quotes: string[] = [];
    for (const r of records) {
      quotes.push(r.currency);
      const src = investmentMarketSourceCurrency(r);
      if (src && isInvestmentMarketPriced(r)) {
        quotes.push(src);
      }
    }
    return quotes;
  }, [records]);
  const { needsFx, ratesQuery, rateByQuoteForDisplay, fxLoading, fxError } =
    useFrankfurterRatesForTotals(totalDisplayCurrency, fxQuoteCurrencies);

  const oneUnitConverter = useCallback(
    (from: string, to: string): number | undefined => {
      try {
        return convertAmountWithBase(
          1,
          from,
          to,
          totalDisplayCurrency,
          rateByQuoteForDisplay,
        );
      } catch {
        return undefined;
      }
    },
    [totalDisplayCurrency, rateByQuoteForDisplay],
  );

  const rowNotionalInDisplayCurrencyForSort = useCallback(
    (r: FinanceInvestmentRecord): number =>
      investmentNotionalInDisplayCurrency(
        r,
        totalDisplayCurrency,
        rateByQuoteForDisplay,
        needsFx,
        ratesQuery.isSuccess,
      ),
    [totalDisplayCurrency, rateByQuoteForDisplay, needsFx, ratesQuery.isSuccess],
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
            r.unit !== undefined ? String(r.unit) : "",
            r.lastUpdated ?? "",
            detailsHay,
            r.relatedHouse ?? "",
            r.ticker ?? "",
            r.cryptoCurrency ?? "",
            r.currentValue !== undefined ? String(r.currentValue) : "",
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    if (sortKey !== null) {
      list.sort((a, b) =>
        compareInv(a, b, sortKey, sortDir, relatedHouseLabelByValue, rowNotionalInDisplayCurrencyForSort),
      );
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
  }, [
    records,
    tableFilter,
    sortKey,
    sortDir,
    relatedHouseLabelByValue,
    rowNotionalInDisplayCurrencyForSort,
  ]);

  const convertedPrincipalTotal = useMemo(() => {
    if (records.length === 0) return null;
    if (needsFx) {
      if (!ratesQuery.isSuccess) return null;
      if (!ratesQuery.data) return null;
    }
    try {
      return records.reduce(
        (sum, r) =>
          sum +
          convertAmountToBase(
            r.principalAmount,
            r.currency,
            totalDisplayCurrency,
            rateByQuoteForDisplay,
          ),
        0,
      );
    } catch {
      return null;
    }
  }, [records, needsFx, ratesQuery.isSuccess, ratesQuery.data, rateByQuoteForDisplay, totalDisplayCurrency]);

  const convertedCurrentValueTotal = useMemo(() => {
    if (records.length === 0) return null;
    if (needsFx) {
      if (!ratesQuery.isSuccess) return null;
      if (!ratesQuery.data) return null;
    }
    try {
      return records.reduce((sum, r) => {
        const valueInRowCcy = investmentRecordCurrentValueInRowCurrency(r, oneUnitConverter);
        const value =
          valueInRowCcy !== undefined
            ? valueInRowCcy
            : investmentRecordFiatNotionalInQuoteCurrency(r);
        return (
          sum +
          convertAmountToBase(value, r.currency, totalDisplayCurrency, rateByQuoteForDisplay)
        );
      }, 0);
    } catch {
      return null;
    }
  }, [
    records,
    needsFx,
    ratesQuery.isSuccess,
    ratesQuery.data,
    rateByQuoteForDisplay,
    totalDisplayCurrency,
    oneUnitConverter,
  ]);

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
      unit:
        row.category === "Real Estate"
          ? ""
          : row.unit !== undefined
            ? String(row.unit)
            : "",
      currentValue:
        row.category === "Real Estate"
          ? String(row.currentValue ?? row.principalAmount)
          : "",
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
    const unitParsed =
      form.category === "Real Estate" ? undefined : parseOptionalUnit(form.unit);
    if (form.category !== "Real Estate" && unitParsed === null) {
      setFormError("Units must be a valid number.");
      return;
    }
    let realEstateCurrentValue: number | undefined;
    if (form.category === "Real Estate") {
      const cv = parseAmount(form.currentValue);
      if (cv === null) {
        setFormError("Current value must be a valid number.");
        return;
      }
      realEstateCurrentValue = cv;
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
      ...(form.category !== "Real Estate" &&
      unitParsed !== undefined &&
      unitParsed !== null
        ? { unit: unitParsed }
        : {}),
      ...(form.category === "Real Estate" && realEstateCurrentValue !== undefined
        ? { currentValue: realEstateCurrentValue }
        : {}),
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
            <div className="col-12 col-md-2">
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
                    unit: category === "Real Estate" ? "" : f.unit,
                    currentValue:
                      category === "Real Estate"
                        ? f.principal.trim() !== ""
                          ? f.principal
                          : ""
                        : "",
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
            {(form.category === "Real Estate" && hasHouseOptions) ||
            form.category === "ETF" ||
            form.category === "Crypto" ? (
              <div className="col-12 col-md-2">
                <label className="form-label small" htmlFor={`${sheetId}-details`}>
                  Details
                </label>
                {form.category === "Real Estate" ? (
                  <select
                    id={`${sheetId}-details`}
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
                ) : form.category === "ETF" ? (
                  <input
                    id={`${sheetId}-details`}
                    type="text"
                    className="form-control form-control-sm"
                    maxLength={INVESTMENT_TICKER_MAX_LEN}
                    value={form.ticker}
                    onChange={(ev) => setForm((f) => ({ ...f, ticker: ev.target.value }))}
                  />
                ) : (
                  <input
                    id={`${sheetId}-details`}
                    type="text"
                    className="form-control form-control-sm"
                    maxLength={INVESTMENT_CRYPTO_CURRENCY_MAX_LEN}
                    value={form.cryptoCurrency}
                    onChange={(ev) =>
                      setForm((f) => ({ ...f, cryptoCurrency: ev.target.value }))
                    }
                  />
                )}
              </div>
            ) : null}
            <div className="col-12 col-md-2">
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
            <div className="col-12 col-md-2">
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
            <div className="col-12 col-md-2">
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
            <div className="col-12 col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-ccy`}>
                Currency
              </label>
              <CurrencySelect
                id={`${sheetId}-ccy`}
                value={form.currency}
                onChange={(code) => setForm((f) => ({ ...f, currency: code }))}
              />
            </div>
            {form.category === "Real Estate" ? (
              <div className="col-12 col-md-2">
                <label className="form-label small" htmlFor={`${sheetId}-curval`}>
                  Current value
                </label>
                <input
                  id={`${sheetId}-curval`}
                  type="number"
                  step="0.01"
                  className="form-control form-control-sm"
                  required
                  value={form.currentValue}
                  onChange={(ev) => setForm((f) => ({ ...f, currentValue: ev.target.value }))}
                />
              </div>
            ) : null}
            {form.category !== "Real Estate" ? (
              <div className="col-12 col-md-2">
                <label className="form-label small" htmlFor={`${sheetId}-unit`}>
                  Units
                </label>
                <input
                  id={`${sheetId}-unit`}
                  type="number"
                  step="any"
                  className="form-control form-control-sm"
                  value={form.unit}
                  onChange={(ev) => setForm((f) => ({ ...f, unit: ev.target.value }))}
                />
              </div>
            ) : null}
          </div>
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
                  {r.category === "Real Estate" ? "—" : formatUnitCell(r.unit)}
                </td>
                <td className="small text-end">
                  {(() => {
                    const marketPriced = isInvestmentMarketPriced(r);
                    if (marketPriced && needsFx && ratesQuery.isPending) {
                      return <span className="text-muted">—</span>;
                    }
                    if (marketPriced && needsFx && ratesQuery.isError) {
                      return <span className="text-muted">—</span>;
                    }
                    const valueInRowCcy = investmentRecordCurrentValueInRowCurrency(
                      r,
                      oneUnitConverter,
                    );
                    if (valueInRowCcy === undefined) {
                      return <span className="text-muted">—</span>;
                    }
                    return (
                      <MoneyAmount amount={valueInRowCcy} currency={r.currency} amountOnly />
                    );
                  })()}
                </td>
                <td className="small text-muted">{investmentLastUpdatedDisplay(r.lastUpdated)}</td>
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
              <td className="small text-muted fw-normal">
                <FrankfurterRatesFooterNote
                  needsFx={needsFx}
                  fxError={fxError}
                  fxLoading={fxLoading}
                  ratesQuery={ratesQuery}
                />
              </td>
              <td className="small" />
              <td className="small" />
              <td className="small text-end">
                {(() => {
                  if (needsFx && ratesQuery.isPending) {
                    return <span className="text-muted">—</span>;
                  }
                  if (needsFx && ratesQuery.isError) {
                    return <span className="text-muted">—</span>;
                  }
                  if (convertedPrincipalTotal !== null) {
                    return (
                      <MoneyAmount
                        amount={convertedPrincipalTotal}
                        currency={totalDisplayCurrency}
                        amountOnly
                      />
                    );
                  }
                  return <span className="text-muted">—</span>;
                })()}
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
              <td className="small" />
              <td className="small text-end">
                {(() => {
                  if (needsFx && ratesQuery.isPending) {
                    return <span className="text-muted">—</span>;
                  }
                  if (needsFx && ratesQuery.isError) {
                    return <span className="text-muted">—</span>;
                  }
                  if (convertedCurrentValueTotal !== null) {
                    return (
                      <MoneyAmount
                        amount={convertedCurrentValueTotal}
                        currency={totalDisplayCurrency}
                        amountOnly
                      />
                    );
                  }
                  return <span className="text-muted">—</span>;
                })()}
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
