import { useState, useEffect, useCallback } from "react";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../utils/api";
import { logger } from "../utils/logger";

interface RecItem {
  title: string;
  year?: number | null;
  overview: string;
  poster_url?: string | null;
  media_type: "movie" | "series";
  external_id: number;
  tmdb_id?: number | null;
  reason: string;
}

type Catalog = "watched" | "liked" | "continue";

const CATALOGS: { key: Catalog; label: string; hint: string }[] = [
  { key: "liked", label: "Kedvelt alapján", hint: "A kedvelt tartalmaidhoz hasonló címek" },
  { key: "watched", label: "Hozzáadott alapján", hint: "A hozzáadott tartalmaidhoz hasonló címek" },
  { key: "continue", label: "Folytatás", hint: "Sorozataid, amikből még hiányzik epizód" },
];

function RecCard({ item, onFeedback }: { item: RecItem; onFeedback: (item: RecItem, liked: boolean) => Promise<void> }) {
  const [voted, setVoted] = useState<"like" | "dislike" | null>(null);
  const [busy, setBusy] = useState(false);

  async function vote(liked: boolean) {
    if (voted || busy) return;
    setBusy(true);
    try {
      await onFeedback(item, liked);
      setVoted(liked ? "like" : "dislike");
    } catch {
      // a hibát az onFeedback logolja
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "flex", gap: 14, padding: 14 }}>
      {/* Poster */}
      <div
        style={{
          width: 56,
          height: 80,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          flexShrink: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {item.poster_url ? (
          <img src={item.poster_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>
            {item.title}
          </span>
          {item.year && <span className="text-xs text-gray-400">{item.year}</span>}
          <span className="badge badge-gray">{item.media_type === "movie" ? "Film" : "Sorozat"}</span>
        </div>
        {item.overview && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.overview}</p>
        )}
        {item.reason && (
          <p className="text-xs text-gray-400 mt-1 italic">{item.reason}</p>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 10 }}>
          <button
            onClick={() => vote(true)}
            disabled={busy || voted !== null}
            className={`btn btn-sm ${voted === "like" ? "btn-primary" : "btn-secondary"}`}
            aria-label={`${item.title} kedvelése`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M6.633 10.25c-.483 0-.964-.078-1.423-.23L2.096 8.98A4.501 4.501 0 00.673 8.75v9.5c.483 0 .964.078 1.423.23l3.114 1.04c.459.152.94.23 1.423.23" />
            </svg>
            {voted === "like" ? "Kedvelve" : "Tetszik"}
          </button>
          <button
            onClick={() => vote(false)}
            disabled={busy || voted !== null}
            className="btn btn-secondary btn-sm"
            aria-label={`${item.title} elutasítása`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: "rotate(180deg)" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M6.633 10.25c-.483 0-.964-.078-1.423-.23L2.096 8.98A4.501 4.501 0 00.673 8.75v9.5c.483 0 .964.078 1.423.23l3.114 1.04c.459.152.94.23 1.423.23" />
            </svg>
            {voted === "dislike" ? "Elutasítva" : "Nem érdekel"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RecommendationsPage() {
  const [catalog, setCatalog] = useState<Catalog>("liked");
  const [items, setItems] = useState<RecItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (cat: Catalog) => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ items: RecItem[] }>(`/api/recommendations/${cat}`, { timeoutMs: 60_000 });
      setItems(data.items ?? []);
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : "Az ajánlások betöltése nem sikerült.");
      logger.error("media", "Ajánlások betöltése sikertelen");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(catalog); }, [catalog, load]);

  const handleFeedback = useCallback(async (item: RecItem, liked: boolean) => {
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          media_type: item.media_type,
          external_id: item.external_id,
          title: item.title,
          tmdb_id: item.tmdb_id ?? null,
          liked,
        }),
      });
      logger.info("media", `Visszajelzés: ${item.title} — ${liked ? "tetszik" : "nem érdekel"}`);
    } catch (err) {
      logger.error("media", "Visszajelzés küldése sikertelen");
      throw err;
    }
  }, []);

  const active = CATALOGS.find((c) => c.key === catalog)!;

  return (
    <AppShell>
      {/* Top bar */}
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Ajánlások
          </h1>
        </div>
        <button onClick={() => load(catalog)} className="btn btn-secondary btn-sm" disabled={loading}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Frissítés
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>

        {/* Catalog selector */}
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", maxWidth: 480, marginBottom: 8 }}>
          {CATALOGS.map((c, i) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCatalog(c.key)}
              style={{
                flex: 1,
                padding: "8px 0",
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
                border: "none",
                borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                background: catalog === c.key ? "var(--primary-bg)" : "var(--surface)",
                color: catalog === c.key ? "var(--primary-ink)" : "var(--ink-3)",
                transition: "none",
                fontFamily: "inherit",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mb-6">{active.hint}</p>

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card" style={{ display: "flex", gap: 14, padding: 14 }}>
                <div className="skeleton" style={{ width: 56, height: 80, borderRadius: 4, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 14, width: "50%", marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 10, width: "90%", marginBottom: 4 }} />
                  <div className="skeleton" style={{ height: 10, width: "70%" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="card" style={{ padding: "16px 20px", background: "var(--surface-2)", borderColor: "var(--border)" }}>
            <p className="text-xs text-gray-700">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && items.length === 0 && (
          <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div
              style={{
                width: 44, height: 44, margin: "0 auto 12px", borderRadius: 8,
                background: "var(--surface-2)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.563.563 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700">Még nincs ajánlás</p>
            <p className="text-xs text-gray-400 mt-1" style={{ maxWidth: 380, margin: "4px auto 0" }}>
              {catalog === "continue"
                ? "Ha lesz olyan sorozatod, amiből hiányzik epizód, itt jelenik meg."
                : "Adj hozzá tartalmakat a chatben, vagy kedvelj ajánlásokat — ezekből tanulja meg a rendszer, mit érdemes ajánlani."}
            </p>
          </div>
        )}

        {/* Items */}
        {!loading && items.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {items.map((item) => (
              <RecCard key={`${item.media_type}-${item.external_id}`} item={item} onFeedback={handleFeedback} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
