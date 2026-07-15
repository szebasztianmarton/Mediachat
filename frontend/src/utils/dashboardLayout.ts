// Az adaptív dashboard elrendezése: mely widgetek, milyen sorrendben és
// méretben. Felhasználónként localStorage-ban tárolva (mint a téma és a
// sidebar-állapot) — nem kell hozzá backend.

export type WidgetSize = "full" | "half";

export interface WidgetInstance {
  id: string;
  size: WidgetSize;
}

// A regisztrált widgetek azonosítói. A metaadat (cím, leírás, render) a
// DashboardPage WIDGETS regiszterében él — ez itt csak a perzisztencia.
export const WIDGET_IDS = [
  "status",
  "services",
  "now-playing",
  "torrents",
  "storage",
  "library",
  "watchers",
  "quick-actions",
  "system-info",
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export const DEFAULT_LAYOUT: WidgetInstance[] = [
  { id: "status", size: "full" },
  { id: "services", size: "full" },
  { id: "now-playing", size: "half" },
  { id: "torrents", size: "half" },
  { id: "storage", size: "full" },
  { id: "library", size: "full" },
  { id: "watchers", size: "full" },
  { id: "quick-actions", size: "full" },
  { id: "system-info", size: "full" },
];

const KEY = (userId: string) => `mediachat-dashboard-${userId}`;

function isValidId(id: string): id is WidgetId {
  return (WIDGET_IDS as readonly string[]).includes(id);
}

export function loadLayout(userId: string): WidgetInstance[] {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return [...DEFAULT_LAYOUT];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_LAYOUT];
    // Csak ismert id-kat és érvényes méretet fogadunk el — a regiszter
    // változásakor (törölt widget) a mentés így nem tör el.
    const seen = new Set<string>();
    const clean: WidgetInstance[] = [];
    for (const item of parsed) {
      if (
        item && typeof item === "object" &&
        typeof (item as WidgetInstance).id === "string" &&
        isValidId((item as WidgetInstance).id) &&
        !seen.has((item as WidgetInstance).id)
      ) {
        const size: WidgetSize = (item as WidgetInstance).size === "half" ? "half" : "full";
        clean.push({ id: (item as WidgetInstance).id, size });
        seen.add((item as WidgetInstance).id);
      }
    }
    return clean;
  } catch {
    return [...DEFAULT_LAYOUT];
  }
}

export function saveLayout(userId: string, layout: WidgetInstance[]): void {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(layout));
  } catch {
    /* quota / private mode — némán elnyeljük */
  }
}

export function resetLayout(userId: string): WidgetInstance[] {
  try {
    localStorage.removeItem(KEY(userId));
  } catch { /* ignore */ }
  return [...DEFAULT_LAYOUT];
}
