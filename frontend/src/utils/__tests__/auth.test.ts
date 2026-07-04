import { beforeEach, describe, expect, it, vi } from "vitest";

// localStorage stub (node környezetben nincs)
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
});

import { getAuth, setAuth, clearAuth } from "../auth";
import { AUTH_KEY } from "../../types";

const VALID = { token: "t0k3n", userId: "u1", username: "admin", role: "admin" as const };

describe("auth util", () => {
  beforeEach(() => store.clear());

  it("setAuth → getAuth visszaadja ugyanazt", () => {
    setAuth(VALID);
    expect(getAuth()).toEqual(VALID);
  });

  it("üres tárolónál null", () => {
    expect(getAuth()).toBeNull();
  });

  it("hibás JSON-nál null (nem dob)", () => {
    store.set(AUTH_KEY, "{nem json");
    expect(getAuth()).toBeNull();
  });

  it("hiányzó token mezőnél null (régi formátum kizárva)", () => {
    store.set(AUTH_KEY, JSON.stringify({ userId: "u1", username: "admin", role: "admin" }));
    expect(getAuth()).toBeNull();
  });

  it("clearAuth törli az adatot", () => {
    setAuth(VALID);
    clearAuth();
    expect(getAuth()).toBeNull();
  });
});
