import { describe, expect, it } from "vitest";
import {
  formatDateTimeHKT,
  formatMoneyAmount,
  formatMoneyAmountWithoutCurrency,
} from "./formatDisplay";

describe("formatMoneyAmount", () => {
  it("formats HKD", () => {
    expect(formatMoneyAmount(12.5, "HKD")).toMatch(/12/);
  });
});

describe("formatMoneyAmountWithoutCurrency", () => {
  it("omits ISO currency code from the string", () => {
    const full = formatMoneyAmount(1234.5, "USD");
    const bare = formatMoneyAmountWithoutCurrency(1234.5, "USD");
    expect(bare).not.toMatch(/\bUSD\b/);
    expect(full).toMatch(/\bUSD\b|^\$/);
    expect(bare).toMatch(/1,?234/);
  });
});

describe("formatDateTimeHKT", () => {
  it("includes HKT suffix", () => {
    const s = formatDateTimeHKT("2026-05-26T14:12:00.000Z");
    expect(s).toContain("HKT");
    expect(s).toContain("2026");
  });

  it("returns em dash for invalid iso", () => {
    expect(formatDateTimeHKT("not-a-date")).toBe("—");
  });
});
