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
  FINANCE_ACCOUNT_TYPES,
  newStatementLineId,
  type FinanceAccountRecord,
  type FinanceAccountType,
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

function accountLastUpdatedDisplay(lastUpdated: string | undefined): string {
  if (!lastUpdated) {
    return "—";
  }
  return formatDateUtc(`${lastUpdated}T00:00:00.000Z`);
}

function accountTypeUsesBillingCycleDay(t: FinanceAccountType): boolean {
  return t !== "Bank Account";
}

type AccountsSortKey = "atype" | "day" | "amt" | "ccy" | "lastUpdated";

function compareAccounts(
  a: FinanceAccountRecord,
  b: FinanceAccountRecord,
  sortKey: AccountsSortKey,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "atype":
      cmp = a.accountType.localeCompare(b.accountType, undefined, { sensitivity: "base" });
      break;
    case "day": {
      const da = a.billingCycleDay;
      const db = b.billingCycleDay;
      cmp = da === db ? 0 : da < db ? -1 : 1;
      break;
    }
    case "amt": {
      const ma = a.recordedValue;
      const mb = b.recordedValue;
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "ccy":
      cmp = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
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

export function FinanceAccountsPanel(props: {
  readonly records: readonly FinanceAccountRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinanceAccountRecord[]) => FinanceAccountRecord[],
  ) => void;
}) {
  const { records, onPatch } = props;
  const sheetId = "accounts";
  const formId = `${sheetId}-form`;
  const recordEditorSectionRef = useRef<HTMLDivElement | null>(null);

  const [sortKey, setSortKey] = useState<AccountsSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const onSort = useCallback((key: AccountsSortKey) => {
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir("asc");
        return key;
      }
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return prevKey;
    });
  }, []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [accountTypeInput, setAccountTypeInput] = useState<FinanceAccountType>("Bank Account");
  const [billingDayStr, setBillingDayStr] = useState("1");
  const [valueStr, setValueStr] = useState("");
  const [formCurrency, setFormCurrency] = useState(GLOBAL_DEFAULT_CURRENCY);
  const [tableFilter, setTableFilter] = useState("");
  const [totalDisplayCurrency, setTotalDisplayCurrency] = useState<CurrencyCode>(
    GLOBAL_DEFAULT_CURRENCY,
  );

  const tableColumns = useMemo((): AdminDataTableColumn[] => {
    const manualSort = sortKey !== null;
    const thAria = (
      key: AccountsSortKey,
    ): "ascending" | "descending" | "none" | "other" | undefined => {
      if (!manualSort) return undefined;
      if (sortKey === key) return sortDir === "asc" ? "ascending" : "descending";
      return "none";
    };
    const dirFor = (key: AccountsSortKey): "asc" | "desc" | null =>
      sortKey === key ? sortDir : null;

    return [
      {
        key: "atype",
        header: (
          <TableSortHeaderButton
            label="Account Type"
            isActive={sortKey === "atype"}
            direction={dirFor("atype")}
            onClick={() => onSort("atype")}
          />
        ),
        className: "small",
        thAriaSort: thAria("atype"),
      },
      {
        key: "day",
        header: (
          <TableSortHeaderButton
            label="Billing Cycle Day"
            isActive={sortKey === "day"}
            direction={dirFor("day")}
            onClick={() => onSort("day")}
          />
        ),
        className: "small text-end",
        headerClassName: "text-end",
        thAriaSort: thAria("day"),
      },
      {
        key: "amt",
        header: (
          <TableSortHeaderButton
            label="Recorded Value"
            isActive={sortKey === "amt"}
            direction={dirFor("amt")}
            onClick={() => onSort("amt")}
          />
        ),
        className: "small text-end",
        headerClassName: "text-end",
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
      },
      {
        key: "ops",
        header: <span className="visually-hidden">Operations</span>,
        className: "text-end text-nowrap",
        headerClassName: "text-end",
      },
    ];
  }, [onSort, sortDir, sortKey]);

  const colSpan = tableColumns.length;

  const filtered = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const list = !q
      ? [...records]
      : records.filter((r) => {
          const hay = [
            r.accountType,
            ...(accountTypeUsesBillingCycleDay(r.accountType)
              ? [String(r.billingCycleDay)]
              : []),
            r.currency,
            String(r.recordedValue),
            r.lastUpdated ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    if (sortKey !== null) {
      list.sort((a, b) => compareAccounts(a, b, sortKey, sortDir));
    } else {
      list.sort((a, b) => {
        const byCcy = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
        if (byCcy !== 0) return byCcy;
        return a.accountType.localeCompare(b.accountType, undefined, { sensitivity: "base" });
      });
    }
    return list;
  }, [records, tableFilter, sortKey, sortDir]);

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
        (sum, r) =>
          sum + convertAmountToBase(r.recordedValue, r.currency, totalDisplayCurrency, map),
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
    setAccountTypeInput("Bank Account");
    setBillingDayStr("1");
    setValueStr("");
    setFormCurrency(GLOBAL_DEFAULT_CURRENCY);
  }

  function openEdit(row: FinanceAccountRecord) {
    setEditingId(row.id);
    setFormError(null);
    setAccountTypeInput(row.accountType);
    setBillingDayStr(String(row.billingCycleDay));
    setValueStr(String(row.recordedValue));
    setFormCurrency(coerceSupportedCurrency(row.currency, GLOBAL_DEFAULT_CURRENCY));
    scheduleFocusRecordEditor(() => recordEditorSectionRef.current);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const valueNum = parseAmount(valueStr);
    let billingCycleDay: number;
    if (accountTypeUsesBillingCycleDay(accountTypeInput)) {
      const dayParsed = Number.parseInt(billingDayStr.trim(), 10);
      if (!Number.isInteger(dayParsed) || dayParsed < 1 || dayParsed > 31) {
        setFormError("Billing cycle day must be a whole number from 1 to 31.");
        return;
      }
      billingCycleDay = dayParsed;
    } else if (editingId) {
      const prev = records.find((r) => r.id === editingId);
      billingCycleDay = prev?.billingCycleDay ?? 1;
    } else {
      billingCycleDay = 1;
    }
    if (valueNum === null) {
      setFormError("Recorded value must be a valid number.");
      return;
    }
    const currency = coerceSupportedCurrency(formCurrency, GLOBAL_DEFAULT_CURRENCY);
    const id = editingId ?? newStatementLineId();
    const row: FinanceAccountRecord = {
      id,
      accountType: accountTypeInput,
      billingCycleDay,
      recordedValue: valueNum,
      currency,
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
    if (!window.confirm("Delete this account record?")) return;
    onPatch((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) {
      resetForm();
    }
  }

  return (
    <div>
      <AdminEditorSection
        containerRef={recordEditorSectionRef}
        title="Account record"
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
              <label className="form-label small" htmlFor={`${sheetId}-account-type`}>
                Account Type
              </label>
              <select
                id={`${sheetId}-account-type`}
                className="form-select form-select-sm"
                value={accountTypeInput}
                onChange={(ev) => setAccountTypeInput(ev.target.value as FinanceAccountType)}
              >
                {FINANCE_ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {accountTypeUsesBillingCycleDay(accountTypeInput) ? (
              <div className="col-md-2">
                <label className="form-label small" htmlFor={`${sheetId}-billing-day`}>
                  Billing cycle day
                </label>
                <input
                  id={`${sheetId}-billing-day`}
                  type="number"
                  min={1}
                  max={31}
                  step={1}
                  className="form-control form-control-sm"
                  required
                  value={billingDayStr}
                  onChange={(ev) => setBillingDayStr(ev.target.value)}
                />
              </div>
            ) : null}
            <div className="col-md-3">
              <label className="form-label small" htmlFor={`${sheetId}-value`}>
                Recorded value
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
          </div>
        </form>
      </AdminEditorSection>

      <AdminEditorSection title="Accounts">
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
                <td className="small">{r.accountType}</td>
                <td className="small text-end">
                  {accountTypeUsesBillingCycleDay(r.accountType) ? r.billingCycleDay : "—"}
                </td>
                <td className="small text-end">
                  <MoneyAmount amount={r.recordedValue} currency={r.currency} amountOnly />
                </td>
                <td className="small">{r.currency}</td>
                <td className="small text-nowrap">{accountLastUpdatedDisplay(r.lastUpdated)}</td>
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
              message={records.length ? "No records match the filter." : "No account records yet."}
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
              <td className="small" />
              <td className="small text-end" />
            </tr>
          ) : null}
        </AdminDataTable>
      </AdminEditorSection>
    </div>
  );
}
