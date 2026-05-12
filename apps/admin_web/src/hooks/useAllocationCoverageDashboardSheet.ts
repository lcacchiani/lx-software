import { useCallback, useMemo } from "react";
import { useFrankfurterRatesForTotals } from "./useFrankfurterRatesForTotals";
import { useFinanceQuotes } from "./useFinanceQuotes";
import { GLOBAL_DEFAULT_CURRENCY } from "../lib/currencies";
import { buildQuoteMap } from "../lib/financeQuotes";
import { convertAmountToBase, convertAmountWithBase } from "../lib/frankfurterRates";
import {
  investmentMarketSourceCurrency,
  investmentRecordCurrentValueInRowCurrency,
  investmentRecordFiatNotionalInQuoteCurrency,
  isInvestmentMarketPriced,
} from "../lib/financeModel";
import { useFinance } from "./useFinance";

/**
 * Allocation coverage math for the dashboard (same as Allocation Coverage card): liquid
 * investments, savings, and bank account balances vs allocation accumulated amounts, all in
 * {@link GLOBAL_DEFAULT_CURRENCY}. FX quote set includes every account row so credit card
 * currencies resolve when other cards need them.
 */
export function useAllocationCoverageDashboardSheet() {
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
    for (const acc of data.accountRecords) {
      s.add(acc.currency);
    }
    for (const q of quotesQuery.data ?? []) {
      if (q.currency) s.add(q.currency);
    }
    return [...s];
  }, [
    liquidInvestments,
    sortedAllocations,
    data.savingsRecords,
    bankAccounts,
    data.accountRecords,
    quotesQuery.data,
  ]);

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
        rateByQuote: map,
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

  return {
    sortedAllocations,
    sheet,
    needsFx,
    ratesQuery,
    fxLoading,
    fxError,
  };
}
