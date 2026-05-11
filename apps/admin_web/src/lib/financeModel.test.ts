import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  ledgerMonthlyAmount,
  normalizeLedgerRecords,
} from "./financeModel";

describe("normalizeLedgerRecords", () => {
  it("keeps rows whose category is allowed for that sheet", () => {
    const rows = [
      {
        id: "1",
        category: "Salary",
        description: "Pay",
        amount: 100,
        currency: "HKD",
      },
      {
        id: "2",
        category: "Bonus",
        description: "Extra",
        amount: 50,
        currency: "HKD",
      },
    ];
    expect(normalizeLedgerRecords(rows, INCOME_CATEGORIES)).toHaveLength(1);
    expect(normalizeLedgerRecords(rows, INCOME_CATEGORIES)[0].category).toBe("Salary");
  });

  it("accepts expense categories independently", () => {
    const rows = [
      {
        id: "1",
        category: "Retirement",
        description: "MPF",
        amount: 1500,
        currency: "HKD",
      },
    ];
    expect(normalizeLedgerRecords(rows, EXPENSE_CATEGORIES)).toHaveLength(1);
  });

  it("defaults amountPeriod to month when absent or unknown", () => {
    const rows = [
      {
        id: "1",
        category: "Salary",
        description: "Pay",
        amount: 1200,
        currency: "HKD",
      },
      {
        id: "2",
        category: "Rent",
        description: "Sublet",
        amount: 100,
        currency: "HKD",
        amountPeriod: "weekly",
      },
    ];
    const out = normalizeLedgerRecords(rows, INCOME_CATEGORIES);
    expect(out).toHaveLength(2);
    expect(out[0].amountPeriod).toBe("month");
    expect(out[1].amountPeriod).toBe("month");
  });

  it("preserves yearly amountPeriod", () => {
    const rows = [
      {
        id: "1",
        category: "Salary",
        description: "Annual bonus",
        amount: 12000,
        currency: "HKD",
        amountPeriod: "year",
      },
    ];
    const out = normalizeLedgerRecords(rows, INCOME_CATEGORIES);
    expect(out[0].amountPeriod).toBe("year");
    expect(ledgerMonthlyAmount(out[0])).toBe(1000);
  });

  it("preserves relatedHouse when valid", () => {
    const rows = [
      {
        id: "1",
        category: "Salary",
        description: "Pay",
        amount: 100,
        currency: "HKD",
        relatedHouse: "hillmarton",
      },
    ];
    const out = normalizeLedgerRecords(rows, INCOME_CATEGORIES);
    expect(out[0].relatedHouse).toBe("hillmarton");
    expect(out[0].amountPeriod).toBe("month");
  });

  it("drops invalid relatedHouse values", () => {
    const rows = [
      {
        id: "1",
        category: "Salary",
        description: "Pay",
        amount: 100,
        currency: "HKD",
        relatedHouse: "other",
      },
    ];
    const out = normalizeLedgerRecords(rows, INCOME_CATEGORIES);
    expect(out[0].relatedHouse).toBeUndefined();
  });
});
