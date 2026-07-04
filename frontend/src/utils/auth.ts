import { AUTH_KEY } from "../types";
import type { AuthData } from "../types";

export function getAuth(): AuthData | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as AuthData;
    if (!data.token || !data.userId || !data.username || !data.role) return null;
    return data;
  } catch {
    return null;
  }
}

export function setAuth(data: AuthData): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(data));
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_KEY);
}
