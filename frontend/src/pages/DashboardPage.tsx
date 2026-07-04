import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useServiceStatus } from "../hooks/useServiceStatus";
import ServiceCard from "../components/ServiceCard";
import StatusBadge from "../components/StatusBadge";
import { api } from "../utils/api";
import { logger } from "../utils/logger";

// ── Now Playing ──────────────────────────────────────────────────────────────

interface MediaSession {
  id: string;
  username: string;
  title: string;
  type: "movie" | "episode" | "music";
  source: "plex" | "jellyfin";
  state: "playing" | "paused";
  progressPercent: number;
  thumb?: string;
}

function NowPlayingWidget() {
  const [sessions, setSessions] = useState<MediaSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<{ sessions?: MediaSession[]; configured?: boolean }>("/api/media/sessions");
        if (!cancelled) {
          if (data.configured === false) {
            setError("Plex/Jellyfin integráció nincs konfigurálva (PLEX_URL / JELLYFIN_URL)");
          } else {
            setError(null);
            setSessions(data.sessions ?? []);
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
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#F0F0F0" }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="#000000" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m7.5-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-1.5-3.75h-7.5" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>Most nézi</h2>
        </div>
        {sessions && sessions.length > 0 && (
          <span className="badge badge-green">
            <span className="dot dot-green" />
            {sessions.length} aktív
          </span>
        )}
      </div>

      <div style={{ padding: "16px 20px" }}>
        {loading && (
          <div className="flex items-center gap-2">
            <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
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
          <div className="space-y-3">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "#F0F0F0" }}
                >
                  <span className="text-xs font-semibold" style={{ color: "#000000" }}>
                    {s.username[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900 truncate" style={{ letterSpacing: "-0.01em" }}>{s.title}</span>
                    <span
                      className="badge"
                      style={{
                        background: "#F0F0F0",
                        color: "#000000",
                        borderColor: "transparent",
                        flexShrink: 0,
                      }}
                    >
                      {s.source.toUpperCase()}
                    </span>
                    {s.state === "paused" && (
                      <span className="badge badge-gray" style={{ flexShrink: 0 }}>szünet</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{s.username}</span>
                    <div className="flex-1 h-1 bg-gray-100 rounded-full">
                      <div
                        className="h-1 rounded-full"
                        style={{ width: `${s.progressPercent}%`, background: "#000000" }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{s.progressPercent}%</span>
                  </div>
                </div>
              </div>
            ))}
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<{ torrents?: TorrentItem[]; configured?: boolean }>("/api/torrents");
        if (!cancelled) {
          if (data.configured === false) {
            setError("Torrent kliens nincs konfigurálva (QBITTORRENT_URL)");
          } else {
            setError(null);
            setTorrents(data.torrents ?? []);
          }
        }
      } catch {
        if (!cancelled) setError("A qBittorrent nem érhető el");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#F0F0F0" }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="#000000" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>Torrent letöltések</h2>
        </div>
      </div>

      <div style={{ padding: "16px 20px" }}>
        {loading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i}>
                <div className="skeleton" style={{ height: 12, width: "70%", marginBottom: 6 }} />
                <div className="skeleton" style={{ height: 6, borderRadius: 999 }} />
              </div>
            ))}
          </div>
        )}
        {error && !loading && <p className="text-sm text-gray-400 italic">{error}</p>}
        {!loading && !error && torrents?.length === 0 && (
          <p className="text-sm text-gray-400">Nincs aktív letöltés.</p>
        )}
        {!loading && torrents && torrents.length > 0 && (
          <div className="space-y-4">
            {torrents.map((t) => (
              <div key={t.id}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm text-gray-800 truncate" style={{ letterSpacing: "-0.01em" }}>{t.name}</span>
                  <span className={torrentStateBadge[t.state]}>
                    {torrentStateLabel[t.state]}
                    {t.state === "downloading" && ` · ${fmtSpeed(t.dlSpeed)}`}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full">
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: `${t.progressPercent}%`,
                      background: t.state === "error" ? "#888888" : "#000000",
                    }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">{t.progressPercent}%</p>
              </div>
            ))}
          </div>
        )}
      </div>
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
          style={{ background: "#F0F0F0" }}
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
      className="card p-4 flex items-center gap-3 group cursor-pointer"
      style={{ textDecoration: "none", transition: "border-color 0.15s, box-shadow 0.15s" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#E0E0E0";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#D8D8D8";
        (e.currentTarget as HTMLElement).style.boxShadow = "";
      }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#F0F0F0" }}>
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

// ── Dashboard Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { services, refresh } = useServiceStatus();

  const onlineCount  = services.filter((s) => s.status === "online").length;
  const totalCount   = services.length;
  const isChecking   = services.some((s) => s.status === "checking");
  const overallStatus = isChecking ? "checking" : onlineCount === totalCount ? "online" : onlineCount === 0 ? "offline" : "online";

  return (
    <AppShell>
      {/* Page top bar */}
      <div className="page-topbar">
        <div className="flex-1 min-w-0">
          <h1
            className="text-base font-semibold text-gray-900"
            style={{ letterSpacing: "-0.02em" }}
          >
            Rendszer áttekintés
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge
            status={overallStatus}
            label={
              isChecking
                ? "Ellenőrzés..."
                : `${onlineCount}/${totalCount} online`
            }
          />
          <button
            onClick={refresh}
            className="btn btn-secondary btn-sm"
            aria-label="Frissítés"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Frissítés
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "24px" }}>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard
            value={`${onlineCount}/${totalCount}`}
            label="Online"
            icon="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
            color="#000000"
          />
          <StatCard
            value={services.filter(s => s.status === "offline").length}
            label="Offline"
            icon="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            color="#ef4444"
          />
          <StatCard
            value={services.filter(s => s.key === "sonarr" && s.status === "online").length > 0 ? "OK" : "—"}
            label="Sonarr"
            icon="M15 10l4.553-2.069A1 1 0 0121 8.869V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
            color="#0ea5e9"
          />
          <StatCard
            value={services.filter(s => s.key === "radarr" && s.status === "online").length > 0 ? "OK" : "—"}
            label="Radarr"
            icon="M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
            color="#eab308"
          />
        </div>

        {/* Services */}
        <div className="mb-2">
          <p className="section-label mb-3">Szolgáltatások</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
            {services.map((service) => (
              <ServiceCard key={service.key} service={service} />
            ))}
          </div>
        </div>

        {/* Media + Torrents */}
        <div className="mb-2">
          <p className="section-label mb-3">Média &amp; Letöltések</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            <NowPlayingWidget />
            <TorrentWidget />
          </div>
        </div>

        {/* Quick actions */}
        <div className="mb-2">
          <p className="section-label mb-3">Gyors műveletek</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
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

        {/* System info */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4" style={{ letterSpacing: "-0.01em" }}>Rendszer információ</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Backend", value: "FastAPI" },
              { label: "Interfész", value: "Media Chatbot" },
              { label: "AI modell", value: "Ollama" },
              { label: "Verzió", value: "MVP 3.0" },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: "10px 14px", background: "#F5F5F5", borderRadius: 8, border: "1px solid #E8E8E8" }}>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className="text-sm font-medium text-gray-800" style={{ fontFamily: "ui-monospace, monospace", letterSpacing: 0 }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  );
}
