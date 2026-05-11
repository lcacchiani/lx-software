import { useMemo } from "react";
import type { CurrencyCode } from "../lib/currencies";
import { useFrankfurterRatesToBase } from "./useFrankfurterRatesToBase";

/**
 * Frankfurter wiring shared by finance tables that show a converted total in a chosen display currency.
 */
export function useFrankfurterRatesForTotals(
  totalDisplayCurrency: CurrencyCode,
  recordCurrencies: readonly string[],
) {
  const needsFx = useMemo(() => {
    const base = totalDisplayCurrency.trim().toUpperCase();
    const bases = new Set(recordCurrencies.map((c) => c.trim().toUpperCase()));
    return bases.size > 0 && [...bases].some((c) => c !== base);
  }, [recordCurrencies, totalDisplayCurrency]);

  const ratesQuery = useFrankfurterRatesToBase(totalDisplayCurrency, recordCurrencies);

  const rateByQuoteForDisplay = useMemo((): ReadonlyMap<string, number> => {
    if (!needsFx || !ratesQuery.isSuccess || !ratesQuery.data) {
      return new Map();
    }
    return ratesQuery.data.rateByQuote;
  }, [needsFx, ratesQuery.isSuccess, ratesQuery.data]);

  const fxLoading = needsFx && ratesQuery.isPending;
  const fxError = needsFx && ratesQuery.isError;

  return {
    needsFx,
    ratesQuery,
    rateByQuoteForDisplay,
    fxLoading,
    fxError,
  };
}
