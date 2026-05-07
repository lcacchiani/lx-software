import { ensureFreshTokens } from "./auth";
import { getAdminConfig } from "./config";

export class AdminApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`Admin API request failed (${status})`);
    this.name = "AdminApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

/** Join API base URL and path (exported for unit tests). */
export function joinUrl(base: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${suffix}`;
}

export type AdminFetchOptions = RequestInit & {
  /**
   * When false, do not attach Authorization (for public routes like GET /health).
   * Default true: always send the Cognito **ID token** (see HttpJwtAuthorizer
   * jwtAudience in CDK — ID token `aud` matches the app client; access tokens
   * do not).
   */
  readonly requireAuth?: boolean;
};

export async function adminFetch(
  path: string,
  init: AdminFetchOptions = {}
): Promise<Response> {
  const { requireAuth = true, ...rest } = init;
  const cfg = getAdminConfig();
  if (!cfg.apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL is not set");
  }
  const headers = new Headers(rest.headers);
  if (requireAuth) {
    const idToken = await ensureFreshTokens();
    headers.set("Authorization", `Bearer ${idToken}`);
  }
  const url = joinUrl(cfg.apiBaseUrl, path);
  if (!headers.has("Content-Type") && rest.body) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...rest, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new AdminApiError(res.status, text);
  }
  return res;
}

export async function adminFetchJson<T>(
  path: string,
  init: AdminFetchOptions = {}
): Promise<T> {
  const res = await adminFetch(path, init);
  return (await res.json()) as T;
}
