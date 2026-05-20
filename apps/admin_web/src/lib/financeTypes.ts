/** Finance domain types and category constants (from contracts/finance.json). */

import type {
  ASSET_TYPES,
  FINANCE_ACCOUNT_TYPES,
  INVESTMENT_CATEGORIES,
} from "./contracts/generated";

export {
  ASSET_TYPES,
  EXPENSE_CATEGORIES,
  FINANCE_ACCOUNT_TYPES,
  FINANCE_HOUSE_KEYS,
  GLOBAL_DEFAULT_CURRENCY,
  INCOME_CATEGORIES,
  INVESTMENT_CATEGORIES,
  type CurrencyCode,
  type HouseKey,
} from "./contracts/generated";

export type FinanceLineType = "income" | "expenditure" | "mortgage";

export type HouseFloat = {
  readonly amount: number;
  readonly currency: string;
};

export type HouseStatementLine = {
  readonly id: string;
  readonly dateUtc: string;
  readonly type: FinanceLineType;
  readonly description: string;
  readonly netAmount: number;
  readonly vat: number;
  readonly currency: string;
  readonly grossAmount: number;
  readonly sourceAssetKeys?: readonly string[];
};

export type HouseFinanceData = {
  readonly defaultCurrency: import("./contracts/generated").CurrencyCode;
  readonly float: HouseFloat;
  readonly lines: readonly HouseStatementLine[];
};

export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];
export type AssetType = (typeof ASSET_TYPES)[number];
export type FinanceAccountType = (typeof FINANCE_ACCOUNT_TYPES)[number];

export const INVESTMENT_TICKER_MAX_LEN = 64;
export const INVESTMENT_CRYPTO_CURRENCY_MAX_LEN = 120;
export const MAX_PENSION_DESCRIPTION_LEN = 8000;
export const MAX_ACCOUNT_DESCRIPTION_LEN = 8000;
