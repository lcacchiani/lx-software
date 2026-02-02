import { ensureFreshTokens } from './auth';
import { getApiBaseUrl } from './config';

export type ResourceName =
  | 'organizations'
  | 'locations'
  | 'activities'
  | 'pricing'
  | 'schedules';

export interface ListResponse<T> {
  items: T[];
  next_cursor?: string | null;
}

export class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function buildResourceUrl(resource: ResourceName, id?: string) {
  const base = getApiBaseUrl();
  const normalized = base.endsWith('/') ? base : `${base}/`;
  const suffix = id ? `v1/admin/${resource}/${id}` : `v1/admin/${resource}`;
  return new URL(suffix, normalized).toString();
}

async function getAuthHeader() {
  const tokens = await ensureFreshTokens();
  if (!tokens) {
    throw new ApiError('Not authenticated.', 401);
  }
  const token = tokens.idToken || tokens.accessToken;
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const authHeader = await getAuthHeader();
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeader,
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return null as T;
  }

  const raw = await response.text();
  const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  if (!response.ok) {
    const message =
      data && typeof data === 'object'
        ? (data.error as string | undefined) ||
          (data.message as string | undefined) ||
          response.statusText
        : response.statusText;
    const detail =
      data && typeof data === 'object'
        ? (data.detail as string | undefined)
        : undefined;
    throw new ApiError(message, response.status, detail);
  }
  return data as T;
}

export async function listResource<T>(
  resource: ResourceName,
  cursor?: string,
  limit = 50
) {
  const url = new URL(buildResourceUrl(resource));
  url.searchParams.set('limit', `${limit}`);
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  return request<ListResponse<T>>(url.toString());
}

export async function createResource<TInput, TOutput>(
  resource: ResourceName,
  payload: TInput
) {
  return request<TOutput>(buildResourceUrl(resource), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function updateResource<TInput, TOutput>(
  resource: ResourceName,
  id: string,
  payload: TInput
) {
  return request<TOutput>(buildResourceUrl(resource, id), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteResource(resource: ResourceName, id: string) {
  return request<void>(buildResourceUrl(resource, id), {
    method: 'DELETE',
  });
}
