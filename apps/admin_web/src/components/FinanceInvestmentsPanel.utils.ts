import type { CurrencyCode } from "../lib/currencies";
import { convertAmountToBase } from "../lib/frankfurterRates";
import {
  investmentDetailsDisplay,
  investmentRecordFiatNotionalInQuoteCurrency,
  type FinanceInvestmentRecord,
  type HouseKey,
} from "../lib/financeModel";
import { formatDateUtc } from "../lib/formatDisplay";

export function parseOptionalUnit(raw: string): number | undefined | null {
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

export function investmentLastUpdatedDisplay(lastUpdated: string | undefined): string {
  if (!lastUpdated) {
    return "—";
  }
  return formatDateUtc(`${lastUpdated}T00:00:00.000Z`);
}

export function formatUnitCell(unit: number | undefined): string {
  if (unit === undefined) {
    return "—";
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(unit);
}

/**
 * For **sorting** by Current Value: notional in {@link displayCurrency} (Frankfurter when the
 * row currency differs). Table cells show notional in the row’s own currency instead.
 *
 * `valueInRowCcy` is the row's current value already in the row's own currency
 * (computed via the live ticker quote × Frankfurter for market-priced rows,
 * or the fiat notional fallback for everything else). When that value is
 * `undefined` (quote/FX still loading or errored), we fall back to the
 * fiat notional so the row still sorts predictably.
 */
export function investmentNotionalInDisplayCurrency(
  r: FinanceInvestmentRecord,
  displayCurrency: CurrencyCode,
  rateByQuote: ReadonlyMap<string, number>,
  needsFxGlobal: boolean,
  ratesFetchSucceeded: boolean,
  valueInRowCcy: number | undefined,
): number {
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

export type InvSortKey =
  | "cat"
  | "details"
  | "atype"
  | "prov"
  | "amt"
  | "ccy"
  | "unit"
  | "currVal"
  | "lastUpd";

export function compareInv(
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
