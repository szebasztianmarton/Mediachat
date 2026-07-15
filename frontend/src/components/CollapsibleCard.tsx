import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface FilterChip {
  key: string;
  label: string;
}

interface Props {
  title: string;
  iconPath?: string;
  /** Jobb oldali badge (pl. állapot vagy darabszám). */
  badge?: ReactNode;
  /** Cím után megjelenő halvány darabszám. */
  count?: number;
  /** Ha megadod, az összecsukott állapot ezen a kulcson perzisztálódik. */
  storageKey?: string;
  defaultCollapsed?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Állapot-szűrő pöttyök; az első az alapértelmezett (pl. „Mind"). */
  chips?: FilterChip[];
  bodyStyle?: CSSProperties;
  className?: string;
  /** A törzs render-propja — az aktuális keresőszót és a kiválasztott chip-et kapja. */
  children: (query: string, chip: string) => ReactNode;
}

function readCollapsed(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback;
  try {
    const v = localStorage.getItem(`mediachat-collapsed-${storageKey}`);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch { /* ignore */ }
  return fallback;
}

export default function CollapsibleCard({
  title,
  iconPath,
  badge,
  count,
  storageKey,
  defaultCollapsed = false,
  searchable = false,
  searchPlaceholder = "Szűrés…",
  chips,
  bodyStyle,
  className,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed(storageKey, defaultCollapsed));
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<string>(chips?.[0]?.key ?? "");

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      if (storageKey) {
        try { localStorage.setItem(`mediachat-collapsed-${storageKey}`, next ? "1" : "0"); } catch { /* ignore */ }
      }
      return next;
    });
  }

  const hasToolbar = !collapsed && (searchable || (chips && chips.length > 0));

  return (
    <div className={`card overflow-hidden${className ? ` ${className}` : ""}`}>
      <div className="card-header">
        <div className="flex items-center gap-2.5" style={{ minWidth: 0 }}>
          {iconPath && (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)" }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--ink)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
              </svg>
            </div>
          )}
          <h2 className="text-sm font-semibold text-gray-900 truncate" style={{ letterSpacing: "-0.01em" }}>
            {title}
          </h2>
          {count !== undefined && <span className="text-xs text-gray-400 shrink-0">{count}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge}
          <button
            type="button"
            className="collapse-btn"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `${title} kinyitása` : `${title} összecsukása`}
            title={collapsed ? "Kinyitás" : "Összecsukás"}
          >
            <svg
              className={`w-4 h-4 collapse-chevron${collapsed ? " collapse-chevron--collapsed" : ""}`}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      </div>

      {hasToolbar && (
        <div className="list-toolbar">
          {searchable && (
            <div className="list-search">
              <svg className="list-search__icon w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0016.803 15.803z" />
              </svg>
              <input
                type="text"
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </div>
          )}
          {chips && chips.length > 0 && (
            <div className="flex items-center gap-1.5" style={{ flexWrap: "wrap" }}>
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`chip${chip === c.key ? " chip--active" : ""}`}
                  onClick={() => setChip(c.key)}
                  aria-pressed={chip === c.key}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!collapsed && <div style={bodyStyle}>{children(query.trim().toLowerCase(), chip)}</div>}
    </div>
  );
}
