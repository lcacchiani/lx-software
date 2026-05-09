import { describe, expect, it } from "vitest";
import { convertAmountToBase } from "./frankfurterRates";

describe("convertAmountToBase", () => {
  it("returns amount unchanged when currencies match", () => {
    expect(convertAmountToBase(42, "HKD", "HKD", new Map())).toBe(42);
  });

  it("divides by Frankfurter rate (1 base = rate quote)", () => {
    // 1 HKD = 0.12754 USD → 100 USD → 100 / 0.12754 HKD
    const rateByQuote = new Map([["USD", 0.12754]]);
    const hkd = convertAmountToBase(100, "USD", "HKD", rateByQuote);
    expect(hkd).toBeCloseTo(100 / 0.12754, 2);
  });
});
