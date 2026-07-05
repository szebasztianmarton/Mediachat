import { useState, useEffect, useMemo, useCallback } from "react";
import AppShell from "../components/AppShell";
import { api } from "../utils/api";

interface CalEvent {
  date: string;
  type: "movie" | "episode";
  title: string;
  code: string;
  subtitle: string;
  runtime: number;
  has_file: boolean;
}

type View = "month" | "week" | "forecast" | "day" | "agenda";

const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
const WEEKDAYS_LONG = ["Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat", "Vasárnap"];
const MONTHS = [
  "január", "február", "március", "április", "május", "június",
  "július", "augusztus", "szeptember", "október", "november", "december",
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { return addDays(d, -((d.getDay() + 6) % 7)); }
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}
function timeRange(e: CalEvent): string {
  const start = new Date(e.date);
  if (isNaN(start.getTime())) return "";
  const s = fmtTime(e.date);
  if (!e.runtime) return s;
  const end = new Date(start.getTime() + e.runtime * 60000);
  return `${s} – ${end.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}`;
}

function eventColor(e: CalEvent): string {
  if (e.has_file) return "var(--ok)";
  return e.type === "movie" ? "var(--primary-bg)" : "var(--warn)";
}

// ── Esemény-sor (agenda/week/day nézethez) ────────────────────────────────────

function EventRow({ e, showTime = true }: { e: CalEvent; showTime?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderLeft: `2px solid ${eventColor(e)}`, paddingLeft: 10 }}>
      {showTime && (
        <span className="text-xs text-gray-400" style={{ minWidth: 96, flexShrink: 0 }}>{timeRange(e)}</span>
      )}
      <span className="text-sm text-gray-900 truncate" style={{ flex: 1, minWidth: 0 }}>{e.title}</span>
      {e.code && <span className="text-xs text-gray-500" style={{ minWidth: 44, flexShrink: 0 }}>{e.code}</span>}
      <span className="text-sm text-gray-500 truncate" style={{ flex: 1, minWidth: 0 }}>{e.subtitle}</span>
    </div>
  );
}

export default function CalendarPage() {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); });
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // A lekérendő tartomány a nézettől függ
  const range = useMemo<[Date, Date]>(() => {
    if (view === "month" || view === "agenda") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const gridStart = startOfWeek(first);
      return [gridStart, addDays(gridStart, 41)];
    }
    if (view === "week") { const s = startOfWeek(cursor); return [s, addDays(s, 6)]; }
    if (view === "day") return [cursor, cursor];
    // forecast: ma → +13 nap
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return [today, addDays(today, 13)];
  }, [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ events: CalEvent[] }>(`/api/calendar?start=${ymd(range[0])}&end=${ymd(range[1])}`, { timeoutMs: 60_000 });
      setEvents(data.events ?? []);
    } catch { setEvents([]); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const key = e.date.slice(0, 10);
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return map;
  }, [events]);

  const todayKey = ymd(new Date());

  // Navigáció léptetése a nézet szerint
  const shift = (dir: number) => {
    if (view === "month" || view === "agenda") setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
    else if (view === "week") setCursor((c) => addDays(c, dir * 7));
    else setCursor((c) => addDays(c, dir));
  };
  const goToday = () => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), n.getDate())); };

  const title = useMemo(() => {
    if (view === "month" || view === "agenda") return `${cursor.getFullYear()}. ${MONTHS[cursor.getMonth()]}`;
    if (view === "week") { const s = startOfWeek(cursor); const e = addDays(s, 6); return `${s.getMonth() + 1}.${s.getDate()} – ${e.getMonth() + 1}.${e.getDate()}`; }
    if (view === "day") return `${cursor.getFullYear()}. ${MONTHS[cursor.getMonth()]} ${cursor.getDate()}.`;
    return "Előrejelzés (14 nap)";
  }, [view, cursor]);

  return (
    <AppShell>
      <div className="page-topbar" style={{ gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => shift(-1)} className="btn btn-secondary btn-sm" aria-label="Vissza" style={{ padding: "0 8px" }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" /></svg>
          </button>
          <button onClick={() => shift(1)} className="btn btn-secondary btn-sm" aria-label="Előre" style={{ padding: "0 8px" }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" /></svg>
          </button>
          <button onClick={goToday} className="btn btn-secondary btn-sm">Ma</button>
        </div>
        <div className="flex-1" style={{ textAlign: "center" }}>
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em", margin: 0 }}>{title}</h1>
        </div>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          {(["month", "week", "forecast", "day", "agenda"] as View[]).map((v, i) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "5px 11px", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none",
                borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                background: view === v ? "var(--primary-bg)" : "var(--surface)",
                color: view === v ? "var(--primary-ink)" : "var(--ink-3)", fontFamily: "inherit",
              }}
            >
              {{ month: "Hónap", week: "Hét", forecast: "Előrejelzés", day: "Nap", agenda: "Lista" }[v]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>
        {/* Jelmagyarázat */}
        <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
          <Legend color="var(--primary-bg)" label="Film" />
          <Legend color="var(--warn)" label="Epizód" />
          <Legend color="var(--ok)" label="Letöltve" />
          {loading && <span className="text-xs text-gray-400">Betöltés…</span>}
        </div>

        {/* ── HÓNAP ── */}
        {view === "month" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
              {WEEKDAYS.map((d) => <div key={d} className="text-xs font-medium text-gray-400" style={{ textAlign: "center" }}>{d}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), i)).map((day) => {
                const key = ymd(day);
                const inMonth = day.getMonth() === cursor.getMonth();
                const dayEvents = byDay.get(key) ?? [];
                const isToday = key === todayKey;
                return (
                  <div key={key} className="card" style={{ minHeight: 92, padding: 6, opacity: inMonth ? 1 : 0.4, borderColor: isToday ? "var(--primary-bg)" : "var(--border)", borderWidth: isToday ? 2 : 1, display: "flex", flexDirection: "column", gap: 3, overflow: "hidden" }}>
                    <span className="text-[11px] font-medium" style={{ color: isToday ? "var(--ink)" : "var(--ink-3)", textAlign: "right" }}>{day.getDate()}</span>
                    {dayEvents.slice(0, 4).map((e, i) => (
                      <div key={i} title={`${e.title} ${e.code} — ${e.subtitle}`} style={{ fontSize: 10.5, lineHeight: 1.25, padding: "2px 4px", borderRadius: 3, background: "var(--surface-2)", borderLeft: `2px solid ${eventColor(e)}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)" }}>
                        {e.title}
                      </div>
                    ))}
                    {dayEvents.length > 4 && <span className="text-[10px] text-gray-400">+{dayEvents.length - 4}</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── HÉT ── */}
        {view === "week" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
            {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i)).map((day) => {
              const key = ymd(day);
              const dayEvents = byDay.get(key) ?? [];
              const isToday = key === todayKey;
              return (
                <div key={key} className="card" style={{ minHeight: 200, padding: 8, borderColor: isToday ? "var(--primary-bg)" : "var(--border)", borderWidth: isToday ? 2 : 1 }}>
                  <p className="text-xs font-semibold" style={{ color: "var(--ink)", marginBottom: 8 }}>
                    {WEEKDAYS[(day.getDay() + 6) % 7]} {day.getDate()}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {dayEvents.map((e, i) => (
                      <div key={i} style={{ borderLeft: `2px solid ${eventColor(e)}`, paddingLeft: 6 }}>
                        <p className="text-[11px] text-gray-400">{fmtTime(e.date)}</p>
                        <p className="text-xs text-gray-900 truncate" title={e.title}>{e.title}</p>
                        <p className="text-[10px] text-gray-500 truncate">{e.code} {e.subtitle}</p>
                      </div>
                    ))}
                    {dayEvents.length === 0 && <p className="text-[11px] text-gray-400 italic">—</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── NAP ── */}
        {view === "day" && (
          <div className="card" style={{ padding: "16px 20px", maxWidth: 720 }}>
            <p className="text-sm font-semibold text-gray-900" style={{ marginBottom: 12 }}>
              {WEEKDAYS_LONG[(cursor.getDay() + 6) % 7]}
            </p>
            {(byDay.get(ymd(cursor)) ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">Ezen a napon nincs megjelenés.</p>
            ) : (
              (byDay.get(ymd(cursor)) ?? []).map((e, i) => <EventRow key={i} e={e} />)
            )}
          </div>
        )}

        {/* ── LISTA / ELŐREJELZÉS ── */}
        {(view === "agenda" || view === "forecast") && (
          <div style={{ maxWidth: 900 }}>
            {[...byDay.entries()].sort().filter(([, evs]) => evs.length > 0).map(([key, evs]) => {
              const d = new Date(key + "T00:00:00");
              return (
                <div key={key} className="card" style={{ padding: "12px 18px", marginBottom: 8 }}>
                  <p className="text-sm font-semibold" style={{ color: key === todayKey ? "var(--primary-bg)" : "var(--ink)", marginBottom: 4 }}>
                    {WEEKDAYS_LONG[(d.getDay() + 6) % 7]}, {d.getFullYear()}. {MONTHS[d.getMonth()]} {d.getDate()}.
                  </p>
                  {evs.map((e, i) => <EventRow key={i} e={e} />)}
                </div>
              );
            })}
            {events.length === 0 && !loading && (
              <p className="text-sm text-gray-400 text-center mt-8">Nincs megjelenés a tartományban. (Sonarr/Radarr kapcsolat szükséges.)</p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} /> {label}
    </span>
  );
}
