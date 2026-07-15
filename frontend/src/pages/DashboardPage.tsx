import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useServiceStatus } from "../hooks/useServiceStatus";
import type { ServiceHealth } from "../types";
import ServiceCard from "../components/ServiceCard";
import StatusBadge from "../components/StatusBadge";
import CollapsibleCard from "../components/CollapsibleCard";
import { AreaChart, DonutChart, HBarChart, fmtBytes } from "../components/Charts";
import { api } from "../utils/api";
import { logger } from "../utils/logger";
import { getAuth } from "../utils/auth";
import { useI18n } from "../i18n";
import type { TFunc, Lang } from "../i18n";
import type { WidgetId, WidgetInstance } from "../utils/dashboardLayout";
import { loadLayout, saveLayout, resetLayout } from "../utils/dashboardLayout";

// ── Now Playing ──────────────────────────────────────────────────────────────

interface StreamInfo {
  source: string;
  decision: "direct" | "copy" | "transcode";
  target: string;
}

interface MediaSession {
  id: string;
  username: string;
  user_avatar?: string | null;
  title: string;
  subtitle?: string | null;
  poster?: string | null;
  type: "movie" | "episode" | "music";
  source: "plex" | "jellyfin";
  state: "playing" | "paused";
  progressPercent: number;
  position_sec?: number;
  duration_sec?: number;
  runtime_min?: number | null;
  device?: string | null;
  client?: string | null;
  secure?: boolean;
  remote?: boolean | null;
  address?: string | null;
  bitrate_kbps?: number | null;
  play_method?: "direct" | "transcode" | null;
  transcode_reasons?: string[];
  streams?: { video?: StreamInfo; audio?: StreamInfo; subtitle?: StreamInfo };
}

interface SessionSummary {
  total: number;
  playing: number;
  paused: number;
  transcoding: number;
  direct: number;
  remote: number;
  transcode_bitrate_kbps: number;
}

// A poszter/avatar a Plex/Jellyfin szerverről a backend-proxyn át jön (a token
// query paraméterben, mert az <img> nem küld egyedi fejlécet). Az abszolút URL-t
// (pl. Plex avatar a plex.tv-ről) közvetlenül használjuk.
function imageUrl(s: MediaSession, ref?: string | null): string | undefined {
  if (!ref) return undefined;
  if (/^https?:\/\//i.test(ref)) return ref;
  const auth = getAuth();
  if (!auth?.token) return undefined;
  return `/api/media/image?source=${s.source}&path=${encodeURIComponent(ref)}&t=${encodeURIComponent(auth.token)}`;
}

function fmtClock(total?: number): string {
  if (total === undefined || total === null) return "";
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function fmtMbps(kbps?: number | null): string {
  if (!kbps) return "";
  const mbps = kbps / 1000;
  return `${mbps >= 10 ? Math.round(mbps) : mbps.toFixed(mbps % 1 === 0 ? 0 : 1)} Mbps`;
}

function SessionPoster({ s }: { s: MediaSession }) {
  const [err, setErr] = useState(false);
  const url = imageUrl(s, s.poster);
  if (url && !err) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setErr(true)}
        style={{ width: 60, height: 90, objectFit: "cover", borderRadius: 4, flexShrink: 0, background: "var(--surface-2)" }}
      />
    );
  }
  return (
    <div style={{ width: 60, height: 90, borderRadius: 4, flexShrink: 0, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
      <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </div>
  );
}

function StreamRow({ label, info }: { label: string; info: StreamInfo }) {
  return (
    <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border-2)", display: "flex", gap: 14 }}>
      <span className="text-xs text-gray-400" style={{ width: 60, flexShrink: 0, paddingTop: 1 }}>{label}</span>
      <div style={{ minWidth: 0 }}>
        <p className="text-xs text-gray-800 truncate" style={{ fontWeight: 500 }}>{info.source}</p>
        <p className="text-xs text-gray-400 truncate" style={{ marginTop: 2 }}>↳ {info.target}</p>
      </div>
    </div>
  );
}

function LockIcon({ secure }: { secure: boolean }) {
  return (
    <svg className="w-4 h-4" fill="none" stroke={secure ? "var(--ok, #16a34a)" : "var(--ink-3)"} strokeWidth="2" viewBox="0 0 24 24" role="img" aria-label={secure ? "Biztonságos kapcsolat" : "Nem titkosított"}>
      <title>{secure ? "Biztonságos kapcsolat" : "Nem titkosított"}</title>
      {secure ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      )}
    </svg>
  );
}

function SessionCard({ s }: { s: MediaSession }) {
  const transcoding = s.play_method === "transcode";
  const tint = transcoding ? "color-mix(in srgb, var(--warn, #ca8a04) 10%, transparent)" : undefined;
  const stateLabel = s.state === "paused" ? "Szünet" : "Lejátszás";
  const timeLine = s.duration_sec ? `${fmtClock(s.position_sec)} / ${fmtClock(s.duration_sec)}` : "";
  const netLine = [
    s.remote === null || s.remote === undefined ? null : s.remote ? "Távoli" : "Helyi",
    s.address ? `(${s.address})` : null,
  ].filter(Boolean).join(" ");
  const avatar = imageUrl(s, s.user_avatar);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
      {/* Poszter + cím */}
      <div style={{ display: "flex", gap: 12, padding: 12 }}>
        <SessionPoster s={s} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>{s.title}</span>
            <span className="badge" style={{ background: "var(--surface-2)", color: "var(--ink)", borderColor: "transparent", flexShrink: 0 }}>{s.source.toUpperCase()}</span>
          </div>
          {s.subtitle && <p className="text-xs text-gray-500 mt-1">{s.subtitle}</p>}
          {s.runtime_min ? <p className="text-xs text-gray-400 mt-1">{s.runtime_min} perc</p> : null}
        </div>
      </div>

      {/* Haladás sáv */}
      <div style={{ height: 3, background: "var(--surface-2)" }}>
        <div style={{ height: "100%", width: `${s.progressPercent}%`, background: transcoding ? "var(--warn, #ca8a04)" : "var(--ink)" }} />
      </div>

      {/* Lejátszó infó */}
      <div style={{ display: "flex", gap: 10, padding: "12px 16px", background: tint }}>
        <div style={{ paddingTop: 1 }}><LockIcon secure={!!s.secure} /></div>
        <div style={{ minWidth: 0 }}>
          <p className="text-xs text-gray-800" style={{ fontWeight: 500 }}>
            {s.client || "Ismeretlen kliens"}{s.device ? <span className="text-gray-400" style={{ fontWeight: 400 }}> — {s.device}</span> : null}
          </p>
          <p className="text-xs text-gray-400" style={{ marginTop: 2 }}>
            {stateLabel}{timeLine ? ` — ${timeLine}` : ""}
          </p>
          {(netLine || s.bitrate_kbps) && (
            <p className="text-xs text-gray-400" style={{ marginTop: 2 }}>
              {netLine}{s.bitrate_kbps ? `${netLine ? " — " : ""}${fmtMbps(s.bitrate_kbps)}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Sávok: videó / hang / felirat */}
      <div style={{ background: tint }}>
        {s.streams?.video && <StreamRow label="Videó" info={s.streams.video} />}
        {s.streams?.audio && <StreamRow label="Hang" info={s.streams.audio} />}
        {s.streams?.subtitle && <StreamRow label="Feliratok" info={s.streams.subtitle} />}
      </div>

      {/* Felhasználó */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: "1px solid var(--border-2)" }}>
        {avatar ? (
          <img src={avatar} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)" }}>
            <span className="text-xs font-semibold" style={{ color: "var(--ink)" }}>{s.username[0]?.toUpperCase()}</span>
          </div>
        )}
        <span className="text-xs text-gray-600">{s.username}</span>
      </div>
    </div>
  );
}

function NowPlayingWidget() {
  const [sessions, setSessions] = useState<MediaSession[] | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<{ sessions?: MediaSession[]; configured?: boolean; summary?: SessionSummary }>("/api/media/sessions");
        if (!cancelled) {
          if (data.configured === false) {
            setError("Plex/Jellyfin integráció nincs konfigurálva (PLEX_URL / JELLYFIN_URL)");
          } else {
            setError(null);
            setSessions(data.sessions ?? []);
            setSummary(data.summary ?? null);
            if ((data.sessions ?? []).length > 0) {
              logger.info("media", `${(data.sessions ?? []).length} aktív média lejátszás`);
            }
          }
        }
      } catch {
        if (!cancelled) setError("A média sessionök nem érhetők el");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="#000000" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m7.5-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-1.5-3.75h-7.5" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>Most nézi</h2>
        </div>
        {sessions && sessions.length > 0 && (
          <div className="flex items-center gap-1.5">
            {summary && summary.transcoding > 0 && (
              <span className="badge badge-amber" title="Átkódoló streamek — szerver CPU-terhelés">
                {summary.transcoding} átkódolás
              </span>
            )}
            {summary && summary.remote > 0 && (
              <span className="badge badge-gray" title="Távoli (LAN-on kívüli) lejátszások">
                {summary.remote} távoli
              </span>
            )}
            <span className="badge badge-green">
              <span className="dot dot-green" />
              {sessions.length} aktív
            </span>
          </div>
        )}
      </div>

      <div style={{ padding: "16px 20px" }}>
        {loading && (
          <div className="flex items-center gap-2">
            <div className="skeleton" style={{ width: 60, height: 90, borderRadius: 4 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ height: 12, width: "60%", marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 8, width: "40%" }} />
            </div>
          </div>
        )}
        {error && !loading && (
          <p className="text-xs text-gray-400 italic">{error}</p>
        )}
        {!loading && !error && sessions?.length === 0 && (
          <p className="text-sm text-gray-400">Jelenleg senki sem néz semmit.</p>
        )}
        {!loading && sessions && sessions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {sessions.map((s) => <SessionCard key={s.id} s={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Torrent Widget ────────────────────────────────────────────────────────────

interface TorrentItem {
  id: string;
  name: string;
  progressPercent: number;
  dlSpeed: number;
  state: "downloading" | "seeding" | "paused" | "queued" | "error";
  sizeBytes: number;
  completedAt?: number | null; // unix mp
  deleteAt?: number | null;    // unix mp — mikor törli az auto-cleanup
}

function fmtCountdown(deleteAt: number): string {
  const remaining = deleteAt - Date.now() / 1000;
  if (remaining <= 0) return "hamarosan törlődik";
  if (remaining < 3600) return `törlés ~${Math.max(1, Math.round(remaining / 60))} perc múlva`;
  return `törlés ~${Math.round(remaining / 3600)} óra múlva`;
}

function fmtSpeed(bps: number): string {
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
  if (bps >= 1_024) return `${(bps / 1_024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

const torrentStateBadge: Record<TorrentItem["state"], string> = {
  downloading: "badge badge-blue",
  seeding:     "badge badge-green",
  paused:      "badge badge-gray",
  queued:      "badge badge-amber",
  error:       "badge badge-red",
};

const torrentStateLabel: Record<TorrentItem["state"], string> = {
  downloading: "Letöltés",
  seeding:     "Seedelés",
  paused:      "Szünet",
  queued:      "Sorban",
  error:       "Hiba",
};

function TorrentWidget() {
  const [torrents, setTorrents] = useState<TorrentItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<{ torrents?: TorrentItem[]; configured?: boolean }>("/api/torrents");
        if (!cancelled) {
          if (data.configured === false) {
            setError("Torrent kliens nincs konfigurálva (Beállítások → Torrent)");
          } else {
            setError(null);
            setTorrents(data.torrents ?? []);
          }
        }
      } catch {
        if (!cancelled) setError("A torrent kliens nem érhető el");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  async function handleDelete(t: TorrentItem) {
    if (confirmDelete !== t.id) {
      setConfirmDelete(t.id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    setConfirmDelete(null);
    try {
      await api(`/api/torrents/${encodeURIComponent(t.id)}`, { method: "DELETE" });
      setTorrents((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
      logger.warn("torrent", `Torrent törölve: ${t.name}`);
    } catch {
      logger.error("torrent", `Torrent törlése sikertelen: ${t.name}`);
    }
  }

  const TORRENT_CHIPS = [
    { key: "all", label: "Mind" },
    { key: "downloading", label: "Letöltés" },
    { key: "seeding", label: "Seedelés" },
    { key: "error", label: "Hiba" },
  ];

  return (
    <CollapsibleCard
      title="Torrent letöltések"
      iconPath="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      storageKey="torrents"
      count={torrents?.length}
      searchable
      searchPlaceholder="Torrent keresése…"
      chips={torrents && torrents.length > 0 ? TORRENT_CHIPS : undefined}
      bodyStyle={{ padding: "16px 20px" }}
    >
      {(query, chip) => {
        if (loading) {
          return (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i}>
                  <div className="skeleton" style={{ height: 12, width: "70%", marginBottom: 6 }} />
                  <div className="skeleton" style={{ height: 6, borderRadius: 999 }} />
                </div>
              ))}
            </div>
          );
        }
        if (error) return <p className="text-sm text-gray-400 italic">{error}</p>;
        if (!torrents || torrents.length === 0) return <p className="text-sm text-gray-400">Nincs aktív letöltés.</p>;

        const filtered = torrents.filter(
          (t) => (chip === "all" || t.state === chip) && (!query || t.name.toLowerCase().includes(query))
        );
        if (filtered.length === 0) {
          return <p className="text-sm text-gray-400 italic">Nincs a szűrőnek megfelelő letöltés.</p>;
        }

        return (
          <div className="space-y-4">
            {filtered.map((t) => (
              <div key={t.id}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm text-gray-800 truncate" style={{ letterSpacing: "-0.01em" }}>{t.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={torrentStateBadge[t.state]}>
                      {torrentStateLabel[t.state]}
                      {t.state === "downloading" && ` · ${fmtSpeed(t.dlSpeed)}`}
                    </span>
                    <button
                      onClick={() => handleDelete(t)}
                      className={`btn btn-sm ${confirmDelete === t.id ? "btn-danger" : "btn-ghost"}`}
                      style={{ padding: "0 6px", height: 22 }}
                      title="Torrent törlése a kliensből"
                      aria-label={`${t.name} törlése`}
                    >
                      {confirmDelete === t.id ? "Biztos?" : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: `${t.progressPercent}%`,
                      background: t.state === "error" ? "var(--err)" : "var(--ink)",
                    }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {t.progressPercent}%
                  {t.deleteAt && <span style={{ color: "var(--warn)" }}> · {fmtCountdown(t.deleteAt)}</span>}
                </p>
              </div>
            ))}
          </div>
        );
      }}
    </CollapsibleCard>
  );
}

// ── Statisztika szekció ───────────────────────────────────────────────────────

interface StatsData {
  torrents: { total: number; downloading: number; seeding: number } | null;
  users: number;
  conversations: number;
  messages: number;
  adds_total: number;
  adds_by_day: { date: string; count: number }[];
  jobs: Record<string, number>;
}

interface LibraryStats {
  movies: { count: number; with_file: number; missing: number; size_bytes: number; top_genres: { name: string; count: number }[] };
  series: { count: number; seasons: number; episodes: number; size_bytes: number; top_genres: { name: string; count: number }[] };
  combined: { total_size_bytes: number; top_genres: { name: string; count: number }[] };
  sonarr_configured: boolean;
  radarr_configured: boolean;
}

// ── Áttekintő csempe ──────────────────────────────────────────────────────────

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-gray-500" style={{ letterSpacing: "0.03em" }}>{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1" style={{ letterSpacing: "-0.03em" }}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatsSection() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [lib, setLib] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<StatsData>("/api/stats", { timeoutMs: 60_000 }).catch(() => null),
      api<LibraryStats>("/api/library/stats", { timeoutMs: 60_000 }).catch(() => null),
    ]).then(([s, l]) => {
      if (cancelled) return;
      setStats(s);
      setLib(l);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-4">
            <div className="skeleton" style={{ height: 10, width: "60%", marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 22, width: "40%" }} />
          </div>
        ))}
      </div>
    );
  }

  const hasLib = lib && (lib.radarr_configured || lib.sonarr_configured);
  const adds = stats?.adds_by_day ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── FILM statisztika ── */}
      {lib && lib.radarr_configured && (
        <div>
          <p className="section-label mb-3">Filmek</p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="grid grid-cols-2 gap-3 lg:col-span-2" style={{ gridAutoRows: "min-content" }}>
              <Tile label="Film összesen" value={lib.movies.count} />
              <Tile label="Tárhely" value={fmtBytes(lib.movies.size_bytes)} />
              <Tile label="Fájllal" value={lib.movies.with_file} sub={`${lib.movies.missing} hiányzó`} />
              <Tile label="Átlag / film" value={lib.movies.with_file > 0 ? fmtBytes(lib.movies.size_bytes / lib.movies.with_file) : "—"} />
            </div>
            {lib.movies.top_genres.length > 0 && (
              <div className="card p-4">
                <p className="text-xs font-medium text-gray-500 mb-3">Top műfajok (film)</p>
                <HBarChart items={lib.movies.top_genres.slice(0, 5).map((g) => ({ label: g.name, value: g.count, valueLabel: String(g.count) }))} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SOROZAT statisztika ── */}
      {lib && lib.sonarr_configured && (
        <div>
          <p className="section-label mb-3">Sorozatok</p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="grid grid-cols-2 gap-3 lg:col-span-2" style={{ gridAutoRows: "min-content" }}>
              <Tile label="Sorozat összesen" value={lib.series.count} />
              <Tile label="Tárhely" value={fmtBytes(lib.series.size_bytes)} />
              <Tile label="Évadok" value={lib.series.seasons} sub={`${lib.series.episodes} epizód`} />
              <Tile label="Átlag / évad" value={lib.series.seasons > 0 ? fmtBytes(lib.series.size_bytes / lib.series.seasons) : "—"} />
            </div>
            {lib.series.top_genres.length > 0 && (
              <div className="card p-4">
                <p className="text-xs font-medium text-gray-500 mb-3">Top műfajok (sorozat)</p>
                <HBarChart items={lib.series.top_genres.slice(0, 5).map((g) => ({ label: g.name, value: g.count, valueLabel: String(g.count) }))} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Áttekintés: arány + idősor ── */}
      <div>
        <p className="section-label mb-3">Áttekintés</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {hasLib && (
            <div className="card p-4">
              <p className="text-xs font-medium text-gray-500 mb-3">Tárhely megoszlás</p>
              <DonutChart
                centerValue={fmtBytes(lib!.combined.total_size_bytes)}
                centerLabel="összesen"
                slices={[
                  { label: "Filmek", value: lib!.movies.size_bytes, color: "var(--primary-bg)" },
                  { label: "Sorozatok", value: lib!.series.size_bytes, color: "var(--warn)" },
                ]}
              />
            </div>
          )}
          {adds.length > 0 && (
            <div className="card p-4">
              <p className="text-xs font-medium text-gray-500 mb-3">Hozzáadások az elmúlt 14 napban</p>
              <AreaChart
                points={adds.map((d) => d.count)}
                labels={[adds[0]?.date ?? "", adds[adds.length - 1]?.date ?? ""]}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Rendszer csempék ── */}
      {stats && (
        <div>
          <p className="section-label mb-3">Rendszer</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="Hozzáadás összesen" value={stats.adds_total} />
            <Tile label="Aktív torrent" value={stats.torrents?.total ?? "—"} sub={stats.torrents ? `${stats.torrents.downloading} letölt · ${stats.torrents.seeding} seed` : undefined} />
            <Tile label="Beszélgetés" value={stats.conversations} sub={`${stats.messages} üzenet`} />
            <Tile label="Felhasználó" value={stats.users} />
          </div>
        </div>
      )}

      {!hasLib && !stats && (
        <div className="card" style={{ padding: "24px", textAlign: "center" }}>
          <p className="text-sm text-gray-400">Nincs elérhető statisztikai adat. Konfiguráld a Sonarr/Radarr kapcsolatot.</p>
        </div>
      )}
    </div>
  );
}

// ── Össz-tárhely szekció ──────────────────────────────────────────────────────

interface StorageAgg {
  disks: { path: string; total_bytes: number; used_bytes: number; free_bytes: number }[];
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  movies_total_bytes: number;
  series_total_bytes: number;
  radarr_configured: boolean;
  sonarr_configured: boolean;
}

function TotalStorageSection() {
  const [data, setData] = useState<StorageAgg | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<StorageAgg>("/api/library/storage", { timeoutMs: 60_000 })
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!data) return <WidgetPlaceholder label="Össztárhely betöltése…" />;
  if (!data.radarr_configured && !data.sonarr_configured)
    return <WidgetPlaceholder label="Össztárhely — nincs Sonarr/Radarr konfigurálva" />;
  const usedPct = data.total_bytes > 0 ? Math.round((data.used_bytes / data.total_bytes) * 100) : 0;

  return (
    <div>
      <p className="section-label mb-3">Össztárhely</p>
      <div className="card p-5">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <span className="text-2xl font-bold text-gray-900">{fmtBytes(data.used_bytes)}</span>
            <span className="text-sm text-gray-400"> / {fmtBytes(data.total_bytes)} használt ({usedPct}%)</span>
          </div>
          <span className="text-sm text-gray-500">{fmtBytes(data.free_bytes)} szabad</span>
        </div>
        {/* Halmozott sáv: film / sorozat / egyéb-használt / szabad */}
        <div style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-2)" }}>
          <Seg bytes={data.movies_total_bytes} total={data.total_bytes} color="var(--primary-bg)" title={`Filmek: ${fmtBytes(data.movies_total_bytes)}`} />
          <Seg bytes={data.series_total_bytes} total={data.total_bytes} color="var(--warn)" title={`Sorozatok: ${fmtBytes(data.series_total_bytes)}`} />
          <Seg bytes={Math.max(0, data.used_bytes - data.movies_total_bytes - data.series_total_bytes)} total={data.total_bytes} color="var(--ink-3)" title="Egyéb használt" />
          <Seg bytes={data.free_bytes} total={data.total_bytes} color="var(--surface-3)" title={`Szabad: ${fmtBytes(data.free_bytes)}`} />
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
          <LegendDot color="var(--primary-bg)" label={`Filmek ${fmtBytes(data.movies_total_bytes)}`} />
          <LegendDot color="var(--warn)" label={`Sorozatok ${fmtBytes(data.series_total_bytes)}`} />
          <LegendDot color="var(--ink-3)" label="Egyéb" />
          <LegendDot color="var(--surface-3)" label={`Szabad ${fmtBytes(data.free_bytes)}`} />
        </div>
      </div>
    </div>
  );
}

function Seg({ bytes, total, color, title }: { bytes: number; total: number; color: string; title: string }) {
  if (bytes <= 0 || total <= 0) return null;
  return <div title={title} style={{ width: `${(bytes / total) * 100}%`, background: color, minWidth: bytes > 0 ? 2 : 0 }} />;
}
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-2)" }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} /> {label}
    </span>
  );
}

// ── Jellyfin nézési analitika ─────────────────────────────────────────────────

interface JfUser {
  name: string;
  last_activity: string | null;
  last_login: string | null;
  watched_count: number;
  movies: number;
  episodes: number;
  total_minutes: number;
  avg_minutes: number;
  recent: { title: string; type: string; last_played: string | null; minutes: number }[];
  continue: { title: string; percent: number }[];
}

function fmtMinutes(min: number, t: TFunc): string {
  const hourU = t("time.hourShort");
  const minU = t("time.minShort");
  if (min < 60) return `${min} ${minU}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} ${hourU} ${m} ${minU}` : `${h} ${hourU}`;
}
function relDate(iso: string | null, t: TFunc, lang: Lang): string {
  if (!iso) return t("rel.never");
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return t("rel.today");
  if (days === 1) return t("rel.yesterday");
  if (days < 30) return t("rel.daysAgo", { n: days });
  return d.toLocaleDateString(lang === "en" ? "en-US" : "hu-HU", { year: "numeric", month: "short", day: "numeric" });
}

function WatchAnalyticsSection() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<{ configured: boolean; users: JfUser[]; total_users?: number; total_minutes?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ configured: boolean; users: JfUser[]; total_users?: number; total_minutes?: number }>("/api/jellyfin/analytics", { timeoutMs: 60_000 })
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div>
        <p className="section-label mb-3">{t("analytics.title")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="card p-4"><div className="skeleton" style={{ height: 14, width: "50%", marginBottom: 8 }} /><div className="skeleton" style={{ height: 10, width: "80%" }} /></div>)}
        </div>
      </div>
    );
  }
  if (!data?.configured) return <WidgetPlaceholder label={t("analytics.notConfigured")} />;
  if (data.users.length === 0) return <WidgetPlaceholder label={t("analytics.noData")} />;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <p className="section-label" style={{ margin: 0 }}>{t("analytics.title")}</p>
        <span className="text-xs text-gray-400">
          {t("analytics.summary", { users: data.total_users ?? 0, time: fmtMinutes(data.total_minutes ?? 0, t) })}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.users.map((u) => {
          const open = expanded === u.name;
          return (
            <div key={u.name} className="card" style={{ padding: 14, cursor: "pointer" }} onClick={() => setExpanded(open ? null : u.name)}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 999, background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {u.name[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="text-sm font-semibold text-gray-900 truncate">{u.name}</p>
                  <p className="text-[11px] text-gray-400">{t("analytics.lastActivity", { when: relDate(u.last_activity, t, lang) })}</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 12 }}>
                <Metric value={String(u.watched_count)} label={t("analytics.watched")} sub={t("analytics.countsShort", { movies: u.movies, episodes: u.episodes })} />
                <Metric value={fmtMinutes(u.total_minutes, t)} label={t("analytics.total")} />
                <Metric value={fmtMinutes(u.avg_minutes, t)} label={t("analytics.avg")} />
              </div>
              {u.continue.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p className="text-[10px] text-gray-400 uppercase" style={{ letterSpacing: "0.05em", marginBottom: 4 }}>{t("analytics.inProgress")}</p>
                  {u.continue.slice(0, open ? 6 : 2).map((c, i) => (
                    <div key={i} style={{ marginBottom: 5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                        <span className="text-xs text-gray-700 truncate" style={{ flex: 1 }}>{c.title}</span>
                        <span className="text-xs text-gray-400">{c.percent}%</span>
                      </div>
                      <div style={{ height: 3, background: "var(--surface-3)", borderRadius: 2, marginTop: 2 }}>
                        <div style={{ height: "100%", width: `${c.percent}%`, background: "var(--ok)", borderRadius: 2 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {open && u.recent.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--border-2)", paddingTop: 8 }}>
                  <p className="text-[10px] text-gray-400 uppercase" style={{ letterSpacing: "0.05em", marginBottom: 4 }}>{t("analytics.recent")}</p>
                  {u.recent.map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                      <span className="text-xs text-gray-700 truncate" style={{ flex: 1 }}>{r.title}</span>
                      <span className="text-[11px] text-gray-400 shrink-0">{relDate(r.last_played, t, lang)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div>
      <p className="text-sm font-bold text-gray-900" style={{ lineHeight: 1.1 }}>{value}</p>
      <p className="text-[10px] text-gray-400">{label}{sub && ` · ${sub}`}</p>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ value, label, icon }: { value: string | number; label: string; icon: string; color?: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide" style={{ letterSpacing: "0.05em" }}>{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1" style={{ letterSpacing: "-0.03em" }}>{value}</p>
        </div>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: "var(--surface-2)" }}
        >
          <svg className="w-4 h-4" fill="none" stroke="#000000" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ── Quick action card ─────────────────────────────────────────────────────────

function QuickAction({ icon, title, desc, href }: { icon: string; title: string; desc: string; href: string }) {
  return (
    <Link
      to={href}
      className="card card-hover p-4 flex items-center gap-3 group cursor-pointer"
      style={{ textDecoration: "none" }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)" }}>
        <svg className="w-4 h-4" fill="none" stroke="#000000" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900" style={{ letterSpacing: "-0.01em" }}>{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
      <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-700 transition-colors shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}

// ── Widget placeholder (nem konfigurált / üres widgetekhez) ────────────────────

function WidgetPlaceholder({ label }: { label: string }) {
  return (
    <div className="card" style={{ padding: "24px 20px", textAlign: "center" }}>
      <p className="text-sm text-gray-400">{label}</p>
    </div>
  );
}

// ── Widgetté kiemelt korábbi szekciók ─────────────────────────────────────────

function StatusTilesWidget({ services }: { services: ServiceHealth[] }) {
  const onlineCount = services.filter((s) => s.status === "online").length;
  const totalCount = services.length;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <StatCard
        value={`${onlineCount}/${totalCount}`}
        label="Online"
        icon="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
      />
      <StatCard
        value={services.filter((s) => s.status === "offline").length}
        label="Offline"
        icon="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
      <StatCard
        value={services.some((s) => s.key === "sonarr" && s.status === "online") ? "OK" : "—"}
        label="Sonarr"
        icon="M15 10l4.553-2.069A1 1 0 0121 8.869V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
      />
      <StatCard
        value={services.some((s) => s.key === "radarr" && s.status === "online") ? "OK" : "—"}
        label="Radarr"
        icon="M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
      />
    </div>
  );
}

function ServicesWidget({ services }: { services: ServiceHealth[] }) {
  return (
    <div>
      <p className="section-label mb-3">Szolgáltatások</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {services.map((service) => (
          <ServiceCard key={service.key} service={service} />
        ))}
      </div>
    </div>
  );
}

function QuickActionsWidget() {
  return (
    <div>
      <p className="section-label mb-3">Gyors műveletek</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <QuickAction
          icon="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
          title="Chat"
          desc="Kérdezd meg a Media Assistentet"
          href="/chat"
        />
        <QuickAction
          icon="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
          title="Felhasználók"
          desc="Hozzáférés kezelése"
          href="/users"
        />
        <QuickAction
          icon="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
          title="Naplók"
          desc="Rendszer eseménynapló"
          href="/logs"
        />
      </div>
    </div>
  );
}

function SystemInfoWidget() {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-4" style={{ letterSpacing: "-0.01em" }}>Rendszer információ</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Backend", value: "FastAPI" },
          { label: "Interfész", value: "Media Chatbot" },
          { label: "AI modell", value: "Ollama" },
          { label: "Verzió", value: "MVP 3.0" },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: "10px 14px", background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border-2)" }}>
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className="text-sm font-medium text-gray-800" style={{ fontFamily: "ui-monospace, monospace", letterSpacing: 0 }}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Widget-regiszter ──────────────────────────────────────────────────────────

interface WidgetCtx {
  services: ServiceHealth[];
}

interface WidgetMeta {
  id: WidgetId;
  title: string;
  desc: string;
  sizeable: boolean; // half ↔ full átméretezhető-e
  render: (ctx: WidgetCtx) => ReactNode;
}

const WIDGETS: WidgetMeta[] = [
  { id: "status", title: "Állapot csempék", desc: "Online/offline összegzés + Sonarr/Radarr", sizeable: false, render: (c) => <StatusTilesWidget services={c.services} /> },
  { id: "services", title: "Szolgáltatások", desc: "Backend, Sonarr, Radarr, Ollama, TMDB, Redis", sizeable: false, render: (c) => <ServicesWidget services={c.services} /> },
  { id: "now-playing", title: "Most nézi", desc: "Aktív Plex/Jellyfin lejátszások", sizeable: true, render: () => <NowPlayingWidget /> },
  { id: "torrents", title: "Torrent letöltések", desc: "Aktív letöltések állapota", sizeable: true, render: () => <TorrentWidget /> },
  { id: "storage", title: "Össztárhely", desc: "Lemezhasználat film/sorozat bontásban", sizeable: false, render: () => <TotalStorageSection /> },
  { id: "library", title: "Könyvtár statisztika", desc: "Film/sorozat számok, tárhely, top műfajok", sizeable: false, render: () => <StatsSection /> },
  { id: "watchers", title: "Jellyfin nézők", desc: "Per-felhasználó nézési statisztika", sizeable: false, render: () => <WatchAnalyticsSection /> },
  { id: "quick-actions", title: "Gyors műveletek", desc: "Chat, Felhasználók, Naplók", sizeable: false, render: () => <QuickActionsWidget /> },
  { id: "system-info", title: "Rendszer információ", desc: "Backend, modell, verzió", sizeable: false, render: () => <SystemInfoWidget /> },
];

const WIDGET_MAP: Record<string, WidgetMeta> = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

// ── Widget eszköztár ikongomb ─────────────────────────────────────────────────

function ToolBtn({ onClick, title, disabled, danger, grab, path }: {
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  grab?: boolean;
  path: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`${danger ? "dash-remove" : ""} ${grab ? "dash-drag-handle" : ""}`}
    >
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </button>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { services, refresh } = useServiceStatus();
  const auth = getAuth();
  const userId = auth?.userId ?? "anon";

  const [layout, setLayout] = useState<WidgetInstance[]>(() => loadLayout(userId));
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Elrendezés perzisztálása minden változáskor
  useEffect(() => { saveLayout(userId, layout); }, [userId, layout]);

  const onlineCount = services.filter((s) => s.status === "online").length;
  const totalCount = services.length;
  const isChecking = services.some((s) => s.status === "checking");
  const overallStatus = isChecking ? "checking" : onlineCount === totalCount ? "online" : onlineCount === 0 ? "offline" : "online";

  const placed = new Set(layout.map((w) => w.id));
  const available = WIDGETS.filter((w) => !placed.has(w.id));
  const ctx: WidgetCtx = { services };

  function addWidget(id: WidgetId) {
    setLayout((l) => [...l, { id, size: WIDGET_MAP[id].sizeable ? "half" : "full" }]);
    if (available.length <= 1) setAddOpen(false);
  }
  function removeWidget(idx: number) {
    setLayout((l) => l.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    setLayout((l) => {
      const j = idx + dir;
      if (j < 0 || j >= l.length) return l;
      const copy = [...l];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  }
  function toggleSize(idx: number) {
    setLayout((l) => l.map((w, i) => (i === idx ? { ...w, size: w.size === "full" ? "half" : "full" } : w)));
  }
  function reorder(from: number, to: number) {
    setLayout((l) => {
      const copy = [...l];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  }
  function doReset() {
    setLayout(resetLayout(userId));
    setAddOpen(false);
  }

  return (
    <AppShell>
      {/* Page top bar */}
      <div className="page-topbar">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Rendszer áttekintés
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <StatusBadge
              status={overallStatus}
              label={isChecking ? "Ellenőrzés..." : `${onlineCount}/${totalCount} online`}
            />
          )}
          {editing ? (
            <>
              <button onClick={doReset} className="btn btn-ghost btn-sm" title="Alaphelyzetbe állítás">
                Alaphelyzet
              </button>
              <button onClick={() => { setEditing(false); setAddOpen(false); }} className="btn btn-primary btn-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Kész
              </button>
            </>
          ) : (
            <>
              <button onClick={refresh} className="btn btn-secondary btn-sm" aria-label="Frissítés">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Frissítés
              </button>
              <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm" title="Dashboard testreszabása">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Testreszabás
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "24px" }}>
        {editing && (
          <p className="text-xs text-gray-500 mb-4" style={{ lineHeight: 1.6 }}>
            Húzd át a widgeteket az átrendezéshez, vagy használd a nyilakat. Az átméretezhető widgetek fél/teljes
            szélességre válthatók. A módosítások automatikusan mentődnek erre az eszközre.
          </p>
        )}

        <div className="dash-grid">
          {layout.map((inst, idx) => {
            const meta = WIDGET_MAP[inst.id];
            if (!meta) return null;
            const sizeClass = inst.size === "half" ? "dash-widget--half" : "dash-widget--full";
            return (
              <div
                key={inst.id}
                className={`dash-widget ${sizeClass}${editing ? " dash-widget--editing" : ""}${dragOverIdx === idx ? " dash-widget--dragover" : ""}${dragIndex.current === idx ? " dash-widget--dragging" : ""}`}
                draggable={editing}
                onDragStart={editing ? () => { dragIndex.current = idx; } : undefined}
                onDragOver={editing ? (e) => { e.preventDefault(); if (dragOverIdx !== idx) setDragOverIdx(idx); } : undefined}
                onDrop={editing ? (e) => {
                  e.preventDefault();
                  if (dragIndex.current !== null && dragIndex.current !== idx) reorder(dragIndex.current, idx);
                  dragIndex.current = null;
                  setDragOverIdx(null);
                } : undefined}
                onDragEnd={editing ? () => { dragIndex.current = null; setDragOverIdx(null); } : undefined}
              >
                {editing && (
                  <div className="dash-toolbar">
                    <ToolBtn grab title="Húzd az átrendezéshez" path="M8.25 6.75h.008v.008H8.25V6.75Zm0 5.25h.008v.008H8.25v-.008Zm0 5.25h.008v.008H8.25v-.008Zm7.5-10.5h.008v.008h-.008V6.75Zm0 5.25h.008v.008h-.008v-.008Zm0 5.25h.008v.008h-.008v-.008Z" />
                    <ToolBtn onClick={() => move(idx, -1)} disabled={idx === 0} title="Fel" path="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    <ToolBtn onClick={() => move(idx, 1)} disabled={idx === layout.length - 1} title="Le" path="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    {meta.sizeable && (
                      <ToolBtn onClick={() => toggleSize(idx)} title={inst.size === "full" ? "Fél szélesség" : "Teljes szélesség"} path="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M15 15v4.5M15 15h4.5M15 15l5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M9 15v4.5M9 15H4.5M9 15l-5.25 5.25" />
                    )}
                    <ToolBtn danger onClick={() => removeWidget(idx)} title="Eltávolítás" path="M6 18L18 6M6 6l12 12" />
                  </div>
                )}
                <div className={editing ? "dash-widget__content--editing" : undefined}>
                  {meta.render(ctx)}
                </div>
              </div>
            );
          })}

          {editing && available.length > 0 && (
            <button type="button" className="dash-add-tile" onClick={() => setAddOpen(true)}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Widget hozzáadása ({available.length})
            </button>
          )}

          {layout.length === 0 && !editing && (
            <div className="dash-empty">
              <p className="text-sm">A dashboard üres.</p>
              <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
                Widgetek hozzáadása
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Widget-hozzáadó panel */}
      {addOpen && (
        <>
          <button className="app-overlay" onClick={() => setAddOpen(false)} aria-label="Bezárás" />
          <div
            role="dialog"
            aria-label="Widget hozzáadása"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(440px, calc(100vw - 32px))",
              maxHeight: "80vh",
              overflowY: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-pop)",
              zIndex: 60,
              padding: 8,
            }}
          >
            <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 className="text-sm font-semibold text-gray-900">Widget hozzáadása</h2>
              <button onClick={() => setAddOpen(false)} className="btn btn-ghost btn-sm" aria-label="Bezárás" style={{ padding: "2px 6px" }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {available.length === 0 ? (
              <p className="text-sm text-gray-400" style={{ padding: "12px 10px 16px" }}>Minden widget a dashboardon van.</p>
            ) : (
              available.map((w) => (
                <button
                  key={w.id}
                  onClick={() => addWidget(w.id)}
                  className="select-row"
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 10px", borderRadius: "var(--radius-sm)", background: "transparent", border: "none" }}
                >
                  <span className="text-sm font-medium text-gray-900" style={{ display: "block" }}>{w.title}</span>
                  <span className="text-xs text-gray-500">{w.desc}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
