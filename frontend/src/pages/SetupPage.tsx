import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth } from "../utils/auth";
import { getTheme, setTheme, THEMES } from "../utils/theme";
import type { Theme } from "../utils/theme";

export function setupDoneKey(userId: string): string {
  return `mediachat-setup-${userId}`;
}

// Mini téma-előnézet: bg + kártya + gomb sáv az adott téma színeivel
const PREVIEW: Record<Theme, { bg: string; card: string; border: string; ink: string; accent: string }> = {
  light:  { bg: "#F9F9F9", card: "#FFFFFF", border: "#E0E0E0", ink: "#000000", accent: "#000000" },
  dark:   { bg: "#141414", card: "#1E1E1E", border: "#2E2E2E", ink: "#F0F0F0", accent: "#F0F0F0" },
  threed: { bg: "#E9EDF3", card: "#FFFFFF", border: "#E3E8F0", ink: "#1A2233", accent: "#4F6BED" },
  modern: { bg: "#0F1117", card: "#171A23", border: "#262B38", ink: "#EDEEF2", accent: "#6E7CFF" },
};

function ThemePreview({ themeId }: { themeId: Theme }) {
  const p = PREVIEW[themeId];
  return (
    <div
      className="theme-swatch"
      style={{ background: p.bg, borderColor: p.border, padding: 10, gap: 6, height: 96 }}
      aria-hidden="true"
    >
      <div
        style={{
          background: p.card,
          border: `1px solid ${p.border}`,
          borderRadius: themeId === "threed" ? 10 : 4,
          boxShadow: themeId === "threed" ? "0 4px 10px rgba(26,34,51,0.12)" : "none",
          padding: "6px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ height: 6, width: "55%", background: p.ink, opacity: 0.85, borderRadius: 2 }} />
        <div style={{ height: 4, width: "80%", background: p.ink, opacity: 0.3, borderRadius: 2 }} />
        <div style={{ height: 4, width: "65%", background: p.ink, opacity: 0.3, borderRadius: 2 }} />
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: "auto" }}>
        <div style={{ height: 12, width: 34, background: p.accent, borderRadius: themeId === "threed" ? 6 : 2 }} />
        <div style={{ height: 12, width: 34, background: "transparent", border: `1px solid ${p.border}`, borderRadius: themeId === "threed" ? 6 : 2 }} />
      </div>
    </div>
  );
}

export default function SetupPage() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [selected, setSelected] = useState<Theme>(getTheme);

  function choose(theme: Theme) {
    setSelected(theme);
    setTheme(theme); // azonnali élő előnézet az egész felületen
  }

  function finish() {
    if (auth) {
      try { localStorage.setItem(setupDoneKey(auth.userId), "1"); } catch {}
    }
    navigate(auth?.role === "admin" ? "/dashboard" : "/chat", { replace: true });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 620 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 600,
            color: "var(--ink)",
            margin: "0 0 6px",
            textAlign: "center",
          }}
        >
          Üdv, {auth?.username ?? "felhasználó"}!
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)", textAlign: "center", margin: "0 0 28px" }}>
          Válaszd ki, hogyan nézzen ki a Media Assistant. Később bármikor átválthatsz a bal alsó téma-gombbal.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => choose(t.id)}
              aria-pressed={selected === t.id}
              className="card"
              style={{
                padding: 12,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                borderColor: selected === t.id ? "var(--primary-border)" : "var(--border)",
                borderWidth: selected === t.id ? 2 : 1,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <ThemePreview themeId={t.id} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{t.label}</span>
                  {selected === t.id && (
                    <svg className="w-4 h-4" fill="none" stroke="var(--ok)" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </div>
                <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "2px 0 0", lineHeight: 1.4 }}>
                  {t.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
          <button onClick={finish} className="btn btn-primary btn-lg">
            Kezdés ezzel a témával
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
