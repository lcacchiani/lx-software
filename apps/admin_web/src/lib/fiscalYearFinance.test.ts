import { describe, expect, it } from "vitest";
import {
  defaultFiscalYearIdForNowUtc,
  formatFiscalYearIdLabel,
  fiscalYearIdToStartCalendarYear,
  fiscalYearUtcBounds,
  sumHouseStatementLinesForFiscalYear,
} from "./fiscalYearFinance";
import type { HouseStatementLine } from "./financeModel";

describe("fiscalYearUtcBounds", () => {
  it("uses April 1 UTC start and April 1 next year as exclusive end", () => {
    const { startMs, endExclusiveMs } = fiscalYearUtcBounds(2025);
    expect(new Date(startMs).toISOString()).toBe("2025-04-01T00:00:00.000Z");
    expect(new Date(endExclusiveMs).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("fiscalYearIdToStartCalendarYear", () => {
  it("parses the leading year from an id", () => {
    expect(fiscalYearIdToStartCalendarYear("2025-2026")).toBe(2025);
    expect(fiscalYearIdToStartCalendarYear("2026-2027")).toBe(2026);
  });
});

describe("formatFiscalYearIdLabel", () => {
  it("uses April–March range wording", () => {
    expect(formatFiscalYearIdLabel("2025-2026")).toBe(
      "Fiscal year (1 Apr 2025 – 31 Mar 2026)",
    );
    expect(formatFiscalYearIdLabel("2026-2027")).toBe(
      "Fiscal year (1 Apr 2026 – 31 Mar 2027)",
    );
  });
});

describe("defaultFiscalYearIdForNowUtc", () => {
  it("selects the FY that contains May (after April) in UTC", () => {
    expect(defaultFiscalYearIdForNowUtc(new Date("2026-05-26T12:00:00.000Z"))).toBe(
      "2026-2027",
    );
  });

  it("selects the FY that contains March (before April) in UTC", () => {
    expect(defaultFiscalYearIdForNowUtc(new Date("2026-03-26T12:00:00.000Z"))).toBe(
      "2025-2026",
    );
  });

  it("uses April 1 UTC as the start of the new FY", () => {
    expect(defaultFiscalYearIdForNowUtc(new Date("2026-03-31T23:59:59.999Z"))).toBe(
      "2025-2026",
    );
    expect(defaultFiscalYearIdForNowUtc(new Date("2026-04-01T00:00:00.000Z"))).toBe(
      "2026-2027",
    );
  });
});

describe("sumHouseStatementLinesForFiscalYear", () => {
  const mk = (
    dateUtc: string,
    type: "income" | "expenditure" | "mortgage",
    net: number,
    currency = "HKD",
  ): HouseStatementLine => ({
    id: "x",
    dateUtc,
    type,
    description: "t",
    netAmount: net,
    vat: 0,
    currency,
    grossAmount: net,
  });

  it("includes March 31 end and excludes April 1 next year for FY 2025–26", () => {
    const lines = [
      mk("2025-03-31T12:00:00.000Z", "income", 100),
      mk("2025-04-01T00:00:00.000Z", "income", 200),
      mk("2026-03-31T23:59:59.999Z", "expenditure", 50),
      mk("2026-04-01T00:00:00.000Z", "income", 999),
    ];
    const r = sumHouseStatementLinesForFiscalYear(lines, 2025);
    expect(r.incomeByCurrency.HKD).toBe(200);
    expect(r.expensesByCurrency.HKD).toBe(50);
  });

  it("buckets by currency", () => {
    const lines = [
      mk("2025-06-01T00:00:00.000Z", "income", 10, "HKD"),
      mk("2025-06-02T00:00:00.000Z", "income", 20, "USD"),
    ];
    const r = sumHouseStatementLinesForFiscalYear(lines, 2025);
    expect(r.incomeByCurrency.HKD).toBe(10);
    expect(r.incomeByCurrency.USD).toBe(20);
  });

  it("treats mortgage lines as expenses for fiscal totals", () => {
    const lines = [
      mk("2025-06-01T00:00:00.000Z", "mortgage", 3000, "HKD"),
      mk("2025-06-02T00:00:00.000Z", "expenditure", 100, "HKD"),
    ];
    const r = sumHouseStatementLinesForFiscalYear(lines, 2025);
    expect(r.expensesByCurrency.HKD).toBe(3100);
    expect(r.incomeByCurrency.HKD).toBeUndefined();
  });
});
