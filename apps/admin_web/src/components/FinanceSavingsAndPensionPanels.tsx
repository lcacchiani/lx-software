import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { formatDateUtc } from "../lib/formatDisplay";
import { parseAmount } from "../lib/formParse";
import { convertAmountToBase } from "../lib/frankfurterRates";
import {
  INVESTMENT_ASSET_TYPES,
  MAX_PENSION_DESCRIPTION_LEN,
  newStatementLineId,
  type FinancePensionRecord,
  type FinanceSavingsRecord,
  type InvestmentAssetType,
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

function pensionLastUpdatedDisplay(lastUpdated: string | undefined): string {
  if (!lastUpdated) {
    return "—";
  }
  return formatDateUtc(`${lastUpdated}T00:00:00.000Z`);
}

/** Pension adds server-managed `lastUpdated`. Savings adds `atype` (asset type) between label and description. */
type MoneyRecordsSortKey = "label" | "atype" | "amt" | "ccy" | "desc" | "lastUpdated";

function compareSavings(
  a: FinanceSavingsRecord,
  b: FinanceSavingsRecord,
  sortKey: MoneyRecordsSortKey,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "label":
      cmp = a.deposit.localeCompare(b.deposit, undefined, { sensitivity: "base" });
      break;
    case "atype":
      cmp = a.assetType.localeCompare(b.assetType, undefined, { sensitivity: "base" });
      break;
    case "amt": {
      const ma = a.value;
      const mb = b.value;
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "ccy":
      cmp = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
      break;
    case "desc":
      cmp = a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      break;
    case "lastUpdated":
      cmp = 0;
      break;
    default:
      break;
  }
  if (cmp !== 0) return dir * cmp;
  return a.id.localeCompare(b.id);
}

function comparePension(
  a: FinancePensionRecord,
  b: FinancePensionRecord,
  sortKey: MoneyRecordsSortKey,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "label":
      cmp = a.fund.localeCompare(b.fund, undefined, { sensitivity: "base" });
      break;
    case "atype":
      cmp = 0;
      break;
    case "amt": {
      const ma = a.value;
      const mb = b.value;
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "ccy":
      cmp = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
      break;
    case "desc":
      cmp = a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      break;
    case "lastUpdated": {
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
  return a.id.localeCompare(b.id);
}

type SimpleMoneyRecordsPanelProps =
  | {
      variant: "savings";
      records: readonly FinanceSavingsRecord[];
      onPatch: (patch: (prev: readonly FinanceSavingsRecord[]) => FinanceSavingsRecord[]) => void;
      sheetId: string;
      formSectionTitle: string;
      tableSectionTitle: string;
      labelColumnHeader: string;
      labelFormLabel: string;
      labelInputId: string;
      deleteConfirmMessage: string;
      emptyMessage: string;
      /** Table column order: `valueFirst` = Deposit, Value, Currency; `currencyFirst` = Fund, Currency, Value */
      columnOrder: "valueFirst" | "currencyFirst";
    }
  | {
      variant: "pension";
      records: readonly FinancePensionRecord[];
      onPatch: (patch: (prev: readonly FinancePensionRecord[]) => FinancePensionRecord[]) => void;
      sheetId: string;
      formSectionTitle: string;
      tableSectionTitle: string;
      labelColumnHeader: string;
      labelFormLabel: string;
      labelInputId: string;
      deleteConfirmMessage: string;
      emptyMessage: string;
      columnOrder: "valueFirst" | "currencyFirst";
    };

function SimpleMoneyRecordsPanel(props: SimpleMoneyRecordsPanelProps) {
  const {
    variant,
    records,
    onPatch,
    sheetId,
    formSectionTitle,
    tableSectionTitle,
    labelColumnHeader,
    labelFormLabel,
    labelInputId,
    deleteConfirmMessage,
    emptyMessage,
    columnOrder,
  } = props;

  const [sortKey, setSortKey] = useState<MoneyRecordsSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const onSort = useCallback((key: MoneyRecordsSortKey) => {
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
      key: MoneyRecordsSortKey,
    ): "ascending" | "descending" | "none" | "other" | undefined => {
      if (!manualSort) return undefined;
      if (sortKey === key) return sortDir === "asc" ? "ascending" : "descending";
      return "none";
    };
    const dirFor = (key: MoneyRecordsSortKey): "asc" | "desc" | null =>
      sortKey === key ? sortDir : null;

    const labelCol: AdminDataTableColumn = {
      key: "label",
      header: (
        <TableSortHeaderButton
          label={labelColumnHeader}
          isActive={sortKey === "label"}
          direction={dirFor("label")}
          onClick={() => onSort("label")}
        />
      ),
      className: "small",
      thAriaSort: thAria("label"),
    };
    const assetTypeCol: AdminDataTableColumn = {
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
    };
    const valueCol: AdminDataTableColumn = {
      key: "amt",
      header: (
        <TableSortHeaderButton
          label="Value"
          isActive={sortKey === "amt"}
          direction={dirFor("amt")}
          onClick={() => onSort("amt")}
          align="end"
        />
      ),
      className: "small text-end",
      headerClassName: "small text-end",
      thAriaSort: thAria("amt"),
    };
    const ccyCol: AdminDataTableColumn = {
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
    };
    const opsCol: AdminDataTableColumn = {
      key: "ops",
      header: <span className="visually-hidden">Operations</span>,
      className: "text-end text-nowrap",
      headerClassName: "text-end",
    };

    const descCol: AdminDataTableColumn = {
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
    };

    const lastUpdatedCol: AdminDataTableColumn = {
      key: "lastUpdated",
      header: (
        <TableSortHeaderButton
          label="Last Update"
          isActive={sortKey === "lastUpdated"}
          direction={dirFor("lastUpdated")}
          onClick={() => onSort("lastUpdated")}
        />
      ),
      className: "small text-nowrap",
      thAriaSort: thAria("lastUpdated"),
    };

    if (variant === "pension") {
      return columnOrder === "valueFirst"
        ? [labelCol, descCol, valueCol, ccyCol, lastUpdatedCol, opsCol]
        : [labelCol, descCol, ccyCol, valueCol, lastUpdatedCol, opsCol];
    }
    return columnOrder === "valueFirst"
      ? [labelCol, assetTypeCol, descCol, valueCol, ccyCol, opsCol]
      : [labelCol, assetTypeCol, descCol, ccyCol, valueCol, opsCol];
  }, [
    columnOrder,
    labelColumnHeader,
    onSort,
    sortDir,
    sortKey,
    variant,
  ]);

  const colSpan = tableColumns.length;
  const formId = `${sheetId}-form`;
  const recordEditorSectionRef = useRef<HTMLDivElement | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [valueStr, setValueStr] = useState("");
  const [formCurrency, setFormCurrency] = useState(GLOBAL_DEFAULT_CURRENCY);
  const [assetTypeInput, setAssetTypeInput] = useState<InvestmentAssetType>("Fixed");
  const [tableFilter, setTableFilter] = useState("");
  const [totalDisplayCurrency, setTotalDisplayCurrency] = useState<CurrencyCode>(
    GLOBAL_DEFAULT_CURRENCY,
  );

  const filtered = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (variant === "savings") {
      const recs = records as readonly FinanceSavingsRecord[];
      const list = !q
        ? [...recs]
        : recs.filter((r) => {
            const hay = [r.deposit, r.assetType, r.description, r.currency, String(r.value)]
              .join(" ")
              .toLowerCase();
            return hay.includes(q);
          });
      if (sortKey !== null) {
        list.sort((a, b) => compareSavings(a, b, sortKey, sortDir));
      } else {
        list.sort((a, b) => {
          const byCcy = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
          if (byCcy !== 0) return byCcy;
          return a.deposit.localeCompare(b.deposit, undefined, { sensitivity: "base" });
        });
      }
      return list;
    }
    const recs = records as readonly FinancePensionRecord[];
    const list = !q
      ? [...recs]
      : recs.filter((r) => {
          const hay = [r.fund, r.description, r.currency, String(r.value), r.lastUpdated ?? ""]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    if (sortKey !== null) {
      list.sort((a, b) => comparePension(a, b, sortKey, sortDir));
    } else {
      list.sort((a, b) => {
        const byCcy = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
        if (byCcy !== 0) return byCcy;
        return a.fund.localeCompare(b.fund, undefined, { sensitivity: "base" });
      });
    }
    return list;
  }, [records, tableFilter, sortKey, sortDir, variant]);

  const recordCurrencies = useMemo(() => filtered.map((r) => r.currency), [filtered]);
  const { needsFx, ratesQuery, fxLoading, fxError } = useFrankfurterRatesForTotals(
    totalDisplayCurrency,
    recordCurrencies,
  );

  const convertedTotal = useMemo(() => {
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
        (sum, r) => sum + convertAmountToBase(r.value, r.currency, totalDisplayCurrency, map),
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

  function resetForm() {
    setEditingId(null);
    setFormError(null);
    setNameInput("");
    setDescriptionInput("");
    setValueStr("");
    setFormCurrency(GLOBAL_DEFAULT_CURRENCY);
    setAssetTypeInput("Fixed");
  }

  function openEdit(row: FinanceSavingsRecord | FinancePensionRecord) {
    setEditingId(row.id);
    setFormError(null);
    if (variant === "savings") {
      const r = row as FinanceSavingsRecord;
      setNameInput(r.deposit);
      setAssetTypeInput(r.assetType);
      setDescriptionInput(r.description);
      setValueStr(String(r.value));
      setFormCurrency(coerceSupportedCurrency(r.currency, GLOBAL_DEFAULT_CURRENCY));
    } else {
      const r = row as FinancePensionRecord;
      setNameInput(r.fund);
      setDescriptionInput(r.description);
      setValueStr(String(r.value));
      setFormCurrency(coerceSupportedCurrency(r.currency, GLOBAL_DEFAULT_CURRENCY));
    }
    scheduleFocusRecordEditor(() => recordEditorSectionRef.current);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const valueNum = parseAmount(valueStr);
    if (!nameInput.trim()) {
      setFormError(`${labelFormLabel} is required.`);
      return;
    }
    if (valueNum === null) {
      setFormError("Value must be a valid number.");
      return;
    }
    const currency = coerceSupportedCurrency(formCurrency, GLOBAL_DEFAULT_CURRENCY);
    const id = editingId ?? newStatementLineId();

    if (variant === "savings") {
      const assetType: InvestmentAssetType = INVESTMENT_ASSET_TYPES.includes(assetTypeInput)
        ? assetTypeInput
        : "Fixed";
      const descTrimmed = descriptionInput.trim();
      const row: FinanceSavingsRecord = {
        id,
        deposit: nameInput.trim(),
        assetType,
        description:
          descTrimmed.length > MAX_PENSION_DESCRIPTION_LEN
            ? descTrimmed.slice(0, MAX_PENSION_DESCRIPTION_LEN)
            : descTrimmed,
        value: valueNum,
        currency,
      };
      const save = onPatch as (
        patch: (prev: readonly FinanceSavingsRecord[]) => FinanceSavingsRecord[],
      ) => void;
      save((prev) => {
        if (editingId) {
          return prev.map((r) => (r.id === editingId ? row : r));
        }
        return [...prev, row];
      });
    } else {
      const descTrimmed = descriptionInput.trim();
      const row: FinancePensionRecord = {
        id,
        fund: nameInput.trim(),
        description:
          descTrimmed.length > MAX_PENSION_DESCRIPTION_LEN
            ? descTrimmed.slice(0, MAX_PENSION_DESCRIPTION_LEN)
            : descTrimmed,
        value: valueNum,
        currency,
      };
      const save = onPatch as (
        patch: (prev: readonly FinancePensionRecord[]) => FinancePensionRecord[],
      ) => void;
      save((prev) => {
        if (editingId) {
          return prev.map((r) => (r.id === editingId ? row : r));
        }
        return [...prev, row];
      });
    }

    resetForm();
  }

  function deleteRow(id: string) {
    if (!window.confirm(deleteConfirmMessage)) return;
    if (variant === "savings") {
      const save = onPatch as (
        patch: (prev: readonly FinanceSavingsRecord[]) => FinanceSavingsRecord[],
      ) => void;
      save((prev) => prev.filter((r) => r.id !== id));
    } else {
      const save = onPatch as (
        patch: (prev: readonly FinancePensionRecord[]) => FinancePensionRecord[],
      ) => void;
      save((prev) => prev.filter((r) => r.id !== id));
    }
    if (editingId === id) {
      resetForm();
    }
  }

  return (
    <div>
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
        <form id={formId} onSubmit={submit}>
          {formError ? (
            <div className="alert alert-danger py-2 small" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label small" htmlFor={labelInputId}>
                {labelFormLabel}
              </label>
              <input
                id={labelInputId}
                type="text"
                className="form-control form-control-sm"
                required
                value={nameInput}
                onChange={(ev) => setNameInput(ev.target.value)}
              />
            </div>
            {variant === "savings" ? (
              <div className="col-md-2">
                <label className="form-label small" htmlFor={`${sheetId}-atype`}>
                  Asset type
                </label>
                <select
                  id={`${sheetId}-atype`}
                  className="form-select form-select-sm"
                  value={assetTypeInput}
                  onChange={(ev) =>
                    setAssetTypeInput(ev.target.value as InvestmentAssetType)
                  }
                >
                  {INVESTMENT_ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="col-md-3">
              <label className="form-label small" htmlFor={`${sheetId}-description`}>
                Description
              </label>
              <input
                id={`${sheetId}-description`}
                type="text"
                className="form-control form-control-sm"
                value={descriptionInput}
                onChange={(ev) => setDescriptionInput(ev.target.value)}
              />
            </div>
            {columnOrder === "currencyFirst" ? (
              <div className="col-md-3">
                <label className="form-label small" htmlFor={`${sheetId}-ccy`}>
                  Currency
                </label>
                <CurrencySelect
                  id={`${sheetId}-ccy`}
                  value={formCurrency}
                  onChange={(code) =>
                    setFormCurrency(coerceSupportedCurrency(code, GLOBAL_DEFAULT_CURRENCY))
                  }
                />
              </div>
            ) : null}
            <div className="col-md-3">
              <label className="form-label small" htmlFor={`${sheetId}-value`}>
                Value
              </label>
              <input
                id={`${sheetId}-value`}
                type="number"
                step="0.01"
                className="form-control form-control-sm"
                required
                value={valueStr}
                onChange={(ev) => setValueStr(ev.target.value)}
              />
            </div>
            {columnOrder === "valueFirst" ? (
              <div className="col-md-3">
                <label className="form-label small" htmlFor={`${sheetId}-ccy`}>
                  Currency
                </label>
                <CurrencySelect
                  id={`${sheetId}-ccy`}
                  value={formCurrency}
                  onChange={(code) =>
                    setFormCurrency(coerceSupportedCurrency(code, GLOBAL_DEFAULT_CURRENCY))
                  }
                />
              </div>
            ) : null}
          </div>
        </form>
      </AdminEditorSection>

      <AdminEditorSection title={tableSectionTitle}>
        <AdminDataTable
          embedded
          columns={tableColumns}
          filterValue={tableFilter}
          onFilterChange={setTableFilter}
          filterPlaceholder="Filter records…"
        >
          {filtered.length ? (
            filtered.map((r) => {
              const label = variant === "savings" ? (r as FinanceSavingsRecord).deposit : (r as FinancePensionRecord).fund;
              const descriptionText =
                variant === "savings"
                  ? (r as FinanceSavingsRecord).description
                  : (r as FinancePensionRecord).description;
              const descCell = <td className="small">{descriptionText}</td>;
              const assetTypeCell =
                variant === "savings" ? (
                  <td className="small">{(r as FinanceSavingsRecord).assetType}</td>
                ) : null;
              const lastUpdatedCellPension =
                variant === "pension" ? (
                  <td className="small text-nowrap">
                    {pensionLastUpdatedDisplay((r as FinancePensionRecord).lastUpdated)}
                  </td>
                ) : null;
              const cellsValueFirst = (
                <>
                  <td className="small">{label}</td>
                  {assetTypeCell}
                  {descCell}
                  <td className="small text-end">
                    <MoneyAmount amount={r.value} currency={r.currency} amountOnly />
                  </td>
                  <td className="small">{r.currency}</td>
                  {lastUpdatedCellPension}
                </>
              );
              const cellsCurrencyFirst = (
                <>
                  <td className="small">{label}</td>
                  {assetTypeCell}
                  {descCell}
                  <td className="small">{r.currency}</td>
                  <td className="small text-end">
                    <MoneyAmount amount={r.value} currency={r.currency} amountOnly />
                  </td>
                  {lastUpdatedCellPension}
                </>
              );
              return (
                <tr key={r.id}>
                  {columnOrder === "valueFirst" ? cellsValueFirst : cellsCurrencyFirst}
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
              );
            })
          ) : (
            <AdminDataTableEmptyRow
              colSpan={colSpan}
              message={records.length ? "No records match the filter." : emptyMessage}
            />
          )}
          {records.length > 0 ? (
            <tr className="table-group-divider table-secondary fw-semibold">
              <td className="small">Total</td>
              {variant === "savings" ? <td className="small" /> : null}
              <td className="small text-muted fw-normal">
                <FrankfurterRatesFooterNote
                  needsFx={needsFx}
                  fxError={fxError}
                  fxLoading={fxLoading}
                  ratesQuery={ratesQuery}
                />
              </td>
              {columnOrder === "valueFirst" ? (
                <>
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
                </>
              ) : (
                <>
                  <td className="small">
                    <CurrencySelect
                      id={`${sheetId}-total-ccy`}
                      className="form-select form-select-sm"
                      value={totalDisplayCurrency}
                      onChange={(code) => setTotalDisplayCurrency(code)}
                      disabled={fxLoading}
                    />
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
                </>
              )}
              {variant === "pension" ? <td className="small" /> : null}
              <td className="small text-end" />
            </tr>
          ) : null}
        </AdminDataTable>
      </AdminEditorSection>
    </div>
  );
}

export function FinanceSavingsPanel(props: {
  readonly records: readonly FinanceSavingsRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinanceSavingsRecord[]) => FinanceSavingsRecord[],
  ) => void;
}) {
  return (
    <SimpleMoneyRecordsPanel
      variant="savings"
      records={props.records}
      onPatch={props.onPatch}
      sheetId="savings"
      formSectionTitle="Savings record"
      tableSectionTitle="Savings"
      labelColumnHeader="Deposit"
      labelFormLabel="Deposit"
      labelInputId="savings-deposit"
      deleteConfirmMessage="Delete this savings record?"
      emptyMessage="No savings records yet."
      columnOrder="valueFirst"
    />
  );
}

export function FinancePensionPanel(props: {
  readonly records: readonly FinancePensionRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinancePensionRecord[]) => FinancePensionRecord[],
  ) => void;
}) {
  return (
    <SimpleMoneyRecordsPanel
      variant="pension"
      records={props.records}
      onPatch={props.onPatch}
      sheetId="pension"
      formSectionTitle="Pension record"
      tableSectionTitle="Pension"
      labelColumnHeader="Fund"
      labelFormLabel="Fund"
      labelInputId="pension-fund"
      deleteConfirmMessage="Delete this pension record?"
      emptyMessage="No pension records yet."
      columnOrder="valueFirst"
    />
  );
}
