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
  FINANCE_LIABILITY_TYPES,
  newStatementLineId,
  type FinanceLiabilityRecord,
  type FinanceLiabilityType,
  type HouseKey,
} from "../lib/financeModel";
import { houseDisplayLabel } from "../lib/houses";
import { scheduleFocusRecordEditor } from "../lib/focusRecordEditor";
import { useFrankfurterRatesForTotals } from "../hooks/useFrankfurterRatesForTotals";
import {
  AdminCell,
  AdminDataTable,
  AdminDataTableCellMeta,
  AdminDataTableEmptyRow,
  type AdminDataTableColumn,
  AdminEditorSection,
  AdminTableTotalCurrency,
  AdminTableTotalLabel,
  CurrencySelect,
  MoneyAmount,
  StaleValuationBadge,
  TableIconButton,
  TableSortHeaderButton,
} from "./ui";

function liabilityLastUpdatedDisplay(lastUpdated: string | undefined): string {
  if (!lastUpdated) {
    return "—";
  }
  return formatDateUtc(`${lastUpdated}T00:00:00.000Z`);
}

type LiabilitiesSortKey = "desc" | "ltype" | "amt" | "rate" | "ccy" | "house" | "lastUpdated";

const LIABILITY_SORT_OPTIONS: readonly { readonly key: LiabilitiesSortKey; readonly label: string }[] = [
  { key: "desc", label: "Description" },
  { key: "ltype", label: "Type" },
  { key: "amt", label: "Outstanding" },
  { key: "ccy", label: "Currency" },
  { key: "rate", label: "Interest rate" },
  { key: "house", label: "Property" },
  { key: "lastUpdated", label: "Last update" },
];

function compareLiabilities(
  a: FinanceLiabilityRecord,
  b: FinanceLiabilityRecord,
  sortKey: LiabilitiesSortKey,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "desc":
      cmp = a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      break;
    case "ltype":
      cmp = a.liabilityType.localeCompare(b.liabilityType, undefined, { sensitivity: "base" });
      break;
    case "amt": {
      const ma = a.outstandingBalance;
      const mb = b.outstandingBalance;
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "rate": {
      const ra = a.interestRatePercent ?? -1;
      const rb = b.interestRatePercent ?? -1;
      cmp = ra === rb ? 0 : ra < rb ? -1 : 1;
      break;
    }
    case "ccy":
      cmp = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
      break;
    case "house":
      cmp = (a.relatedHouse ?? "").localeCompare(b.relatedHouse ?? "", undefined, {
        sensitivity: "base",
      });
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

export function FinanceLiabilitiesPanel(props: {
  readonly records: readonly FinanceLiabilityRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinanceLiabilityRecord[]) => FinanceLiabilityRecord[],
  ) => void;
  readonly relatedHouseOptions: ReadonlyArray<{
    readonly value: HouseKey;
    readonly label: string;
  }>;
}) {
  const { records, onPatch, relatedHouseOptions } = props;
  const sheetId = "liabilities";
  const formId = `${sheetId}-form`;
  const recordEditorSectionRef = useRef<HTMLDivElement | null>(null);

  const [sortKey, setSortKey] = useState<LiabilitiesSortKey | null>("ltype");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const onSort = useCallback((key: LiabilitiesSortKey) => {
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
  const [descriptionInput, setDescriptionInput] = useState("");
  const [liabilityTypeInput, setLiabilityTypeInput] = useState<FinanceLiabilityType>("Mortgage");
  const [balanceStr, setBalanceStr] = useState("");
  const [rateStr, setRateStr] = useState("");
  const [relatedHouseInput, setRelatedHouseInput] = useState<HouseKey | "">("");
  const [formCurrency, setFormCurrency] = useState(GLOBAL_DEFAULT_CURRENCY);
  const [tableFilter, setTableFilter] = useState("");
  const [totalDisplayCurrency, setTotalDisplayCurrency] = useState<CurrencyCode>(
    GLOBAL_DEFAULT_CURRENCY,
  );

  const tableColumns = useMemo((): AdminDataTableColumn[] => {
    const manualSort = sortKey !== null;
    const thAria = (
      key: LiabilitiesSortKey,
    ): "ascending" | "descending" | "none" | "other" | undefined => {
      if (!manualSort) return undefined;
      if (sortKey === key) return sortDir === "asc" ? "ascending" : "descending";
      return "none";
    };
    const dirFor = (key: LiabilitiesSortKey): "asc" | "desc" | null =>
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
        key: "ltype",
        header: (
          <TableSortHeaderButton
            label="Liability Type"
            isActive={sortKey === "ltype"}
            direction={dirFor("ltype")}
            onClick={() => onSort("ltype")}
          />
        ),
        className: "small",
        priority: "secondary",
        thAriaSort: thAria("ltype"),
      },
      {
        key: "amt",
        header: (
          <TableSortHeaderButton
            label="Outstanding Balance"
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
        priority: "secondary",
        thAriaSort: thAria("ccy"),
      },
      {
        key: "rate",
        header: (
          <TableSortHeaderButton
            label="Interest Rate"
            isActive={sortKey === "rate"}
            direction={dirFor("rate")}
            onClick={() => onSort("rate")}
          />
        ),
        className: "small text-end",
        headerClassName: "text-end",
        priority: "tertiary",
        thAriaSort: thAria("rate"),
      },
      {
        key: "house",
        header: (
          <TableSortHeaderButton
            label="Related Property"
            isActive={sortKey === "house"}
            direction={dirFor("house")}
            onClick={() => onSort("house")}
          />
        ),
        className: "small",
        priority: "secondary",
        thAriaSort: thAria("house"),
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
        className: "small admin-nowrap",
        priority: "tertiary",
        thAriaSort: thAria("lastUpdated"),
      },
      {
        key: "ops",
        header: <span className="visually-hidden">Operations</span>,
        className: "text-end admin-nowrap",
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
            r.description,
            r.liabilityType,
            r.currency,
            String(r.outstandingBalance),
            r.interestRatePercent !== undefined ? String(r.interestRatePercent) : "",
            houseDisplayLabel(r.relatedHouse),
            r.lastUpdated ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    if (sortKey !== null) {
      list.sort((a, b) => compareLiabilities(a, b, sortKey, sortDir));
    } else {
      list.sort((a, b) => {
        const byType = a.liabilityType.localeCompare(b.liabilityType, undefined, {
          sensitivity: "base",
        });
        if (byType !== 0) return byType;
        return a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
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
          sum + convertAmountToBase(r.outstandingBalance, r.currency, totalDisplayCurrency, map),
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
    setDescriptionInput("");
    setLiabilityTypeInput("Mortgage");
    setBalanceStr("");
    setRateStr("");
    setRelatedHouseInput("");
    setFormCurrency(GLOBAL_DEFAULT_CURRENCY);
  }

  function openEdit(row: FinanceLiabilityRecord) {
    setEditingId(row.id);
    setFormError(null);
    setDescriptionInput(row.description);
    setLiabilityTypeInput(row.liabilityType);
    setBalanceStr(String(row.outstandingBalance));
    setRateStr(row.interestRatePercent !== undefined ? String(row.interestRatePercent) : "");
    setRelatedHouseInput(row.relatedHouse ?? "");
    setFormCurrency(coerceSupportedCurrency(row.currency, GLOBAL_DEFAULT_CURRENCY));
    scheduleFocusRecordEditor(() => recordEditorSectionRef.current);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const description = descriptionInput.trim();
    if (!description) {
      setFormError("Description is required.");
      return;
    }
    const balanceNum = parseAmount(balanceStr);
    if (balanceNum === null || balanceNum < 0) {
      setFormError("Outstanding balance must be a number ≥ 0.");
      return;
    }
    let interestRatePercent: number | undefined;
    if (rateStr.trim()) {
      const rateNum = parseAmount(rateStr);
      if (rateNum === null || rateNum < 0 || rateNum > 100) {
        setFormError("Interest rate must be a number between 0 and 100.");
        return;
      }
      interestRatePercent = rateNum;
    }
    const currency = coerceSupportedCurrency(formCurrency, GLOBAL_DEFAULT_CURRENCY);
    const id = editingId ?? newStatementLineId();
    const row: FinanceLiabilityRecord = {
      id,
      description,
      liabilityType: liabilityTypeInput,
      outstandingBalance: balanceNum,
      currency,
      ...(interestRatePercent !== undefined ? { interestRatePercent } : {}),
      ...(relatedHouseInput ? { relatedHouse: relatedHouseInput } : {}),
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
    if (!window.confirm("Delete this liability record?")) return;
    onPatch((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) {
      resetForm();
    }
  }

  return (
    <div>
      <AdminEditorSection
        containerRef={recordEditorSectionRef}
        title="Liability record"
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
            <div className="col-12 col-sm-6 col-lg-2">
              <label className="form-label small" htmlFor={`${sheetId}-description`}>
                Description
              </label>
              <input
                id={`${sheetId}-description`}
                type="text"
                className="form-control form-control-sm"
                required
                value={descriptionInput}
                onChange={(ev) => setDescriptionInput(ev.target.value)}
                placeholder="e.g. lender and product"
                autoComplete="off"
              />
            </div>
            <div className="col-12 col-sm-6 col-lg-2">
              <label className="form-label small" htmlFor={`${sheetId}-liability-type`}>
                Liability Type
              </label>
              <select
                id={`${sheetId}-liability-type`}
                className="form-select form-select-sm"
                value={liabilityTypeInput}
                onChange={(ev) => setLiabilityTypeInput(ev.target.value as FinanceLiabilityType)}
              >
                {FINANCE_LIABILITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-sm-6 col-lg-2">
              <label className="form-label small" htmlFor={`${sheetId}-balance`}>
                Outstanding Balance
              </label>
              <input
                id={`${sheetId}-balance`}
                type="number"
                step="0.01"
                min={0}
                className="form-control form-control-sm"
                required
                value={balanceStr}
                onChange={(ev) => setBalanceStr(ev.target.value)}
              />
            </div>
            <div className="col-12 col-sm-6 col-lg-2">
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
            <div className="col-12 col-sm-6 col-lg-2">
              <label className="form-label small" htmlFor={`${sheetId}-rate`}>
                Interest Rate %
              </label>
              <input
                id={`${sheetId}-rate`}
                type="number"
                step="0.01"
                min={0}
                max={100}
                className="form-control form-control-sm"
                value={rateStr}
                onChange={(ev) => setRateStr(ev.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="col-12 col-sm-6 col-lg-2">
              <label className="form-label small" htmlFor={`${sheetId}-related-house`}>
                Related Property
              </label>
              <select
                id={`${sheetId}-related-house`}
                className="form-select form-select-sm"
                value={relatedHouseInput}
                onChange={(ev) => setRelatedHouseInput(ev.target.value as HouseKey | "")}
              >
                <option value="">—</option>
                {relatedHouseOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </form>
      </AdminEditorSection>

      <AdminEditorSection title="Liabilities">
        <AdminDataTable
          embedded
          columns={tableColumns}
          filterValue={tableFilter}
          onFilterChange={setTableFilter}
          filterPlaceholder="Filter records…"
          sort={{
            options: LIABILITY_SORT_OPTIONS,
            sortKey,
            direction: sortDir,
            onChange: (key, dir) => {
              setSortKey(key as LiabilitiesSortKey | null);
              setSortDir(dir);
            },
          }}
        >
          {filtered.length ? (
            filtered.map((r) => (
              <tr key={r.id}>
                <AdminCell column="desc" className="small">
                  {r.description}
                  <AdminDataTableCellMeta>
                    {r.liabilityType} · {r.currency}
                    {r.relatedHouse ? ` · ${houseDisplayLabel(r.relatedHouse)}` : ""}
                  </AdminDataTableCellMeta>
                  <AdminDataTableCellMeta until="tertiary">
                    <StaleValuationBadge lastUpdated={r.lastUpdated} />
                  </AdminDataTableCellMeta>
                </AdminCell>
                <AdminCell column="ltype" className="small">{r.liabilityType}</AdminCell>
                <AdminCell column="amt" className="small text-end">
                  <MoneyAmount amount={r.outstandingBalance} currency={r.currency} amountOnly />
                </AdminCell>
                <AdminCell column="ccy" className="small">{r.currency}</AdminCell>
                <AdminCell column="rate" className="small text-end">
                  {r.interestRatePercent !== undefined ? `${r.interestRatePercent}%` : "—"}
                </AdminCell>
                <AdminCell column="house" className="small">{houseDisplayLabel(r.relatedHouse)}</AdminCell>
                <AdminCell column="lastUpdated" className="small">
                  {liabilityLastUpdatedDisplay(r.lastUpdated)}
                  <StaleValuationBadge lastUpdated={r.lastUpdated} />
                </AdminCell>
                <AdminCell column="ops" className="small text-end">
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
                </AdminCell>
              </tr>
            ))
          ) : (
            <AdminDataTableEmptyRow
              colSpan={colSpan}
              message={
                records.length ? "No records match the filter." : "No liability records yet."
              }
            />
          )}
          {records.length > 0 ? (
            <tr className="table-group-divider table-secondary fw-semibold">
              <AdminCell column="desc" className="small">
                <AdminTableTotalLabel
                  label="Total owed"
                  needsFx={needsFx}
                  fxError={fxError}
                  fxLoading={fxLoading}
                  ratesQuery={ratesQuery}
                />
              </AdminCell>
              <AdminCell column="ltype" className="small" />
              <AdminCell column="amt" className="small text-end">
                {convertedTotal !== null ? (
                  <MoneyAmount amount={convertedTotal} currency={totalDisplayCurrency} amountOnly />
                ) : (
                  <span className="text-muted">—</span>
                )}
                <br />
                <AdminTableTotalCurrency
                  id={`${sheetId}-total-ccy`}
                  value={totalDisplayCurrency}
                  onChange={setTotalDisplayCurrency}
                  disabled={fxLoading}
                />
              </AdminCell>
              <AdminCell column="ccy" className="small" />
              <AdminCell column="rate" className="small" />
              <AdminCell column="house" className="small" />
              <AdminCell column="lastUpdated" className="small" />
              <AdminCell column="ops" className="small text-end" />
            </tr>
          ) : null}
        </AdminDataTable>
      </AdminEditorSection>
    </div>
  );
}
