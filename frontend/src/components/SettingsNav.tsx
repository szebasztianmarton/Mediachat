import { NavLink } from "react-router-dom";

// A Beállítások szekció almenüje — a Szolgáltatások, Tanítás és Felhasználók
// oldalak közös fejléce, hogy egy összefüggő szekciónak érződjenek.
const TABS = [
  { label: "Szolgáltatások", href: "/settings" },
  { label: "Értesítések", href: "/settings/notifications" },
  { label: "Biztonsági mentés", href: "/settings/backup" },
  { label: "Tanítás", href: "/training" },
  { label: "Felhasználók", href: "/users" },
];

export default function SettingsNav() {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "0 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.href}
          to={tab.href}
          end={tab.href === "/settings"}
          className={({ isActive }) => (isActive ? "settings-tab settings-tab--active" : "settings-tab")}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
