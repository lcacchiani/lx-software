/** Admin-supported ISO 4217 codes (fixed list; managed in admin UI as dropdowns). */

export const SUPPORTED_CURRENCIES = [
  "GBP",
  "HKD",
  "USD",
  "EUR",
  "CNY",
  "SGD",
  "AED",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Platform default when no house-specific default is set. */
export const GLOBAL_DEFAULT_CURRENCY: CurrencyCode = "HKD";

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
