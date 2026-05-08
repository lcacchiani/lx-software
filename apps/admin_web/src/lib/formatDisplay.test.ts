import { describe, expect, it } from "vitest";
import { formatDateTimeHKT, formatMoneyAmount } from "./formatDisplay";

describe("formatMoneyAmount", () => {
  it("formats HKD", () => {
    expect(formatMoneyAmount(12.5, "HKD")).toMatch(/12/);
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
