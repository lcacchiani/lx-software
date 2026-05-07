import { describe, expect, it } from "vitest";
import { joinUrl } from "./apiAdminClient";

describe("apiAdminClient joinUrl", () => {
  it("joins base and path", () => {
    expect(joinUrl("https://api.example", "/me")).toBe("https://api.example/me");
    expect(joinUrl("https://api.example/", "me")).toBe("https://api.example/me");
  });

  it("passes through absolute URLs", () => {
    expect(joinUrl("https://x", "https://y/z")).toBe("https://y/z");
  });
});
