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

export type FinanceLedgerSheetKey = "income" | "expenses";

export type HouseKey = "hillmarton" | "morrison";

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
  /**
   * Client-only: expense rows computed from tagged monthly income and allocation rates
   * (never persisted on the expense sheet).
   */
  readonly isDerivedFromTaggedIncome?: boolean;
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

/** Monthly income (any category) linked to a house — used to split unallocated derived expenses. */
function sumMonthlyIncomeByHouseAndCurrency(
  incomeRecords: readonly FinanceLedgerRecord[],
  houseKey: HouseKey,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) {
      continue;
    }
    const c = r.currency;
    out[c] = (out[c] ?? 0) + r.amount;
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
 */
export function sumMonthlyFinanceLedgerAmountsByHouse(
  incomeRecords: readonly FinanceLedgerRecord[],
  expenseRecords: readonly FinanceLedgerRecord[],
  houseKey: HouseKey,
  expenseAllocationPercents?: ExpenseIncomeAllocationPercents,
): FinanceLedgerAmountBuckets {
  const alloc = expenseAllocationPercents ?? DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

  const incomeHiByCcy = sumMonthlyIncomeByHouseAndCurrency(incomeRecords, "hillmarton");
  const incomeMoByCcy = sumMonthlyIncomeByHouseAndCurrency(incomeRecords, "morrison");

  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) continue;
    const c = r.currency;
    income[c] = (income[c] ?? 0) + r.amount;
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

  const addUnallocatedDerivedForFlag = (
    flag: "isTax" | "isSaving" | "isInvestment",
    pct: number,
  ): void => {
    if (pct <= 0) {
      return;
    }
    const unallocByCcy = sumMonthlyTaggedIncomeWithoutRelatedHouseByCurrency(
      incomeRecords,
      flag,
    );
    for (const [c, base] of Object.entries(unallocByCcy)) {
      if (base <= 0) {
        continue;
      }
      const amt = base * (pct / 100);
      const wHi = incomeHiByCcy[c] ?? 0;
      const wMo = incomeMoByCcy[c] ?? 0;
      const wSelf = houseKey === "hillmarton" ? wHi : wMo;
      const wTot = wHi + wMo;
      const share = wTot > 0 ? wSelf / wTot : 0.5;
      expenses[c] = (expenses[c] ?? 0) + amt * share;
    }
  };

  addDerivedForFlag("isTax", alloc.taxOnIncomePercent);
  addDerivedForFlag("isInvestment", alloc.investmentOnIncomePercent);
  addDerivedForFlag("isSaving", alloc.savingOnIncomePercent);

  addUnallocatedDerivedForFlag("isTax", alloc.taxOnIncomePercent);
  addUnallocatedDerivedForFlag("isInvestment", alloc.investmentOnIncomePercent);
  addUnallocatedDerivedForFlag("isSaving", alloc.savingOnIncomePercent);

  return { incomeByCurrency: income, expensesByCurrency: expenses };
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
};

function categorySet(categories: readonly string[]): Set<string> {
  return new Set(categories);
}

export type NormalizeLedgerRecordsOptions = {
  /** When true, reads `isTax` / `isSaving` / `isInvestment` for income rows (defaults false). */
  readonly includeIncomeFlags?: boolean;
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
    } else {
      out.push(base);
    }
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
