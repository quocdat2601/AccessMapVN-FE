"use client";

import { getApiBaseUrl } from "@/shared/config/runtime";
import { createBrowserSupabaseClient } from "@/shared/lib/supabase/client";

export interface ApiProblemDetails {
  code?: string;
  message?: string;
  correlationId?: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly details?: unknown;

  constructor(status: number, problem: ApiProblemDetails = {}) {
    super(problem.message || `Yêu cầu thất bại (${status}).`);
    this.name = "ApiError";
    this.status = status;
    this.code = problem.code;
    this.correlationId = problem.correlationId;
    this.details = problem.details;
  }

  get isConcurrencyConflict() {
    return (
      this.status === 409 ||
      this.status === 412 ||
      this.code === "CONCURRENCY_CONFLICT" ||
      this.code === "STALE_VERSION"
    );
  }
}

export interface ApiResponse<T> {
  data: T;
  etag?: string;
}

interface ApiRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  etag?: string;
  idempotencyKey?: string;
  headers?: HeadersInit;
}

const PORTAL_AUTH_STORAGE_KEY = "accessmap_admin_portal_auth";

export interface StoredPortalAuth {
  accessToken: string;
  csrfToken?: string;
  sessionId?: string;
}

export function getStoredPortalAuth(): StoredPortalAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PORTAL_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPortalAuth;
    return parsed?.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export function setStoredPortalAuth(auth: StoredPortalAuth | null) {
  if (typeof window === "undefined") return;
  try {
    if (!auth) {
      window.sessionStorage.removeItem(PORTAL_AUTH_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(PORTAL_AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // Ignore sessionStorage restrictions
  }
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

async function parsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    return response.json().catch(() => undefined);
  }

  const text = await response.text();
  return text || undefined;
}

function toProblem(payload: unknown): ApiProblemDetails {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" ? { message: payload } : {};
  }

  const value = payload as Record<string, unknown>;
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message:
      typeof value.message === "string"
        ? value.message
        : typeof value.title === "string"
          ? value.title
          : undefined,
    correlationId:
      typeof value.correlationId === "string" ? value.correlationId : undefined,
    details: value.details ?? value.errors,
  };
}

let portalRefreshPromise: Promise<StoredPortalAuth | null> | null = null;

async function fetchPortalCsrfToken(apiBaseUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/admin/auth/csrf`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const data = (await res.json().catch(() => undefined)) as { csrfToken?: string } | undefined;
    return data?.csrfToken;
  } catch {
    return undefined;
  }
}

export async function refreshPortalAuth(): Promise<StoredPortalAuth | null> {
  if (typeof window === "undefined") return null;
  if (portalRefreshPromise) return portalRefreshPromise;

  portalRefreshPromise = (async () => {
    try {
      const apiBaseUrl = getApiBaseUrl();
      if (!apiBaseUrl) return null;

      const stored = getStoredPortalAuth();
      let csrfToken = stored?.csrfToken;
      if (!csrfToken) {
        csrfToken = await fetchPortalCsrfToken(apiBaseUrl);
      }
      if (!csrfToken) return null;

      const response = await fetch(`${apiBaseUrl}/api/v1/admin/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        credentials: "include",
        body: "{}",
        cache: "no-store",
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setStoredPortalAuth(null);
        }
        return null;
      }

      const data = (await response.json().catch(() => undefined)) as
        | { accessToken?: string; csrfToken?: string; sessionId?: string }
        | undefined;
      if (!data?.accessToken) return null;

      const nextAuth: StoredPortalAuth = {
        accessToken: data.accessToken,
        csrfToken: data.csrfToken ?? csrfToken,
        sessionId: data.sessionId ?? stored?.sessionId,
      };
      setStoredPortalAuth(nextAuth);
      return nextAuth;
    } catch {
      return null;
    } finally {
      portalRefreshPromise = null;
    }
  })();

  return portalRefreshPromise;
}

export async function logoutPortalSession(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl) return;

    let portalAuth = getStoredPortalAuth();
    if (!portalAuth?.accessToken) {
      portalAuth = await refreshPortalAuth();
    }
    if (!portalAuth?.accessToken) return;

    let csrfToken = portalAuth.csrfToken;
    if (!csrfToken) {
      csrfToken = await fetchPortalCsrfToken(apiBaseUrl);
    }
    if (!csrfToken) return;

    await fetch(`${apiBaseUrl}/api/v1/admin/auth/logout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${portalAuth.accessToken}`,
        "X-CSRF-TOKEN": csrfToken,
      },
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    // Best-effort portal session revocation before clearing local tokens.
  } finally {
    setStoredPortalAuth(null);
  }
}

function buildApiHeaders(
  options: ApiRequestOptions,
  bearerToken: string,
  csrfToken?: string,
): Headers {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${bearerToken}`);
  if (csrfToken) headers.set("X-CSRF-TOKEN", csrfToken);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.etag) headers.set("If-Match", options.etag);
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  } else if (
    (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE") &&
    !headers.has("Idempotency-Key")
  ) {
    headers.set("Idempotency-Key", crypto.randomUUID());
  }
  return headers;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    throw new ApiError(0, {
      code: "API_NOT_CONFIGURED",
      message: "Chưa cấu hình NEXT_PUBLIC_API_BASE_URL.",
    });
  }

  let portalAuth = getStoredPortalAuth();
  if (!portalAuth?.accessToken) {
    portalAuth = await refreshPortalAuth();
  }
  let bearerToken = portalAuth?.accessToken;

  if (!bearerToken) {
    const supabase = createBrowserSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session?.access_token) {
      bearerToken = data.session.access_token;
    }
  }

  if (!bearerToken) {
    throw new ApiError(401, {
      code: "AUTHENTICATION_REQUIRED",
      message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    });
  }

  const targetUrl = `${apiBaseUrl}${normalizePath(path)}`;
  const serializedBody =
    options.body === undefined ? undefined : JSON.stringify(options.body);

  let response = await fetch(targetUrl, {
    ...options,
    headers: buildApiHeaders(options, bearerToken, portalAuth?.csrfToken),
    credentials: portalAuth ? "include" : options.credentials,
    body: serializedBody,
    cache: "no-store",
  });

  if (response.status === 401 && portalAuth?.accessToken) {
    const refreshed = await refreshPortalAuth();
    if (refreshed?.accessToken) {
      response = await fetch(targetUrl, {
        ...options,
        headers: buildApiHeaders(options, refreshed.accessToken, refreshed.csrfToken),
        credentials: "include",
        body: serializedBody,
        cache: "no-store",
      });
    }
  }

  const payload = await parsePayload(response);

  if (!response.ok) throw new ApiError(response.status, toProblem(payload));

  return {
    data: payload as T,
    etag: response.headers.get("etag") ?? undefined,
  };
}
