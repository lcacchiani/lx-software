import { describe, expect, it } from "vitest";
import { adminTabButtonId, nextTabIdForKey } from "./adminTabs";

describe("adminTabButtonId", () => {
  it("joins the prefix and tab id", () => {
    expect(adminTabButtonId("finance", "accounts")).toBe("finance-tab-accounts");
  });
});

describe("nextTabIdForKey", () => {
  const ids = ["a", "b", "c"] as const;

  it("wraps right and left", () => {
    expect(nextTabIdForKey("ArrowRight", ids, "c")).toBe("a");
    expect(nextTabIdForKey("ArrowLeft", ids, "a")).toBe("c");
  });

  it("treats ArrowDown/Up like right/left", () => {
    expect(nextTabIdForKey("ArrowDown", ids, "a")).toBe("b");
    expect(nextTabIdForKey("ArrowUp", ids, "b")).toBe("a");
  });

  it("jumps to the ends", () => {
    expect(nextTabIdForKey("Home", ids, "c")).toBe("a");
    expect(nextTabIdForKey("End", ids, "a")).toBe("c");
  });

  it("ignores unrelated keys", () => {
    expect(nextTabIdForKey("Enter", ids, "a")).toBeNull();
  });
});
