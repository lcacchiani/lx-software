import { describe, expect, it } from "vitest";
import {
  base64UrlToPaddedBase64,
  cognitoGroupsIncludeAdmin,
  decodeUserFromIdToken,
  readIdTokenExpiryMs,
} from "./jwt";

function syntheticIdToken(payload: Record<string, unknown>): string {
  const header = btoa("{}")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const pl = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${pl}.sig`;
}

describe("jwt", () => {
  it("pads base64url segments for atob", () => {
    const payload = "eyJzdWIiOiJhIiwiZXhwIjo5OTk5OTk5OTk5fQ";
    const b64 = base64UrlToPaddedBase64(payload);
    expect(b64.endsWith("=")).toBe(true);
    expect(() => JSON.parse(atob(b64))).not.toThrow();
  });

  it("reads exp from synthetic id token", () => {
    const ms = readIdTokenExpiryMs(syntheticIdToken({ sub: "u", exp: 2_000_000_000 }));
    expect(ms).toBe(2_000_000_000_000);
  });

  it("reads email and auth_time as last login", () => {
    const authTime = Date.parse("2026-09-04T14:12:00.000Z") / 1000;
    const user = decodeUserFromIdToken(
      syntheticIdToken({
        sub: "u-1",
        email: "ada@example.com",
        auth_time: authTime,
        iat: authTime + 100,
      })
    );
    expect(user).toEqual({
      sub: "u-1",
      email: "ada@example.com",
      lastLoginAt: "2026-09-04T14:12:00.000Z",
    });
  });

  it("falls back to iat when auth_time is missing", () => {
    const iat = Date.parse("2026-09-04T14:12:00.000Z") / 1000;
    const user = decodeUserFromIdToken(syntheticIdToken({ sub: "u-1", iat }));
    expect(user?.lastLoginAt).toBe("2026-09-04T14:12:00.000Z");
    expect(user?.email).toBeUndefined();
  });

  it("returns null when sub is missing", () => {
    expect(
      decodeUserFromIdToken(syntheticIdToken({ email: "ada@example.com" }))
    ).toBeNull();
  });

  it("matches backend admin group parsing", () => {
    expect(cognitoGroupsIncludeAdmin({ "cognito:groups": "admin" })).toBe(true);
    expect(
      cognitoGroupsIncludeAdmin({ "cognito:groups": "viewer,admin" })
    ).toBe(true);
    expect(cognitoGroupsIncludeAdmin({ "cognito:groups": ["admin"] })).toBe(
      true
    );
    expect(cognitoGroupsIncludeAdmin({ "cognito:groups": "viewer" })).toBe(
      false
    );
    expect(cognitoGroupsIncludeAdmin({})).toBe(false);
  });
});
