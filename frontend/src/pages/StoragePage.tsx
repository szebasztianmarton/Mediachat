import { useState, useEffect, useCallback } from "react";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../utils/api";
import { useToast } from "../components/Toast";
import { logger } from "../utils/logger";

interface Volume {
  name: string;
  path: string;
  exists: boolean;
  total_gb: number;
  used_gb: number;
  free_gb: number;
}

interface StorageStatus {
  volumes: Volume[];
  warnings: string[];
  min_free_gb: number;
}

interface StaleItem {
  title: string;
  media_type: "movie" | "series";
  external_id: number;
  arr_id: number;
  last_activity: string | null;
  days_idle: number | null;
}

interface CleanupResult {
  cache_files: { deleted_files: number; freed_mb: number; path: string };
  search_cache_keys_deleted: number;
}

interface TorrentLogEntry {
  id: number;
  name: string;
  mode: "auto" | "manual";
  size_bytes: number;
  deleted_at: string | null;
}

const VOLUME_LABELS: Record<string, string> = {
  cache: "Cache",
  media: "Média",
  downloads: "Letöltések",
};

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div style={{ width: "100%" }}>
      <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-2)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: pct > 90 ? "var(--warn)" : "var(--ink)" }} />
      </div>
      <p className="text-[10px] text-gray-400 mt-1">{pct}% használt</p>
    </div>
  );
}

export default function StoragePage() {
  const toast = useToast();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [stale, setStale] = useState<StaleItem[]>([]);
  const [staleDays, setStaleDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [staleLoading, setStaleLoading] = useState(true);
  const [error, setError] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState("");
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState("");
  const [torrentLog, setTorrentLog] = useState<TorrentLogEntry[]>([]);
  const [autoDeleteHours, setAutoDeleteHours] = useState(0);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<StorageStatus>("/api/storage/status");
      setStatus(data);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "A tárhely állapot nem érhető el.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStale = useCallback(async () => {
    setStaleLoading(true);
    try {
      const data = await api<{ items: StaleItem[]; days: number }>("/api/storage/stale", { timeoutMs: 60_000 });
      setStale(data.items ?? []);
      setStaleDays(data.days);
    } catch {
      // Sonarr/Radarr nélkül üres marad — nem hiba a felhasználónak
      setStale([]);
    } finally {
      setStaleLoading(false);
    }
  }, []);

  const loadTorrentLog = useCallback(async () => {
    try {
      const data = await api<{ entries: TorrentLogEntry[]; auto_delete_hours: number }>(
        "/api/torrents/cleanup/log"
      );
      setTorrentLog(data.entries ?? []);
      setAutoDeleteHours(data.auto_delete_hours ?? 0);
    } catch {
      setTorrentLog([]);
    }
  }, []);

  useEffect(() => { loadStatus(); loadStale(); loadTorrentLog(); }, [loadStatus, loadStale, loadTorrentLog]);

  async function handleCleanup() {
    setCleaning(true);
    setCleanupMsg("");
    try {
      const result = await api<CleanupResult>("/api/storage/cleanup", { method: "POST", body: JSON.stringify({}), timeoutMs: 120_000 });
      const files = result.cache_files;
      const msg = `${files.deleted_files} fájl törölve (${files.freed_mb} MB), ${result.search_cache_keys_deleted} keresési cache kulcs ürítve.`;
      setCleanupMsg(msg);
      toast.success(msg);
      logger.success("system", "Cache takarítás lefutott");
      loadStatus();
    } catch (err) {
      const msg = err instanceof ApiError ? `Hiba: ${err.message}` : "A takarítás nem sikerült.";
      setCleanupMsg(msg);
      toast.error(msg);
      logger.error("system", "Cache takarítás sikertelen");
    } finally {
      setCleaning(false);
    }
  }

  async function handleStaleAction(item: StaleItem, action: "delete" | "unmonitor") {
    if (action === "delete" && confirmDelete !== item.arr_id) {
      setConfirmDelete(item.arr_id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    setActionBusy(item.arr_id);
    setActionMsg("");
    try {
      const result = await api<{ message: string }>("/api/storage/stale/action", {
        method: "POST",
        body: JSON.stringify({ media_type: item.media_type, arr_id: item.arr_id, action }),
      });
      setActionMsg(`${item.title}: ${result.message}`);
      toast.success(`${item.title}: ${result.message}`);
      logger.warn("media", `Stale akció (${action}): ${item.title}`);
      loadStale();
    } catch (err) {
      const msg = err instanceof ApiError ? `Hiba: ${err.message}` : "A művelet nem sikerült.";
      setActionMsg(msg);
      toast.error(msg);
    } finally {
      setActionBusy(null);
      setConfirmDelete(null);
    }
  }

  return (
    <AppShell>
      {/* Top bar */}
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Tárhely
          </h1>
        </div>
        <button onClick={handleCleanup} className="btn btn-primary btn-sm" disabled={cleaning}>
          {cleaning ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25M9 16.5v.75m3-3v3M15 12v5.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          )}
          Cache takarítás
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>

        {error && (
          <div className="card mb-6" style={{ padding: "12px 16px", background: "var(--surface-2)", borderColor: "var(--border)" }}>
            <p className="text-xs text-gray-700">{error}</p>
          </div>
        )}

        {cleanupMsg && (
          <div className="card mb-6" style={{ padding: "12px 16px", background: "var(--surface-2)", borderColor: "var(--border)" }}>
            <p className="text-xs text-gray-700">{cleanupMsg}</p>
          </div>
        )}

        {/* Warnings */}
        {status && status.warnings.length > 0 && (
          <div className="card mb-6" style={{ padding: "12px 16px", background: "var(--surface-2)", borderColor: "var(--border-strong)" }}>
            {status.warnings.map((w) => (
              <p key={w} className="text-xs font-medium text-gray-800">⚠ {w}</p>
            ))}
          </div>
        )}

        {/* Volumes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {loading && [0, 1, 2].map((i) => (
            <div key={i} className="card" style={{ padding: 16 }}>
              <div className="skeleton" style={{ height: 14, width: "40%", marginBottom: 10 }} />
              <div className="skeleton" style={{ height: 10, width: "80%", marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 6, width: "100%" }} />
            </div>
          ))}
          {!loading && status?.volumes.map((vol) => (
            <div key={vol.name} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span className="text-sm font-semibold text-gray-900">{VOLUME_LABELS[vol.name] ?? vol.name}</span>
                {!vol.exists && <span className="badge badge-gray">Nem elérhető</span>}
              </div>
              <p className="text-[11px] text-gray-400 mb-3 truncate" title={vol.path} style={{ fontFamily: "monospace" }}>{vol.path}</p>
              {vol.exists ? (
                <>
                  <p className="text-xs text-gray-600 mb-2">
                    <span className="font-semibold text-gray-900">{vol.free_gb} GB</span> szabad / {vol.total_gb} GB
                  </p>
                  <UsageBar used={vol.used_gb} total={vol.total_gb} />
                </>
              ) : (
                <p className="text-xs text-gray-400">Az útvonal nem érhető el a szerveren.</p>
              )}
            </div>
          ))}
        </div>

        {/* Stale media */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>
              Elavult tartalmak
            </h2>
            <span className="badge badge-gray">{staleDays}+ nap inaktív</span>
          </div>

          {actionMsg && (
            <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border-2)", background: "var(--surface-2)" }}>
              <p className="text-xs text-gray-700">{actionMsg}</p>
            </div>
          )}

          {staleLoading && (
            <div style={{ padding: "16px 20px" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 14, width: `${80 - i * 15}%`, marginBottom: 10 }} />
              ))}
            </div>
          )}

          {!staleLoading && stale.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <p className="text-sm text-gray-400">Nincs elavult tartalom</p>
              <p className="text-xs text-gray-400 mt-1">Minden médiádat használtad az elmúlt {staleDays} napban, vagy a Sonarr/Radarr nem érhető el.</p>
            </div>
          )}

          {!staleLoading && stale.map((item, idx) => (
            <div
              key={`${item.media_type}-${item.arr_id}`}
              style={{
                padding: "12px 20px",
                borderTop: idx > 0 ? "1px solid var(--border-2)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="text-sm font-medium text-gray-900 truncate">{item.title}</span>
                  <span className="badge badge-gray">{item.media_type === "movie" ? "Film" : "Sorozat"}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {item.days_idle !== null ? `${item.days_idle} napja inaktív` : "Soha nem volt aktivitás"}
                </p>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => handleStaleAction(item, "unmonitor")}
                  disabled={actionBusy === item.arr_id}
                  className="btn btn-secondary btn-sm"
                  title="A Sonarr/Radarr nem keres többé új letöltést hozzá"
                >
                  Unmonitor
                </button>
                <button
                  onClick={() => handleStaleAction(item, "delete")}
                  disabled={actionBusy === item.arr_id}
                  className={`btn btn-sm ${confirmDelete === item.arr_id ? "btn-danger" : "btn-secondary"}`}
                >
                  {confirmDelete === item.arr_id ? "Biztos?" : "Törlés"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Torrent takarítási napló */}
        <div className="card overflow-hidden mt-8">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>
              Torrent takarítási napló
            </h2>
            <span className={autoDeleteHours > 0 ? "badge badge-green" : "badge badge-gray"}>
              {autoDeleteHours > 0 ? `Auto-törlés: ${autoDeleteHours} óra` : "Auto-törlés kikapcsolva"}
            </span>
          </div>

          {torrentLog.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center" }}>
              <p className="text-sm text-gray-400">Még nincs törölt torrent</p>
              <p className="text-xs text-gray-400 mt-1">
                Az automatikus törlés a Beállítások → Torrent kliens szekcióban kapcsolható be (óra megadásával).
              </p>
            </div>
          ) : (
            <div>
              {torrentLog.map((entry, idx) => (
                <div
                  key={entry.id}
                  style={{
                    padding: "10px 20px",
                    borderTop: idx > 0 ? "1px solid var(--border-2)" : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="text-sm text-gray-800 truncate" title={entry.name}>{entry.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {entry.deleted_at ? new Date(entry.deleted_at).toLocaleString("hu-HU") : "—"}
                      {entry.size_bytes > 0 && ` · ${(entry.size_bytes / 1_073_741_824).toFixed(2)} GB`}
                    </p>
                  </div>
                  <span className={entry.mode === "auto" ? "badge badge-amber" : "badge badge-gray"}>
                    {entry.mode === "auto" ? "Automatikus" : "Kézi"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          A törlés a Sonarr/Radarr könyvtárból távolítja el a bejegyzést — a fájlok törlését a STORAGE_DELETE_FILES env-változó szabályozza.
        </p>
      </div>
    </AppShell>
  );
}
