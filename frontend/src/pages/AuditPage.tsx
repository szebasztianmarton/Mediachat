import { useState, useEffect, useCallback } from "react";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../utils/api";

interface AuditEntry {
  type: string;
  user: string | null;
  title: string;
  media_type: "movie" | "series" | null;
  created_at: string | null;
  mode?: string;
}

const TYPE_BADGE: Record<string, string> = {
  added: "badge badge-green",
  liked: "badge badge-blue",
  dropped: "badge badge-gray",
  torrent_cleanup: "badge badge-amber",
};

const TYPE_LABEL: Record<string, string> = {
  added: "Hozzáadva",
  liked: "Kedvelve",
  dropped: "Elutasítva",
  torrent_cleanup: "Torrent törölve",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ entries: AuditEntry[] }>("/api/audit");
      setEntries(data.entries ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Az audit napló betöltése nem sikerült.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function fmtTime(iso: string | null): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("hu-HU", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  }

  return (
    <AppShell>
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Audit napló
          </h1>
        </div>
        <button onClick={load} className="btn btn-secondary btn-sm" disabled={loading}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Frissítés
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>
        {error && (
          <div className="card mb-6" style={{ padding: "12px 16px", background: "var(--surface-2)", borderColor: "var(--border-strong)" }}>
            <p className="text-xs text-gray-700">{error}</p>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>
                Ki mit adott hozzá / törölt
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Hozzáadások, kedvelés/elutasítás visszajelzés és az automatikus torrent-törlések, időrendben.
              </p>
            </div>
            <span className="badge badge-gray">{entries.length} bejegyzés</span>
          </div>

          {loading && (
            <div style={{ padding: "16px 20px" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 14, width: `${80 - i * 12}%`, marginBottom: 10 }} />
              ))}
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <p className="text-sm text-gray-400">Még nincs napló-bejegyzés</p>
            </div>
          )}

          {!loading && entries.map((entry, idx) => (
            <div
              key={idx}
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
                  <span className="text-sm font-medium text-gray-900 truncate">{entry.title}</span>
                  {entry.media_type && (
                    <span className="badge badge-gray">{entry.media_type === "movie" ? "Film" : "Sorozat"}</span>
                  )}
                  <span className={TYPE_BADGE[entry.type] ?? "badge badge-gray"}>
                    {TYPE_LABEL[entry.type] ?? entry.type}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {entry.user ? `${entry.user} · ` : ""}{fmtTime(entry.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
