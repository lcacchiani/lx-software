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
