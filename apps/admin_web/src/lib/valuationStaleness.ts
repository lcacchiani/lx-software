/**
 * Stale-valuation detection for finance rows with a server-managed
 * `lastUpdated` UTC calendar date (investments, pensions, accounts,
 * liabilities). A row is stale when its valuation has not been touched for
 * more than {@link VALUATION_STALE_DAYS} days; rows without a date are never
 * flagged (there is nothing to compare against).
 */

export const VALUATION_STALE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `lastUpdated` is a `YYYY-MM-DD` UTC calendar date; `nowMs` defaults to the current time. */
export function isValuationStale(
  lastUpdated: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastUpdated) {
    return false;
  }
  const ms = Date.parse(`${lastUpdated}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    return false;
  }
  return nowMs - ms > VALUATION_STALE_DAYS * DAY_MS;
}
