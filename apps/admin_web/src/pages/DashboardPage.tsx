import { Fragment, type ReactNode, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FinanceDataLoadOrError } from "../components/FinanceDataStatus";
import {
  CurrencySelect,
  FrankfurterRatesFooterNote,
  MoneyAmount,
} from "../components/ui";
import { adminFetchJson } from "../lib/apiAdminClient";
import { useFrankfurterRatesForTotals } from "../hooks/useFrankfurterRatesForTotals";
import { useFrankfurterRatesToBase } from "../hooks/useFrankfurterRatesToBase";
import { useFinance } from "../hooks/useFinance";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
  type CurrencyCode,
} from "../lib/currencies";
import { convertAmountToBase, convertAmountWithBase } from "../lib/frankfurterRates";
import { buildQuoteMap } from "../lib/financeQuotes";
import { useFinanceQuotes } from "../hooks/useFinanceQuotes";
import { LEDGER_RELATED_HOUSE_OPTIONS } from "../lib/houses";
import {
  defaultFiscalYearIdForNowUtc,
  FISCAL_YEAR_OPTIONS,
  formatFiscalYearIdLabel,
  type FiscalYearId,
  fiscalYearIdToStartCalendarYear,
  sumHouseStatementLinesForFiscalYear,
} from "../lib/fiscalYearFinance";
import {
  EXPENSE_CATEGORIES,
  investmentMarketSourceCurrency,
  investmentRecordCurrentValueInRowCurrency,
  investmentRecordFiatNotionalInQuoteCurrency,
  isInvestmentMarketPriced,
  monthlyLedgerNetByCurrency,
  sumMonthlyFinanceLedgerAmountsByHouse,
  sumMonthlyFinanceLedgerAmountsGeneral,
  sumMonthlyGeneralExpenseAmountsByCategory,
  ledgerMonthlyAmount,
  type HouseKey,
} from "../lib/financeModel";
import { HOUSE_DISPLAY_LABEL } from "../lib/houses";

function formatExpensePercentOfIncome(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded}%`;
  }
  return `${rounded.toFixed(1)}%`;
}

function sortedCurrencyEntries(record: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(record)
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

function FiscalBucketList({
  buckets,
  emptyLabel,
}: {
  readonly buckets: Readonly<Record<string, number>>;
  readonly emptyLabel: string;
}) {
  const entries = sortedCurrencyEntries(buckets);
  if (entries.length === 0) {
    return <span className="text-muted">{emptyLabel}</span>;
  }
  return (
    <ul className="list-unstyled mb-0 small">
      {entries.map(([currency, amount]) => (
        <li key={currency}>
          <MoneyAmount amount={amount} currency={currency} />
        </li>
      ))}
    </ul>
  );
}

function MonthlyNetByCurrencyList({
  netByCurrency,
  emptyLabel,
}: {
  readonly netByCurrency: Readonly<Record<string, number>>;
  readonly emptyLabel: string;
}) {
  const currencies = Object.keys(netByCurrency).sort((a, b) => a.localeCompare(b));
  const currency = currencies[0];
  if (!currency) {
    return <span className="text-muted">{emptyLabel}</span>;
  }
  const amount = netByCurrency[currency] ?? 0;
  return (
    <ul className="list-unstyled mb-0 small">
      <li className={amount >= 0 ? "text-success" : "text-danger"}>
        <MoneyAmount amount={amount} currency={currency} />
      </li>
    </ul>
  );
}

function HouseSummaryCard({
  houseName,
  houseKey,
  fiscalYear,
  onFiscalYearChange,
}: {
  readonly houseName: string;
  readonly houseKey: HouseKey;
  readonly fiscalYear: FiscalYearId;
  readonly onFiscalYearChange: (id: FiscalYearId) => void;
}) {
  const { data } = useFinance();
  const house = data[houseKey];
  const sums = useMemo(
    () =>
      sumHouseStatementLinesForFiscalYear(
        house.lines,
        fiscalYearIdToStartCalendarYear(fiscalYear),
      ),
    [house.lines, fiscalYear],
  );

  const monthlySums = useMemo(
    () =>
      sumMonthlyFinanceLedgerAmountsByHouse(
        data.incomeRecords,
        data.expenseRecords,
        houseKey,
        data.expenseIncomeAllocationPercents,
        data.allocationRecords,
      ),
    [
      data.allocationRecords,
      data.expenseIncomeAllocationPercents,
      data.expenseRecords,
      data.incomeRecords,
      houseKey,
    ],
  );

  const monthlyNetByCurrency = useMemo(
    () => monthlyLedgerNetByCurrency(monthlySums),
    [monthlySums],
  );

  const fyLabel = formatFiscalYearIdLabel(fiscalYear);

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-body d-flex flex-column">
        <h2 className="h6 mb-3">
          <strong>{houseName}</strong>
        </h2>
        <div className="mb-3">
          <select
            className="form-select form-select-sm"
            value={fiscalYear}
            onChange={(e) => onFiscalYearChange(e.target.value as FiscalYearId)}
            aria-label={`${houseName}: ${fyLabel}`}
          >
            {FISCAL_YEAR_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <dl className="row small mb-0 flex-grow-1">
          <dt className="col-sm-4 text-muted">Income</dt>
          <dd className="col-sm-8">
            <FiscalBucketList buckets={sums.incomeByCurrency} emptyLabel="—" />
          </dd>
          <dt className="col-sm-4 text-muted pt-2">Expenses</dt>
          <dd className="col-sm-8 pt-2">
            <FiscalBucketList buckets={sums.expensesByCurrency} emptyLabel="—" />
          </dd>
        </dl>
        <p className="text-muted small mb-0 mt-3">
          Totals use net amounts from house statement lines in this period.
        </p>
        <hr className="my-3" />
        <p className="small text-muted mb-2">Monthly income and expenses</p>
        <dl className="row small mb-0">
          <dt className="col-sm-4 text-muted">Income</dt>
          <dd className="col-sm-8">
            <FiscalBucketList buckets={monthlySums.incomeByCurrency} emptyLabel="—" />
          </dd>
          <dt className="col-sm-4 text-muted pt-2">Expenses</dt>
          <dd className="col-sm-8 pt-2">
            <FiscalBucketList buckets={monthlySums.expensesByCurrency} emptyLabel="—" />
          </dd>
          <dt className="col-sm-4 text-muted pt-2">Net</dt>
          <dd className="col-sm-8 pt-2">
            <MonthlyNetByCurrencyList netByCurrency={monthlyNetByCurrency} emptyLabel="—" />
          </dd>
        </dl>
      </div>
    </div>
  );
}

function MonthlyViewExpenseAllocationsSection() {
  const { data } = useFinance();
  const generalBuckets = useMemo(
    () =>
      sumMonthlyFinanceLedgerAmountsGeneral(
        data.incomeRecords,
        data.expenseRecords,
        data.expenseIncomeAllocationPercents,
        LEDGER_RELATED_HOUSE_OPTIONS,
        data.allocationRecords,
      ),
    [
      data.allocationRecords,
      data.expenseIncomeAllocationPercents,
      data.expenseRecords,
      data.incomeRecords,
    ],
  );

  const hasActivity = useMemo(() => {
    for (const v of Object.values(generalBuckets.incomeByCurrency)) {
      if (v !== 0) return true;
    }
    for (const v of Object.values(generalBuckets.expensesByCurrency)) {
      if (v !== 0) return true;
    }
    return false;
  }, [generalBuckets]);

  const quoteCurrencies = useMemo(() => {
    const s = new Set<string>();
    for (const [ccy, amt] of Object.entries(generalBuckets.incomeByCurrency)) {
      if (amt !== 0) s.add(ccy);
    }
    for (const [ccy, amt] of Object.entries(generalBuckets.expensesByCurrency)) {
      if (amt !== 0) s.add(ccy);
    }
    return [...s];
  }, [generalBuckets]);

  const needsFx = useMemo(
    () =>
      quoteCurrencies.some(
        (c) => c.trim().toUpperCase() !== GLOBAL_DEFAULT_CURRENCY,
      ),
    [quoteCurrencies],
  );

  const ratesQuery = useFrankfurterRatesToBase(GLOBAL_DEFAULT_CURRENCY, quoteCurrencies);

  const convertedHkd = useMemo(() => {
    if (!hasActivity) {
      return { status: "empty" as const };
    }
    let rateByQuote: ReadonlyMap<string, number> = new Map();
    if (needsFx) {
      if (ratesQuery.isPending) {
        return { status: "loading" as const };
      }
      if (ratesQuery.isError) {
        return { status: "error" as const };
      }
      if (!ratesQuery.isSuccess || !ratesQuery.data) {
        return { status: "loading" as const };
      }
      rateByQuote = ratesQuery.data.rateByQuote;
    }
    try {
      const sumBucket = (rec: Readonly<Record<string, number>>): number =>
        Object.entries(rec).reduce(
          (sum, [ccy, amt]) =>
            amt === 0
              ? sum
              : sum +
                convertAmountToBase(amt, ccy, GLOBAL_DEFAULT_CURRENCY, rateByQuote),
          0,
        );
      const income = sumBucket(generalBuckets.incomeByCurrency);
      const expenses = sumBucket(generalBuckets.expensesByCurrency);
      const expenseByCategory = sumMonthlyGeneralExpenseAmountsByCategory(
        data.incomeRecords,
        data.expenseRecords,
        data.expenseIncomeAllocationPercents,
        LEDGER_RELATED_HOUSE_OPTIONS,
      );
      const categoryPercentsSorted = EXPENSE_CATEGORIES.map((category) => {
        const buckets: Readonly<Record<string, number>> = expenseByCategory[category] ?? {};
        const amountHkd = sumBucket(buckets);
        const percent = income > 0 ? (amountHkd / income) * 100 : 0;
        return { category, amountHkd, percent };
      }).sort((a, b) => {
        if (b.percent !== a.percent) {
          return b.percent - a.percent;
        }
        return a.category.localeCompare(b.category, undefined, { sensitivity: "base" });
      });
      return {
        status: "ok" as const,
        income,
        expenses,
        net: income - expenses,
        categoryPercentsSorted,
      };
    } catch {
      return { status: "fx-missing" as const };
    }
  }, [
    data.expenseIncomeAllocationPercents,
    data.expenseRecords,
    data.incomeRecords,
    generalBuckets.expensesByCurrency,
    generalBuckets.incomeByCurrency,
    hasActivity,
    needsFx,
    ratesQuery.data,
    ratesQuery.isError,
    ratesQuery.isPending,
    ratesQuery.isSuccess,
  ]);

  function generalHkdValue(
    c: typeof convertedHkd,
    kind: "income" | "expenses" | "net" | "netDaily",
  ): ReactNode {
    if (c.status === "empty") {
      return <span className="text-muted">—</span>;
    }
    if (c.status === "loading") {
      return <span className="text-muted">Loading rates…</span>;
    }
    if (c.status === "error") {
      return <span className="text-danger">Could not load exchange rates.</span>;
    }
    if (c.status === "fx-missing") {
      return <span className="text-danger">Missing FX rate for a currency.</span>;
    }
    const amt =
      kind === "income"
        ? c.income
        : kind === "expenses"
          ? c.expenses
          : kind === "net"
            ? c.net
            : c.net / 30;
    if (kind === "net" || kind === "netDaily") {
      return (
        <span className={amt >= 0 ? "text-success" : "text-danger"}>
          <MoneyAmount amount={amt} currency={GLOBAL_DEFAULT_CURRENCY} />
        </span>
      );
    }
    return <MoneyAmount amount={amt} currency={GLOBAL_DEFAULT_CURRENCY} />;
  }

  function generalCategoryPercentPanel(c: typeof convertedHkd): ReactNode {
    if (c.status === "empty") {
      return <span className="text-muted">—</span>;
    }
    if (c.status === "loading") {
      return <span className="text-muted">Loading rates…</span>;
    }
    if (c.status === "error") {
      return <span className="text-danger">Could not load exchange rates.</span>;
    }
    if (c.status === "fx-missing") {
      return <span className="text-danger">Missing FX rate for a currency.</span>;
    }
    if (c.income <= 0) {
      return (
        <p className="text-muted small mb-0">
          Income is zero in {GLOBAL_DEFAULT_CURRENCY}, so category allocations are not shown.
        </p>
      );
    }
    return (
      <dl className="row small mb-0">
        {c.categoryPercentsSorted.map(({ category, percent }, idx) => (
          <Fragment key={category}>
            <dt
              className={
                idx > 0 ? "col-sm-4 text-muted pt-2" : "col-sm-4 text-muted"
              }
            >
              {category}
            </dt>
            <dd className={idx > 0 ? "col-sm-8 pt-2" : "col-sm-8"}>
              {formatExpensePercentOfIncome(percent)}
            </dd>
          </Fragment>
        ))}
      </dl>
    );
  }

  return (
    <div className="row g-3 mb-4">
      <div className="col-12 col-lg-6">
        <div className="card h-100 shadow-sm">
          <div className="card-body d-flex flex-column">
            <h2 className="h6 mb-3">
              <strong>Monthly View</strong>
            </h2>
            <p className="text-muted small mb-3">
              Monthly income and expenses not linked to any property (including derived tax,
              saving, and investment amounts from tagged income with no related property),
              summed in {GLOBAL_DEFAULT_CURRENCY}.
            </p>
            <dl className="row small mb-0">
              <dt className="col-sm-4 text-muted">Income</dt>
              <dd className="col-sm-8">{generalHkdValue(convertedHkd, "income")}</dd>
              <dt className="col-sm-4 text-muted pt-2">Expenses</dt>
              <dd className="col-sm-8 pt-2">{generalHkdValue(convertedHkd, "expenses")}</dd>
              <dt className="col-sm-4 text-muted pt-2">Net</dt>
              <dd className="col-sm-8 pt-2">{generalHkdValue(convertedHkd, "net")}</dd>
              <dt className="col-sm-4 text-muted pt-2">Net (daily)</dt>
              <dd className="col-sm-8 pt-2">{generalHkdValue(convertedHkd, "netDaily")}</dd>
            </dl>
          </div>
        </div>
      </div>
      <div className="col-12 col-lg-6">
        <div className="card h-100 shadow-sm">
          <div className="card-body d-flex flex-column">
            <h2 className="h6 mb-3">
              <strong>Expense Allocations</strong>
            </h2>
            <p className="small text-muted mb-2">
              Expense categories as a share of general income in this monthly view (highest
              first).
            </p>
            {generalCategoryPercentPanel(convertedHkd)}
          </div>
        </div>
      </div>
    </div>
  );
}

function AllocationCoverageDashboardCard() {
  const { data } = useFinance();
  const base = GLOBAL_DEFAULT_CURRENCY;

  const sortedAllocations = useMemo(
    () =>
      [...data.allocationRecords].sort((a, b) =>
        a.description.localeCompare(b.description, undefined, { sensitivity: "base" }),
      ),
    [data.allocationRecords],
  );

  const liquidInvestments = useMemo(
    () => data.investmentRecords.filter((r) => r.assetType === "Liquid"),
    [data.investmentRecords],
  );

  const bankAccounts = useMemo(
    () => data.accountRecords.filter((a) => a.accountType === "Bank Account"),
    [data.accountRecords],
  );

  const marketPricedSymbols = useMemo(() => {
    const symbols: string[] = [];
    for (const r of liquidInvestments) {
      if (!isInvestmentMarketPriced(r)) continue;
      const src = investmentMarketSourceCurrency(r);
      if (src) symbols.push(src);
    }
    return symbols;
  }, [liquidInvestments]);

  const quotesQuery = useFinanceQuotes(marketPricedSymbols);
  const quoteByOriginalSymbol = useMemo(
    () => buildQuoteMap(quotesQuery.data ?? []),
    [quotesQuery.data],
  );
  const quotesPending = marketPricedSymbols.length > 0 && quotesQuery.isPending;
  const quotesErrored = marketPricedSymbols.length > 0 && quotesQuery.isError;

  const fxQuoteCurrencies = useMemo(() => {
    const s = new Set<string>();
    for (const r of liquidInvestments) {
      s.add(r.currency);
    }
    for (const a of sortedAllocations) {
      s.add(a.currency);
    }
    for (const sv of data.savingsRecords) {
      s.add(sv.currency);
    }
    for (const ac of bankAccounts) {
      s.add(ac.currency);
    }
    for (const q of quotesQuery.data ?? []) {
      if (q.currency) s.add(q.currency);
    }
    return [...s];
  }, [liquidInvestments, sortedAllocations, data.savingsRecords, bankAccounts, quotesQuery.data]);

  const { needsFx, ratesQuery, rateByQuoteForDisplay, fxLoading, fxError } =
    useFrankfurterRatesForTotals(base, fxQuoteCurrencies);

  const oneUnitConverter = useCallback(
    (sourceCode: string, rowCurrency: string): number | undefined => {
      const q = quoteByOriginalSymbol.get(sourceCode);
      if (!q || q.price === undefined || q.currency === undefined) {
        return undefined;
      }
      const quoteCcy = q.currency.trim().toUpperCase();
      const rowCcy = rowCurrency.trim().toUpperCase();
      if (quoteCcy === rowCcy) return q.price;
      if (needsFx && !ratesQuery.isSuccess) return undefined;
      try {
        return convertAmountWithBase(
          q.price,
          quoteCcy,
          rowCcy,
          base,
          rateByQuoteForDisplay,
        );
      } catch {
        return undefined;
      }
    },
    [quoteByOriginalSymbol, needsFx, ratesQuery.isSuccess, base, rateByQuoteForDisplay],
  );

  const liquidValueInRowCcy = useMemo(() => {
    const m = new Map<string, number | undefined>();
    for (const r of liquidInvestments) {
      m.set(r.id, investmentRecordCurrentValueInRowCurrency(r, oneUnitConverter));
    }
    return m;
  }, [liquidInvestments, oneUnitConverter]);

  const sheet = useMemo(() => {
    const hasAnyData =
      sortedAllocations.length > 0 ||
      liquidInvestments.length > 0 ||
      data.savingsRecords.length > 0 ||
      bankAccounts.length > 0;
    if (!hasAnyData) {
      return { status: "empty" as const };
    }
    if (quotesPending) {
      return { status: "loading" as const, stage: "quotes" as const };
    }
    if (quotesErrored) {
      return { status: "error" as const, stage: "quotes" as const };
    }
    if (needsFx) {
      if (fxLoading) {
        return { status: "loading" as const, stage: "fx" as const };
      }
      if (fxError || !ratesQuery.isSuccess || !ratesQuery.data) {
        return { status: "error" as const, stage: "fx" as const };
      }
    }
    const map =
      needsFx && ratesQuery.data ? ratesQuery.data.rateByQuote : new Map<string, number>();

    try {
      const allocationRows: {
        readonly key: string;
        readonly description: string;
        readonly hkd: number;
      }[] = [];
      let allocationsSum = 0;
      for (const a of sortedAllocations) {
        const hkd = convertAmountToBase(a.accumulatedAmount, a.currency, base, map);
        allocationRows.push({ key: a.expenseId, description: a.description, hkd });
        allocationsSum += hkd;
      }

      let coverage = 0;
      for (const r of liquidInvestments) {
        const vRow = liquidValueInRowCcy.get(r.id);
        const value =
          vRow !== undefined ? vRow : investmentRecordFiatNotionalInQuoteCurrency(r);
        coverage += convertAmountToBase(value, r.currency, base, map);
      }
      for (const s of data.savingsRecords) {
        coverage += convertAmountToBase(s.value, s.currency, base, map);
      }
      for (const acc of bankAccounts) {
        coverage += convertAmountToBase(acc.recordedValue, acc.currency, base, map);
      }

      const diff = allocationsSum - coverage;
      return {
        status: "ok" as const,
        allocationRows,
        allocationsSum,
        coverage,
        diff,
      };
    } catch {
      return { status: "fx-missing" as const };
    }
  }, [
    sortedAllocations,
    liquidInvestments,
    liquidValueInRowCcy,
    data.savingsRecords,
    bankAccounts,
    base,
    quotesPending,
    quotesErrored,
    needsFx,
    fxLoading,
    fxError,
    ratesQuery.isSuccess,
    ratesQuery.data,
  ]);

  function loadingOrErrorMessage(s: typeof sheet): ReactNode {
    if (s.status === "loading") {
      return s.stage === "quotes" ? (
        <span className="text-muted">Loading investment quotes…</span>
      ) : (
        <span className="text-muted">Loading exchange rates…</span>
      );
    }
    if (s.status === "error") {
      return s.stage === "quotes" ? (
        <span className="text-danger">Could not load investment quotes.</span>
      ) : (
        <span className="text-danger">Could not load exchange rates.</span>
      );
    }
    if (s.status === "fx-missing") {
      return <span className="text-danger">Missing FX rate for a currency.</span>;
    }
    return null;
  }

  return (
    <div className="col-12 col-lg-6">
      <div className="card h-100 shadow-sm">
        <div className="card-body d-flex flex-column">
          <h2 className="h6 mb-3">
            <strong>Allocation Coverage</strong>
          </h2>
          <p className="text-muted small mb-3">
            Allocation rows (same as the Finance Allocations tab) in {base}, compared to liquid
            investments, all savings deposits, and bank account current balances—also summed in{" "}
            {base}.
          </p>

          {sheet.status === "empty" ? (
            <p className="text-muted small mb-0">No allocation or coverage data yet.</p>
          ) : (
            <>
              <div className="table-responsive mb-3" style={{ maxHeight: "14rem" }}>
                <table className="table table-sm table-striped mb-0">
                  <thead>
                    <tr>
                      <th className="small">Description</th>
                      <th className="small text-end">Accumulated ({base})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAllocations.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="small text-muted">
                          No allocation rows.
                        </td>
                      </tr>
                    ) : sheet.status === "ok" ? (
                      sheet.allocationRows.map((row) => (
                        <tr key={row.key}>
                          <td className="small">{row.description}</td>
                          <td className="small text-end text-nowrap">
                            <MoneyAmount amount={row.hkd} currency={base} amountOnly />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="small">
                          {loadingOrErrorMessage(sheet)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {sortedAllocations.length > 0 && sheet.status === "ok" ? (
                    <tfoot>
                      <tr className="fw-semibold">
                        <td className="small">Total allocations</td>
                        <td className="small text-end text-nowrap">
                          <MoneyAmount amount={sheet.allocationsSum} currency={base} amountOnly />
                        </td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>

              <dl className="row small mb-2">
                <dt className="col-sm-5 text-muted">Coverage</dt>
                <dd className="col-sm-7 text-end mb-0">
                  {sheet.status === "ok" ? (
                    <MoneyAmount amount={sheet.coverage} currency={base} amountOnly />
                  ) : (
                    loadingOrErrorMessage(sheet)
                  )}
                </dd>
                <dt className="col-sm-5 text-muted pt-2">Allocations − coverage</dt>
                <dd className="col-sm-7 text-end pt-2 mb-0">
                  {sheet.status === "ok" ? (
                    <span className={sheet.diff <= 0 ? "text-success" : "text-danger"}>
                      <MoneyAmount amount={sheet.diff} currency={base} amountOnly />
                    </span>
                  ) : (
                    loadingOrErrorMessage(sheet)
                  )}
                </dd>
              </dl>
              {needsFx ? (
                <p className="small text-muted mb-0">
                  <FrankfurterRatesFooterNote
                    needsFx={needsFx}
                    fxError={fxError}
                    fxLoading={fxLoading}
                    ratesQuery={ratesQuery}
                  />
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PensionDashboardCard() {
  const { data } = useFinance();
  const [totalDisplayCurrency, setTotalDisplayCurrency] = useState<CurrencyCode>(
    GLOBAL_DEFAULT_CURRENCY,
  );

  const pensionParts = useMemo(() => {
    const parts: { readonly amount: number; readonly currency: string }[] = [];
    for (const r of data.pensionRecords) {
      parts.push({ amount: r.value, currency: r.currency });
    }
    for (const a of data.allocationRecords) {
      if (a.isPension === true) {
        parts.push({ amount: a.accumulatedAmount, currency: a.currency });
      }
    }
    return parts;
  }, [data.allocationRecords, data.pensionRecords]);

  const salaryRecords = useMemo(
    () =>
      data.incomeRecords.filter(
        (r) => r.category === "Salary" && r.isDerivedFromAllocation !== true,
      ),
    [data.incomeRecords],
  );

  const recordCurrencies = useMemo(() => {
    const s = new Set<string>();
    for (const p of pensionParts) {
      s.add(p.currency);
    }
    for (const r of salaryRecords) {
      s.add(r.currency);
    }
    return [...s];
  }, [pensionParts, salaryRecords]);

  const { needsFx, ratesQuery, fxLoading, fxError } = useFrankfurterRatesForTotals(
    totalDisplayCurrency,
    recordCurrencies,
  );

  const convertedPensionTotal = useMemo(() => {
    const fundEmpty = data.pensionRecords.length === 0;
    const allocEmpty = !data.allocationRecords.some((r) => r.isPension === true);
    if (fundEmpty && allocEmpty) {
      return { status: "empty" as const };
    }
    let map: ReadonlyMap<string, number> = new Map();
    if (needsFx) {
      if (fxLoading) {
        return { status: "loading" as const };
      }
      if (fxError || !ratesQuery.isSuccess || !ratesQuery.data) {
        return { status: "error" as const };
      }
      map = ratesQuery.data.rateByQuote;
    }
    try {
      const sum = pensionParts.reduce(
        (acc, p) =>
          acc +
          convertAmountToBase(p.amount, p.currency, totalDisplayCurrency, map),
        0,
      );
      return { status: "ok" as const, sum };
    } catch {
      return { status: "fx-missing" as const };
    }
  }, [
    data.allocationRecords,
    data.pensionRecords,
    fxError,
    fxLoading,
    needsFx,
    pensionParts,
    ratesQuery.data,
    ratesQuery.isSuccess,
    totalDisplayCurrency,
  ]);

  const convertedSalaryAnnual = useMemo(() => {
    if (salaryRecords.length === 0) {
      return { status: "empty" as const };
    }
    let map: ReadonlyMap<string, number> = new Map();
    if (needsFx) {
      if (fxLoading) {
        return { status: "loading" as const };
      }
      if (fxError || !ratesQuery.isSuccess || !ratesQuery.data) {
        return { status: "error" as const };
      }
      map = ratesQuery.data.rateByQuote;
    }
    try {
      const sum = salaryRecords.reduce((acc, r) => {
        const annual = ledgerMonthlyAmount(r) * 12;
        return (
          acc +
          convertAmountToBase(annual, r.currency, totalDisplayCurrency, map)
        );
      }, 0);
      return { status: "ok" as const, sum };
    } catch {
      return { status: "fx-missing" as const };
    }
  }, [
    fxError,
    fxLoading,
    needsFx,
    ratesQuery.data,
    ratesQuery.isSuccess,
    salaryRecords,
    totalDisplayCurrency,
  ]);

  const yearSalaryRatioDisplay = useMemo((): ReactNode => {
    if (convertedPensionTotal.status === "empty") {
      return <span className="text-muted">—</span>;
    }
    if (
      convertedPensionTotal.status === "loading" ||
      convertedSalaryAnnual.status === "loading"
    ) {
      return <span className="text-muted">Loading rates…</span>;
    }
    if (
      convertedPensionTotal.status === "error" ||
      convertedSalaryAnnual.status === "error"
    ) {
      return <span className="text-danger">Could not load exchange rates.</span>;
    }
    if (
      convertedPensionTotal.status === "fx-missing" ||
      convertedSalaryAnnual.status === "fx-missing"
    ) {
      return <span className="text-danger">Missing FX rate for a currency.</span>;
    }
    if (convertedSalaryAnnual.status === "empty" || convertedSalaryAnnual.sum <= 0) {
      return (
        <span className="text-muted">
          — (no annual salary in the Salary category)
        </span>
      );
    }
    const ratio = convertedPensionTotal.sum / convertedSalaryAnnual.sum;
    const rounded = Math.round(ratio * 100) / 100;
    return (
      <span>
        {Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)}
        <span className="text-muted">×</span>
        <span className="text-muted small ms-1">
          (pension ÷ annual salary, {totalDisplayCurrency})
        </span>
      </span>
    );
  }, [convertedPensionTotal, convertedSalaryAnnual, totalDisplayCurrency]);

  function pensionTotalBody(): ReactNode {
    if (convertedPensionTotal.status === "empty") {
      return <span className="text-muted">—</span>;
    }
    if (convertedPensionTotal.status === "loading") {
      return <span className="text-muted">Loading rates…</span>;
    }
    if (convertedPensionTotal.status === "error") {
      return <span className="text-danger">Could not load exchange rates.</span>;
    }
    if (convertedPensionTotal.status === "fx-missing") {
      return <span className="text-danger">Missing FX rate for a currency.</span>;
    }
    return (
      <MoneyAmount
        amount={convertedPensionTotal.sum}
        currency={totalDisplayCurrency}
        amountOnly
      />
    );
  }

  return (
    <div className="col-12 col-lg-6">
      <div className="card h-100 shadow-sm">
        <div className="card-body d-flex flex-column">
          <h2 className="h6 mb-3">
            <strong>Pension</strong>
          </h2>
          <p className="text-muted small mb-3">
            Total pension (fund rows plus allocations tagged Pension), converted to your chosen
            display currency—the same total as on the Finance Pension tab.
          </p>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <span className="fw-semibold">{pensionTotalBody()}</span>
            <CurrencySelect
              id="dashboard-pension-total-ccy"
              className="form-select form-select-sm w-auto"
              value={totalDisplayCurrency}
              onChange={(code) =>
                setTotalDisplayCurrency(coerceSupportedCurrency(code, GLOBAL_DEFAULT_CURRENCY))
              }
              disabled={fxLoading}
            />
          </div>
          <p className="small text-muted mb-3">
            <FrankfurterRatesFooterNote
              needsFx={needsFx}
              fxError={fxError}
              fxLoading={fxLoading}
              ratesQuery={ratesQuery}
            />
          </p>
          <dl className="row small mb-0">
            <dt className="col-sm-5 text-muted">Year Salary Ratio</dt>
            <dd className="col-sm-7 mb-0">{yearSalaryRatioDisplay}</dd>
          </dl>
          <p className="text-muted small mb-0 mt-2">
            Annual salary sums Income rows in the Salary category (monthly amounts × 12, yearly
            amounts as entered), in the same display currency.
          </p>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const healthQuery = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () =>
      adminFetchJson<{ status?: string }>("/health", { requireAuth: false }),
  });

  const meQuery = useQuery({
    queryKey: ["admin", "me"],
    queryFn: () =>
      adminFetchJson<{ sub?: string; email?: string }>("/me"),
  });

  const [hillmartonFy, setHillmartonFy] = useState<FiscalYearId>(() =>
    defaultFiscalYearIdForNowUtc(),
  );
  const [morrisonFy, setMorrisonFy] = useState<FiscalYearId>(() =>
    defaultFiscalYearIdForNowUtc(),
  );

  const financeQuery = useFinance();

  return (
    <div>
      <h1 className="h3 mb-3">Dashboard</h1>
      <p className="text-muted">
        Welcome to the LX Software admin console. Use the sidebar to manage assets
        and records.
      </p>

      <FinanceDataLoadOrError
        isLoading={financeQuery.isLoading}
        isError={financeQuery.isError}
        loadErrorMessage="Could not load finance data for summaries. Check API configuration and sign-in."
      />
      {!financeQuery.isLoading && !financeQuery.isError ? (
        <>
          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <HouseSummaryCard
                houseName={HOUSE_DISPLAY_LABEL.hillmarton}
                houseKey="hillmarton"
                fiscalYear={hillmartonFy}
                onFiscalYearChange={setHillmartonFy}
              />
            </div>
            <div className="col-md-6">
              <HouseSummaryCard
                houseName={HOUSE_DISPLAY_LABEL.morrison}
                houseKey="morrison"
                fiscalYear={morrisonFy}
                onFiscalYearChange={setMorrisonFy}
              />
            </div>
          </div>
          <MonthlyViewExpenseAllocationsSection />
          <div className="row g-3 mb-4">
            <PensionDashboardCard />
            <AllocationCoverageDashboardCard />
          </div>
        </>
      ) : null}

      <div className="card mt-4 shadow-sm">
        <div className="card-body">
          <h2 className="h6 text-uppercase text-muted">API health</h2>
          {healthQuery.isLoading ? (
            <p className="mb-0 small text-muted">Checking /health…</p>
          ) : healthQuery.isError ? (
            <p className="mb-0 small text-danger">Health check failed.</p>
          ) : (
            <p className="mb-0 small">
              <code>/health</code>:{" "}
              <span className="text-success">{healthQuery.data?.status ?? "ok"}</span>
            </p>
          )}
        </div>
      </div>
      <div className="card mt-3 shadow-sm">
        <div className="card-body">
          <h2 className="h6 text-uppercase text-muted">Session</h2>
          {meQuery.isLoading ? (
            <p className="mb-0 small text-muted">Loading profile…</p>
          ) : meQuery.isError ? (
            <p className="mb-0 small text-danger">
              Could not load profile. Check API configuration and sign-in.
            </p>
          ) : (
            <dl className="row small mb-0">
              <dt className="col-sm-3">Subject</dt>
              <dd className="col-sm-9">{meQuery.data?.sub ?? "—"}</dd>
              <dt className="col-sm-3">Email</dt>
              <dd className="col-sm-9">{meQuery.data?.email ?? "—"}</dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
