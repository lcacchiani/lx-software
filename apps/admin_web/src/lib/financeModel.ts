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
};

/** Monthly equivalent for ledger tables that show a per-month column. */
export function ledgerMonthlyAmount(record: FinanceLedgerRecord): number {
  return record.amountPeriod === "year" ? record.amount / 12 : record.amount;
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
): FinanceLedgerAmountBuckets {
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

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

  return { incomeByCurrency: income, expensesByCurrency: expenses };
}

export type FinancePersistedState = {
  readonly hillmarton: HouseFinanceData;
  readonly morrison: HouseFinanceData;
  readonly incomeRecords: readonly FinanceLedgerRecord[];
  readonly expenseRecords: readonly FinanceLedgerRecord[];
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
};

function categorySet(categories: readonly string[]): Set<string> {
  return new Set(categories);
}

/** Coerces API payloads into ledger rows; drops entries with unknown categories. */
export function normalizeLedgerRecords(
  input: unknown,
  allowedCategories: readonly string[],
): FinanceLedgerRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const allowed = categorySet(allowedCategories);
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
    out.push({
      id,
      category,
      description,
      amount,
      currency,
      amountPeriod,
      ...(relatedHouse ? { relatedHouse } : {}),
    });
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
