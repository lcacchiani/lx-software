import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  buildDerivedExpenseLedgerRowsFromTaggedIncome,
  investmentRecordCurrentValueInRowCurrency,
  investmentRecordFiatNotionalInQuoteCurrency,
  investmentMarketSourceCurrency,
  isInvestmentMarketPriced,
  investmentDetailsDisplay,
  ledgerMonthlyAmount,
  allocationRecordsToApiPayload,
  normalizeAllocationRecords,
  normalizeExpenseIncomeAllocationPercents,
  normalizeInvestmentRecords,
  normalizeLedgerRecords,
  normalizePensionRecords,
  normalizeSavingsRecords,
  monthlyLedgerNetByCurrency,
  sumMonthlyFinanceLedgerAmountsByHouse,
  sumMonthlyFinanceLedgerAmountsGeneral,
  sumMonthlyGeneralExpenseAmountsByCategory,
  syntheticIncomeLedgerRowsFromAllocations,
  type HouseKey,
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

  it("drops unit on Real Estate rows (units are not used for this category)", () => {
    const rows = [
      {
        id: "1",
        category: "Real Estate",
        assetType: "Fixed",
        provider: "Bank",
        principalAmount: 100,
        currency: "HKD",
        unit: 5,
      },
    ];
    const out = normalizeInvestmentRecords(rows);
    expect(out).toHaveLength(1);
    expect(out[0].unit).toBeUndefined();
  });

  it("reads optional currentValue for Real Estate", () => {
    const rows = [
      {
        id: "1",
        category: "Real Estate",
        assetType: "Fixed",
        provider: "Bank",
        principalAmount: 100,
        currency: "HKD",
        currentValue: 250,
      },
    ];
    const out = normalizeInvestmentRecords(rows);
    expect(out[0].currentValue).toBe(250);
  });

  it("reads optional unit and lastUpdated", () => {
    const rows = [
      {
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "Broker",
        principalAmount: 10,
        currency: "USD",
        unit: 100,
        lastUpdated: "2026-05-01",
      },
    ];
    const out = normalizeInvestmentRecords(rows);
    expect(out).toHaveLength(1);
    expect(out[0].unit).toBe(100);
    expect(out[0].lastUpdated).toBe("2026-05-01");
  });

  it("drops invalid unit values", () => {
    const rows = [
      {
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "Broker",
        principalAmount: 10,
        currency: "USD",
        unit: "not-a-number",
      },
    ];
    expect(normalizeInvestmentRecords(rows)).toHaveLength(0);
  });

  it("keeps ticker only for ETF and cryptoCurrency only for Crypto", () => {
    const rows = [
      {
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "Broker",
        principalAmount: 10,
        currency: "USD",
        ticker: "VWRA",
      },
      {
        id: "2",
        category: "Crypto",
        assetType: "Liquid",
        provider: "Ex",
        principalAmount: 1,
        currency: "USD",
        cryptoCurrency: "BTC",
      },
      {
        id: "3",
        category: "Real Estate",
        assetType: "Fixed",
        provider: "Bank",
        principalAmount: 1,
        currency: "HKD",
        ticker: "IGNORE",
      },
    ];
    const out = normalizeInvestmentRecords(rows);
    expect(out[0].ticker).toBe("VWRA");
    expect(out[1].cryptoCurrency).toBe("BTC");
    expect(out[2].ticker).toBeUndefined();
  });
});

describe("investmentRecordFiatNotionalInQuoteCurrency", () => {
  it("uses principal total for non-crypto", () => {
    expect(
      investmentRecordFiatNotionalInQuoteCurrency({
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 5000,
        currency: "USD",
        unit: 10,
      }),
    ).toBe(5000);
  });

  it("multiplies units by principal for Crypto when units are positive", () => {
    expect(
      investmentRecordFiatNotionalInQuoteCurrency({
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 95000,
        currency: "USD",
        unit: 2,
      }),
    ).toBe(190000);
  });

  it("uses principal alone for Crypto when units are absent", () => {
    expect(
      investmentRecordFiatNotionalInQuoteCurrency({
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 120000,
        currency: "HKD",
      }),
    ).toBe(120000);
  });

  it("multiplies units by principal for Fixed Term Deposit when units are positive", () => {
    expect(
      investmentRecordFiatNotionalInQuoteCurrency({
        id: "1",
        category: "Fixed Term Deposit",
        assetType: "Fixed",
        provider: "Bank",
        principalAmount: 10000,
        currency: "HKD",
        unit: 3,
      }),
    ).toBe(30000);
  });

  it("uses currentValue for Real Estate when set", () => {
    expect(
      investmentRecordFiatNotionalInQuoteCurrency({
        id: "1",
        category: "Real Estate",
        assetType: "Fixed",
        provider: "X",
        principalAmount: 100,
        currency: "HKD",
        currentValue: 999,
      }),
    ).toBe(999);
  });

  it("falls back to principal for Real Estate when currentValue is omitted", () => {
    expect(
      investmentRecordFiatNotionalInQuoteCurrency({
        id: "1",
        category: "Real Estate",
        assetType: "Fixed",
        provider: "X",
        principalAmount: 100,
        currency: "HKD",
      }),
    ).toBe(100);
  });
});

describe("investmentMarketSourceCurrency", () => {
  it("returns trimmed cryptoCurrency for Crypto rows", () => {
    expect(
      investmentMarketSourceCurrency({
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "HKD",
        cryptoCurrency: " BTC ",
      }),
    ).toBe("BTC");
  });

  it("returns trimmed ticker for ETF rows", () => {
    expect(
      investmentMarketSourceCurrency({
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "USD",
        ticker: " VWRA ",
      }),
    ).toBe("VWRA");
  });

  it("returns undefined when field is missing/empty", () => {
    expect(
      investmentMarketSourceCurrency({
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "USD",
      }),
    ).toBeUndefined();
    expect(
      investmentMarketSourceCurrency({
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "USD",
        ticker: "   ",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for non-Crypto/ETF categories", () => {
    expect(
      investmentMarketSourceCurrency({
        id: "1",
        category: "Real Estate",
        assetType: "Fixed",
        provider: "Bank",
        principalAmount: 1,
        currency: "HKD",
      }),
    ).toBeUndefined();
  });
});

describe("isInvestmentMarketPriced", () => {
  it("is true for Crypto with positive units and cryptoCurrency", () => {
    expect(
      isInvestmentMarketPriced({
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "HKD",
        unit: 0.5,
        cryptoCurrency: "BTC",
      }),
    ).toBe(true);
  });

  it("is true for ETF with positive units and ticker", () => {
    expect(
      isInvestmentMarketPriced({
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "USD",
        unit: 10,
        ticker: "VWRA",
      }),
    ).toBe(true);
  });

  it("is false without units or with non-positive units", () => {
    expect(
      isInvestmentMarketPriced({
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "HKD",
        cryptoCurrency: "BTC",
      }),
    ).toBe(false);
    expect(
      isInvestmentMarketPriced({
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "USD",
        ticker: "VWRA",
        unit: 0,
      }),
    ).toBe(false);
  });

  it("is false when ticker/cryptoCurrency is missing", () => {
    expect(
      isInvestmentMarketPriced({
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 1,
        currency: "USD",
        unit: 5,
      }),
    ).toBe(false);
  });
});

describe("investmentRecordCurrentValueInRowCurrency", () => {
  it("uses unit × rate(1 ticker → row.currency) for ETF rows", () => {
    const v = investmentRecordCurrentValueInRowCurrency(
      {
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "Broker",
        principalAmount: 4500, // not used when market priced
        currency: "USD",
        unit: 10,
        ticker: "EUR",
      },
      (from, to) => {
        // 1 EUR = 1.07 USD (illustrative)
        if (from === "EUR" && to === "USD") return 1.07;
        return undefined;
      },
    );
    expect(v).toBeCloseTo(10 * 1.07, 6);
  });

  it("uses unit × rate(1 cryptoCurrency → row.currency) for Crypto rows", () => {
    const v = investmentRecordCurrentValueInRowCurrency(
      {
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "Ex",
        principalAmount: 95000,
        currency: "USD",
        unit: 0.5,
        cryptoCurrency: "BTC",
      },
      (from, to) => {
        if (from === "BTC" && to === "USD") return 100000;
        return undefined;
      },
    );
    expect(v).toBe(50000);
  });

  it("returns undefined when the rate provider returns undefined", () => {
    const v = investmentRecordCurrentValueInRowCurrency(
      {
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "Ex",
        principalAmount: 95000,
        currency: "USD",
        unit: 1,
        cryptoCurrency: "BTC",
      },
      () => undefined,
    );
    expect(v).toBeUndefined();
  });

  it("returns undefined when the rate provider throws", () => {
    const v = investmentRecordCurrentValueInRowCurrency(
      {
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "Ex",
        principalAmount: 95000,
        currency: "USD",
        unit: 1,
        cryptoCurrency: "BTC",
      },
      () => {
        throw new Error("missing");
      },
    );
    expect(v).toBeUndefined();
  });

  it("falls back to fiat notional when row is not market priced (no units)", () => {
    const v = investmentRecordCurrentValueInRowCurrency(
      {
        id: "1",
        category: "Crypto",
        assetType: "Liquid",
        provider: "Ex",
        principalAmount: 120000,
        currency: "HKD",
        cryptoCurrency: "BTC",
      },
      () => 999,
    );
    expect(v).toBe(120000);
  });

  it("falls back to fiat notional when ticker/cryptoCurrency is missing", () => {
    const v = investmentRecordCurrentValueInRowCurrency(
      {
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 5000,
        currency: "USD",
        unit: 10,
      },
      () => 999,
    );
    expect(v).toBe(5000);
  });

  it("uses rate identity when market source equals row currency", () => {
    const v = investmentRecordCurrentValueInRowCurrency(
      {
        id: "1",
        category: "ETF",
        assetType: "Liquid",
        provider: "X",
        principalAmount: 100,
        currency: "USD",
        unit: 7,
        ticker: "USD",
      },
      (from, to) => (from === to ? 1 : undefined),
    );
    expect(v).toBe(7);
  });
});

describe("investmentDetailsDisplay", () => {
  const labels = new Map<HouseKey, string>([
    ["hillmarton", "H1"],
    ["morrison", "M1"],
  ]);

  it("shows house label for Real Estate", () => {
    expect(
      investmentDetailsDisplay(
        {
          id: "1",
          category: "Real Estate",
          assetType: "Fixed",
          provider: "B",
          principalAmount: 1,
          currency: "HKD",
          relatedHouse: "morrison",
        },
        labels,
      ),
    ).toBe("M1");
  });

  it("shows ticker for ETF and crypto label for Crypto", () => {
    expect(
      investmentDetailsDisplay(
        {
          id: "1",
          category: "ETF",
          assetType: "Liquid",
          provider: "B",
          principalAmount: 1,
          currency: "USD",
          ticker: "VXUS",
        },
        labels,
      ),
    ).toBe("VXUS");
    expect(
      investmentDetailsDisplay(
        {
          id: "2",
          category: "Crypto",
          assetType: "Liquid",
          provider: "B",
          principalAmount: 1,
          currency: "USD",
          cryptoCurrency: "ETH",
        },
        labels,
      ),
    ).toBe("ETH");
  });
});

describe("normalizeSavingsRecords", () => {
  it("keeps valid rows and drops invalid", () => {
    const rows = [
      { id: "1", deposit: "Bank A", value: 1000, currency: "HKD" },
      { id: "", deposit: "X", value: 1, currency: "HKD" },
      { id: "2", deposit: "  ", value: 1, currency: "HKD" },
    ];
    const out = normalizeSavingsRecords(rows);
    expect(out).toHaveLength(1);
    expect(out[0].deposit).toBe("Bank A");
    expect(out[0].description).toBe("");
  });

  it("reads description", () => {
    const rows = [
      { id: "1", deposit: "Bank A", description: "  Term  ", value: 1000, currency: "HKD" },
    ];
    const out = normalizeSavingsRecords(rows);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("Term");
  });
});

describe("normalizePensionRecords", () => {
  it("keeps valid rows", () => {
    const rows = [{ id: "p", fund: "Plan A", value: 99.5, currency: "GBP" }];
    const out = normalizePensionRecords(rows);
    expect(out).toHaveLength(1);
    expect(out[0].fund).toBe("Plan A");
    expect(out[0].description).toBe("");
    expect(out[0].value).toBe(99.5);
  });

  it("reads description", () => {
    const rows = [
      {
        id: "p",
        fund: "Plan A",
        description: "Employer match",
        value: 1,
        currency: "HKD",
      },
    ];
    const out = normalizePensionRecords(rows);
    expect(out[0].description).toBe("Employer match");
  });

  it("reads valid lastUpdated calendar date", () => {
    const rows = [
      {
        id: "p",
        fund: "Plan A",
        description: "",
        value: 1,
        currency: "HKD",
        lastUpdated: "2026-04-20",
      },
    ];
    const out = normalizePensionRecords(rows);
    expect(out[0].lastUpdated).toBe("2026-04-20");
  });

  it("drops invalid lastUpdated", () => {
    const rows = [
      {
        id: "p",
        fund: "Plan A",
        description: "",
        value: 1,
        currency: "HKD",
        lastUpdated: "2026-13-40",
      },
    ];
    const out = normalizePensionRecords(rows);
    expect(out[0].lastUpdated).toBeUndefined();
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

  it("includes allocation rows tagged as income when relatedHouse matches", () => {
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
      ],
      INCOME_CATEGORIES,
      { includeIncomeFlags: true },
    );
    const expenses = normalizeLedgerRecords([], EXPENSE_CATEGORIES);
    const allocations = normalizeAllocationRecords([
      {
        expenseId: "x1",
        description: "Alloc in",
        monthlyAmount: 25,
        accumulatedAmount: 0,
        currency: "HKD",
        relatedHouse: "hillmarton",
        isIncome: true,
      },
    ]);
    const r = sumMonthlyFinanceLedgerAmountsByHouse(
      income,
      expenses,
      "hillmarton",
      undefined,
      allocations,
    );
    expect(r.incomeByCurrency.HKD).toBe(125);
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

  it("does not add derived expenses from tax-tagged income with no related house", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "General income",
          amount: 1000,
          currency: "HKD",
          isTax: true,
          isSaving: false,
          isInvestment: false,
        },
      ],
      INCOME_CATEGORIES,
      { includeIncomeFlags: true },
    );
    const alloc = normalizeExpenseIncomeAllocationPercents({
      taxOnIncomePercent: 10,
      investmentOnIncomePercent: 0,
      savingOnIncomePercent: 0,
    });
    const r = sumMonthlyFinanceLedgerAmountsByHouse(income, [], "hillmarton", alloc);
    expect(r.expensesByCurrency.HKD ?? 0).toBe(0);
    expect(r.incomeByCurrency.HKD ?? 0).toBe(0);
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

const LEDGER_HOUSE_OPTIONS = [
  { value: "hillmarton" as const, label: "H1" },
  { value: "morrison" as const, label: "M1" },
];

describe("sumMonthlyFinanceLedgerAmountsGeneral", () => {
  it("sums month-period ledger rows with no related house and excludes property-linked rows", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "General pay",
          amount: 80,
          currency: "HKD",
        },
        {
          id: "i2",
          category: "Rent",
          description: "Hill rent",
          amount: 200,
          currency: "HKD",
          relatedHouse: "hillmarton",
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
          description: "General bill",
          amount: 15,
          currency: "HKD",
        },
        {
          id: "e2",
          category: "Insurance",
          description: "House ins",
          amount: 99,
          currency: "HKD",
          relatedHouse: "morrison",
        },
      ],
      EXPENSE_CATEGORIES,
    );
    const r = sumMonthlyFinanceLedgerAmountsGeneral(
      income,
      expenses,
      normalizeExpenseIncomeAllocationPercents({}),
      LEDGER_HOUSE_OPTIONS,
    );
    expect(r.incomeByCurrency.HKD).toBe(80);
    expect(r.expensesByCurrency.HKD).toBe(15);
  });

  it("adds derived expenses from tagged income with no related property", () => {
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
    const alloc = normalizeExpenseIncomeAllocationPercents({
      taxOnIncomePercent: 10,
      investmentOnIncomePercent: 0,
      savingOnIncomePercent: 0,
    });
    const r = sumMonthlyFinanceLedgerAmountsGeneral(
      income,
      [],
      alloc,
      LEDGER_HOUSE_OPTIONS,
    );
    expect(r.incomeByCurrency.HKD).toBe(500);
    expect(r.expensesByCurrency.HKD).toBeCloseTo(50, 10);
  });

  it("includes allocation income in general monthly totals when not linked to a property", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "Pay",
          amount: 100,
          currency: "HKD",
        },
      ],
      INCOME_CATEGORIES,
      { includeIncomeFlags: true },
    );
    const allocations = normalizeAllocationRecords([
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000099",
        description: "Side",
        monthlyAmount: 0,
        accumulatedAmount: 1,
        currency: "USD",
        isCustomAllocation: true,
        isIncome: true,
        allocationIncomeMonthly: 40,
      },
    ]);
    const r = sumMonthlyFinanceLedgerAmountsGeneral(
      income,
      [],
      normalizeExpenseIncomeAllocationPercents({}),
      LEDGER_HOUSE_OPTIONS,
      allocations,
    );
    expect(r.incomeByCurrency.HKD).toBe(100);
    expect(r.incomeByCurrency.USD).toBe(40);
  });
});

describe("sumMonthlyGeneralExpenseAmountsByCategory", () => {
  it("splits general expenses by category and includes unallocated derived rows", () => {
    const income = normalizeLedgerRecords(
      [
        {
          id: "i1",
          category: "Salary",
          description: "Pay",
          amount: 1000,
          currency: "HKD",
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
          category: "Rent",
          description: "Flat",
          amount: 700,
          currency: "HKD",
        },
        {
          id: "e2",
          category: "Utility",
          description: "Power",
          amount: 50,
          currency: "HKD",
        },
      ],
      EXPENSE_CATEGORIES,
    );
    const alloc = normalizeExpenseIncomeAllocationPercents({
      taxOnIncomePercent: 10,
      investmentOnIncomePercent: 0,
      savingOnIncomePercent: 0,
    });
    const byCat = sumMonthlyGeneralExpenseAmountsByCategory(
      income,
      expenses,
      alloc,
      LEDGER_HOUSE_OPTIONS,
    );
    expect(byCat.Rent?.HKD).toBe(700);
    expect(byCat.Utility?.HKD).toBe(50);
    expect(byCat.Tax?.HKD).toBeCloseTo(100, 10);
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

describe("syntheticIncomeLedgerRowsFromAllocations", () => {
  it("builds income ledger rows from tagged allocations with positive monthly amounts", () => {
    const rows = syntheticIncomeLedgerRowsFromAllocations(
      normalizeAllocationRecords([
        {
          expenseId: "e-alloc-1",
          description: "Bonus pool",
          monthlyAmount: 300,
          accumulatedAmount: 0,
          currency: "HKD",
          isIncome: true,
        },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("__alloc_income__e-alloc-1");
    expect(rows[0].amount).toBe(300);
    expect(rows[0].isDerivedFromAllocation).toBe(true);
  });
});

describe("allocationRecordsToApiPayload", () => {
  it("sends description and currency only for custom allocations", () => {
    const body = allocationRecordsToApiPayload([
      {
        expenseId: "e1",
        description: "From expense",
        monthlyAmount: 100,
        accumulatedAmount: 5,
        currency: "HKD",
      },
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000001",
        description: "Manual",
        monthlyAmount: 0,
        accumulatedAmount: 10,
        currency: "USD",
        isCustomAllocation: true,
      },
    ]);
    expect(body).toEqual([
      { expenseId: "e1", accumulatedAmount: 5 },
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000001",
        description: "Manual",
        currency: "USD",
        accumulatedAmount: 10,
      },
    ]);
  });

  it("includes isIncome and allocationIncomeMonthly on custom rows when set", () => {
    const body = allocationRecordsToApiPayload([
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000011",
        description: "Side",
        monthlyAmount: 0,
        accumulatedAmount: 1,
        currency: "HKD",
        isCustomAllocation: true,
        isIncome: true,
        allocationIncomeMonthly: 55,
      },
    ]);
    expect(body).toEqual([
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000011",
        description: "Side",
        currency: "HKD",
        accumulatedAmount: 1,
        isIncome: true,
        allocationIncomeMonthly: 55,
      },
    ]);
  });

  it("includes isIncome on linked rows when true", () => {
    const body = allocationRecordsToApiPayload([
      {
        expenseId: "exp-1",
        description: "X",
        monthlyAmount: 10,
        accumulatedAmount: 2,
        currency: "HKD",
        isIncome: true,
      },
    ]);
    expect(body).toEqual([{ expenseId: "exp-1", accumulatedAmount: 2, isIncome: true }]);
  });

  it("treats __custom__ id as custom even without flag", () => {
    const body = allocationRecordsToApiPayload([
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000099",
        description: "Legacy",
        monthlyAmount: 0,
        accumulatedAmount: 3,
        currency: "EUR",
      },
    ]);
    expect(body).toEqual([
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000099",
        description: "Legacy",
        currency: "EUR",
        accumulatedAmount: 3,
      },
    ]);
  });

  it("normalizes custom allocation without income tag (monthly stays zero)", () => {
    const out = normalizeAllocationRecords([
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000002",
        description: "X",
        monthlyAmount: 99,
        accumulatedAmount: 1,
        currency: "HKD",
        isCustomAllocation: true,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].monthlyAmount).toBe(0);
    expect(out[0].isIncome).toBeUndefined();
  });

  it("normalizes custom allocation with income tag and monthly", () => {
    const out = normalizeAllocationRecords([
      {
        expenseId: "__custom__00000000-0000-4000-8000-000000000003",
        description: "Side",
        monthlyAmount: 0,
        accumulatedAmount: 1,
        currency: "HKD",
        isCustomAllocation: true,
        isIncome: true,
        allocationIncomeMonthly: 42,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].isIncome).toBe(true);
    expect(out[0].allocationIncomeMonthly).toBe(42);
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
