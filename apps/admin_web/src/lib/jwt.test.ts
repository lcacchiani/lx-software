import { describe, expect, it } from "vitest";
import { base64UrlToPaddedBase64, readIdTokenExpiryMs } from "./jwt";

describe("jwt", () => {
  it("pads base64url segments for atob", () => {
    const payload = "eyJzdWIiOiJhIiwiZXhwIjo5OTk5OTk5OTk5fQ";
    const b64 = base64UrlToPaddedBase64(payload);
    expect(b64.endsWith("=")).toBe(true);
    expect(() => JSON.parse(atob(b64))).not.toThrow();
  });

  it("reads exp from synthetic id token", () => {
    const header = btoa("{}").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const pl = btoa(JSON.stringify({ sub: "u", exp: 2_000_000_000 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tok = `${header}.${pl}.sig`;
    const ms = readIdTokenExpiryMs(tok);
    expect(ms).toBe(2_000_000_000_000);
  });
});
