import { describe, expect, it } from "vitest";
import { isValuationStale, VALUATION_STALE_DAYS } from "./valuationStaleness";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

describe("isValuationStale", () => {
  it("flags a date older than the threshold", () => {
    expect(isValuationStale("2026-01-01", NOW)).toBe(true);
  });

  it("does not flag a recent date", () => {
    expect(isValuationStale("2026-08-01", NOW)).toBe(false);
  });

  it("does not flag a date exactly at the threshold", () => {
    const at = new Date(NOW - VALUATION_STALE_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    // Midnight of that day is within the window because NOW is midday.
    expect(isValuationStale(at, Date.parse(`${at}T00:00:00.000Z`))).toBe(false);
  });

  it("does not flag missing or invalid dates", () => {
    expect(isValuationStale(undefined, NOW)).toBe(false);
    expect(isValuationStale("", NOW)).toBe(false);
    expect(isValuationStale("not-a-date", NOW)).toBe(false);
  });
});
