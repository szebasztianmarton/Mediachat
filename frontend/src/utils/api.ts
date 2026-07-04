import { clearAuth, getAuth } from "./auth";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface ApiOptions extends RequestInit {
  timeoutMs?: number;
}

/** Közös API kliens: JSON, session token, timeout és hibakezelés egy helyen. */
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeoutMs = 30_000, headers: extraHeaders, ...init } = options;
  const auth = getAuth();
  const headers: Record<string, string> = {
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(extraHeaders as Record<string, string> | undefined),
  };
  if (auth?.token) headers["X-Session-Token"] = auth.token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, headers, signal: init.signal ?? controller.signal });
    if (res.status === 401 && auth?.token && !path.startsWith("/api/auth/login")) {
      // Lejárt vagy visszavont session — kényszerített kijelentkezés.
      clearAuth();
      window.location.href = "/login";
      throw new ApiError("A munkamenet lejárt, jelentkezz be újra.", 401);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new ApiError(body.detail || `HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
