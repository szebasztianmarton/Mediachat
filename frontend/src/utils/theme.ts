const THEME_KEY = "mediachat-theme";

export type Theme = "light" | "dark" | "threed" | "modern";

export const THEMES: { id: Theme; label: string; description: string }[] = [
  { id: "light", label: "E-ink", description: "Papírfehér, monokróm, azonnali — reMarkable stílus" },
  { id: "dark", label: "Sötét", description: "Mély sötét, magas kontraszt, e-ink karakterrel" },
  { id: "threed", label: "3D", description: "Lágy árnyékok, mélység, kék akcentus" },
  { id: "modern", label: "Modern", description: "Sötét indigó, Linear-stílusú felület" },
];

const VALID = new Set<string>(THEMES.map((t) => t.id));

function systemPreference(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored && VALID.has(stored)) return stored as Theme;
  } catch {}
  return systemPreference();
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

export function toggleTheme(): Theme {
  // Ciklikus váltás a témák között (a sidebar gyorsgombja használja)
  const order = THEMES.map((t) => t.id);
  const next = order[(order.indexOf(getTheme()) + 1) % order.length];
  setTheme(next);
  return next;
}

export function applyStoredTheme(): void {
  setTheme(getTheme());
}
