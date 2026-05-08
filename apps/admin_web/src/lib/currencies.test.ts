import { describe, expect, it } from "vitest";
import {
  GLOBAL_DEFAULT_CURRENCY,
  coerceSupportedCurrency,
  isSupportedCurrency,
} from "./currencies";

describe("currencies", () => {
  it("lists HKD as global default", () => {
    expect(GLOBAL_DEFAULT_CURRENCY).toBe("HKD");
  });

  it("coerces unknown codes to fallback", () => {
    expect(coerceSupportedCurrency("JPY", "USD")).toBe("USD");
    expect(coerceSupportedCurrency("  gbp  ", "HKD")).toBe("GBP");
  });

  it("isSupportedCurrency checks the fixed list", () => {
    expect(isSupportedCurrency("CNY")).toBe(true);
    expect(isSupportedCurrency("XYZ")).toBe(false);
  });
});
