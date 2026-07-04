const LOG_KEY = "mediachat-logs";
const MAX_LOGS = 500;

export type LogLevel = "info" | "success" | "warning" | "error";
export type LogCategory =
  | "auth"
  | "settings"
  | "chat"
  | "service"
  | "torrent"
  | "media"
  | "users"
  | "training"
  | "system";

export interface LogEntry {
  id: string;
  timestamp: string; // ISO string — survives JSON round-trip
  level: LogLevel;
  category: LogCategory;
  message: string;
  detail?: string;
}

type Listener = (entries: LogEntry[]) => void;
const listeners = new Set<Listener>();

function load(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function persist(entries: LogEntry[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {}
}

// Module-level mutable store
let store: LogEntry[] = load();

export function addLog(
  level: LogLevel,
  category: LogCategory,
  message: string,
  detail?: string
): void {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    detail,
  };
  store = [...store, entry].slice(-MAX_LOGS);
  persist(store);
  listeners.forEach((fn) => fn(store));
}

export function getLogs(): LogEntry[] {
  return store;
}

export function clearLogs(): void {
  store = [];
  localStorage.removeItem(LOG_KEY);
  listeners.forEach((fn) => fn(store));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Shorthand API
export const logger = {
  info: (cat: LogCategory, msg: string, detail?: string) =>
    addLog("info", cat, msg, detail),
  success: (cat: LogCategory, msg: string, detail?: string) =>
    addLog("success", cat, msg, detail),
  warn: (cat: LogCategory, msg: string, detail?: string) =>
    addLog("warning", cat, msg, detail),
  error: (cat: LogCategory, msg: string, detail?: string) =>
    addLog("error", cat, msg, detail),
};

// Bootstrap log entry on module load
addLog("info", "system", "Media Assistant elindult");
