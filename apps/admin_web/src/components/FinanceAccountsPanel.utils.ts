import type { FinanceAccountRecord, FinanceAccountType } from "../lib/financeModel";
import { formatDateUtc } from "../lib/formatDisplay";

export function accountLastUpdatedDisplay(lastUpdated: string | undefined): string {
  if (!lastUpdated) {
    return "—";
  }
  return formatDateUtc(`${lastUpdated}T00:00:00.000Z`);
}

export function accountTypeUsesBillingCycleDay(t: FinanceAccountType): boolean {
  return t !== "Bank Account";
}

export function accountTypeIsCreditCard(t: FinanceAccountType): boolean {
  return t === "Credit Card";
}

export type AccountsSortKey = "desc" | "atype" | "day" | "amt" | "stmt" | "ccy" | "lastUpdated";

export function compareAccounts(
  a: FinanceAccountRecord,
  b: FinanceAccountRecord,
  sortKey: AccountsSortKey,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "desc":
      cmp = a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      break;
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
    case "stmt": {
      const sa = accountTypeIsCreditCard(a.accountType) ? (a.lastStatementAmount ?? 0) : 0;
      const sb = accountTypeIsCreditCard(b.accountType) ? (b.lastStatementAmount ?? 0) : 0;
      cmp = sa === sb ? 0 : sa < sb ? -1 : 1;
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
