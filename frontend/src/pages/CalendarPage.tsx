import { useState, useEffect, useMemo, useCallback } from "react";
import AppShell from "../components/AppShell";
import { api } from "../utils/api";

interface CalEvent {
  date: string;
  type: "movie" | "episode";
  title: string;
  subtitle: string;
  has_file: boolean;
}

const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
const MONTHS = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  // Az aktuálisan mutatott hónap első napja
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // A rács a hónapot lefedő teljes heteket mutatja (hétfő-kezdés)
  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // hétfő = 0
    const start = new Date(first);
    start.setDate(first.getDate() - startOffset);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    const start = ymd(grid[0]);
    const end = ymd(grid[grid.length - 1]);
    try {
      const data = await api<{ events: CalEvent[] }>(`/api/calendar?start=${start}&end=${end}`, { timeoutMs: 60_000 });
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [grid]);

  useEffect(() => { load(); }, [load]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const key = e.date.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const todayKey = ymd(new Date());
  const shift = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  const goToday = () => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); };

  return (
    <AppShell>
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Naptár
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => shift(-1)} className="btn btn-secondary btn-sm" aria-label="Előző hónap" style={{ padding: "0 8px" }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <span className="text-sm font-medium text-gray-900" style={{ minWidth: 130, textAlign: "center" }}>
            {cursor.getFullYear()}. {MONTHS[cursor.getMonth()]}
          </span>
          <button onClick={() => shift(1)} className="btn btn-secondary btn-sm" aria-label="Következő hónap" style={{ padding: "0 8px" }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </button>
          <button onClick={goToday} className="btn btn-secondary btn-sm">Ma</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>
        {/* Jelmagyarázat */}
        <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--primary-bg)" }} /> Film
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--warn)" }} /> Epizód
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-3)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--ok)" }} /> Letöltve
          </span>
          {loading && <span className="text-xs text-gray-400">Betöltés…</span>}
        </div>

        {/* Fejléc: hét napjai */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-xs font-medium text-gray-400" style={{ textAlign: "center", padding: "2px 0" }}>{d}</div>
          ))}
        </div>

        {/* Rács */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {grid.map((day) => {
            const key = ymd(day);
            const inMonth = day.getMonth() === cursor.getMonth();
            const dayEvents = eventsByDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className="card"
                style={{
                  minHeight: 92,
                  padding: 6,
                  opacity: inMonth ? 1 : 0.4,
                  borderColor: isToday ? "var(--primary-bg)" : "var(--border)",
                  borderWidth: isToday ? 2 : 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  overflow: "hidden",
                }}
              >
                <span className="text-[11px] font-medium" style={{ color: isToday ? "var(--ink)" : "var(--ink-3)", textAlign: "right" }}>
                  {day.getDate()}
                </span>
                {dayEvents.slice(0, 4).map((e, i) => (
                  <div
                    key={i}
                    title={`${e.title} — ${e.subtitle}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 10.5,
                      lineHeight: 1.25,
                      padding: "2px 4px",
                      borderRadius: 3,
                      background: "var(--surface-2)",
                      borderLeft: `2px solid ${e.has_file ? "var(--ok)" : e.type === "movie" ? "var(--primary-bg)" : "var(--warn)"}`,
                      overflow: "hidden",
                    }}
                  >
                    <span style={{ color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.title}
                    </span>
                  </div>
                ))}
                {dayEvents.length > 4 && (
                  <span className="text-[10px] text-gray-400">+{dayEvents.length - 4} további</span>
                )}
              </div>
            );
          })}
        </div>

        {events.length === 0 && !loading && (
          <p className="text-sm text-gray-400 text-center mt-8">
            Ebben a hónapban nincs megjelenés. (Sonarr/Radarr kapcsolat szükséges.)
          </p>
        )}
      </div>
    </AppShell>
  );
}
