import {
  GLOBAL_DEFAULT_CURRENCY,
  coerceSupportedCurrency,
  type CurrencyCode,
} from "./currencies";

export type FinanceLineType = "income" | "expenditure";

export type HouseFloat = {
  readonly amount: number;
  readonly currency: string;
};

export type HouseStatementLine = {
  readonly id: string;
  /** ISO 8601 instant (UTC), e.g. 2026-05-08T14:30:00.000Z */
  readonly dateUtc: string;
  readonly type: FinanceLineType;
  readonly description: string;
  readonly netAmount: number;
  readonly vat: number;
  readonly currency: string;
  readonly grossAmount: number;
  /**
   * Optional S3 object keys for assets (e.g. statement PDFs) tied to this line.
   * Populated by imports and optional manual uploads. Legacy records may only
   * have `sourceAssetKey` in JSON until they are saved again.
   */
  readonly sourceAssetKeys?: readonly string[];
};

/** Resolved attachment keys for a line (normalized data uses `sourceAssetKeys` only). */
export function statementLineAssetKeys(line: HouseStatementLine): readonly string[] {
  const keys = line.sourceAssetKeys;
  return keys?.length ? keys : [];
}

function mergeRawSourceAssetKeys(row: Record<string, unknown>): string[] | undefined {
  const merged: string[] = [];
  const rawArr = row.sourceAssetKeys;
  if (Array.isArray(rawArr)) {
    for (const x of rawArr) {
      if (typeof x === "string" && x.trim()) merged.push(x.trim());
    }
  }
  const legacy = row.sourceAssetKey;
  if (typeof legacy === "string" && legacy.trim()) merged.push(legacy.trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of merged) {
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out.length ? out : undefined;
}

export type HouseFinanceData = {
  /** House-level default for new money fields and unsupported legacy codes. */
  readonly defaultCurrency: CurrencyCode;
  readonly float: HouseFloat;
  readonly lines: readonly HouseStatementLine[];
};

/** Income tab categories (aligned with admin Lambda validation). */
export const INCOME_CATEGORIES = ["Salary", "Rent"] as const;

/** Optional income ledger toggles (stored on income sheet rows only). */
export type IncomeLedgerFlagField = "isTax" | "isSaving" | "isInvestment";

export const INCOME_LEDGER_FLAG_FIELDS: ReadonlyArray<{
  readonly field: IncomeLedgerFlagField;
  readonly label: string;
}> = [
  { field: "isTax", label: "Tax" },
  { field: "isSaving", label: "Saving" },
  { field: "isInvestment", label: "Investment" },
];

/** Expense ledger only: tag shown on Expenses tab and drives the Allocations tab. */
export type ExpenseLedgerFlagField = "isAllocate";

export const EXPENSE_LEDGER_FLAG_FIELDS: ReadonlyArray<{
  readonly field: ExpenseLedgerFlagField;
  readonly label: string;
}> = [{ field: "isAllocate", label: "Allocate" }];

/** Expense tab categories (aligned with admin Lambda validation). */
export const EXPENSE_CATEGORIES = [
  "Utility",
  "Saving",
  "Investment",
  "Rent",
  "Mortgage",
  "Insurance",
  "Retirement",
  "Tax",
  "Amenities",
  "Helper",
  "Education",
] as const;

/** Investment holdings tab (aligned with admin Lambda validation). */
export const INVESTMENT_CATEGORIES = [
  "Real Estate",
  "Fixed Term Deposit",
  "ETF",
  "Crypto",
] as const;

export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];

export const ASSET_TYPES = ["Fixed", "Liquid"] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export type HouseKey = "hillmarton" | "morrison";

/** Max length for ETF ticker text (aligned with admin Lambda). */
export const INVESTMENT_TICKER_MAX_LEN = 64;
/** Max length for crypto “currency” name text (aligned with admin Lambda). */
export const INVESTMENT_CRYPTO_CURRENCY_MAX_LEN = 120;

/** One row in the Investments sheet (DynamoDB finance sheet `investments`). */
export type FinanceInvestmentRecord = {
  readonly id: string;
  readonly category: InvestmentCategory;
  readonly currency: string;
  readonly assetType: AssetType;
  readonly provider: string;
  /** Amount in `currency`: invested principal; for Crypto with `unit`, spot fiat value of one unit. */
  readonly principalAmount: number;
  /** Optional quantity (e.g. shares, coins, lots). */
  readonly unit?: number;
  /** When category is Real Estate, optional link to a house (same keys as finance house tabs). */
  readonly relatedHouse?: HouseKey;
  /**
   * When category is Real Estate, optional market/appraisal value in `currency` for totals and FX.
   * When omitted, {@link principalAmount} is used as the quote-currency notional.
   */
  readonly currentValue?: number;
  /** When category is ETF, optional ticker symbol or name. */
  readonly ticker?: string;
  /** When category is Crypto, optional asset name (e.g. coin); UI label “Crypto currency”. */
  readonly cryptoCurrency?: string;
  /** UTC calendar date `YYYY-MM-DD` when row content last changed (set by admin API). */
  readonly lastUpdated?: string;
};

/** One row in the Savings sheet (DynamoDB finance sheet `savings`). */
export type FinanceSavingsRecord = {
  readonly id: string;
  readonly deposit: string;
  readonly assetType: AssetType;
  readonly description: string;
  readonly value: number;
  readonly currency: string;
};

/** Max UTF-8 length for pension description (aligned with admin Lambda `MAX_FINANCE_DESCRIPTION`). */
export const MAX_PENSION_DESCRIPTION_LEN = 8000;

/** One row in the Pension sheet (DynamoDB finance sheet `pension`). */
export type FinancePensionRecord = {
  readonly id: string;
  readonly fund: string;
  readonly description: string;
  readonly value: number;
  readonly currency: string;
  /** UTC calendar date `YYYY-MM-DD` when row content last changed (set by admin API). */
  readonly lastUpdated?: string;
};

/** Accounts tab (aligned with admin Lambda validation). */
export const FINANCE_ACCOUNT_TYPES = ["Bank Account", "Credit Card", "Debit Card"] as const;

export type FinanceAccountType = (typeof FINANCE_ACCOUNT_TYPES)[number];

export const MAX_ACCOUNT_DESCRIPTION_LEN = 8000;

/** One row in the Accounts sheet (DynamoDB finance sheet `accounts`). */
export type FinanceAccountRecord = {
  readonly id: string;
  readonly description: string;
  readonly accountType: FinanceAccountType;
  /** Day of month (1–31) for the billing cycle. */
  readonly billingCycleDay: number;
  /** Current balance in `currency` (stored as `recordedValue` in the admin API). */
  readonly recordedValue: number;
  /**
   * Credit Card only: last statement balance in `currency`.
   * Omitted for other account types.
   */
  readonly lastStatementAmount?: number;
  readonly currency: string;
  /** UTC calendar date `YYYY-MM-DD` when row content last changed (set by admin API). */
  readonly lastUpdated?: string;
};

/**
 * Signed balance for the Accounts tab FX total: bank and debit add; credit card subtracts
 * (current balance is treated as debt).
 */
export function financeAccountSignedValueForTotal(
  accountType: FinanceAccountType,
  recordedValue: number,
): number {
  return accountType === "Credit Card" ? -recordedValue : recordedValue;
}

/**
 * One row on the Allocations tab: mirrors an expense tagged Allocate, with a persisted
 * accumulated amount (DynamoDB finance sheet `allocations`).
 */
export type FinanceAllocationRecord = {
  readonly expenseId: string;
  readonly description: string;
  /**
   * Linked rows: monthly amount from the expense ledger (yearly ÷12).
   * Custom rows: always 0 (use {@link allocationRecordIncomeMonthlyValue} when tagged as income).
   */
  readonly monthlyAmount: number;
  readonly accumulatedAmount: number;
  readonly currency: string;
  /** UTC calendar date `YYYY-MM-DD` when accumulated amount last changed (set by admin API). */
  readonly lastUpdated?: string;
  /** User-defined allocation line (editable description/currency; no monthly budget). */
  readonly isCustomAllocation?: boolean;
  /**
   * When true, a synthetic income line appears on the Income tab (and in general monthly totals).
   * Custom rows require {@link allocationIncomeMonthly}; linked rows use {@link monthlyAmount}.
   */
  readonly isIncome?: boolean;
  /**
   * When true, row is tagged Pension on Allocations and listed on the Pension tab (persisted by
   * admin API).
   */
  readonly isPension?: boolean;
  /** Custom allocations only: per-month income when `isIncome` (persisted by admin API). */
  readonly allocationIncomeMonthly?: number;
  /** Linked rows only: copied from the source expense when present. */
  readonly relatedHouse?: HouseKey;
};

/** Prefix for custom allocation row ids (aligned with admin Lambda). */
export const CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX = "__custom__";

export function newCustomAllocationExpenseId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX}line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Shapes the PUT body: linked rows omit description/currency; custom rows include them. */
export function allocationRecordsToApiPayload(
  records: readonly FinanceAllocationRecord[],
): unknown[] {
  return records.map((r) => {
    const isCustom =
      r.isCustomAllocation === true ||
      r.expenseId.startsWith(CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX);
    if (isCustom) {
      const body: Record<string, unknown> = {
        expenseId: r.expenseId,
        description: r.description,
        currency: r.currency,
        accumulatedAmount: r.accumulatedAmount,
      };
      if (r.isIncome === true) {
        body.isIncome = true;
        const m = r.allocationIncomeMonthly;
        if (typeof m === "number" && Number.isFinite(m)) {
          body.allocationIncomeMonthly = m;
        }
      }
      if (r.isPension === true) {
        body.isPension = true;
      }
      return body;
    }
    const linked: Record<string, unknown> = {
      expenseId: r.expenseId,
      accumulatedAmount: r.accumulatedAmount,
    };
    if (r.isIncome === true) {
      linked.isIncome = true;
    }
    if (r.isPension === true) {
      linked.isPension = true;
    }
    return linked;
  });
}

/** Monthly income implied by an allocation tagged {@link FinanceAllocationRecord.isIncome}. */
export function allocationRecordIncomeMonthlyValue(record: FinanceAllocationRecord): number {
  if (record.isIncome !== true) {
    return 0;
  }
  const isCustom =
    record.isCustomAllocation === true ||
    record.expenseId.startsWith(CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX);
  if (isCustom) {
    const v = record.allocationIncomeMonthly;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  const v = record.monthlyAmount;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Synthetic income ledger rows for the Income tab (not persisted on the income sheet;
 * edit tags and amounts on the Allocations tab).
 */
export function syntheticIncomeLedgerRowsFromAllocations(
  allocationRecords: readonly FinanceAllocationRecord[],
): FinanceLedgerRecord[] {
  const category = INCOME_CATEGORIES[0];
  const out: FinanceLedgerRecord[] = [];
  for (const a of allocationRecords) {
    const monthly = allocationRecordIncomeMonthlyValue(a);
    if (!Number.isFinite(monthly) || monthly <= 0) {
      continue;
    }
    out.push({
      id: `__alloc_income__${a.expenseId}`,
      category,
      description: `${a.description} (allocation income)`,
      amount: monthly,
      currency: a.currency,
      amountPeriod: "month",
      ...(a.relatedHouse ? { relatedHouse: a.relatedHouse } : {}),
      isDerivedFromAllocation: true,
    });
  }
  return out;
}

export type FinanceLedgerSheetKey = "income" | "expenses";

/** Whether `amount` is entered per calendar month or per year (yearly rows are shown ÷12 in monthly views). */
export type FinanceLedgerAmountPeriod = "month" | "year";

/** One row in the Income or Expenses ledger (same shape; category lists differ per sheet). */
export type FinanceLedgerRecord = {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly amount: number;
  readonly currency: string;
  /** Defaults to `month` when omitted (legacy rows). */
  readonly amountPeriod: FinanceLedgerAmountPeriod;
  /** Optional link to a house (same keys as finance house tabs). */
  readonly relatedHouse?: HouseKey;
  /** Income ledger only: classification toggles (stored by admin API for income sheet). */
  readonly isTax?: boolean;
  readonly isSaving?: boolean;
  readonly isInvestment?: boolean;
  /** Expense ledger only: when true, row appears on the Allocations tab (stored on expense sheet). */
  readonly isAllocate?: boolean;
  /**
   * Client-only: expense rows computed from tagged monthly income and allocation rates
   * (never persisted on the expense sheet).
   */
  readonly isDerivedFromTaggedIncome?: boolean;
  /**
   * Client-only: income rows mirrored from allocations tagged as income (never persisted on the
   * income sheet).
   */
  readonly isDerivedFromAllocation?: boolean;
};

/** Monthly equivalent for ledger tables that show a per-month column. */
export function ledgerMonthlyAmount(record: FinanceLedgerRecord): number {
  return record.amountPeriod === "year" ? record.amount / 12 : record.amount;
}

/** Percentages (0–100) applied to monthly income tagged Tax / Investment / Saving per property. */
export type ExpenseIncomeAllocationPercents = {
  readonly taxOnIncomePercent: number;
  readonly investmentOnIncomePercent: number;
  readonly savingOnIncomePercent: number;
};

export const DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS: ExpenseIncomeAllocationPercents = {
  taxOnIncomePercent: 0,
  investmentOnIncomePercent: 0,
  savingOnIncomePercent: 0,
};

export function normalizeExpenseIncomeAllocationPercents(
  input: unknown,
): ExpenseIncomeAllocationPercents {
  const d = DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  if (!input || typeof input !== "object") {
    return d;
  }
  const o = input as Record<string, unknown>;
  const clamp = (v: unknown): number => {
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string"
          ? Number.parseFloat(v)
          : Number.NaN;
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.min(100, Math.max(0, n));
  };
  return {
    taxOnIncomePercent: clamp(o.taxOnIncomePercent),
    investmentOnIncomePercent: clamp(o.investmentOnIncomePercent),
    savingOnIncomePercent: clamp(o.savingOnIncomePercent),
  };
}

type DerivedExpenseFromTaggedIncomeSpec = {
  readonly idSegment: string;
  readonly category: "Tax" | "Investment" | "Saving";
  readonly title: string;
  readonly incomeFlag: "isTax" | "isInvestment" | "isSaving";
  readonly percentKey: keyof ExpenseIncomeAllocationPercents;
};

const DERIVED_EXPENSE_FROM_TAGGED_INCOME_SPECS: readonly DerivedExpenseFromTaggedIncomeSpec[] = [
  {
    idSegment: "tax-on-income",
    category: "Tax",
    title: "Tax on Income",
    incomeFlag: "isTax",
    percentKey: "taxOnIncomePercent",
  },
  {
    idSegment: "investment-on-income",
    category: "Investment",
    title: "Investments on Income",
    incomeFlag: "isInvestment",
    percentKey: "investmentOnIncomePercent",
  },
  {
    idSegment: "saving-on-income",
    category: "Saving",
    title: "Savings on Income",
    incomeFlag: "isSaving",
    percentKey: "savingOnIncomePercent",
  },
];

function isLedgerRelatedHouse(relatedHouse: HouseKey | undefined): relatedHouse is HouseKey {
  return relatedHouse === "hillmarton" || relatedHouse === "morrison";
}

function sumMonthlyTaggedIncomeByHouseAndCurrency(
  incomeRecords: readonly FinanceLedgerRecord[],
  houseKey: HouseKey,
  flag: "isTax" | "isSaving" | "isInvestment",
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) {
      continue;
    }
    if (!r[flag]) {
      continue;
    }
    const c = r.currency;
    out[c] = (out[c] ?? 0) + ledgerMonthlyAmount(r);
  }
  return out;
}

/** Tagged monthly income rows with no (or invalid) related property — still counts toward derived rows. */
function sumMonthlyTaggedIncomeWithoutRelatedHouseByCurrency(
  incomeRecords: readonly FinanceLedgerRecord[],
  flag: "isTax" | "isSaving" | "isInvestment",
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || !r[flag]) {
      continue;
    }
    if (isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const c = r.currency;
    out[c] = (out[c] ?? 0) + ledgerMonthlyAmount(r);
  }
  return out;
}

/**
 * Synthetic expense rows from allocation rates × monthly income flagged on the income sheet
 * (Tax / Investment / Saving), one row per property and currency where the tagged base is
 * positive and the rate is greater than zero, plus rows for tagged income with no related
 * property.
 */
export function buildDerivedExpenseLedgerRowsFromTaggedIncome(
  incomeRecords: readonly FinanceLedgerRecord[],
  percents: ExpenseIncomeAllocationPercents,
  relatedHouseOptions: ReadonlyArray<{ readonly value: HouseKey; readonly label: string }>,
): FinanceLedgerRecord[] {
  const houses: readonly HouseKey[] = ["hillmarton", "morrison"];
  const out: FinanceLedgerRecord[] = [];
  for (const houseKey of houses) {
    const houseLabel =
      relatedHouseOptions.find((o) => o.value === houseKey)?.label ?? houseKey;
    for (const spec of DERIVED_EXPENSE_FROM_TAGGED_INCOME_SPECS) {
      const pct = percents[spec.percentKey];
      if (pct <= 0) {
        continue;
      }
      const byCcy = sumMonthlyTaggedIncomeByHouseAndCurrency(
        incomeRecords,
        houseKey,
        spec.incomeFlag,
      );
      for (const [currency, base] of Object.entries(byCcy)) {
        if (base <= 0) {
          continue;
        }
        const amount = base * (pct / 100);
        if (!Number.isFinite(amount) || amount === 0) {
          continue;
        }
        out.push({
          id: `__derived__${spec.idSegment}__${houseKey}__${currency}`,
          category: spec.category,
          description: `${spec.title} (${houseLabel})`,
          amount,
          currency,
          amountPeriod: "month",
          relatedHouse: houseKey,
          isDerivedFromTaggedIncome: true,
        });
      }
    }
  }
  for (const spec of DERIVED_EXPENSE_FROM_TAGGED_INCOME_SPECS) {
    const pct = percents[spec.percentKey];
    if (pct <= 0) {
      continue;
    }
    const byCcy = sumMonthlyTaggedIncomeWithoutRelatedHouseByCurrency(
      incomeRecords,
      spec.incomeFlag,
    );
    for (const [currency, base] of Object.entries(byCcy)) {
      if (base <= 0) {
        continue;
      }
      const amount = base * (pct / 100);
      if (!Number.isFinite(amount) || amount === 0) {
        continue;
      }
      out.push({
        id: `__derived__${spec.idSegment}__unallocated__${currency}`,
        category: spec.category,
        description: `${spec.title} (no related property)`,
        amount,
        currency,
        amountPeriod: "month",
        isDerivedFromTaggedIncome: true,
      });
    }
  }
  return out;
}

/** Buckets for dashboard-style income vs expense totals by currency. */
export type FinanceLedgerAmountBuckets = {
  readonly incomeByCurrency: Readonly<Record<string, number>>;
  readonly expensesByCurrency: Readonly<Record<string, number>>;
};

/**
 * Sums Finance Income / Expenses ledger rows with `amountPeriod` **month** and
 * `relatedHouse` equal to `houseKey`. Yearly rows are excluded. All matching
 * rows are included (no calendar-year filter).
 *
 * Derived tax / investment / saving expense slices apply only to monthly income
 * rows **linked to this house**. Tagged income with no related property is not
 * attributed here (see synthetic rows from {@link buildDerivedExpenseLedgerRowsFromTaggedIncome}).
 *
 * When `allocationRecords` is set, allocations tagged as income with the same
 * `relatedHouse` add to the income side (mirrors the Income tab).
 */
export function sumMonthlyFinanceLedgerAmountsByHouse(
  incomeRecords: readonly FinanceLedgerRecord[],
  expenseRecords: readonly FinanceLedgerRecord[],
  houseKey: HouseKey,
  expenseAllocationPercents?: ExpenseIncomeAllocationPercents,
  allocationRecords?: readonly FinanceAllocationRecord[],
): FinanceLedgerAmountBuckets {
  const alloc = expenseAllocationPercents ?? DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) continue;
    const c = r.currency;
    income[c] = (income[c] ?? 0) + r.amount;
  }
  if (allocationRecords?.length) {
    for (const a of allocationRecords) {
      if (a.relatedHouse !== houseKey) continue;
      const m = allocationRecordIncomeMonthlyValue(a);
      if (!Number.isFinite(m) || m <= 0) continue;
      const c = a.currency;
      income[c] = (income[c] ?? 0) + m;
    }
  }
  for (const r of expenseRecords) {
    if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) continue;
    const c = r.currency;
    expenses[c] = (expenses[c] ?? 0) + r.amount;
  }

  const addDerivedForFlag = (
    flag: "isTax" | "isSaving" | "isInvestment",
    pct: number,
  ): void => {
    if (pct <= 0) {
      return;
    }
    for (const r of incomeRecords) {
      if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) {
        continue;
      }
      if (!r[flag]) {
        continue;
      }
      const c = r.currency;
      const base = ledgerMonthlyAmount(r);
      expenses[c] = (expenses[c] ?? 0) + base * (pct / 100);
    }
  };

  addDerivedForFlag("isTax", alloc.taxOnIncomePercent);
  addDerivedForFlag("isInvestment", alloc.investmentOnIncomePercent);
  addDerivedForFlag("isSaving", alloc.savingOnIncomePercent);

  return { incomeByCurrency: income, expensesByCurrency: expenses };
}

/**
 * Monthly ledger totals for income and expenses not linked to a property
 * (`relatedHouse` unset), plus synthetic derived expense rows from tagged
 * monthly income with no related property (same rules as the expenses sheet).
 * Yearly (`amountPeriod: year`) rows are excluded, matching
 * {@link sumMonthlyFinanceLedgerAmountsByHouse}.
 *
 * When `allocationRecords` is set, allocations tagged as income with no related
 * property add to the general income side.
 */
export function sumMonthlyFinanceLedgerAmountsGeneral(
  incomeRecords: readonly FinanceLedgerRecord[],
  expenseRecords: readonly FinanceLedgerRecord[],
  expenseAllocationPercents: ExpenseIncomeAllocationPercents,
  relatedHouseOptions: ReadonlyArray<{ readonly value: HouseKey; readonly label: string }>,
  allocationRecords?: readonly FinanceAllocationRecord[],
): FinanceLedgerAmountBuckets {
  const alloc = expenseAllocationPercents ?? DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const c = r.currency;
    income[c] = (income[c] ?? 0) + r.amount;
  }
  if (allocationRecords?.length) {
    for (const a of allocationRecords) {
      if (isLedgerRelatedHouse(a.relatedHouse)) continue;
      const m = allocationRecordIncomeMonthlyValue(a);
      if (!Number.isFinite(m) || m <= 0) continue;
      const c = a.currency;
      income[c] = (income[c] ?? 0) + m;
    }
  }
  for (const r of expenseRecords) {
    if (r.amountPeriod !== "month" || isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const c = r.currency;
    expenses[c] = (expenses[c] ?? 0) + r.amount;
  }

  const derived = buildDerivedExpenseLedgerRowsFromTaggedIncome(
    incomeRecords,
    alloc,
    relatedHouseOptions,
  );
  for (const r of derived) {
    if (isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const c = r.currency;
    expenses[c] = (expenses[c] ?? 0) + r.amount;
  }

  return { incomeByCurrency: income, expensesByCurrency: expenses };
}

/**
 * Per-currency monthly expense totals for the **general** ledger slice (no related
 * property), matching {@link sumMonthlyFinanceLedgerAmountsGeneral}: persisted
 * expense rows with `amountPeriod: month` and no `relatedHouse`, plus derived
 * tax / saving / investment rows from tagged income with no related property.
 * Every {@link EXPENSE_CATEGORIES} key is present; currencies with zero net are omitted.
 */
export function sumMonthlyGeneralExpenseAmountsByCategory(
  incomeRecords: readonly FinanceLedgerRecord[],
  expenseRecords: readonly FinanceLedgerRecord[],
  expenseAllocationPercents: ExpenseIncomeAllocationPercents,
  relatedHouseOptions: ReadonlyArray<{ readonly value: HouseKey; readonly label: string }>,
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const alloc = expenseAllocationPercents ?? DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  const byCat: Record<string, Record<string, number>> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    byCat[cat] = {};
  }

  for (const r of expenseRecords) {
    if (r.amountPeriod !== "month" || isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const bucket = byCat[r.category];
    if (!bucket) {
      continue;
    }
    const c = r.currency;
    bucket[c] = (bucket[c] ?? 0) + r.amount;
  }

  const derived = buildDerivedExpenseLedgerRowsFromTaggedIncome(
    incomeRecords,
    alloc,
    relatedHouseOptions,
  );
  for (const r of derived) {
    if (isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const bucket = byCat[r.category];
    if (!bucket) {
      continue;
    }
    const c = r.currency;
    bucket[c] = (bucket[c] ?? 0) + r.amount;
  }

  return byCat;
}

/** Per-currency income minus expenses for {@link FinanceLedgerAmountBuckets}. */
export function monthlyLedgerNetByCurrency(
  buckets: FinanceLedgerAmountBuckets,
): Record<string, number> {
  const { incomeByCurrency: inc, expensesByCurrency: exp } = buckets;
  const keys = [...new Set([...Object.keys(inc), ...Object.keys(exp)])];
  const out: Record<string, number> = {};
  for (const c of keys) {
    out[c] = (inc[c] ?? 0) - (exp[c] ?? 0);
  }
  return out;
}

export type FinancePersistedState = {
  readonly hillmarton: HouseFinanceData;
  readonly morrison: HouseFinanceData;
  readonly incomeRecords: readonly FinanceLedgerRecord[];
  readonly expenseRecords: readonly FinanceLedgerRecord[];
  readonly expenseIncomeAllocationPercents: ExpenseIncomeAllocationPercents;
  readonly investmentRecords: readonly FinanceInvestmentRecord[];
  readonly savingsRecords: readonly FinanceSavingsRecord[];
  readonly pensionRecords: readonly FinancePensionRecord[];
  readonly accountRecords: readonly FinanceAccountRecord[];
  readonly allocationRecords: readonly FinanceAllocationRecord[];
};

export const DEFAULT_FLOAT: HouseFloat = {
  amount: 0,
  currency: GLOBAL_DEFAULT_CURRENCY,
};

function emptyHouse(): HouseFinanceData {
  return {
    defaultCurrency: GLOBAL_DEFAULT_CURRENCY,
    float: { ...DEFAULT_FLOAT, currency: GLOBAL_DEFAULT_CURRENCY },
    lines: [],
  };
}

export const DEFAULT_FINANCE_STATE: FinancePersistedState = {
  hillmarton: emptyHouse(),
  morrison: emptyHouse(),
  incomeRecords: [],
  expenseRecords: [],
  expenseIncomeAllocationPercents: DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS,
  investmentRecords: [],
  savingsRecords: [],
  pensionRecords: [],
  accountRecords: [],
  allocationRecords: [],
};

function categorySet(categories: readonly string[]): Set<string> {
  return new Set(categories);
}

const INVESTMENT_CATEGORY_SET = categorySet(INVESTMENT_CATEGORIES);
const FINANCE_ACCOUNT_TYPE_SET = categorySet(FINANCE_ACCOUNT_TYPES);

function isAssetType(v: unknown): v is AssetType {
  return v === "Fixed" || v === "Liquid";
}

function trimInvestmentDetailString(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/**
 * Fiat notional in {@link FinanceInvestmentRecord.currency} before cross-currency conversion
 * (e.g. Frankfurter).
 *
 * For **Crypto** with a positive `unit`, `principalAmount` is the spot fiat value of **one** unit
 * (coin/token) in the record currency — e.g. 1 BNB = 1 HKD — and the row total is `unit × principalAmount`.
 * Frankfurter converts that total when displaying in another ISO currency.
 * For Crypto without units, `principalAmount` is the total position in quote currency.
 *
 * For **Fixed Term Deposit** with a positive `unit`, the notional is `unit × principalAmount`
 * (e.g. lots × principal per lot); otherwise `principalAmount`.
 *
 * For **Real Estate**, uses {@link FinanceInvestmentRecord.currentValue} when set; otherwise
 * `principalAmount`.
 *
 * **ETF** uses `principalAmount` as the total in quote currency.
 */
export function investmentRecordFiatNotionalInQuoteCurrency(
  record: FinanceInvestmentRecord,
): number {
  const p = record.principalAmount;
  if (record.category === "Real Estate") {
    const cv = record.currentValue;
    if (cv !== undefined && Number.isFinite(cv)) {
      return cv;
    }
    return p;
  }
  if (record.category === "Fixed Term Deposit") {
    const u = record.unit;
    if (u !== undefined && Number.isFinite(u) && u > 0 && Number.isFinite(p)) {
      return u * p;
    }
    return p;
  }
  if (record.category !== "Crypto") return p;
  const u = record.unit;
  if (u !== undefined && Number.isFinite(u) && u > 0 && Number.isFinite(p)) {
    return u * p;
  }
  return p;
}

/**
 * Returns the per-row "market price source" currency code for an Investment row,
 * i.e. the symbol whose Frankfurter rate (against the row currency) is applied
 * to `unit` to compute the current value:
 *  - Crypto rows return the trimmed `cryptoCurrency` (when set).
 *  - ETF rows return the trimmed `ticker` (when set).
 *  - Other categories (or rows missing the field) return `undefined`.
 */
export function investmentMarketSourceCurrency(
  record: FinanceInvestmentRecord,
): string | undefined {
  if (record.category === "Crypto") {
    const v = record.cryptoCurrency?.trim();
    return v ? v : undefined;
  }
  if (record.category === "ETF") {
    const v = record.ticker?.trim();
    return v ? v : undefined;
  }
  return undefined;
}

/**
 * Whether {@link record} is a Crypto/ETF row eligible for market-priced current value:
 * has a positive numeric `unit` AND a non-empty `cryptoCurrency`/`ticker` field.
 * Rows where the market source equals the row currency still qualify (rate is identity).
 */
export function isInvestmentMarketPriced(record: FinanceInvestmentRecord): boolean {
  const src = investmentMarketSourceCurrency(record);
  if (!src) return false;
  const u = record.unit;
  return u !== undefined && Number.isFinite(u) && u > 0;
}

/**
 * Computes the current value of an Investment row in its own `currency`.
 *
 * For Crypto/ETF rows that are {@link isInvestmentMarketPriced market priced},
 * the value is `unit × rate(1 marketSource → row.currency)`, where the
 * rate is provided by `convertOneUnitToRowCurrency`. The callback may
 * throw or return `undefined` when the rate is unavailable; in that case
 * this function returns `undefined` so callers can render a placeholder.
 *
 * For all other rows (or when the row is not yet market-priced), falls back
 * to {@link investmentRecordFiatNotionalInQuoteCurrency}.
 */
export function investmentRecordCurrentValueInRowCurrency(
  record: FinanceInvestmentRecord,
  convertOneUnitToRowCurrency: (
    marketSourceCurrency: string,
    rowCurrency: string,
  ) => number | undefined,
): number | undefined {
  if (!isInvestmentMarketPriced(record)) {
    return investmentRecordFiatNotionalInQuoteCurrency(record);
  }
  const src = investmentMarketSourceCurrency(record);
  if (!src) {
    return investmentRecordFiatNotionalInQuoteCurrency(record);
  }
  const u = record.unit;
  if (u === undefined || !Number.isFinite(u)) {
    return investmentRecordFiatNotionalInQuoteCurrency(record);
  }
  let oneUnit: number | undefined;
  try {
    oneUnit = convertOneUnitToRowCurrency(src, record.currency);
  } catch {
    return undefined;
  }
  if (oneUnit === undefined || !Number.isFinite(oneUnit)) {
    return undefined;
  }
  return u * oneUnit;
}

/** Value shown in the Investments “Details” column (property, ticker, or crypto label). */
export function investmentDetailsDisplay(
  record: FinanceInvestmentRecord,
  houseLabelByValue: ReadonlyMap<HouseKey, string>,
): string {
  switch (record.category) {
    case "Real Estate": {
      if (!record.relatedHouse) {
        return "";
      }
      return houseLabelByValue.get(record.relatedHouse) ?? record.relatedHouse;
    }
    case "ETF":
      return record.ticker?.trim() ?? "";
    case "Crypto":
      return record.cryptoCurrency?.trim() ?? "";
    default:
      return "";
  }
}

/** Coerces API payloads into investment rows; drops invalid entries. */
export function normalizeInvestmentRecords(input: unknown): FinanceInvestmentRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: FinanceInvestmentRecord[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const categoryRaw = typeof row.category === "string" ? row.category : "";
    if (!id || !INVESTMENT_CATEGORY_SET.has(categoryRaw)) {
      continue;
    }
    const category = categoryRaw as InvestmentCategory;
    if (!isAssetType(row.assetType)) {
      continue;
    }
    const assetType = row.assetType;
    const provider =
      typeof row.provider === "string" ? row.provider.trim() : "";
    if (!provider) {
      continue;
    }
    const amtRaw = row.principalAmount;
    const principalAmount =
      typeof amtRaw === "number"
        ? amtRaw
        : typeof amtRaw === "string"
          ? Number.parseFloat(amtRaw)
          : Number.NaN;
    if (!Number.isFinite(principalAmount) || Math.abs(principalAmount) > 1e15) {
      continue;
    }
    const curRaw = typeof row.currency === "string" ? row.currency : GLOBAL_DEFAULT_CURRENCY;
    const currency = coerceSupportedCurrency(curRaw, GLOBAL_DEFAULT_CURRENCY);
    const rh = row.relatedHouse;
    const relatedHouse: HouseKey | undefined =
      category === "Real Estate" && (rh === "hillmarton" || rh === "morrison") ? rh : undefined;
    const ticker =
      category === "ETF"
        ? trimInvestmentDetailString(row.ticker, INVESTMENT_TICKER_MAX_LEN)
        : undefined;
    const cryptoCurrency =
      category === "Crypto"
        ? trimInvestmentDetailString(row.cryptoCurrency, INVESTMENT_CRYPTO_CURRENCY_MAX_LEN)
        : undefined;
    let unit: number | undefined;
    if (category !== "Real Estate") {
      const unitRaw = row.unit;
      if (unitRaw === undefined || unitRaw === null || unitRaw === "") {
        unit = undefined;
      } else {
        const n =
          typeof unitRaw === "number"
            ? unitRaw
            : typeof unitRaw === "string"
              ? Number.parseFloat(unitRaw)
              : Number.NaN;
        if (!Number.isFinite(n) || Math.abs(n) > 1e15) {
          continue;
        }
        unit = n;
      }
    }
    let currentValue: number | undefined;
    if (category === "Real Estate") {
      const cvRaw = row.currentValue;
      if (cvRaw !== undefined && cvRaw !== null && cvRaw !== "") {
        const cvn =
          typeof cvRaw === "number"
            ? cvRaw
            : typeof cvRaw === "string"
              ? Number.parseFloat(cvRaw)
              : Number.NaN;
        if (!Number.isFinite(cvn) || Math.abs(cvn) > 1e15) {
          continue;
        }
        currentValue = cvn;
      }
    }
    const lastUpdated = parseOptionalFinanceCalendarDateUtc(row.lastUpdated);
    out.push({
      id,
      category,
      currency,
      assetType,
      provider,
      principalAmount,
      ...(unit !== undefined ? { unit } : {}),
      ...(relatedHouse ? { relatedHouse } : {}),
      ...(currentValue !== undefined ? { currentValue } : {}),
      ...(ticker ? { ticker } : {}),
      ...(cryptoCurrency ? { cryptoCurrency } : {}),
      ...(lastUpdated !== undefined ? { lastUpdated } : {}),
    });
  }
  return out;
}

/** Coerces API payloads into savings rows; drops invalid entries. */
export function normalizeSavingsRecords(input: unknown): FinanceSavingsRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: FinanceSavingsRecord[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const deposit = typeof row.deposit === "string" ? row.deposit.trim() : "";
    if (!id || !deposit) {
      continue;
    }
    const amtRaw = row.value;
    const value =
      typeof amtRaw === "number"
        ? amtRaw
        : typeof amtRaw === "string"
          ? Number.parseFloat(amtRaw)
          : Number.NaN;
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) {
      continue;
    }
    const curRaw = typeof row.currency === "string" ? row.currency : GLOBAL_DEFAULT_CURRENCY;
    const currency = coerceSupportedCurrency(curRaw, GLOBAL_DEFAULT_CURRENCY);
    let description = typeof row.description === "string" ? row.description.trim() : "";
    if (description.length > MAX_PENSION_DESCRIPTION_LEN) {
      description = description.slice(0, MAX_PENSION_DESCRIPTION_LEN);
    }
    const assetType: AssetType = isAssetType(row.assetType)
      ? row.assetType
      : "Fixed";
    out.push({ id, deposit, assetType, description, value, currency });
  }
  return out;
}

/** Valid `YYYY-MM-DD` calendar date in UTC (used for pension and investment `lastUpdated`). */
export function parseOptionalFinanceCalendarDateUtc(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return undefined;
  }
  const ms = Date.parse(`${s}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  if (new Date(ms).toISOString().slice(0, 10) !== s) {
    return undefined;
  }
  return s;
}

/** Coerces API payloads into pension rows; drops invalid entries. */
export function normalizePensionRecords(input: unknown): FinancePensionRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: FinancePensionRecord[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const fund = typeof row.fund === "string" ? row.fund.trim() : "";
    if (!id || !fund) {
      continue;
    }
    const amtRaw = row.value;
    const value =
      typeof amtRaw === "number"
        ? amtRaw
        : typeof amtRaw === "string"
          ? Number.parseFloat(amtRaw)
          : Number.NaN;
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) {
      continue;
    }
    const curRaw = typeof row.currency === "string" ? row.currency : GLOBAL_DEFAULT_CURRENCY;
    const currency = coerceSupportedCurrency(curRaw, GLOBAL_DEFAULT_CURRENCY);
    let description = typeof row.description === "string" ? row.description.trim() : "";
    if (description.length > MAX_PENSION_DESCRIPTION_LEN) {
      description = description.slice(0, MAX_PENSION_DESCRIPTION_LEN);
    }
    const lastUpdated = parseOptionalFinanceCalendarDateUtc(row.lastUpdated);
    const rec: FinancePensionRecord = { id, fund, description, value, currency };
    out.push(lastUpdated === undefined ? rec : { ...rec, lastUpdated });
  }
  return out;
}

/** Coerces API payloads into account rows; drops invalid entries. */
export function normalizeAccountRecords(input: unknown): FinanceAccountRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: FinanceAccountRecord[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const atRaw = typeof row.accountType === "string" ? row.accountType.trim() : "";
    if (!id || !FINANCE_ACCOUNT_TYPE_SET.has(atRaw)) {
      continue;
    }
    const accountType = atRaw as FinanceAccountType;
    const dayRaw = row.billingCycleDay;
    let billingCycleDay: number;
    if (typeof dayRaw === "number" && Number.isInteger(dayRaw) && !Number.isNaN(dayRaw)) {
      billingCycleDay = dayRaw;
    } else if (typeof dayRaw === "string" && /^\d+$/.test(dayRaw.trim())) {
      billingCycleDay = Number.parseInt(dayRaw.trim(), 10);
    } else {
      continue;
    }
    if (billingCycleDay < 1 || billingCycleDay > 31) {
      continue;
    }
    const amtRaw = row.recordedValue;
    const recordedValue =
      typeof amtRaw === "number"
        ? amtRaw
        : typeof amtRaw === "string"
          ? Number.parseFloat(amtRaw)
          : Number.NaN;
    if (!Number.isFinite(recordedValue) || Math.abs(recordedValue) > 1e15) {
      continue;
    }
    let lastStatementAmount: number | undefined;
    if (accountType === "Credit Card") {
      const lsaRaw = row.lastStatementAmount;
      let lsa: number;
      if (lsaRaw === undefined || lsaRaw === null || lsaRaw === "") {
        lsa = 0;
      } else if (typeof lsaRaw === "number") {
        lsa = lsaRaw;
      } else if (typeof lsaRaw === "string") {
        lsa = Number.parseFloat(lsaRaw);
      } else {
        continue;
      }
      if (!Number.isFinite(lsa) || Math.abs(lsa) > 1e15) {
        continue;
      }
      lastStatementAmount = lsa;
    }
    const curRaw = typeof row.currency === "string" ? row.currency : GLOBAL_DEFAULT_CURRENCY;
    const currency = coerceSupportedCurrency(curRaw, GLOBAL_DEFAULT_CURRENCY);
    let description = typeof row.description === "string" ? row.description.trim() : "";
    if (description.length > MAX_ACCOUNT_DESCRIPTION_LEN) {
      description = description.slice(0, MAX_ACCOUNT_DESCRIPTION_LEN);
    }
    const lastUpdated = parseOptionalFinanceCalendarDateUtc(row.lastUpdated);
    const rec: FinanceAccountRecord = {
      id,
      description,
      accountType,
      billingCycleDay,
      recordedValue,
      ...(lastStatementAmount !== undefined ? { lastStatementAmount } : {}),
      currency,
    };
    out.push(lastUpdated === undefined ? rec : { ...rec, lastUpdated });
  }
  return out;
}

export type NormalizeLedgerRecordsOptions = {
  /** When true, reads `isTax` / `isSaving` / `isInvestment` for income rows (defaults false). */
  readonly includeIncomeFlags?: boolean;
  /** When true, reads `isAllocate` for expense rows (defaults false). */
  readonly includeExpenseFlags?: boolean;
};

function parseIncomeLedgerFlag(row: Record<string, unknown>, key: string): boolean {
  const v = row[key];
  return v === true;
}

/** Coerces API payloads into ledger rows; drops entries with unknown categories. */
export function normalizeLedgerRecords(
  input: unknown,
  allowedCategories: readonly string[],
  options?: NormalizeLedgerRecordsOptions,
): FinanceLedgerRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const allowed = categorySet(allowedCategories);
  const includeIncomeFlags = options?.includeIncomeFlags === true;
  const includeExpenseFlags = options?.includeExpenseFlags === true;
  const out: FinanceLedgerRecord[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const category = typeof row.category === "string" ? row.category : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    if (!id || !allowed.has(category) || !description) {
      continue;
    }
    const amtRaw = row.amount;
    const amount =
      typeof amtRaw === "number"
        ? amtRaw
        : typeof amtRaw === "string"
          ? Number.parseFloat(amtRaw)
          : Number.NaN;
    if (!Number.isFinite(amount) || Math.abs(amount) > 1e15) {
      continue;
    }
    const curRaw = typeof row.currency === "string" ? row.currency : GLOBAL_DEFAULT_CURRENCY;
    const currency = coerceSupportedCurrency(curRaw, GLOBAL_DEFAULT_CURRENCY);
    const periodRaw = row.amountPeriod;
    const amountPeriod: FinanceLedgerAmountPeriod =
      periodRaw === "year" ? "year" : "month";
    const rh = row.relatedHouse;
    const relatedHouse: HouseKey | undefined =
      rh === "hillmarton" || rh === "morrison" ? rh : undefined;
    const base: FinanceLedgerRecord = {
      id,
      category,
      description,
      amount,
      currency,
      amountPeriod,
      ...(relatedHouse ? { relatedHouse } : {}),
    };
    if (includeIncomeFlags) {
      out.push({
        ...base,
        isTax: parseIncomeLedgerFlag(row, "isTax"),
        isSaving: parseIncomeLedgerFlag(row, "isSaving"),
        isInvestment: parseIncomeLedgerFlag(row, "isInvestment"),
      });
    } else if (includeExpenseFlags) {
      out.push({
        ...base,
        isAllocate: parseIncomeLedgerFlag(row, "isAllocate"),
      });
    } else {
      out.push(base);
    }
  }
  return out;
}

/** Coerces GET/PUT allocation tab payloads from the admin API. */
export function normalizeAllocationRecords(input: unknown): FinanceAllocationRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: FinanceAllocationRecord[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const expenseId = typeof row.expenseId === "string" ? row.expenseId.trim() : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    if (!expenseId || !description) {
      continue;
    }
    const isCustomAllocation =
      row.isCustomAllocation === true ||
      expenseId.startsWith(CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX);
    const isIncome = row.isIncome === true;
    const isPension = row.isPension === true;
    const rhRaw = row.relatedHouse;
    const relatedHouse: HouseKey | undefined =
      rhRaw === "hillmarton" || rhRaw === "morrison" ? rhRaw : undefined;
    const monthlyRaw = row.monthlyAmount;
    let monthlyAmount: number;
    if (isCustomAllocation) {
      monthlyAmount = 0;
    } else {
      monthlyAmount =
        typeof monthlyRaw === "number"
          ? monthlyRaw
          : typeof monthlyRaw === "string"
            ? Number.parseFloat(monthlyRaw)
            : Number.NaN;
      if (!Number.isFinite(monthlyAmount) || Math.abs(monthlyAmount) > 1e15) {
        continue;
      }
    }
    const accRaw = row.accumulatedAmount;
    const accumulatedAmount =
      typeof accRaw === "number"
        ? accRaw
        : typeof accRaw === "string"
          ? Number.parseFloat(accRaw)
          : Number.NaN;
    if (!Number.isFinite(accumulatedAmount) || Math.abs(accumulatedAmount) > 1e15) {
      continue;
    }
    const curRaw = typeof row.currency === "string" ? row.currency : GLOBAL_DEFAULT_CURRENCY;
    const currency = coerceSupportedCurrency(curRaw, GLOBAL_DEFAULT_CURRENCY);
    const lastUpdated = parseOptionalFinanceCalendarDateUtc(row.lastUpdated);

    let allocationIncomeMonthly: number | undefined;
    if (isCustomAllocation && isIncome) {
      const incRaw = row.allocationIncomeMonthly ?? row.monthlyAmount;
      const inc =
        typeof incRaw === "number"
          ? incRaw
          : typeof incRaw === "string"
            ? Number.parseFloat(incRaw)
            : Number.NaN;
      if (Number.isFinite(inc) && Math.abs(inc) <= 1e15) {
        allocationIncomeMonthly = inc;
      }
    }

    const rec: FinanceAllocationRecord = {
      expenseId,
      description,
      monthlyAmount,
      accumulatedAmount,
      currency,
      ...(isCustomAllocation ? { isCustomAllocation: true as const } : {}),
      ...(isIncome ? { isIncome: true as const } : {}),
      ...(isPension ? { isPension: true as const } : {}),
      ...(allocationIncomeMonthly !== undefined ? { allocationIncomeMonthly } : {}),
      ...(relatedHouse ? { relatedHouse } : {}),
    };
    out.push(lastUpdated === undefined ? rec : { ...rec, lastUpdated });
  }
  return out;
}

export function newStatementLineId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isFinanceLineType(v: unknown): v is FinanceLineType {
  return v === "income" || v === "expenditure";
}

/** Coerces API / legacy payloads into a consistent `HouseFinanceData` shape. */
export function normalizeHouseFinanceData(input: unknown): HouseFinanceData {
  if (!input || typeof input !== "object") {
    return emptyHouse();
  }
  const o = input as Record<string, unknown>;

  const defaultCurrency = coerceSupportedCurrency(
    typeof o.defaultCurrency === "string" ? o.defaultCurrency : GLOBAL_DEFAULT_CURRENCY,
    GLOBAL_DEFAULT_CURRENCY,
  );

  const fl = o.float;
  let float: HouseFloat;
  if (fl && typeof fl === "object") {
    const fo = fl as Record<string, unknown>;
    const amtRaw = fo.amount;
    const amt =
      typeof amtRaw === "number" && Number.isFinite(amtRaw)
        ? amtRaw
        : typeof amtRaw === "string"
          ? Number.parseFloat(amtRaw)
          : 0;
    const amount = Number.isFinite(amt) ? amt : 0;
    const curRaw = typeof fo.currency === "string" ? fo.currency : defaultCurrency;
    float = {
      amount,
      currency: coerceSupportedCurrency(curRaw, defaultCurrency),
    };
  } else {
    float = { amount: 0, currency: defaultCurrency };
  }

  const linesRaw = o.lines;
  const linesOut: HouseStatementLine[] = [];
  if (Array.isArray(linesRaw)) {
    for (const raw of linesRaw) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const dateUtc = typeof row.dateUtc === "string" ? row.dateUtc : "";
      const type = row.type;
      const description = typeof row.description === "string" ? row.description : "";
      if (!id.trim() || !dateUtc || !isFinanceLineType(type) || !description.trim()) {
        continue;
      }
      const net =
        typeof row.netAmount === "number"
          ? row.netAmount
          : Number.parseFloat(String(row.netAmount));
      const vat =
        typeof row.vat === "number" ? row.vat : Number.parseFloat(String(row.vat));
      const gross =
        typeof row.grossAmount === "number"
          ? row.grossAmount
          : Number.parseFloat(String(row.grossAmount));
      if (![net, vat, gross].every((n) => typeof n === "number" && Number.isFinite(n))) {
        continue;
      }
      const curRaw = typeof row.currency === "string" ? row.currency : defaultCurrency;
      const sourceAssetKeys = mergeRawSourceAssetKeys(row);
      linesOut.push({
        id: id.trim(),
        dateUtc: dateUtc.trim(),
        type,
        description: description.trim(),
        netAmount: net,
        vat,
        grossAmount: gross,
        currency: coerceSupportedCurrency(curRaw, defaultCurrency),
        ...(sourceAssetKeys?.length ? { sourceAssetKeys } : {}),
      });
    }
  }

  return {
    defaultCurrency,
    float,
    lines: linesOut,
  };
}
