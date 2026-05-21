/** Admin-supported ISO 4217 codes (from contracts/finance.json). */

import {
  GLOBAL_DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from "./contracts/generated";

export { GLOBAL_DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, type CurrencyCode };

const SUPPORTED_SET = new Set<string>(SUPPORTED_CURRENCIES);

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_SET.has(code.trim().toUpperCase());
}

/** Returns a supported code, or `fallback` if `raw` is missing or not in the list. */
export function coerceSupportedCurrency(
  raw: string,
  fallback: CurrencyCode,
): CurrencyCode {
  const c = raw.trim().toUpperCase();
  return isSupportedCurrency(c) ? (c as CurrencyCode) : fallback;
}
