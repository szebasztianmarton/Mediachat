import { useState, useEffect, useCallback } from "react";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../utils/api";
import { useToast } from "../components/Toast";
import CollapsibleCard from "../components/CollapsibleCard";
import { HBarChart, fmtBytes } from "../components/Charts";
import { logger } from "../utils/logger";

interface DiskInfo {
  path: string;
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
}

interface TopItem {
  title: string;
  year: number | null;
  size_bytes: number;
  seasons?: number;
  episodes?: number;
  avg_per_season_bytes?: number;
  avg_per_episode_bytes?: number | null;
}

interface StorageAnalysis {
  top_movies: TopItem[];
  top_series: TopItem[];
  disks: DiskInfo[];
  movies_total_bytes: number;
  series_total_bytes: number;
  total_bytes?: number;
  used_bytes?: number;
  free_bytes?: number;
  sonarr_configured: boolean;
  radarr_configured: boolean;
}

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
  // Jellyfin nézettségi jelzés (ha van Jellyfin konfigurálva)
  category?: "unwatched" | "stale_download";
  watch_status?: "never_watched" | "not_watched_recently" | "no_data";
  last_watched?: string | null;
  watch_days_idle?: number | null;
}

function staleSubtitle(item: StaleItem): string {
  if (item.watch_status === "never_watched") {
    return "Letöltve, de még senki sem nézte meg";
  }
  if (item.watch_status === "not_watched_recently") {
    return item.watch_days_idle !== null && item.watch_days_idle !== undefined
      ? `${item.watch_days_idle} napja nem nézte senki`
      : "Rég nem nézte senki";
  }
  return item.days_idle !== null ? `${item.days_idle} napja inaktív` : "Soha nem volt aktivitás";
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

// A használat mértékéhez színt rendel: 95%+ piros, 85%+ borostyán, alatta semleges.
function usageColor(pct: number): string {
  if (pct >= 95) return "var(--err)";
  if (pct >= 85) return "var(--warn)";
  return "var(--ink)";
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div style={{ width: "100%" }}>
      <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-2)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: usageColor(pct) }} />
      </div>
      <p className="text-[10px] text-gray-400 mt-1">{pct}% használt</p>
    </div>
  );
}

// Azonos útvonalú lemezeket kiszűr (a Sonarr/Radarr néha ugyanazt a mountot
// többször jelenti) — így az összesítés nem duplázódik, és a lista tisztább.
function dedupDisks(disks: DiskInfo[]): DiskInfo[] {
  const seen = new Set<string>();
  const out: DiskInfo[] = [];
  for (const d of disks) {
    if (seen.has(d.path)) continue;
    seen.add(d.path);
    out.push(d);
  }
  return out;
}

// Áttekintő összesítő: a média-lemezek deduplikált összes/használt/szabad + a
// film/sorozat/egyéb/szabad halmozott sáv — egy pillantással látható „mennyire tele".
function StorageOverview({ analysis }: { analysis: StorageAnalysis }) {
  const disks = dedupDisks(analysis.disks);
  const total = disks.reduce((a, d) => a + d.total_bytes, 0);
  const used = disks.reduce((a, d) => a + d.used_bytes, 0);
  const free = disks.reduce((a, d) => a + d.free_bytes, 0);
  if (total <= 0) return null;
  const usedPct = Math.round((used / total) * 100);
  const movies = analysis.movies_total_bytes;
  const series = analysis.series_total_bytes;
  const other = Math.max(0, used - movies - series);

  const seg = (bytes: number, color: string, title: string) =>
    bytes > 0 ? <div title={title} style={{ width: `${(bytes / total) * 100}%`, background: color, minWidth: 2 }} /> : null;
  const legend = (color: string, label: string) => (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-2)" }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} /> {label}
    </span>
  );

  return (
    <div className="card p-5 mb-8">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <span className="text-2xl font-bold text-gray-900">{fmtBytes(used)}</span>
          <span className="text-sm text-gray-400"> / {fmtBytes(total)} használt ({usedPct}%)</span>
        </div>
        <span className="text-sm font-medium" style={{ color: usedPct >= 90 ? "var(--warn)" : "var(--ink-2)" }}>
          {fmtBytes(free)} szabad
        </span>
      </div>
      <div style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-2)" }}>
        {seg(movies, "var(--primary-bg)", `Filmek: ${fmtBytes(movies)}`)}
        {seg(series, "var(--warn)", `Sorozatok: ${fmtBytes(series)}`)}
        {seg(other, "var(--ink-3)", "Egyéb használt")}
        {seg(free, "var(--surface-3)", `Szabad: ${fmtBytes(free)}`)}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
        {legend("var(--primary-bg)", `Filmek ${fmtBytes(movies)}`)}
        {legend("var(--warn)", `Sorozatok ${fmtBytes(series)}`)}
        {other > 0 && legend("var(--ink-3)", `Egyéb ${fmtBytes(other)}`)}
        {legend("var(--surface-3)", `Szabad ${fmtBytes(free)}`)}
      </div>
    </div>
  );
}

// Kompakt lemez-sor: útvonal + vékony sáv + szabad/össz + %. A CollapsibleCard listájában él.
function DiskRow({ disk, first }: { disk: DiskInfo; first: boolean }) {
  const pct = disk.total_bytes > 0 ? Math.min(100, Math.round((disk.used_bytes / disk.total_bytes) * 100)) : 0;
  const color = usageColor(pct);
  return (
    <div style={{ padding: "11px 20px", borderTop: first ? "none" : "1px solid var(--border-2)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <span className="text-xs text-gray-700 truncate" style={{ fontFamily: "monospace" }} title={disk.path}>{disk.path}</span>
        <span className="text-xs shrink-0" style={{ color: "var(--ink-2)" }}>
          {fmtBytes(disk.free_bytes)} szabad · <span style={{ color, fontWeight: 600 }}>{pct}%</span>
        </span>
      </div>
      <div style={{ height: 5, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-2)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color }} />
      </div>
      <p className="text-[10px] text-gray-400 mt-1">{fmtBytes(disk.used_bytes)} / {fmtBytes(disk.total_bytes)} használt</p>
    </div>
  );
}

// A UI adat-volume-jai (cache/média/letöltések) gyakran ugyanazon a fizikai
// lemezen vannak → azonos méret/szabad jelzi. Ilyenkor egy kártyába vonjuk össze.
interface VolGroup {
  key: string;
  labels: string[];
  paths: string[];
  total_gb: number;
  used_gb: number;
  free_gb: number;
  exists: boolean;
}
function groupVolumes(vols: Volume[]): VolGroup[] {
  const map = new Map<string, VolGroup>();
  for (const v of vols) {
    const key = v.exists ? `disk-${v.total_gb}|${v.free_gb}` : `missing-${v.path}`;
    const label = VOLUME_LABELS[v.name] ?? v.name;
    const g = map.get(key);
    if (g) {
      g.labels.push(label);
      g.paths.push(v.path);
    } else {
      map.set(key, { key, labels: [label], paths: [v.path], total_gb: v.total_gb, used_gb: v.used_gb, free_gb: v.free_gb, exists: v.exists });
    }
  }
  return [...map.values()];
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
  const [analysis, setAnalysis] = useState<StorageAnalysis | null>(null);

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

  const loadAnalysis = useCallback(async () => {
    try {
      const data = await api<StorageAnalysis>("/api/library/storage", { timeoutMs: 60_000 });
      setAnalysis(data);
    } catch {
      setAnalysis(null);
    }
  }, []);

  useEffect(() => { loadStatus(); loadStale(); loadTorrentLog(); loadAnalysis(); }, [loadStatus, loadStale, loadTorrentLog, loadAnalysis]);

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

        {/* Áttekintő összesítő — média könyvtár (egy pillantással) */}
        {analysis && (analysis.radarr_configured || analysis.sonarr_configured) && (
          <StorageOverview analysis={analysis} />
        )}

        {/* Adat-volume-ok — az azonos fizikai lemezen lévők egy kártyába vonva */}
        <p className="section-label mb-3">Adatlemezek</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {loading && [0, 1, 2].map((i) => (
            <div key={i} className="card" style={{ padding: 16 }}>
              <div className="skeleton" style={{ height: 14, width: "40%", marginBottom: 10 }} />
              <div className="skeleton" style={{ height: 10, width: "80%", marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 6, width: "100%" }} />
            </div>
          ))}
          {!loading && status && groupVolumes(status.volumes).map((g) => (
            <div key={g.key} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <span className="text-sm font-semibold text-gray-900 truncate">{g.labels.join(" · ")}</span>
                {!g.exists && <span className="badge badge-gray shrink-0">Nem elérhető</span>}
              </div>
              <div className="mb-3">
                {g.paths.map((p) => (
                  <p key={p} className="text-[11px] text-gray-400 truncate" title={p} style={{ fontFamily: "monospace" }}>{p}</p>
                ))}
              </div>
              {g.exists ? (
                <>
                  <p className="text-xs text-gray-600 mb-2">
                    <span className="font-semibold text-gray-900">{g.free_gb} GB</span> szabad / {g.total_gb} GB
                  </p>
                  <UsageBar used={g.used_gb} total={g.total_gb} />
                </>
              ) : (
                <p className="text-xs text-gray-400">Az útvonal nem érhető el a szerveren.</p>
              )}
            </div>
          ))}
        </div>

        {/* Sonarr/Radarr könyvtár-tárhely */}
        {analysis && (analysis.radarr_configured || analysis.sonarr_configured) && (
          <div className="mb-8" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Média könyvtár lemezei — kompakt, telítettség szerint rendezett lista */}
            <CollapsibleCard
              title="Média könyvtár lemezei"
              iconPath="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
              storageKey="storage-disks"
              count={dedupDisks(analysis.disks).length}
              searchable
              searchPlaceholder="Útvonal keresése…"
              badge={<span className="badge badge-gray">Sonarr/Radarr</span>}
            >
              {(q) => {
                const disks = dedupDisks(analysis.disks)
                  .filter((d) => !q || d.path.toLowerCase().includes(q))
                  .sort((a, b) => (b.total_bytes ? b.used_bytes / b.total_bytes : 0) - (a.total_bytes ? a.used_bytes / a.total_bytes : 0));
                if (disks.length === 0) return <p className="text-sm text-gray-400 italic" style={{ padding: "16px 20px" }}>Nincs a szűrőnek megfelelő lemez.</p>;
                return <div>{disks.map((d, i) => <DiskRow key={d.path} disk={d} first={i === 0} />)}</div>;
              }}
            </CollapsibleCard>

            {/* Top helyfoglaló sorozatok — évad-átlaggal, szűrhető */}
            {analysis.top_series.length > 0 && (
              <CollapsibleCard
                title="Legtöbb helyet foglaló sorozatok"
                storageKey="storage-top-series"
                searchable
                searchPlaceholder="Sorozat keresése…"
                badge={<span className="badge badge-gray">átlag / évad</span>}
                bodyStyle={{ padding: "14px 20px" }}
              >
                {(q) => {
                  const items = analysis.top_series.filter((s) => !q || s.title.toLowerCase().includes(q));
                  if (items.length === 0) return <p className="text-sm text-gray-400 italic">Nincs találat.</p>;
                  return (
                    <HBarChart
                      barColor="var(--warn)"
                      items={items.map((s) => ({
                        label: s.title,
                        value: s.size_bytes,
                        valueLabel: fmtBytes(s.size_bytes),
                        sublabel: `${s.seasons ?? 0} évad · átlag ${fmtBytes(s.avg_per_season_bytes ?? 0)}/évad`,
                      }))}
                    />
                  );
                }}
              </CollapsibleCard>
            )}

            {/* Top helyfoglaló filmek — egy fájl, szűrhető */}
            {analysis.top_movies.length > 0 && (
              <CollapsibleCard
                title="Legtöbb helyet foglaló filmek"
                storageKey="storage-top-movies"
                searchable
                searchPlaceholder="Film keresése…"
                bodyStyle={{ padding: "14px 20px" }}
              >
                {(q) => {
                  const items = analysis.top_movies.filter((m) => !q || m.title.toLowerCase().includes(q));
                  if (items.length === 0) return <p className="text-sm text-gray-400 italic">Nincs találat.</p>;
                  return (
                    <HBarChart
                      items={items.map((m) => ({
                        label: m.title,
                        value: m.size_bytes,
                        valueLabel: fmtBytes(m.size_bytes),
                        sublabel: m.year ? String(m.year) : undefined,
                      }))}
                    />
                  );
                }}
              </CollapsibleCard>
            )}
          </div>
        )}

        {/* Elavult tartalmak — összecsukható, szűrhető */}
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <CollapsibleCard
            title="Elavult tartalmak"
            storageKey="storage-stale"
            count={stale.length}
            searchable={stale.length > 0}
            searchPlaceholder="Cím keresése…"
            chips={stale.length > 0 ? [{ key: "all", label: "Mind" }, { key: "movie", label: "Film" }, { key: "series", label: "Sorozat" }] : undefined}
            badge={<span className="badge badge-gray">{staleDays}+ nap inaktív</span>}
          >
            {(q, chip) => (
              <>
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
                {!staleLoading && stale.length > 0 && (() => {
                  const items = stale.filter((i) => (chip === "all" || i.media_type === chip) && (!q || i.title.toLowerCase().includes(q)));
                  if (items.length === 0) return <p className="text-sm text-gray-400 italic" style={{ padding: "16px 20px" }}>Nincs a szűrőnek megfelelő tartalom.</p>;
                  return items.map((item, idx) => (
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
                          {item.watch_status === "never_watched" && <span className="badge badge-amber">Soha nem nézve</span>}
                          {item.watch_status === "not_watched_recently" && <span className="badge badge-gray">Rég nézve</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {staleSubtitle(item)}
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
                  ));
                })()}
              </>
            )}
          </CollapsibleCard>

          {/* Torrent takarítási napló — összecsukható, szűrhető */}
          <CollapsibleCard
            title="Torrent takarítási napló"
            storageKey="storage-torrentlog"
            count={torrentLog.length}
            searchable={torrentLog.length > 0}
            searchPlaceholder="Név keresése…"
            chips={torrentLog.length > 0 ? [{ key: "all", label: "Mind" }, { key: "auto", label: "Automatikus" }, { key: "manual", label: "Kézi" }] : undefined}
            badge={
              <span className={autoDeleteHours > 0 ? "badge badge-green" : "badge badge-gray"}>
                {autoDeleteHours > 0 ? `Auto-törlés: ${autoDeleteHours} óra` : "Auto-törlés kikapcsolva"}
              </span>
            }
          >
            {(q, chip) => {
              if (torrentLog.length === 0) {
                return (
                  <div style={{ padding: "32px 20px", textAlign: "center" }}>
                    <p className="text-sm text-gray-400">Még nincs törölt torrent</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Az automatikus törlés a Beállítások → Torrent kliens szekcióban kapcsolható be (óra megadásával).
                    </p>
                  </div>
                );
              }
              const items = torrentLog.filter((e) => (chip === "all" || e.mode === chip) && (!q || e.name.toLowerCase().includes(q)));
              if (items.length === 0) return <p className="text-sm text-gray-400 italic" style={{ padding: "16px 20px" }}>Nincs a szűrőnek megfelelő bejegyzés.</p>;
              return (
                <div>
                  {items.map((entry, idx) => (
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
              );
            }}
          </CollapsibleCard>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          A törlés a Sonarr/Radarr könyvtárból távolítja el a bejegyzést — a fájlok törlését a STORAGE_DELETE_FILES env-változó szabályozza.
        </p>
      </div>
    </AppShell>
  );
}
