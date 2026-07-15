import { beforeEach, describe, expect, it, vi } from "vitest";

// localStorage stub (node környezetben nincs)
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
});

import { loadLayout, saveLayout, resetLayout, DEFAULT_LAYOUT } from "../dashboardLayout";

const UID = "u1";

describe("dashboardLayout", () => {
  beforeEach(() => store.clear());

  it("üres tárolónál az alapértelmezett elrendezést adja", () => {
    expect(loadLayout(UID)).toEqual(DEFAULT_LAYOUT);
  });

  it("save → load körbejár", () => {
    const layout = [
      { id: "status" as const, size: "full" as const },
      { id: "torrents" as const, size: "half" as const },
    ];
    saveLayout(UID, layout);
    expect(loadLayout(UID)).toEqual(layout);
  });

  it("felhasználónként külön tárol", () => {
    saveLayout("a", [{ id: "status", size: "full" }]);
    saveLayout("b", [{ id: "services", size: "full" }]);
    expect(loadLayout("a")).toEqual([{ id: "status", size: "full" }]);
    expect(loadLayout("b")).toEqual([{ id: "services", size: "full" }]);
  });

  it("ismeretlen widget-id-ket kiszűr (regiszter-változás után nem tör el)", () => {
    store.set(`mediachat-dashboard-${UID}`, JSON.stringify([
      { id: "status", size: "full" },
      { id: "torolt-widget", size: "full" },
      { id: "torrents", size: "half" },
    ]));
    expect(loadLayout(UID)).toEqual([
      { id: "status", size: "full" },
      { id: "torrents", size: "half" },
    ]);
  });

  it("duplikált id-t csak egyszer tart meg", () => {
    store.set(`mediachat-dashboard-${UID}`, JSON.stringify([
      { id: "status", size: "full" },
      { id: "status", size: "half" },
    ]));
    expect(loadLayout(UID)).toEqual([{ id: "status", size: "full" }]);
  });

  it("érvénytelen méretet full-ra normalizál", () => {
    store.set(`mediachat-dashboard-${UID}`, JSON.stringify([
      { id: "status", size: "óriási" },
    ]));
    expect(loadLayout(UID)).toEqual([{ id: "status", size: "full" }]);
  });

  it("hibás JSON-nál az alapértelmezettre esik vissza (nem dob)", () => {
    store.set(`mediachat-dashboard-${UID}`, "{nem json");
    expect(loadLayout(UID)).toEqual(DEFAULT_LAYOUT);
  });

  it("nem-tömb JSON-nál az alapértelmezettre esik vissza", () => {
    store.set(`mediachat-dashboard-${UID}`, JSON.stringify({ foo: "bar" }));
    expect(loadLayout(UID)).toEqual(DEFAULT_LAYOUT);
  });

  it("resetLayout törli a mentést és az alapértelmezettet adja", () => {
    saveLayout(UID, [{ id: "status", size: "full" }]);
    expect(resetLayout(UID)).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout(UID)).toEqual(DEFAULT_LAYOUT);
  });
});
