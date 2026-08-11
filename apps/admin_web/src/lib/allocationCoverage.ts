/**
 * Horizon grouping for the dashboard Allocation Coverage card.
 *
 * Allocation rows split into two horizons: rows tagged Pension
 * ({@link import("./financeModel").FinanceAllocationRecord.isPension}) and everything
 * else ("near-term": tax, school fees, buffers, …). Coverage assets back them with a
 * waterfall that mirrors how the money can actually be spent:
 *
 *  - Liquid coverage (bank balances, liquid investments, liquid savings) backs the
 *    near-term rows first.
 *  - Fixed savings (e.g. landlord deposits) can only back the pension horizon, plus
 *    whatever liquid coverage is left after the near-term rows are fully backed.
 *
 * All amounts are expected in the same (dashboard base) currency.
 */

/** One allocation row already converted to the dashboard base currency. */
export type AllocationCoverageRow = {
  readonly key: string;
  readonly description: string;
  readonly amountInBase: number;
  readonly isPension: boolean;
};

export type AllocationCoverageGroup = {
  readonly rows: readonly AllocationCoverageRow[];
  /** Sum of the group's accumulated allocation amounts. */
  readonly allocationsSum: number;
  /** Coverage the waterfall makes available to this group (not capped at the sum). */
  readonly coverageAvailable: number;
  /** `coverageAvailable / allocationsSum`; undefined when the group has no allocations. */
  readonly fundedFraction: number | undefined;
};

export type AllocationCoverageGroups = {
  readonly nearTerm: AllocationCoverageGroup;
  readonly pension: AllocationCoverageGroup;
};

function sumAmounts(rows: readonly AllocationCoverageRow[]): number {
  let total = 0;
  for (const r of rows) {
    total += r.amountInBase;
  }
  return total;
}

function group(
  rows: readonly AllocationCoverageRow[],
  allocationsSum: number,
  coverageAvailable: number,
): AllocationCoverageGroup {
  return {
    rows,
    allocationsSum,
    coverageAvailable,
    fundedFraction:
      allocationsSum > 0 ? coverageAvailable / allocationsSum : undefined,
  };
}

export function computeAllocationCoverageGroups(args: {
  readonly rows: readonly AllocationCoverageRow[];
  /** Bank balances + liquid investments + liquid savings, in base currency. */
  readonly liquidCoverage: number;
  /** Fixed savings deposits (pension horizon only), in base currency. */
  readonly fixedCoverage: number;
}): AllocationCoverageGroups {
  const nearTermRows = args.rows.filter((r) => !r.isPension);
  const pensionRows = args.rows.filter((r) => r.isPension);
  const nearTermSum = sumAmounts(nearTermRows);
  const pensionSum = sumAmounts(pensionRows);
  const liquidLeftover = Math.max(0, args.liquidCoverage - nearTermSum);
  return {
    nearTerm: group(nearTermRows, nearTermSum, args.liquidCoverage),
    pension: group(pensionRows, pensionSum, args.fixedCoverage + liquidLeftover),
  };
}
