import { useState, useEffect, useCallback, useRef } from "react";
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

  const abortRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    // Az előző, még futó kérést megszakítjuk — így a kései válasz nem írhatja
    // felül az újabb állapotot, és unmount után sincs setState.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const start = Date.now();
    try {
      const res = await fetch("/health", { signal: controller.signal });
      const latency = Date.now() - start;
      if (controller.signal.aborted) return;

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
      if (controller.signal.aborted) return;

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
      if (controller.signal.aborted) return;
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
    if (!autoRefresh) {
      return () => abortRef.current?.abort();
    }
    const id = setInterval(check, 30_000);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [check, autoRefresh]);

  return { services, refresh: check };
}
