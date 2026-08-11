import { describe, expect, it } from "vitest";
import {
  computeAllocationCoverageGroups,
  type AllocationCoverageRow,
} from "./allocationCoverage";

function row(
  key: string,
  amountInBase: number,
  isPension = false,
): AllocationCoverageRow {
  return { key, description: key, amountInBase, isPension };
}

describe("computeAllocationCoverageGroups", () => {
  it("splits rows by the pension tag preserving order", () => {
    const rows = [row("tax", 100), row("mpf", 200, true), row("school", 50)];
    const out = computeAllocationCoverageGroups({
      rows,
      liquidCoverage: 0,
      fixedCoverage: 0,
    });
    expect(out.nearTerm.rows.map((r) => r.key)).toEqual(["tax", "school"]);
    expect(out.pension.rows.map((r) => r.key)).toEqual(["mpf"]);
    expect(out.nearTerm.allocationsSum).toBe(150);
    expect(out.pension.allocationsSum).toBe(200);
  });

  it("gives all liquid coverage to near-term and none to pension when near-term is short", () => {
    const out = computeAllocationCoverageGroups({
      rows: [row("tax", 400), row("pension", 780, true)],
      liquidCoverage: 300,
      fixedCoverage: 150,
    });
    expect(out.nearTerm.coverageAvailable).toBe(300);
    expect(out.nearTerm.fundedFraction).toBeCloseTo(0.75);
    // No liquid leftover; pension only sees the fixed savings.
    expect(out.pension.coverageAvailable).toBe(150);
    expect(out.pension.fundedFraction).toBeCloseTo(150 / 780);
  });

  it("spills liquid leftover into the pension group once near-term is fully backed", () => {
    const out = computeAllocationCoverageGroups({
      rows: [row("tax", 100), row("pension", 500, true)],
      liquidCoverage: 350,
      fixedCoverage: 150,
    });
    expect(out.nearTerm.coverageAvailable).toBe(350);
    expect(out.nearTerm.fundedFraction).toBeCloseTo(3.5);
    expect(out.pension.coverageAvailable).toBe(150 + 250);
    expect(out.pension.fundedFraction).toBeCloseTo(400 / 500);
  });

  it("keeps fixed coverage out of the near-term group even when near-term is short", () => {
    const out = computeAllocationCoverageGroups({
      rows: [row("tax", 1000)],
      liquidCoverage: 100,
      fixedCoverage: 900,
    });
    expect(out.nearTerm.coverageAvailable).toBe(100);
    // Everything fixed plus nothing left over: pension has no rows but still reports assets.
    expect(out.pension.coverageAvailable).toBe(900);
    expect(out.pension.allocationsSum).toBe(0);
    expect(out.pension.fundedFraction).toBeUndefined();
  });

  it("reports undefined funded fraction for empty groups", () => {
    const out = computeAllocationCoverageGroups({
      rows: [],
      liquidCoverage: 10,
      fixedCoverage: 20,
    });
    expect(out.nearTerm.fundedFraction).toBeUndefined();
    expect(out.pension.fundedFraction).toBeUndefined();
    expect(out.nearTerm.rows).toEqual([]);
    expect(out.pension.rows).toEqual([]);
  });

  it("totals across groups equal overall coverage and allocations", () => {
    const rows = [row("a", 120), row("b", 45), row("p", 780, true)];
    const liquidCoverage = 880;
    const fixedCoverage = 149;
    const out = computeAllocationCoverageGroups({ rows, liquidCoverage, fixedCoverage });
    const allocations = out.nearTerm.allocationsSum + out.pension.allocationsSum;
    expect(allocations).toBe(945);
    // Waterfall never creates or destroys coverage: near-term available is the whole
    // liquid pool, pension available is fixed + leftover, so fixed+liquid is preserved.
    const leftover = Math.max(0, liquidCoverage - out.nearTerm.allocationsSum);
    expect(out.pension.coverageAvailable).toBe(fixedCoverage + leftover);
  });
});
