import { useState } from "react";
import AppShell from "../components/AppShell";
import { useLogs } from "../hooks/useLogs";
import { clearLogs } from "../utils/logger";
import type { LogLevel, LogCategory, LogEntry } from "../utils/logger";

const CATEGORIES: { value: LogCategory | "all"; label: string }[] = [
  { value: "all", label: "Mind" },
  { value: "auth", label: "Auth" },
  { value: "chat", label: "Chat" },
  { value: "service", label: "Szolgáltatás" },
  { value: "settings", label: "Beállítások" },
  { value: "users", label: "Felhasználók" },
  { value: "torrent", label: "Torrent" },
  { value: "media", label: "Média" },
  { value: "system", label: "Rendszer" },
];

const LEVELS: { value: LogLevel | "all"; label: string }[] = [
  { value: "all", label: "Mind" },
  { value: "info", label: "Info" },
  { value: "success", label: "Sikeres" },
  { value: "warning", label: "Figyelmeztetés" },
  { value: "error", label: "Hiba" },
];

const levelColors: Record<LogLevel, string> = {
  info: "log-info",
  success: "log-success",
  warning: "log-warning",
  error: "log-error",
};

const levelDot: Record<LogLevel, string> = {
  info:    "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  error:   "bg-red-500",
};

const levelLabel: Record<LogLevel, string> = {
  info: "INFO",
  success: "OK",
  warning: "WARN",
  error: "ERR",
};

const catBadge: Record<LogCategory, string> = {
  auth:     "cat-auth",
  chat:     "cat-chat",
  service:  "cat-service",
  settings: "cat-settings",
  users:    "cat-users",
  torrent:  "cat-torrent",
  media:    "cat-media",
  training: "cat-training",
  system:   "cat-system",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
  } catch { return ""; }
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => entry.detail && setExpanded((e) => !e);
  return (
    <div
      className={`rounded-md px-3 py-2 text-xs ${levelColors[entry.level]} ${entry.detail ? "cursor-pointer" : ""}`}
      onClick={toggle}
      role={entry.detail ? "button" : undefined}
      tabIndex={entry.detail ? 0 : undefined}
      aria-expanded={entry.detail ? expanded : undefined}
      onKeyDown={(e) => {
        if (entry.detail && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${levelDot[entry.level]}`} />
        <span className="shrink-0 opacity-60 font-mono leading-5 text-[11px]">
          {formatDate(entry.timestamp)} {formatTime(entry.timestamp)}
        </span>
        <span className="shrink-0 font-bold leading-5 w-8 text-center">{levelLabel[entry.level]}</span>
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold leading-4 ${catBadge[entry.category]}`}>
          {entry.category}
        </span>
        <span className="flex-1 leading-5">{entry.message}</span>
        {entry.detail && (
          <span className="shrink-0 opacity-40 text-[10px]">{expanded ? "▲" : "▼"}</span>
        )}
      </div>
      {expanded && entry.detail && (
        <pre className="mt-2 ml-8 opacity-70 font-mono whitespace-pre-wrap break-all text-[11px]">
          {entry.detail}
        </pre>
      )}
    </div>
  );
}

export default function LogsPage() {
  const allLogs = useLogs();
  const [catFilter, setCatFilter] = useState<LogCategory | "all">("all");
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = [...allLogs]
    .reverse()
    .filter((e) => catFilter === "all" || e.category === catFilter)
    .filter((e) => levelFilter === "all" || e.level === levelFilter)
    .filter(
      (e) =>
        !search ||
        e.message.toLowerCase().includes(search.toLowerCase()) ||
        (e.detail?.toLowerCase().includes(search.toLowerCase()) ?? false)
    );

  function handleClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    clearLogs();
    setConfirmClear(false);
  }

  return (
    <AppShell>
      {/* Top bar */}
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Rendszernaplók
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">{allLogs.length} bejegyzés · valós idejű frissítés</p>
        </div>
        <button
          onClick={handleClear}
          className={`btn btn-sm ${confirmClear ? "btn-danger" : "btn-secondary"}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          {confirmClear ? "Biztos?" : "Törlés"}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>

        {/* Filters */}
        <div className="card mb-5" style={{ padding: "14px 16px" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Keresés a naplókban..."
            className="input mb-3"
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {/* Category filter */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCatFilter(c.value as LogCategory | "all")}
                  className={`btn btn-sm ${catFilter === c.value ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{ width: 1, background: "#e5e7eb", alignSelf: "stretch" }} />
            {/* Level filter */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  onClick={() => setLevelFilter(l.value as LogLevel | "all")}
                  className={`btn btn-sm ${levelFilter === l.value ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Log list */}
        {filtered.length === 0 ? (
          <div className="card" style={{ padding: "48px 20px", textAlign: "center" }}>
            <p className="text-sm text-gray-400">Nincs találat</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {filtered.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          Max 500 bejegyzés · localStorage tárolt · kattints a részletekért
        </p>
      </div>
    </AppShell>
  );
}
