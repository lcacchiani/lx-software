import { describe, expect, it } from "vitest";
import { bankAccountLabel } from "./bankSyncModel";

describe("bankAccountLabel", () => {
  it("joins name and identifier", () => {
    expect(
      bankAccountLabel({
        uid: "u1",
        name: "Current Account",
        identifier: "GB33BUKB20201555555555",
      }),
    ).toBe("Current Account · GB33BUKB20201555555555");
  });

  it("falls back to product when name is missing", () => {
    expect(bankAccountLabel({ uid: "u1", product: "Savings" })).toBe("Savings");
  });

  it("falls back to uid when nothing else is present", () => {
    expect(bankAccountLabel({ uid: "u1" })).toBe("u1");
  });
});
