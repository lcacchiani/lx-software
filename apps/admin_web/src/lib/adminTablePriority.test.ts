import { describe, expect, it } from "vitest";
import { adminColumnPriorityClass } from "./adminTablePriority";

describe("adminColumnPriorityClass", () => {
  it("keeps primary columns visible at every breakpoint", () => {
    expect(adminColumnPriorityClass("primary")).toBe("");
    expect(adminColumnPriorityClass()).toBe("");
  });

  it("marks secondary columns for hiding below md", () => {
    expect(adminColumnPriorityClass("secondary")).toBe("admin-col-secondary");
  });

  it("marks tertiary columns for hiding below lg", () => {
    expect(adminColumnPriorityClass("tertiary")).toBe("admin-col-tertiary");
  });
});
