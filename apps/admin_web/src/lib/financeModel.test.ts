import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  buildDerivedExpenseLedgerRowsFromTaggedIncome,
  ledgerMonthlyAmount,
  normalizeExpenseIncomeAllocationPercents,
  normalizeInvestmentRecords,
  normalizeLedgerRecords,
  monthlyLedgerNetByCurrency,
  sumMonthlyFinanceLedgerAmountsByHouse,
} from "./financeModel";

describe("normalizeInvestmentRecords", () => {
  it("keeps rows with allowed category and asset type", () => {
    const rows = [
      {
        id: "1",
        category: "Real Estate",
        assetType: "Fixed",
        provider: "Bank",
        principalAmount: 500000,
        currency: "HKD",
      },
      {
        id: "2",
        category: "Bonds",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "HKD",
      },
    ];
    const out = normalizeInvestmentRecords(rows);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("Real Estate");
    expect(out[0].principalAmount).toBe(500000);
  });

  it("drops invalid asset type", () => {
    const rows = [
      {
        id: "1",
        category: "Crypto",
        assetType: "Volatile",
        provider: "Ex",
        principalAmount: 100,
        currency: "USD",
      },
    ];
    expect(normalizeInvestmentRecords(rows)).toHaveLength(0);
  });

  it("keeps relatedHouse only for Real Estate with a valid house key", () => {
    const rows = [
      {
        id: "1",
        category: "Real Estate",
        assetType: "Fixed",
        provider: "Bank",
        principalAmount: 100,
        currency: "HKD",
        relatedHouse: "morrison",
      },
      {
        id: "2",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "HKD",
        relatedHouse: "morrison",
      },
    ];
    const out = normalizeInvestmentRecords(rows);
    expect(out).toHaveLength(2);
    expect(out[0].relatedHouse).toBe("morrison");
    expect(out[1].relatedHouse).toBeUndefined();
  });
});

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
    const out = normalizeLedgerRecords(rows, INCOME_CATEGORIES, { includeIncomeFlags: true });
    expect(out[0].relatedHouse).toBe("hillmarton");
    expect(out[0].amountPeriod).toBe("month");
    expect(out[0].isTax).toBe(false);
    expect(out[0].isSaving).toBe(false);
    expect(out[0].isInvestment).toBe(false);
  });

  it("normalizes income classification flags when enabled", () => {
    const rows = [
      {
        id: "1",
        category: "Salary",
        description: "Pay",
        amount: 100,
        currency: "HKD",
        isTax: true,
        isSaving: 1,
        isInvestment: false,
      },
    ];
    const out = normalizeLedgerRecords(rows, INCOME_CATEGORIES, { includeIncomeFlags: true });
    expect(out[0].isTax).toBe(true);
    expect(out[0].isSaving).toBe(false);
    expect(out[0].isInvestment).toBe(false);
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

describe("sumMonthlyFinanceLedgerAmountsByHouse", () => {
  it("sums month-period ledger rows linked to the house, by currency", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "A",
          amount: 100,
          currency: "HKD",
          relatedHouse: "hillmarton",
        },
        {
          id: "i2",
          category: "Salary",
          description: "B",
          amount: 40,
          currency: "USD",
          relatedHouse: "hillmarton",
        },
        {
          id: "i3",
          category: "Salary",
          description: "Other house",
          amount: 999,
          currency: "HKD",
          relatedHouse: "morrison",
        },
        {
          id: "i4",
          category: "Salary",
          description: "No house",
          amount: 50,
          currency: "HKD",
        },
      ],
      INCOME_CATEGORIES,
      { includeIncomeFlags: true },
    );
    const expenses = normalizeLedgerRecords(
      [
        {
          id: "e1",
          category: "Retirement",
          description: "MPF",
          amount: 10,
          currency: "HKD",
          relatedHouse: "hillmarton",
        },
      ],
      EXPENSE_CATEGORIES,
    );
    const r = sumMonthlyFinanceLedgerAmountsByHouse(income, expenses, "hillmarton");
    expect(r.incomeByCurrency.HKD).toBe(100);
    expect(r.incomeByCurrency.USD).toBe(40);
    expect(r.expensesByCurrency.HKD).toBe(10);
  });

  it("adds derived expenses from tagged income and allocation percents", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "Pay",
          amount: 1000,
          currency: "HKD",
          relatedHouse: "hillmarton",
          isTax: true,
          isSaving: false,
          isInvestment: false,
        },
      ],
      INCOME_CATEGORIES,
      { includeIncomeFlags: true },
    );
    const expenses = normalizeLedgerRecords(
      [
        {
          id: "e1",
          category: "Utility",
          description: "Elec",
          amount: 50,
          currency: "HKD",
          relatedHouse: "hillmarton",
        },
      ],
      EXPENSE_CATEGORIES,
    );
    const alloc = normalizeExpenseIncomeAllocationPercents({
      taxOnIncomePercent: 10,
      investmentOnIncomePercent: 0,
      savingOnIncomePercent: 0,
    });
    const r = sumMonthlyFinanceLedgerAmountsByHouse(income, expenses, "hillmarton", alloc);
    expect(r.expensesByCurrency.HKD).toBeCloseTo(50 + 100, 10);
  });

  it("excludes yearly amountPeriod rows", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "Annual",
          amount: 12000,
          currency: "HKD",
          amountPeriod: "year",
          relatedHouse: "hillmarton",
        },
        {
          id: "i2",
          category: "Salary",
          description: "Monthly",
          amount: 100,
          currency: "HKD",
          relatedHouse: "hillmarton",
        },
      ],
      INCOME_CATEGORIES,
      { includeIncomeFlags: true },
    );
    const r = sumMonthlyFinanceLedgerAmountsByHouse(income, [], "hillmarton");
    expect(r.incomeByCurrency.HKD).toBe(100);
  });
});

describe("normalizeExpenseIncomeAllocationPercents", () => {
  it("clamps values to 0–100", () => {
    const r = normalizeExpenseIncomeAllocationPercents({
      taxOnIncomePercent: -5,
      investmentOnIncomePercent: 200,
      savingOnIncomePercent: "12.5",
    });
    expect(r.taxOnIncomePercent).toBe(0);
    expect(r.investmentOnIncomePercent).toBe(100);
    expect(r.savingOnIncomePercent).toBe(12.5);
  });
});

describe("buildDerivedExpenseLedgerRowsFromTaggedIncome", () => {
  it("builds synthetic rows per house and currency when rate and base are positive", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "Pay",
          amount: 200,
          currency: "HKD",
          relatedHouse: "hillmarton",
          isTax: true,
          isSaving: true,
          isInvestment: false,
        },
      ],
      INCOME_CATEGORIES,
      { includeIncomeFlags: true },
    );
    const rows = buildDerivedExpenseLedgerRowsFromTaggedIncome(
      income,
      normalizeExpenseIncomeAllocationPercents({
        taxOnIncomePercent: 10,
        investmentOnIncomePercent: 0,
        savingOnIncomePercent: 20,
      }),
      [
        { value: "hillmarton", label: "H1" },
        { value: "morrison", label: "M1" },
      ],
    );
    const taxRow = rows.find((r) => r.category === "Tax");
    const saveRow = rows.find((r) => r.category === "Saving");
    expect(taxRow?.amount).toBeCloseTo(20, 10);
    expect(saveRow?.amount).toBeCloseTo(40, 10);
    expect(taxRow?.isDerivedFromTaggedIncome).toBe(true);
    expect(ledgerMonthlyAmount(taxRow!)).toBeCloseTo(20, 10);
  });

  it("includes tax-tagged income without related property", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "Pay",
          amount: 500,
          currency: "HKD",
          isTax: true,
          isSaving: false,
          isInvestment: false,
        },
      ],
      INCOME_CATEGORIES,
      { includeIncomeFlags: true },
    );
    const rows = buildDerivedExpenseLedgerRowsFromTaggedIncome(
      income,
      normalizeExpenseIncomeAllocationPercents({ taxOnIncomePercent: 12, investmentOnIncomePercent: 0, savingOnIncomePercent: 0 }),
      [
        { value: "hillmarton", label: "H1" },
        { value: "morrison", label: "M1" },
      ],
    );
    const unalloc = rows.find((r) => r.description.includes("no related property"));
    expect(unalloc?.category).toBe("Tax");
    expect(unalloc?.amount).toBeCloseTo(60, 10);
  });
});

describe("monthlyLedgerNetByCurrency", () => {
  it("returns income minus expenses per currency", () => {
    const n = monthlyLedgerNetByCurrency({
      incomeByCurrency: { HKD: 100, USD: 50 },
      expensesByCurrency: { HKD: 40, EUR: 20 },
    });
    expect(n.HKD).toBe(60);
    expect(n.USD).toBe(50);
    expect(n.EUR).toBe(-20);
  });
});
