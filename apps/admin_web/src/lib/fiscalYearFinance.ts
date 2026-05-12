import type { HouseStatementLine } from "./financeModel";

/** Fiscal years selectable on the dashboard (April 1 → March 31, UTC boundaries). */
export type FiscalYearId = "2025-2026" | "2026-2027";

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

/** Human-readable label for dashboard fiscal year picker (matches option text). */
export function formatFiscalYearIdLabel(id: FiscalYearId): string {
  const start = fiscalYearIdToStartCalendarYear(id);
  return `Fiscal year (1 Apr ${start} – 31 Mar ${start + 1})`;
}

export const FISCAL_YEAR_OPTIONS: readonly { readonly id: FiscalYearId; readonly label: string }[] =
  [
    { id: "2025-2026", label: formatFiscalYearIdLabel("2025-2026") },
    { id: "2026-2027", label: formatFiscalYearIdLabel("2026-2027") },
  ];

/**
 * Fiscal year (1 Apr – 31 Mar, UTC) that contains `now`, limited to entries in
 * {@link FISCAL_YEAR_OPTIONS} (clamps to the earliest or latest option if outside range).
 */
export function defaultFiscalYearIdForNowUtc(now = new Date()): FiscalYearId {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startCalendarYear = m < 3 ? y - 1 : y;

  const sorted = [...FISCAL_YEAR_OPTIONS].sort(
    (a, b) =>
      fiscalYearIdToStartCalendarYear(a.id) - fiscalYearIdToStartCalendarYear(b.id),
  );

  for (const opt of sorted) {
    if (fiscalYearIdToStartCalendarYear(opt.id) === startCalendarYear) {
      return opt.id;
    }
  }

  if (startCalendarYear < fiscalYearIdToStartCalendarYear(sorted[0].id)) {
    return sorted[0].id;
  }
  return sorted[sorted.length - 1].id;
}

export type FiscalYearAmountBuckets = {
  readonly incomeByCurrency: Readonly<Record<string, number>>;
  /** Net from statement lines typed as expenditure (excludes mortgage). */
  readonly expensesByCurrency: Readonly<Record<string, number>>;
  readonly mortgageByCurrency: Readonly<Record<string, number>>;
};

/**
 * Sums statement-line net amounts for lines whose `dateUtc` falls in the fiscal year:
 * income, expenditure (excluding mortgage), and mortgage separately.
 */
export function sumHouseStatementLinesForFiscalYear(
  lines: readonly HouseStatementLine[],
  startCalendarYear: number,
): FiscalYearAmountBuckets {
  const { startMs, endExclusiveMs } = fiscalYearUtcBounds(startCalendarYear);
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};
  const mortgage: Record<string, number> = {};

  for (const line of lines) {
    const t = new Date(line.dateUtc).getTime();
    if (Number.isNaN(t) || t < startMs || t >= endExclusiveMs) continue;
    const cur = line.currency;
    if (line.type === "income") {
      income[cur] = (income[cur] ?? 0) + line.netAmount;
    } else if (line.type === "mortgage") {
      mortgage[cur] = (mortgage[cur] ?? 0) + line.netAmount;
    } else {
      expenses[cur] = (expenses[cur] ?? 0) + line.netAmount;
    }
  }

  return { incomeByCurrency: income, expensesByCurrency: expenses, mortgageByCurrency: mortgage };
}
