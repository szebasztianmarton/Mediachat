import { useState, useEffect, useCallback } from "react";
import type { ServiceHealth, ServiceStatus } from "../types";

interface HealthResponse {
  status: string;
  sonarr: boolean;
  radarr: boolean;
  ollama?: boolean;
  tmdb?: boolean;
  redis?: boolean;
  sonarr_error?: string;
  radarr_error?: string;
  ollama_error?: string;
}

function makeService(key: string, name: string, status: ServiceStatus = "checking"): ServiceHealth {
  return { key, name, status };
}

export function useServiceStatus(autoRefresh = true) {
  const [services, setServices] = useState<ServiceHealth[]>([
    makeService("backend", "Backend API"),
    makeService("sonarr", "Sonarr"),
    makeService("radarr", "Radarr"),
    makeService("ollama", "Ollama"),
    makeService("tmdb", "TMDB"),
    makeService("redis", "Redis"),
  ]);

  const check = useCallback(async () => {
    const start = Date.now();
    try {
      const res = await fetch("/health");
      const latency = Date.now() - start;

      if (!res.ok) {
        let backendError = `Backend hiba (HTTP ${res.status})`;
        if (res.status === 503) backendError = "Backend még indul, kérlek várj...";
        try {
          const body = await res.json();
          if (body?.detail) backendError = body.detail;
        } catch { /* nincs JSON body */ }
        setServices((prev) =>
          prev.map((s) => ({
            ...s,
            status: "offline" as ServiceStatus,
            error: s.key === "backend" ? backendError : "Backend nem elérhető",
          }))
        );
        return;
      }

      const data: HealthResponse = await res.json();

      setServices([
        { key: "backend", name: "Backend API", status: "online", latency },
        {
          key: "sonarr",
          name: "Sonarr",
          status: data.sonarr ? "online" : "offline",
          error: data.sonarr ? undefined : (data.sonarr_error ?? "Nem elérhető"),
        },
        {
          key: "radarr",
          name: "Radarr",
          status: data.radarr ? "online" : "offline",
          error: data.radarr ? undefined : (data.radarr_error ?? "Nem elérhető"),
        },
        {
          key: "ollama",
          name: "Ollama",
          status: data.ollama ? "online" : "offline",
          error: data.ollama ? undefined : (data.ollama_error ?? "Nem elérhető"),
        },
        {
          key: "tmdb",
          name: "TMDB",
          status: data.tmdb ? "online" : "offline",
          error: data.tmdb ? undefined : "Nincs TMDB_API_KEY konfigurálva",
        },
        {
          key: "redis",
          name: "Redis",
          status: data.redis ? "online" : "offline",
          error: data.redis ? undefined : "Nem elérhető",
        },
      ]);
    } catch {
      setServices((prev) =>
        prev.map((s) => ({
          ...s,
          status: "offline" as ServiceStatus,
          error: s.key === "backend" ? "Hálózati hiba – backend nem elérhető" : "Backend nem elérhető",
        }))
      );
    }
  }, []);

  useEffect(() => {
    check();
    if (!autoRefresh) return;
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [check, autoRefresh]);

  return { services, refresh: check };
}
