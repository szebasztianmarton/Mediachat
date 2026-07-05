import type { ServiceHealth } from "../types";
import StatusBadge from "./StatusBadge";

interface Props {
  service: ServiceHealth;
}

const icons: Record<string, string> = {
  backend:  "M5 12h14M12 5l7 7-7 7",
  sonarr:   "M15 10l4.553-2.069A1 1 0 0121 8.869V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z",
  radarr:   "M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z",
  ollama:   "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  tmdb:     "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  redis:    "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
};

const serviceMeta: Record<string, string> = {
  backend: "FastAPI szerver",
  sonarr:  "TV sorozatkezelő",
  radarr:  "Film letöltő",
  ollama:  "Helyi AI modell",
  tmdb:    "Film adatbázis",
  redis:   "Cache & queue",
};

export default function ServiceCard({ service }: Props) {
  const icon = icons[service.key] ?? icons.backend;
  const desc = serviceMeta[service.key] ?? "Szolgáltatás";
  const isOnline   = service.status === "online";
  const isChecking = service.status === "checking";

  return (
    <div
      className="card p-4 flex items-start gap-3"
      style={{
        borderColor: isOnline ? "#CCCCCC" : isChecking ? "#E0E0E0" : "#EEEEEE",
      }}
    >
      <div
        className="rounded-md p-2 flex-shrink-0 mt-0.5"
        style={{ background: "var(--surface-2)" }}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="#000000"
          strokeWidth="1.75"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm truncate" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>
            {service.name}
          </span>
          <StatusBadge status={service.status} />
        </div>
        <p className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>{desc}</p>
        {service.latency !== undefined && isOnline && (
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>{service.latency}ms</p>
        )}
        {service.error && !isOnline && !isChecking && (
          <p className="text-xs mt-0.5 wrap-break-word" style={{ fontSize: 11, color: "var(--ink-2)" }}>
            {service.error}
          </p>
        )}
      </div>
    </div>
  );
}
