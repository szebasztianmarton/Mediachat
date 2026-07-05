import { useState, useEffect, useCallback } from "react";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../utils/api";
import { useToast } from "../components/Toast";

interface Job {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  message: string;
  title: string;
  media_type: "movie" | "series";
  created_at: string | null;
  finished_at: string | null;
}

const STATUS_BADGE: Record<Job["status"], string> = {
  queued: "badge badge-gray",
  processing: "badge badge-amber",
  completed: "badge badge-green",
  failed: "badge badge-red",
};

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Sorban",
  processing: "Folyamatban",
  completed: "Kész",
  failed: "Hiba",
};

export default function JobsPage() {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ jobs: Job[] }>("/api/jobs");
      setJobs(data.jobs ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "A feladatok betöltése nem sikerült.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-frissítés, amíg van aktív (queued/processing) job
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  async function retry(job: Job) {
    setRetrying(job.id);
    try {
      await api(`/api/jobs/${job.id}/retry`, { method: "POST", body: JSON.stringify({}) });
      toast.info(`Újrapróbálás: ${job.title}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Az újrapróbálás nem sikerült.");
    } finally {
      setRetrying(null);
    }
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("hu-HU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  }

  const activeCount = jobs.filter((j) => j.status === "queued" || j.status === "processing").length;

  return (
    <AppShell>
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Feladatok
          </h1>
        </div>
        {activeCount > 0 && (
          <span className="badge badge-amber">
            <span className="dot dot-amber" />
            {activeCount} aktív
          </span>
        )}
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
            <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>
              Hozzáadási feladatok
            </h2>
            <span className="badge badge-gray">{jobs.length} feladat</span>
          </div>

          {loading && (
            <div style={{ padding: "16px 20px" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 14, width: `${80 - i * 12}%`, marginBottom: 10 }} />
              ))}
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <p className="text-sm text-gray-400">Nincs feladat</p>
              <p className="text-xs text-gray-400 mt-1">
                A háttérben futó hozzáadások (aszinkron mód) itt jelennek meg.
              </p>
            </div>
          )}

          {!loading && jobs.map((job, idx) => (
            <div
              key={job.id}
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
                  <span className="text-sm font-medium text-gray-900 truncate">{job.title}</span>
                  <span className="badge badge-gray">{job.media_type === "movie" ? "Film" : "Sorozat"}</span>
                  <span className={STATUS_BADGE[job.status]}>{STATUS_LABEL[job.status]}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Létrehozva: {fmtTime(job.created_at)}
                  {job.finished_at && ` · Befejezve: ${fmtTime(job.finished_at)}`}
                  {job.message && ` · ${job.message}`}
                </p>
              </div>
              {job.status === "failed" && (
                <button
                  onClick={() => retry(job)}
                  disabled={retrying === job.id}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Újra
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
