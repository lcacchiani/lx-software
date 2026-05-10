import type { HouseStatementLine } from "./financeModel";

/** Fiscal years selectable on the dashboard (April 1 → March 31, UTC boundaries). */
export type FiscalYearId = "2025-2026" | "2026-2027";

export const FISCAL_YEAR_OPTIONS: readonly { readonly id: FiscalYearId; readonly label: string }[] =
  [
    { id: "2025-2026", label: "2025 – 2026" },
    { id: "2026-2027", label: "2026 – 2027" },
  ];

/**
 * Calendar fiscal year starting April 1 `startCalendarYear` (UTC),
 * through March 31 `startCalendarYear + 1` inclusive (`endExclusive` is April 1 next year).
 */
export function fiscalYearUtcBounds(startCalendarYear: number): {
  readonly startMs: number;
  readonly endExclusiveMs: number;
} {
  const startMs = Date.UTC(startCalendarYear, 3, 1, 0, 0, 0, 0);
  const endExclusiveMs = Date.UTC(startCalendarYear + 1, 3, 1, 0, 0, 0, 0);
  return { startMs, endExclusiveMs };
}

export function fiscalYearIdToStartCalendarYear(id: FiscalYearId): number {
  const m = /^(\d{4})-\d{4}$/.exec(id);
  if (!m) return 2025;
  return Number.parseInt(m[1], 10);
}

export type FiscalYearAmountBuckets = {
  readonly incomeByCurrency: Readonly<Record<string, number>>;
  readonly expensesByCurrency: Readonly<Record<string, number>>;
};

/** Sums statement-line net amounts by type for lines whose `dateUtc` falls in the fiscal year. */
export function sumHouseStatementLinesForFiscalYear(
  lines: readonly HouseStatementLine[],
  startCalendarYear: number,
): FiscalYearAmountBuckets {
  const { startMs, endExclusiveMs } = fiscalYearUtcBounds(startCalendarYear);
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

  for (const line of lines) {
    const t = new Date(line.dateUtc).getTime();
    if (Number.isNaN(t) || t < startMs || t >= endExclusiveMs) continue;
    const bucket = line.type === "income" ? income : expenses;
    const cur = line.currency;
    bucket[cur] = (bucket[cur] ?? 0) + line.netAmount;
  }

  return { incomeByCurrency: income, expensesByCurrency: expenses };
}
