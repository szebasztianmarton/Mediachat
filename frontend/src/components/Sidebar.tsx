import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../utils/api";
import { clearAuth, getAuth } from "../utils/auth";
import { getTheme, setTheme, THEMES } from "../utils/theme";
import type { Theme } from "../utils/theme";

interface NavItemDef {
  label: string;
  href: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItemDef[] = [
  {
    label: "Chat",
    href: "/chat",
    icon: "M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z",
  },
  {
    label: "Ajánlások",
    href: "/recommendations",
    icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.563.563 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z",
  },
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z",
    adminOnly: true,
  },
  {
    label: "Tárhely",
    href: "/storage",
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
    adminOnly: true,
  },
  {
    label: "Naplók",
    href: "/logs",
    icon: "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z",
    adminOnly: true,
  },
  {
    label: "Felhasználók",
    href: "/users",
    icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
    adminOnly: true,
  },
  {
    label: "Tanítás",
    href: "/training",
    icon: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0118 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25",
    adminOnly: true,
  },
  {
    label: "Beállítások",
    href: "/settings",
    icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    adminOnly: true,
  },
];

// Minden szín CSS-változóból jön — a témák az index.css-ben élnek.
const sidebarColors = {
  bg:          "var(--surface)",
  border:      "1px solid var(--border)",
  divider:     "var(--border)",
  logoIconBg:  "var(--primary-bg)",
  logoIconStroke: "var(--primary-ink)",
  logoText:    "var(--ink)",
  userText:    "var(--ink)",
  userSubText: "var(--ink-3)",
  avatarBg:    "var(--primary-bg)",
  avatarText:  "var(--primary-ink)",
  actionBg:    "transparent",
  actionBorder: "var(--border)",
  actionColor: "var(--ink-3)",
  actionHoverBg:    "var(--primary-bg)",
  actionHoverColor: "var(--primary-ink)",
};

export default function Sidebar() {
  const navigate = useNavigate();
  const auth = getAuth();
  const isAdmin = auth?.role === "admin";
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function chooseTheme(next: Theme) {
    setTheme(next);
    setThemeState(next);
    setThemeMenuOpen(false);
  }

  function handleLogout() {
    // A szerveroldali session visszavonása — ha nem sikerül, akkor is kilépünk.
    api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    clearAuth();
    navigate("/login");
  }

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const c = sidebarColors;

  return (
    <aside
      style={{
        width: 240,
        minWidth: 240,
        background: c.bg,
        borderRight: c.border,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 50,
        transition: "none",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "0 16px",
          height: 56,
          borderBottom: `1px solid ${c.divider}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            background: c.logoIconBg,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="15" height="15" fill="none" stroke={c.logoIconStroke} strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3" />
          </svg>
        </div>
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: c.logoText,
            letterSpacing: "-0.02em",
            fontFamily: "'EB Garamond', Georgia, serif",
          }}
        >
          Media Assistant
        </span>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {visibleItems.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User profile + actions */}
      <div
        style={{
          borderTop: `1px solid ${c.divider}`,
          padding: "12px 12px 16px",
          flexShrink: 0,
        }}
      >
        {auth && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "6px 4px",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                background: c.avatarBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
                color: c.avatarText,
                flexShrink: 0,
                letterSpacing: 0,
              }}
            >
              {auth.username[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: c.userText,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  lineHeight: 1.35,
                }}
              >
                {auth.username}
              </div>
              <div style={{ fontSize: 11, color: c.userSubText, lineHeight: 1.3 }}>
                {auth.role === "admin" ? "Admin" : "Felhasználó"}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 6, position: "relative" }}>
          {/* Témaválasztó popover */}
          {themeMenuOpen && (
            <div
              style={{
                position: "absolute",
                bottom: 38,
                left: 0,
                width: 200,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                boxShadow: "var(--shadow-pop)",
                padding: 6,
                zIndex: 60,
              }}
              role="menu"
              aria-label="Téma választása"
            >
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  role="menuitemradio"
                  aria-checked={theme === t.id}
                  onClick={() => chooseTheme(t.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    width: "100%",
                    padding: "7px 9px",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    background: theme === t.id ? "var(--surface-3)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                    {t.label} {theme === t.id && "✓"}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.3 }}>{t.description}</span>
                </button>
              ))}
            </div>
          )}

          <SidebarActionBtn
            title="Téma választása"
            onClick={() => setThemeMenuOpen((v) => !v)}
            bg={themeMenuOpen ? c.actionHoverBg : c.actionBg}
            border={c.actionBorder}
            color={themeMenuOpen ? c.actionHoverColor : c.actionColor}
            hoverBg={c.actionHoverBg}
            hoverColor={c.actionHoverColor}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
            </svg>
          </SidebarActionBtn>

          <SidebarActionBtn
            title="Kilépés"
            onClick={handleLogout}
            bg={c.actionBg}
            border={c.actionBorder}
            color={c.actionColor}
            hoverBg={c.actionHoverBg}
            hoverColor={c.actionHoverColor}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25" />
            </svg>
          </SidebarActionBtn>
        </div>
      </div>
    </aside>
  );
}

function SidebarActionBtn({
  children, onClick, title, bg, border, color, hoverBg, hoverColor,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  bg: string;
  border: string;
  color: string;
  hoverBg: string;
  hoverColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        flex: 1,
        height: 30,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 5,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color,
        transition: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverBg;
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = bg;
        e.currentTarget.style.color = color;
      }}
    >
      {children}
    </button>
  );
}
