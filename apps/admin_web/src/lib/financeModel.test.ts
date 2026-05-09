import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
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
});
