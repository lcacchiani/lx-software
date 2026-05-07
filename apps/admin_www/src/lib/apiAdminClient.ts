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

function joinUrl(base: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${suffix}`;
}

export async function adminFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const cfg = getAdminConfig();
  if (!cfg.apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL is not set");
  }
  const idToken = await ensureFreshTokens();
  const url = joinUrl(cfg.apiBaseUrl, path);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${idToken}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new AdminApiError(res.status, text);
  }
  return res;
}

export async function adminFetchJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await adminFetch(path, init);
  return (await res.json()) as T;
}
