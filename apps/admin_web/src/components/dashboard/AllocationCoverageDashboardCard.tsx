import { type ReactNode, useCallback, useMemo } from "react";
import { FrankfurterRatesFooterNote, MoneyAmount } from "../ui";
import { useFrankfurterRatesForTotals } from "../../hooks/useFrankfurterRatesForTotals";
import { useFinance } from "../../hooks/useFinance";
import { useFinanceQuotes } from "../../hooks/useFinanceQuotes";
import { GLOBAL_DEFAULT_CURRENCY } from "../../lib/currencies";
import { buildQuoteMap } from "../../lib/financeQuotes";
import { convertAmountToBase, convertAmountWithBase } from "../../lib/frankfurterRates";
import {
  investmentMarketSourceCurrency,
  investmentRecordCurrentValueInRowCurrency,
  investmentRecordFiatNotionalInQuoteCurrency,
  isInvestmentMarketPriced,
} from "../../lib/financeModel";

export function AllocationCoverageDashboardCard() {
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

      const diff = coverage - allocationsSum;
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
            Allocation rows (same as the Finance Allocations tab) compared to liquid investments, all
            savings deposits, and bank account current balances.
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
                      <th className="small text-end">Accumulated</th>
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
                            <MoneyAmount amount={row.hkd} currency={base} />
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
                </table>
              </div>

              <dl className="row small mb-2">
                <dt className="col-sm-5 text-muted">Coverage</dt>
                <dd className="col-sm-7 text-end mb-0">
                  {sheet.status === "ok" ? (
                    <MoneyAmount amount={sheet.coverage} currency={base} />
                  ) : (
                    loadingOrErrorMessage(sheet)
                  )}
                </dd>
                <dt className="col-sm-5 text-muted pt-2">Allocations</dt>
                <dd className="col-sm-7 text-end pt-2 mb-0">
                  {sheet.status === "ok" ? (
                    <MoneyAmount amount={sheet.allocationsSum} currency={base} />
                  ) : (
                    loadingOrErrorMessage(sheet)
                  )}
                </dd>
                <dt className="col-sm-5 text-muted pt-2">Net</dt>
                <dd className="col-sm-7 text-end pt-2 mb-0">
                  {sheet.status === "ok" ? (
                    <span className={sheet.diff >= 0 ? "text-success" : "text-danger"}>
                      <MoneyAmount amount={sheet.diff} currency={base} />
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
