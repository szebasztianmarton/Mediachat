import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import SettingsNav from "../components/SettingsNav";
import type { AppSettings } from "../types";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../types";
import { api, ApiError } from "../utils/api";
import { clearAuth } from "../utils/auth";
import { useToast } from "../components/Toast";
import { logger } from "../utils/logger";

interface BackupEntry {
  file: string;
  size_bytes: number;
  mtime: number;
}

// Frontend mező ↔ backend config kulcs megfeleltetés. Ezek mentéskor a
// szerverre kerülnek (/api/config) és azonnal érvénybe lépnek.
const CONFIG_FIELD_MAP: Array<{ field: keyof AppSettings; key: string; secret: boolean }> = [
  { field: "sonarrUrl", key: "sonarr_url", secret: false },
  { field: "sonarrApiKey", key: "sonarr_api_key", secret: true },
  { field: "radarrUrl", key: "radarr_url", secret: false },
  { field: "radarrApiKey", key: "radarr_api_key", secret: true },
  { field: "ollamaUrl", key: "ollama_base_url", secret: false },
  { field: "ollamaModel", key: "ollama_model", secret: false },
  { field: "tmdbApiKey", key: "tmdb_api_key", secret: true },
  { field: "torrentClient", key: "torrent_client", secret: false },
  { field: "torrentUrl", key: "torrent_url", secret: false },
  { field: "torrentUsername", key: "torrent_username", secret: false },
  { field: "torrentPassword", key: "torrent_password", secret: true },
  { field: "torrentAutoDeleteHours", key: "torrent_auto_delete_hours", secret: false },
  { field: "plexUrl", key: "plex_url", secret: false },
  { field: "plexToken", key: "plex_token", secret: true },
  { field: "jellyfinUrl", key: "jellyfin_url", secret: false },
  { field: "jellyfinApiKey", key: "jellyfin_api_key", secret: true },
  { field: "webhookSecret", key: "webhook_secret", secret: false },
  { field: "telegramNotifyChatId", key: "telegram_notify_chat_id", secret: false },
  { field: "discordNotifyChannelId", key: "discord_notify_channel_id", secret: false },
  { field: "backupIntervalHours", key: "backup_interval_hours", secret: false },
  { field: "backupKeepLast", key: "backup_keep_last", secret: false },
  { field: "userDailyAddQuota", key: "user_daily_add_quota", secret: false },
];

interface ConfigView {
  values: Record<string, string>;
  secrets: Record<string, string | null>;
}

type ConnectionState = "online" | "offline" | "checking" | "unconfigured" | "untested" | "disabled";

interface ServiceTestResult {
  state: ConnectionState;
  latencyMs?: number;
  error?: string;
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

// ── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ state, latencyMs }: { state: ConnectionState; latencyMs?: number }) {
  if (state === "disabled")     return <span className="badge badge-gray">Letiltva</span>;
  if (state === "unconfigured") return <span className="badge badge-gray">Nincs konfigurálva</span>;
  if (state === "untested")     return <span className="badge badge-gray">Nem tesztelt</span>;
  if (state === "checking")     return <span className="badge badge-amber">Ellenőrzés...</span>;
  if (state === "offline")      return <span className="badge badge-red">Offline</span>;
  return (
    <span className="badge badge-green">
      Online{latencyMs !== undefined && <span className="opacity-70 font-normal"> · {latencyMs}ms</span>}
    </span>
  );
}

// ── Summary dot ──────────────────────────────────────────────────────────────

function SummaryDot({ state }: { state: ConnectionState }) {
  const color = state === "online" ? "var(--ok)" : state === "offline" ? "var(--err)" : state === "checking" ? "var(--warn)" : "var(--border-strong)";
  return (
    <span
      style={{ width: 7, height: 7, borderRadius: 999, background: color, display: "inline-block", flexShrink: 0 }}
    />
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        position: "relative",
        display: "inline-flex",
        height: 20,
        width: 36,
        flexShrink: 0,
        cursor: "pointer",
        borderRadius: 999,
        border: "none",
        background: checked ? "var(--primary-bg)" : "var(--surface-3)",
        transition: "none",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: "var(--surface)",
          transition: "none",
        }}
      />
    </button>
  );
}

// ── Service card ──────────────────────────────────────────────────────────────

interface ServiceCardProps {
  title: string;
  desc: string;
  brandColor?: string;
  iconPath: string;
  enabled: boolean;
  onToggle: () => void;
  result: ServiceTestResult;
  onTest: () => void;
  isTesting: boolean;
  startExpanded?: boolean;
  children: React.ReactNode;
}

function ServiceCard({
  title, desc, iconPath, enabled, onToggle,
  result, onTest, isTesting, startExpanded, children,
}: ServiceCardProps) {
  const [expanded, setExpanded] = useState(startExpanded ?? result.state === "unconfigured");
  const chipState: ConnectionState = !enabled ? "disabled" : result.state;

  return (
    <div className="card overflow-hidden" style={{ display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="#000000" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h3 className="text-sm font-semibold text-gray-900 truncate" style={{ letterSpacing: "-0.01em" }}>{title}</h3>
            <Toggle checked={enabled} onChange={onToggle} />
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">{desc}</p>
          <div style={{ marginTop: 6 }}>
            <StatusChip state={chipState} latencyMs={result.latencyMs} />
          </div>
        </div>
      </div>

      {/* Offline error */}
      {enabled && result.state === "offline" && result.error && (
        <div style={{ margin: "0 14px 10px", padding: "7px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <svg className="w-3.5 h-3.5 shrink-0 text-gray-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-gray-600">{result.error}</p>
        </div>
      )}

      {/* Expandable fields */}
      {enabled && expanded && (
        <div style={{ borderTop: "1px solid var(--border-2)", padding: "12px 16px", background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 10 }}>
          {children}
          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
            <button
              onClick={onTest}
              disabled={isTesting}
              className="btn btn-secondary btn-sm"
            >
              {isTesting ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                </svg>
              )}
              Kapcsolat tesztelése
            </button>
          </div>
        </div>
      )}

      {/* Expand / collapse toggle */}
      {enabled && (
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          style={{
            marginTop: "auto",
            padding: "7px 0",
            width: "100%",
            fontSize: 11,
            color: "var(--ink-3)",
            background: "none",
            border: "none",
            borderTop: "1px solid var(--border-2)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontFamily: "inherit",
            transition: "none",
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = "var(--ink)"}
          onMouseLeave={(e) => e.currentTarget.style.color = "var(--ink-3)"}
        >
          {expanded ? (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
              Összecsuk
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              Konfiguráció
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────

function Field({
  label, id, value, onChange, placeholder, secret, helpText,
}: {
  label: string; id: string; value: string; onChange: (v: string) => void;
  placeholder?: string; secret?: boolean; helpText?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input"
          style={{ paddingRight: secret ? 36 : undefined }}
          autoComplete="off"
          spellCheck={false}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute inset-y-0 right-0 flex items-center px-2.5 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            style={{ background: "none", border: "none" }}
            aria-label={show ? "Elrejtés" : "Megjelenítés"}
          >
            {show ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            )}
          </button>
        )}
      </div>
      {helpText && <p className="mt-1 text-xs text-gray-400">{helpText}</p>}
    </div>
  );
}

function SegmentedControl<T extends string>({
  value, onChange, options,
}: {
  value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1,
            padding: "6px 0",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            border: "none",
            borderLeft: i > 0 ? "1px solid var(--border)" : "none",
            background: value === opt.value ? "var(--primary-bg)" : "var(--surface)",
            color: value === opt.value ? "var(--primary-ink)" : "var(--ink-3)",
            transition: "none",
            fontFamily: "inherit",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({ title, iconPath }: { title: string; iconPath: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="#000000" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>
      <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>{title}</h2>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const ALL_SERVICE_KEYS = [
  "plex", "jellyfin", "sonarr", "radarr", "torrent",
  "ollama", "tmdb", "trakt", "truenas", "telegram", "discord",
] as const;

type ServiceKey = typeof ALL_SERVICE_KEYS[number];

const SERVICE_LABELS: Record<ServiceKey, string> = {
  plex: "Plex", jellyfin: "Jellyfin", sonarr: "Sonarr", radarr: "Radarr",
  torrent: "Torrent", ollama: "Ollama", tmdb: "TMDB", trakt: "Trakt",
  truenas: "TrueNAS", telegram: "Telegram", discord: "Discord",
};

function isConfigured(key: ServiceKey, s: AppSettings): boolean {
  switch (key) {
    case "plex":     return !!s.plexUrl && !!s.plexToken;
    case "jellyfin": return !!s.jellyfinUrl && !!s.jellyfinApiKey;
    case "sonarr":   return !!s.sonarrUrl && !!s.sonarrApiKey;
    case "radarr":   return !!s.radarrUrl && !!s.radarrApiKey;
    case "torrent":  return !!s.torrentUrl;
    case "ollama":   return !!s.ollamaUrl;
    case "tmdb":     return !!s.tmdbApiKey;
    case "trakt":    return !!s.traktClientId;
    case "truenas":  return !!s.truenasUrl;
    case "telegram": return !!s.telegramBotToken;
    case "discord":  return !!s.discordBotToken;
  }
}

function enabledKey(key: ServiceKey): keyof AppSettings {
  return `${key}Enabled` as keyof AppSettings;
}

// Ezeket a backend aktívan tudja tesztelni (POST /api/config/test/{service}).
const BACKEND_TESTABLE = new Set<ServiceKey>([
  "sonarr", "radarr", "ollama", "tmdb", "torrent", "plex", "jellyfin",
]);

// Szolgáltatás → szerver-oldali config kulcsok (value + opcionális secret).
// Ezek alapján tudjuk, hogy a szerver szerint (env vagy UI) konfigurált-e —
// nem a lokális input alapján, ami titkos mezőnél kiürül.
const SERVER_CONFIG_KEYS: Partial<Record<ServiceKey, { value: string; secret?: string }>> = {
  plex: { value: "plex_url", secret: "plex_token" },
  jellyfin: { value: "jellyfin_url", secret: "jellyfin_api_key" },
  sonarr: { value: "sonarr_url", secret: "sonarr_api_key" },
  radarr: { value: "radarr_url", secret: "radarr_api_key" },
  torrent: { value: "torrent_url" },
  ollama: { value: "ollama_base_url" },
  tmdb: { value: "tmdb_api_key", secret: "tmdb_api_key" },
};

export default function SettingsPage() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const view = location.pathname.endsWith("/notifications")
    ? "notifications"
    : location.pathname.endsWith("/backup")
    ? "backup"
    : "services";
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [testingNotify, setTestingNotify] = useState(false);
  const [serverSecrets, setServerSecrets] = useState<Record<string, string | null>>({});
  const [serverValues, setServerValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, ServiceTestResult>>(() =>
    Object.fromEntries(ALL_SERVICE_KEYS.map((k) => [k, { state: "untested" as ConnectionState }]))
  );
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  // A betöltő effect ezen keresztül hívja a testService-t (ami később definiált).
  const autoTestRef = useRef<((k: ServiceKey) => void) | null>(null);

  // Egy szolgáltatás akkor konfigurált, ha a SZERVER szerint be van állítva
  // (env vagy UI) — nem a lokális input alapján. Így a Jellyfin sem tűnik el
  // újratöltés után, amikor a titkos mező kiürül.
  const serverConfigured = useCallback((serverKey: string, secretKey?: string): boolean => {
    if (secretKey && serverSecrets[secretKey]) return true;
    return !!(serverValues[serverKey] && serverValues[serverKey].trim());
  }, [serverSecrets, serverValues]);

  const loadBackups = useCallback(async () => {
    try {
      const data = await api<{ backups: BackupEntry[] }>("/api/backups");
      setBackups(data.backups ?? []);
    } catch {
      setBackups([]);
    }
  }, []);

  useEffect(() => { if (view === "backup") loadBackups(); }, [view, loadBackups]);

  async function runBackup() {
    setBackingUp(true);
    try {
      const res = await api<{ file: string; users: number; conversations: number }>("/api/backups/create", {
        method: "POST", body: JSON.stringify({}), timeoutMs: 60_000,
      });
      toast.success(`Mentés kész: ${res.file} (${res.users} felhasználó, ${res.conversations} beszélgetés)`);
      loadBackups();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "A mentés nem sikerült.");
    } finally {
      setBackingUp(false);
    }
  }

  async function restoreBackup(filename: string) {
    let confirmMessage =
      `Biztosan visszaállítod ezt a mentést: ${filename}?\n\n` +
      "Ez FELÜLÍRJA a jelenlegi felhasználókat, beszélgetéseket, konfigurációt és " +
      "tanítófájlokat, és minden bejelentkezett felhasználót (téged is) kiléptet.";
    try {
      const preview = await api<{
        current: { users: number; conversations: number; messages: number; config_overrides: number };
        backup: { users: number; conversations: number; messages: number; config_overrides: number };
      }>(`/api/backups/${encodeURIComponent(filename)}/restore/preview`);
      confirmMessage +=
        "\n\nJelenlegi → mentésbeli állapot:\n" +
        `Felhasználók: ${preview.current.users} → ${preview.backup.users}\n` +
        `Beszélgetések: ${preview.current.conversations} → ${preview.backup.conversations}\n` +
        `Üzenetek: ${preview.current.messages} → ${preview.backup.messages}\n` +
        `Config-felülírások: ${preview.current.config_overrides} → ${preview.backup.config_overrides}`;
    } catch {
      // Ha a preview nem sikerül, a restore-t még mindig fel kell ajánlani —
      // csak a diff-szám nélkül, alap figyelmeztetéssel.
    }
    if (!window.confirm(confirmMessage)) return;
    setRestoring(filename);
    try {
      await api(`/api/backups/${encodeURIComponent(filename)}/restore`, {
        method: "POST", timeoutMs: 60_000,
      });
      toast.success("Visszaállítás kész — kijelentkeztetés...");
      clearAuth();
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "A visszaállítás nem sikerült.");
      setRestoring(null);
    }
  }

  // A szerver effektív konfigurációjának betöltése — a nem-titkos mezők
  // értéke bekerül az űrlapba, a titkosaknál a placeholder mutatja, hogy be vannak állítva.
  useEffect(() => {
    let cancelled = false;
    api<ConfigView>("/api/config")
      .then((cfg) => {
        if (cancelled) return;
        setServerSecrets(cfg.secrets);
        setServerValues(cfg.values);
        setSettings((prev) => {
          const next: Record<string, unknown> = { ...prev };
          for (const { field, key, secret } of CONFIG_FIELD_MAP) {
            if (!secret && cfg.values[key] !== undefined) next[field] = cfg.values[key];
          }
          // A szerveren konfigurált szolgáltatásokat automatikusan bekapcsoljuk,
          // hogy ne "Letiltva" állapotban tűnjenek el (pl. Jellyfin).
          for (const [svc, m] of Object.entries(SERVER_CONFIG_KEYS)) {
            const set = (m.secret && cfg.secrets[m.secret]) || (cfg.values[m.value] || "").trim();
            if (set) next[`${svc}Enabled`] = true;
          }
          return next as unknown as AppSettings;
        });
        // Konfigurált + tesztelhető szolgáltatások automatikus pingelése (zöld/piros).
        for (const svc of BACKEND_TESTABLE) {
          const m = SERVER_CONFIG_KEYS[svc];
          const set = m && ((m.secret && cfg.secrets[m.secret]) || (cfg.values[m.value] || "").trim());
          if (set) autoTestRef.current?.(svc);
        }
      })
      .catch(() => { /* backend nélkül a localStorage értékek maradnak */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ models: string[] }>("/api/ollama/models")
      .then((data) => { if (!cancelled) setOllamaModels(data.models ?? []); })
      .catch(() => { /* Ollama nem elérhető — a szöveges mező marad */ });
    return () => { cancelled = true; };
  }, []);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function secretPlaceholder(configKey: string, fallback: string): string {
    const mask = serverSecrets[configKey];
    return mask ? `beállítva (${mask}) — új értékhez írd felül` : fallback;
  }

  async function save() {
    setSaveError("");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

    const values: Record<string, string> = {};
    for (const { field, key, secret } of CONFIG_FIELD_MAP) {
      const value = settings[field];
      if (typeof value !== "string") continue;
      if (secret) {
        // Titkos mezőt csak akkor küldünk, ha a user új értéket írt be —
        // az üres input jelentése: "marad a jelenlegi".
        if (value.trim()) values[key] = value.trim();
      } else {
        values[key] = value.trim();
      }
    }

    try {
      const cfg = await api<ConfigView>("/api/config", {
        method: "PUT",
        body: JSON.stringify({ values }),
      });
      setServerSecrets(cfg.secrets);
      // A beírt titkok mentés után kikerülnek az inputból (a maszk jelzi őket)
      setSettings((prev) => {
        const next: Record<string, unknown> = { ...prev };
        for (const { field, secret } of CONFIG_FIELD_MAP) {
          if (secret) next[field] = "";
        }
        return next as unknown as AppSettings;
      });
      setSaved(true);
      toast.success("Beállítások mentve és azonnal érvénybe léptek.");
      logger.success("settings", "Beállítások mentve a szerverre");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "A szerver nem érhető el — csak a böngészőben mentve.";
      setSaveError(msg);
      toast.error(msg);
      logger.error("settings", "Szerveroldali mentés sikertelen");
    }
    setTimeout(() => setSaved(false), 2500);
  }

  async function testNotification() {
    setTestingNotify(true);
    try {
      const res = await api<{ delivered: string[] }>("/api/notifications/test", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (res.delivered.length > 0) {
        toast.success(`Teszt értesítés elküldve: ${res.delivered.join(", ")}`);
      } else {
        toast.info("Az értesítés naplózva, de egyik bot sincs bekapcsolva vagy cél-chat beállítva.");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "A teszt értesítés nem sikerült.");
    } finally {
      setTestingNotify(false);
    }
  }

  function reset() {
    setSettings({ ...DEFAULT_SETTINGS });
    localStorage.removeItem(SETTINGS_KEY);
    setSaved(false);
    logger.warn("settings", "Beállítások visszaállítva");
  }

  const testService = useCallback(async (key: ServiceKey) => {
    if (!BACKEND_TESTABLE.has(key)) {
      setResults((p) => ({
        ...p,
        [key]: {
          state: "untested",
          error: "Ezt a szolgáltatást a backend még nem tudja tesztelni.",
        },
      }));
      logger.info("service", `${SERVICE_LABELS[key]}: backendből nem tesztelhető`);
      return;
    }

    setTesting((p) => ({ ...p, [key]: true }));
    setResults((p) => ({ ...p, [key]: { state: "checking" } }));
    logger.info("service", `Kapcsolat tesztelése: ${SERVICE_LABELS[key]}`);

    try {
      const data = await api<{ ok: boolean; message?: string | null; latency_ms: number }>(
        `/api/config/test/${key}`,
        { method: "POST", body: JSON.stringify({}), timeoutMs: 60_000 }
      );
      setResults((p) => ({
        ...p,
        [key]: {
          state: data.ok ? "online" : "offline",
          latencyMs: data.ok ? data.latency_ms : undefined,
          error: data.ok ? undefined : (data.message ?? "A szolgáltatás nem érhető el"),
        },
      }));
      logger[data.ok ? "success" : "warn"]("service", `${SERVICE_LABELS[key]}: ${data.ok ? "online" : "offline"}`);
    } catch (e) {
      const error = e instanceof ApiError ? e.message : "Kapcsolati hiba";
      setResults((p) => ({ ...p, [key]: { state: "offline", error } }));
      logger.error("service", `${SERVICE_LABELS[key]} teszt sikertelen`, error);
    } finally {
      setTesting((p) => ({ ...p, [key]: false }));
    }
  }, []);

  autoTestRef.current = testService;

  // Szerver-tudatos konfiguráltság: a szerver szerint beállított szolgáltatás
  // akkor is konfiguráltnak számít, ha a lokális titkos mező üres.
  const serviceConfigured = useCallback((key: ServiceKey): boolean => {
    const map = SERVER_CONFIG_KEYS[key];
    if (map && serverConfigured(map.value, map.secret)) return true;
    return isConfigured(key, settings);
  }, [serverConfigured, settings]);

  function cardResult(key: ServiceKey): ServiceTestResult {
    if (!settings[enabledKey(key)]) return { state: "disabled" };
    if (!serviceConfigured(key)) return { state: "unconfigured" };
    return results[key] ?? { state: "untested" };
  }

  function summaryDotState(key: ServiceKey): ConnectionState {
    if (!settings[enabledKey(key)]) return "disabled";
    if (!serviceConfigured(key)) return "unconfigured";
    return results[key]?.state ?? "untested";
  }

  const onlineCount = ALL_SERVICE_KEYS.filter((k) => results[k]?.state === "online" && settings[enabledKey(k)]).length;
  const enabledCount = ALL_SERVICE_KEYS.filter((k) => !!settings[enabledKey(k)]).length;

  return (
    <AppShell>
      {/* Top bar */}
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Beállítások
          </h1>
        </div>
        {view !== "backup" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saved && (
              <span className="text-xs text-gray-600 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                Mentve
              </span>
            )}
            <button onClick={save} className="btn btn-primary btn-sm">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              Mentés
            </button>
          </div>
        )}
      </div>

      <SettingsNav />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>

        {/* ══ SZOLGÁLTATÁSOK NÉZET ══ */}
        {view === "services" && (<>
        {/* Info: mely szekciók mentődnek a szerverre */}
        <div className="card mb-6" style={{ padding: "12px 16px", background: "var(--surface-2)", borderColor: "var(--border)" }}>
          <p className="text-xs text-gray-700">
            A <strong>Sonarr, Radarr, Ollama, TMDB, Torrent, Plex és Jellyfin</strong> beállítások mentéskor a
            szerverre kerülnek és azonnal érvénybe lépnek (újraindításkor is megmaradnak, felülírják az <code style={{ fontFamily: "monospace" }}>.env</code>-et).
            A már beállított kulcsok maszkolva jelennek meg — csak akkor töltsd ki őket, ha módosítani akarod. A többi
            szekció (Trakt, TrueNAS) egyelőre csak ebben a böngészőben tárolódik.
          </p>
        </div>

        {saveError && (
          <div className="card mb-6" style={{ padding: "12px 16px", background: "var(--surface-2)", borderColor: "var(--border-strong)" }}>
            <p className="text-xs font-medium text-gray-800">⚠ {saveError}</p>
          </div>
        )}

        {/* Health summary */}
        <div className="card mb-6" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span
              style={{ width: 8, height: 8, borderRadius: 999, background: onlineCount > 0 ? "var(--ok)" : "var(--border-strong)", flexShrink: 0, display: "inline-block" }}
            />
            <span className="text-sm font-semibold text-gray-900">{onlineCount} / {enabledCount} online</span>
            <span className="text-xs text-gray-400">({ALL_SERVICE_KEYS.length} szolgáltatás)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {ALL_SERVICE_KEYS.map((key) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }} title={`${SERVICE_LABELS[key]}: ${summaryDotState(key)}`}>
                <SummaryDot state={summaryDotState(key)} />
                <span className="text-xs text-gray-400 hidden sm:block">{SERVICE_LABELS[key]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── GROUP 1: Média szerverek ── */}
        <section style={{ marginBottom: 32 }}>
          <GroupHeader
            title="Média szerverek"
            iconPath="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m7.5-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-1.5-3.75h-7.5"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ServiceCard title="Plex" desc="Media Server — lejátszási munkamenetek" brandColor="#e5a00d"
              iconPath="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"
              enabled={settings.plexEnabled} onToggle={() => update("plexEnabled", !settings.plexEnabled)}
              result={cardResult("plex")} onTest={() => testService("plex")} isTesting={!!testing.plex}
              startExpanded={!serviceConfigured("plex")}>
              <Field label="Plex URL" id="plex-url" value={settings.plexUrl} onChange={(v) => update("plexUrl", v)} placeholder="http://localhost:32400" helpText="A Plex Media Server elérhetősége a hálózaton" />
              <Field label="X-Plex-Token" id="plex-token" value={settings.plexToken} onChange={(v) => update("plexToken", v)} placeholder={secretPlaceholder("plex_token", "xxxxxxxxxxxxxxxxxxxx")} secret helpText="Plex web → ⋮ menü → Adatok megtekintése → URL-ben látható" />
            </ServiceCard>

            <ServiceCard title="Jellyfin" desc="Media Server — lejátszási munkamenetek" brandColor="#00a4dc"
              iconPath="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
              enabled={settings.jellyfinEnabled} onToggle={() => update("jellyfinEnabled", !settings.jellyfinEnabled)}
              result={cardResult("jellyfin")} onTest={() => testService("jellyfin")} isTesting={!!testing.jellyfin}
              startExpanded={!serviceConfigured("jellyfin")}>
              <Field label="Jellyfin URL" id="jellyfin-url" value={settings.jellyfinUrl} onChange={(v) => update("jellyfinUrl", v)} placeholder="http://localhost:8096" />
              <Field label="API Kulcs" id="jellyfin-key" value={settings.jellyfinApiKey} onChange={(v) => update("jellyfinApiKey", v)} placeholder={secretPlaceholder("jellyfin_api_key", "abc123def456...")} secret helpText="Admin irányítópult → API Kulcsok → Kulcs hozzáadása" />
            </ServiceCard>
          </div>
        </section>

        {/* ── GROUP 2: Letöltő kliensek ── */}
        <section style={{ marginBottom: 32 }}>
          <GroupHeader
            title="Letöltő kliensek"
            iconPath="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ServiceCard title="Sonarr" desc="TV sorozatok automatikus letöltése" brandColor="#35c5f4"
              iconPath="M15 10l4.553-2.069A1 1 0 0121 8.869V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
              enabled={settings.sonarrEnabled} onToggle={() => update("sonarrEnabled", !settings.sonarrEnabled)}
              result={cardResult("sonarr")} onTest={() => testService("sonarr")} isTesting={!!testing.sonarr}
              startExpanded={!serviceConfigured("sonarr")}>
              <Field label="Sonarr URL" id="sonarr-url" value={settings.sonarrUrl} onChange={(v) => update("sonarrUrl", v)} placeholder="http://localhost:8989" />
              <Field label="API Kulcs" id="sonarr-key" value={settings.sonarrApiKey} onChange={(v) => update("sonarrApiKey", v)} placeholder={secretPlaceholder("sonarr_api_key", "abc123...")} secret helpText="Beállítások → Általános → Biztonság" />
            </ServiceCard>

            <ServiceCard title="Radarr" desc="Filmek automatikus letöltése" brandColor="#f5c518"
              iconPath="M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
              enabled={settings.radarrEnabled} onToggle={() => update("radarrEnabled", !settings.radarrEnabled)}
              result={cardResult("radarr")} onTest={() => testService("radarr")} isTesting={!!testing.radarr}
              startExpanded={!serviceConfigured("radarr")}>
              <Field label="Radarr URL" id="radarr-url" value={settings.radarrUrl} onChange={(v) => update("radarrUrl", v)} placeholder="http://localhost:7878" />
              <Field label="API Kulcs" id="radarr-key" value={settings.radarrApiKey} onChange={(v) => update("radarrApiKey", v)} placeholder={secretPlaceholder("radarr_api_key", "abc123...")} secret helpText="Beállítások → Általános → Biztonság" />
            </ServiceCard>

            <ServiceCard title="Torrent kliens" desc="qBittorrent vagy Transmission" brandColor="#44cc7f"
              iconPath="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              enabled={settings.torrentEnabled} onToggle={() => update("torrentEnabled", !settings.torrentEnabled)}
              result={cardResult("torrent")} onTest={() => testService("torrent")} isTesting={!!testing.torrent}
              startExpanded={!serviceConfigured("torrent")}>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5">Kliens típusa</p>
                <SegmentedControl value={settings.torrentClient} onChange={(v) => update("torrentClient", v)}
                  options={[{ value: "qbittorrent" as const, label: "qBittorrent" }, { value: "transmission" as const, label: "Transmission" }]} />
              </div>
              <Field label="Web UI URL" id="torrent-url" value={settings.torrentUrl} onChange={(v) => update("torrentUrl", v)} placeholder="http://localhost:8080" />
              <Field label="Felhasználónév" id="torrent-user" value={settings.torrentUsername} onChange={(v) => update("torrentUsername", v)} placeholder="admin" />
              <Field label="Jelszó" id="torrent-pass" value={settings.torrentPassword} onChange={(v) => update("torrentPassword", v)} placeholder={secretPlaceholder("torrent_password", "••••••••")} secret />
              <Field
                label="Automatikus törlés letöltés után (óra)"
                id="torrent-autodelete"
                value={settings.torrentAutoDeleteHours}
                onChange={(v) => update("torrentAutoDeleteHours", v.replace(/[^0-9]/g, ""))}
                placeholder="0"
                helpText="A befejezett torrent ennyi óra után törlődik a kliensből (0 = kikapcsolva). Minden törlés a Tárhely oldal naplójában látható."
              />
            </ServiceCard>
          </div>
        </section>

        {/* ── GROUP 3: AI & Metaadatok ── */}
        <section style={{ marginBottom: 32 }}>
          <GroupHeader
            title="AI & Metaadatok"
            iconPath="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ServiceCard title="Ollama" desc="Helyi AI — chat és ajánlások" brandColor="#7c3aed"
              iconPath="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              enabled={settings.ollamaEnabled} onToggle={() => update("ollamaEnabled", !settings.ollamaEnabled)}
              result={cardResult("ollama")} onTest={() => testService("ollama")} isTesting={!!testing.ollama}
              startExpanded={!serviceConfigured("ollama")}>
              <Field label="Ollama URL" id="ollama-url" value={settings.ollamaUrl} onChange={(v) => update("ollamaUrl", v)} placeholder="http://localhost:11434" />
              <Field label="Modell" id="ollama-model" value={settings.ollamaModel} onChange={(v) => update("ollamaModel", v)} placeholder="llama3.2:3b" helpText="Kézzel is beírható, vagy válassz a telepítettek közül lent." />
              {ollamaModels.length > 0 && (
                <div>
                  <label htmlFor="ollama-model-select" className="block text-xs font-medium text-gray-600 mb-1.5">Telepített modellek</label>
                  <select
                    id="ollama-model-select"
                    className="input"
                    value={ollamaModels.includes(settings.ollamaModel) ? settings.ollamaModel : ""}
                    onChange={(e) => { if (e.target.value) update("ollamaModel", e.target.value); }}
                  >
                    <option value="" disabled>Válassz...</option>
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
            </ServiceCard>

            <ServiceCard title="TMDB" desc="Film és sorozat metaadatok" brandColor="#01b4e4"
              iconPath="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              enabled={settings.tmdbEnabled} onToggle={() => update("tmdbEnabled", !settings.tmdbEnabled)}
              result={cardResult("tmdb")} onTest={() => testService("tmdb")} isTesting={!!testing.tmdb}
              startExpanded={!serviceConfigured("tmdb")}>
              <Field label="API Kulcs (Bearer)" id="tmdb-key" value={settings.tmdbApiKey} onChange={(v) => update("tmdbApiKey", v)} placeholder={secretPlaceholder("tmdb_api_key", "eyJhbGci...")} secret helpText="themoviedb.org → Profil → Beállítások → API" />
            </ServiceCard>

            <ServiceCard title="Trakt" desc="Nézési előzmények szinkron" brandColor="#ed2224"
              iconPath="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z"
              enabled={settings.traktEnabled} onToggle={() => update("traktEnabled", !settings.traktEnabled)}
              result={cardResult("trakt")} onTest={() => testService("trakt")} isTesting={!!testing.trakt}
              startExpanded={!serviceConfigured("trakt")}>
              <Field label="Client ID" id="trakt-id" value={settings.traktClientId} onChange={(v) => update("traktClientId", v)} placeholder="client_id..." helpText="trakt.tv → Beállítások → Alkalmazások → Új alkalmazás" />
              <Field label="Client Secret" id="trakt-secret" value={settings.traktClientSecret} onChange={(v) => update("traktClientSecret", v)} placeholder="secret..." secret />
            </ServiceCard>
          </div>
        </section>

        {/* ── GROUP 4: Tárhely & Értesítések ── */}
        <section style={{ marginBottom: 32 }}>
          <GroupHeader
            title="Tárhely & Értesítések"
            iconPath="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ServiceCard title="TrueNAS" desc="NAS tárhely monitorozás" brandColor="#0095d5"
              iconPath="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
              enabled={settings.truenasEnabled} onToggle={() => update("truenasEnabled", !settings.truenasEnabled)}
              result={cardResult("truenas")} onTest={() => testService("truenas")} isTesting={!!testing.truenas}
              startExpanded={!serviceConfigured("truenas")}>
              <Field label="TrueNAS URL" id="truenas-url" value={settings.truenasUrl} onChange={(v) => update("truenasUrl", v)} placeholder="http://truenas.local" />
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5">Hitelesítési mód</p>
                <SegmentedControl value={settings.truenasAuthMode} onChange={(v) => update("truenasAuthMode", v)}
                  options={[{ value: "apikey" as const, label: "API Kulcs" }, { value: "credentials" as const, label: "Felh. / Jelszó" }]} />
              </div>
              {settings.truenasAuthMode === "apikey" ? (
                <Field label="API Kulcs" id="truenas-apikey" value={settings.truenasApiKey} onChange={(v) => update("truenasApiKey", v)} placeholder="1-xxxxxxxxxxxxxxxx" secret helpText="TrueNAS → Beállítások → API Kulcsok" />
              ) : (
                <>
                  <Field label="Felhasználónév" id="truenas-user" value={settings.truenasUsername} onChange={(v) => update("truenasUsername", v)} placeholder="root" />
                  <Field label="Jelszó" id="truenas-pass" value={settings.truenasPassword} onChange={(v) => update("truenasPassword", v)} placeholder="••••••••" secret />
                </>
              )}
            </ServiceCard>

            <ServiceCard title="Telegram" desc="Bot értesítések küldése" brandColor="#229ed9"
              iconPath="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"
              enabled={settings.telegramEnabled} onToggle={() => update("telegramEnabled", !settings.telegramEnabled)}
              result={cardResult("telegram")} onTest={() => testService("telegram")} isTesting={!!testing.telegram}
              startExpanded={!serviceConfigured("telegram")}>
              <Field label="Bot Token" id="telegram-token" value={settings.telegramBotToken} onChange={(v) => update("telegramBotToken", v)} placeholder="123456:ABC-DEF..." secret helpText="Telegram → @BotFather → /newbot → kapott token" />
            </ServiceCard>

            <ServiceCard title="Discord" desc="Bot értesítések Discord szerveren" brandColor="#5865f2"
              iconPath="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z"
              enabled={settings.discordEnabled} onToggle={() => update("discordEnabled", !settings.discordEnabled)}
              result={cardResult("discord")} onTest={() => testService("discord")} isTesting={!!testing.discord}
              startExpanded={!serviceConfigured("discord")}>
              <Field label="Bot Token" id="discord-token" value={settings.discordBotToken} onChange={(v) => update("discordBotToken", v)} placeholder="MTAx..." secret helpText="discord.com/developers → Alkalmazások → Bot → Token" />
            </ServiceCard>
          </div>
        </section>

        </>)}
        {/* ══ ÉRTESÍTÉSEK NÉZET ══ */}
        {view === "notifications" && (
        <section style={{ marginBottom: 32 }}>
          <GroupHeader
            title="Letöltés-kész értesítések"
            iconPath="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
          <div className="card" style={{ padding: "16px 20px" }}>
            <p className="text-xs text-gray-600" style={{ marginBottom: 14, lineHeight: 1.6 }}>
              Amikor egy hozzáadott film/sorozat ténylegesen letöltődik, a Sonarr/Radarr értesíti a szervert,
              ami a Telegram/Discord boton keresztül szól. Állítsd be a titkot itt, majd a Sonarr/Radarrban:
              <br />
              <strong>Settings → Connect → Webhook</strong>, URL: <code style={{ fontFamily: "monospace" }}>{`{APP_URL}/api/webhooks/{TITOK}/sonarr`}</code> (ill. <code style={{ fontFamily: "monospace" }}>/radarr</code>), trigger: <em>On Import</em>.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Field
                label="Webhook titok"
                id="webhook-secret"
                value={settings.webhookSecret}
                onChange={(v) => update("webhookSecret", v.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder="pl. egy hosszú véletlen szó"
                helpText="Üres = a webhook végpont letiltva. Ennek szerepelnie kell a Sonarr/Radarr webhook URL-jében."
              />
              <Field
                label="Telegram értesítési chat ID"
                id="tg-notify"
                value={settings.telegramNotifyChatId}
                onChange={(v) => update("telegramNotifyChatId", v)}
                placeholder="pl. 123456789 (üresen az allowlist elsőjét használja)"
              />
              <Field
                label="Discord értesítési csatorna ID"
                id="dc-notify"
                value={settings.discordNotifyChannelId}
                onChange={(v) => update("discordNotifyChannelId", v)}
                placeholder="pl. 987654321098765432"
              />
              <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
                <button onClick={testNotification} disabled={testingNotify} className="btn btn-secondary btn-sm">
                  {testingNotify ? "Küldés..." : "Teszt értesítés küldése"}
                </button>
              </div>
            </div>
          </div>
        </section>
        )}

        {view === "notifications" && (
        <section style={{ marginBottom: 32 }}>
          <GroupHeader
            title="Korlátok"
            iconPath="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
          <div className="card" style={{ padding: "16px 20px" }}>
            <p className="text-xs text-gray-600" style={{ marginBottom: 14, lineHeight: 1.6 }}>
              Napi hozzáadási limit userenként — admin szerepkör mindig kivétel. 0 = korlátlan.
            </p>
            <div style={{ width: 180 }}>
              <Field
                label="Napi hozzáadási limit"
                id="user-daily-add-quota"
                value={settings.userDailyAddQuota}
                onChange={(v) => update("userDailyAddQuota", v)}
                placeholder="0"
              />
            </div>
          </div>
        </section>
        )}

        {/* ══ BIZTONSÁGI MENTÉS NÉZET ══ */}
        {view === "backup" && (
          <div style={{ maxWidth: 640 }}>
            <div className="card mb-4" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Automatikus adatmentés</h2>
                  <p className="text-xs text-gray-500 mt-1" style={{ lineHeight: 1.6 }}>
                    A szerver naponta automatikusan menti a felhasználókat (hash-elt jelszóval), a
                    konfigurációt, a tanítófájlokat és a beszélgetéseket a <code style={{ fontFamily: "monospace" }}>data/backups</code> mappába
                    (utolsó 14 megtartva). Kézzel is indíthatod:
                  </p>
                </div>
                <button onClick={runBackup} disabled={backingUp} className="btn btn-primary btn-sm shrink-0">
                  {backingUp ? "Mentés..." : "Mentés most"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ width: 160 }}>
                  <Field
                    label="Ütemezés (óránként)"
                    id="backup-interval"
                    value={settings.backupIntervalHours}
                    onChange={(v) => update("backupIntervalHours", v)}
                    placeholder="24"
                  />
                </div>
                <div style={{ width: 160 }}>
                  <Field
                    label="Megőrzött mentések száma"
                    id="backup-keep-last"
                    value={settings.backupKeepLast}
                    onChange={(v) => update("backupKeepLast", v)}
                    placeholder="14"
                  />
                </div>
                <button onClick={save} className="btn btn-secondary btn-sm">Ütemezés mentése</button>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="card-header">
                <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>Elérhető mentések</h2>
                <span className="badge badge-gray">{backups.length}</span>
              </div>
              {backups.length === 0 ? (
                <div style={{ padding: "32px 20px", textAlign: "center" }}>
                  <p className="text-sm text-gray-400">Még nincs mentés</p>
                </div>
              ) : (
                backups.map((b, idx) => (
                  <div key={b.file} style={{ padding: "10px 20px", borderTop: idx > 0 ? "1px solid var(--border-2)" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span className="text-sm text-gray-800 truncate" style={{ fontFamily: "monospace" }}>{b.file}</span>
                    <span className="text-xs text-gray-400 shrink-0" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {new Date(b.mtime * 1000).toLocaleString("hu-HU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {" · "}{(b.size_bytes / 1024).toFixed(0)} KB
                      <button
                        onClick={() => restoreBackup(b.file)}
                        disabled={restoring !== null}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: "3px 10px" }}
                      >
                        {restoring === b.file ? "Visszaállítás..." : "Visszaállítás"}
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Footer — csak a menthető nézeteken */}
        {view !== "backup" && (
          <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
            <button onClick={reset} className="btn btn-secondary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
              Visszaállítás
            </button>
            <button onClick={save} className="btn btn-primary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              Mentés
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
