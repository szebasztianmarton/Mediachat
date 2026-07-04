import { useState, useEffect } from "react";
import { getLogs, subscribe } from "../utils/logger";
import type { LogEntry } from "../utils/logger";

export function useLogs(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>(getLogs);
  useEffect(() => subscribe(setEntries), []);
  return entries;
}
