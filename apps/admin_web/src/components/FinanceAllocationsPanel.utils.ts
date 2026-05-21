import {
  CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX,
  type FinanceAllocationRecord,
} from "../lib/financeModel";
import { formatDateUtc } from "../lib/formatDisplay";

export type AllocSortKey = "desc" | "monthly" | "accum" | "ccy" | "last";

export function allocationLastUpdatedDisplay(lastUpdated: string | undefined): string {
  if (!lastUpdated) {
    return "—";
  }
  return formatDateUtc(`${lastUpdated}T00:00:00.000Z`);
}

/** Linked rows mirror an expense tagged Allocate; custom rows are created on the Allocations tab. */
export function allocationTagsCellLabel(r: FinanceAllocationRecord): string {
  const isCustom =
    r.isCustomAllocation === true || r.expenseId.startsWith(CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX);
  const parts: string[] = [];
  if (!isCustom) {
    parts.push("Expenses");
  } else if (r.isIncome === true) {
    parts.push("Income");
  }
  if (r.isPension === true) {
    parts.push("Pension");
  }
  if (parts.length === 0) {
    return "—";
  }
  return parts.join(", ");
}

export function compareAllocations(
  a: FinanceAllocationRecord,
  b: FinanceAllocationRecord,
  sortKey: AllocSortKey,
  sortDir: "asc" | "desc",
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "desc":
      cmp = a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      break;
    case "monthly": {
      const ma = a.monthlyAmount;
      const mb = b.monthlyAmount;
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "accum": {
      const ma = a.accumulatedAmount;
      const mb = b.accumulatedAmount;
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "ccy":
      cmp = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
      break;
    case "last": {
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
  return a.expenseId.localeCompare(b.expenseId);
}

/** Linked row patch from editor: optional Income and Pension tags (omit when unchecked). */
export function linkedStoredRowPatch(
  row: FinanceAllocationRecord,
  accumulatedAmount: number,
  flags: { readonly isIncome: boolean; readonly isPension: boolean },
): FinanceAllocationRecord {
  return {
    expenseId: row.expenseId,
    description: row.description,
    monthlyAmount: row.monthlyAmount,
    accumulatedAmount,
    currency: row.currency,
    ...(row.lastUpdated !== undefined ? { lastUpdated: row.lastUpdated } : {}),
    ...(row.relatedHouse !== undefined ? { relatedHouse: row.relatedHouse } : {}),
    ...(flags.isIncome ? { isIncome: true as const } : {}),
    ...(flags.isPension ? { isPension: true as const } : {}),
  };
}

export function allocationMonthlyColumnDisplay(
  row: FinanceAllocationRecord,
): { readonly kind: "dash" } | { readonly kind: "amount"; readonly value: number; readonly currency: string } {
  if (row.isCustomAllocation === true) {
    if (row.isIncome === true) {
      return {
        kind: "amount",
        value: row.allocationIncomeMonthly ?? 0,
        currency: row.currency,
      };
    }
    return { kind: "dash" };
  }
  return { kind: "amount", value: row.monthlyAmount, currency: row.currency };
}
