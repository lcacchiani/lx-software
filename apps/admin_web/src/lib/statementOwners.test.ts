import { describe, expect, it } from "vitest";
import { houseDisplayLabel } from "./houses";
import {
  isHouseKey,
  isStatementBookKey,
  parseStatementJobPath,
  parseStatementStartPath,
  statementOwnerQueryKey,
  financeOwnerDisplayLabel,
  SIU_TIN_DEI_BOOK_KEY,
} from "./statementOwners";

describe("statementOwners", () => {
  it("classifies house and book keys", () => {
    expect(isHouseKey("hillmarton")).toBe(true);
    expect(isHouseKey("siuTinDei")).toBe(false);
    expect(isStatementBookKey("siuTinDei")).toBe(true);
    expect(isStatementBookKey("morrison")).toBe(false);
  });

  it("builds parse paths for houses and the Siu Tin Dei book", () => {
    expect(parseStatementStartPath("hillmarton")).toBe(
      "/finance/hillmarton/parse-statement",
    );
    expect(parseStatementStartPath(SIU_TIN_DEI_BOOK_KEY)).toBe(
      "/siu-tin-dei/parse-statement",
    );
    expect(parseStatementJobPath(SIU_TIN_DEI_BOOK_KEY, "abc 1")).toBe(
      "/siu-tin-dei/parse-statement/jobs/abc%201",
    );
  });

  it("uses a separate query key for the statement book", () => {
    expect(statementOwnerQueryKey("morrison")).toEqual(["finance"]);
    expect(statementOwnerQueryKey(SIU_TIN_DEI_BOOK_KEY)).toEqual(["siuTinDei"]);
  });

  it("labels the book for asset lists", () => {
    expect(financeOwnerDisplayLabel("siuTinDei")).toBe("Siu Tin Dei");
    expect(financeOwnerDisplayLabel("")).toBe("—");
    expect(houseDisplayLabel("siuTinDei")).toBe("Siu Tin Dei");
  });
});
