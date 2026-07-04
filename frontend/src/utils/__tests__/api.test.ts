import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// localStorage + window stub (node környezetben nincs)
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
});
const fakeWindow = { location: { href: "" } };
vi.stubGlobal("window", fakeWindow);

import { api, ApiError } from "../api";
import { setAuth } from "../auth";

const VALID = { token: "t0k3n", userId: "u1", username: "admin", role: "admin" as const };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api kliens", () => {
  beforeEach(() => {
    store.clear();
    fakeWindow.location.href = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // a localStorage/window stubokat visszaállítjuk a következő testhez
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
    vi.stubGlobal("window", fakeWindow);
  });

  it("sikeres válasznál a JSON-t adja vissza", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    await expect(api("/api/x")).resolves.toEqual({ ok: true });
  });

  it("token headerrel hív, ha van auth", async () => {
    setAuth(VALID);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/x");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Session-Token"]).toBe("t0k3n");
  });

  it("hibás státusznál ApiError-t dob a detail üzenettel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "Nincs jogosultság." }, 403)));
    const err = (await api("/api/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe("Nincs jogosultság.");
  });

  it("401-nél tokennel: törli az auth-ot és átirányít a loginra", async () => {
    setAuth(VALID);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(api("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(store.size).toBe(0); // clearAuth lefutott
    expect(fakeWindow.location.href).toBe("/login");
  });

  it("401-nél token nélkül: nem irányít át (pl. rossz jelszavas login)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "Hibás jelszó" }, 401)));
    await expect(api("/api/auth/login", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(ApiError);
    expect(fakeWindow.location.href).toBe("");
  });

  it("JSON body-nál Content-Type headert állít", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
