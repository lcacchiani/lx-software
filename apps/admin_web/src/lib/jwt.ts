/** Base64url JWT segment → padded standard base64 for atob(). */
export function base64UrlToPaddedBase64(segment: string): string {
  const pad = "=".repeat((4 - (segment.length % 4)) % 4);
  return (segment + pad).replace(/-/g, "+").replace(/_/g, "/");
}

export function decodeJwtPayload<T extends Record<string, unknown>>(
  jwt: string
): T {
  const [, payload] = jwt.split(".");
  if (!payload) {
    throw new Error("Invalid JWT: missing payload");
  }
  const json = atob(base64UrlToPaddedBase64(payload));
  return JSON.parse(json) as T;
}

export function readIdTokenExpiryMs(idToken: string): number | null {
  try {
    const json = decodeJwtPayload<{ exp?: number }>(idToken);
    if (!json.exp) {
      return null;
    }
    return json.exp * 1000;
  } catch {
    return null;
  }
}

export type IdTokenUser = {
  readonly sub: string;
  readonly email?: string;
  /** ISO instant of Cognito `auth_time`, falling back to `iat`. */
  readonly lastLoginAt?: string;
};

function unixSecondsToIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const d = new Date(value * 1000);
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  return d.toISOString();
}

/** Reads identity claims used by the admin chrome (email + last login). */
export function decodeUserFromIdToken(idToken: string): IdTokenUser | null {
  try {
    const json = decodeJwtPayload<{
      sub?: string;
      email?: string;
      auth_time?: number;
      iat?: number;
    }>(idToken);
    if (!json.sub) {
      return null;
    }
    const lastLoginAt =
      unixSecondsToIso(json.auth_time) ?? unixSecondsToIso(json.iat);
    return {
      sub: json.sub,
      ...(json.email ? { email: json.email } : {}),
      ...(lastLoginAt ? { lastLoginAt } : {}),
    };
  } catch {
    return null;
  }
}

/** Matches `backend/lambda/admin/handler.py` `_groups_include_admin`. */
const ADMIN_GROUP = "admin";

export function cognitoGroupsIncludeAdmin(
  claims: Record<string, unknown>
): boolean {
  const raw = claims["cognito:groups"];
  if (raw == null) {
    return false;
  }
  if (Array.isArray(raw)) {
    return raw.includes(ADMIN_GROUP);
  }
  const parts = String(raw)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.includes(ADMIN_GROUP);
}

/** True when the ID token includes the Cognito `admin` group (claims or override). */
export function idTokenHasAdminAccess(idToken: string): boolean {
  try {
    const claims = decodeJwtPayload<Record<string, unknown>>(idToken);
    return cognitoGroupsIncludeAdmin(claims);
  } catch {
    return false;
  }
}
