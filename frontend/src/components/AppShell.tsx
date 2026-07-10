import { useState } from "react";
import type { ReactNode } from "react";
import Sidebar, { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "./Sidebar";

interface Props {
  children: ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = "mediachat-sidebar-collapsed";

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function AppShell({ children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(getStoredCollapsed);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar
        open={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      {/* Mobil overlay a nyitott sidebar mögött */}
      {mobileOpen && (
        <button
          className="app-overlay mobile-only"
          aria-label="Menü bezárása"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobil hamburger gomb (fix, bal felül) — CSAK zárt állapotban látszik,
          hogy ne fedje a nyitott sidebar fejlécét. Nyitva a sidebar saját
          bezáró (X) gombja veszi át a szerepét, lásd Sidebar.tsx onClose. */}
      {!mobileOpen && (
        <button
          className="mobile-only"
          aria-label="Menü megnyitása"
          aria-expanded={false}
          onClick={() => setMobileOpen(true)}
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 55,
            width: 40,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "var(--shadow-pop)",
            cursor: "pointer",
            color: "var(--ink)",
          }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      )}

      <div
        className="app-content"
        style={{
          marginLeft: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
          transition: "margin-left 0.18s ease",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
