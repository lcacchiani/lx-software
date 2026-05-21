import { GLOBAL_DEFAULT_CURRENCY, coerceSupportedCurrency } from "./currencies";
import {
  CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX,
  FINANCE_ACCOUNT_TYPES,
  INVESTMENT_CATEGORIES,
  INVESTMENT_CRYPTO_CURRENCY_MAX_LEN,
  INVESTMENT_TICKER_MAX_LEN,
  MAX_ACCOUNT_DESCRIPTION_LEN,
  MAX_PENSION_DESCRIPTION_LEN,
  emptyHouse,
  type AssetType,
  type FinanceAccountRecord,
  type FinanceAccountType,
  type FinanceAllocationRecord,
  type FinanceInvestmentRecord,
  type FinanceLedgerAmountPeriod,
  type FinanceLedgerRecord,
  type FinanceLineType,
  type FinancePensionRecord,
  type FinanceSavingsRecord,
  type HouseFinanceData,
  type HouseFloat,
  type HouseKey,
  type HouseStatementLine,
  type InvestmentCategory,
} from "./financeTypes";

export * from "./financeTypes";
export * from "./financeLedger";
export * from "./financeAggregations";

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
  return v === "income" || v === "expenditure" || v === "mortgage";
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
