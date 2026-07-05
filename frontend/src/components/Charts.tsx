// CSP-biztos, külső könyvtár nélküli inline SVG chartok — a téma CSS-változóit
// használják, így mind a 4 témában helyesen jelennek meg.

// ── Donut chart (arány, pl. film vs sorozat) ──────────────────────────────────

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({ slices, size = 132, thickness = 18, centerLabel, centerValue }: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
           aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
          {total > 0 && slices.map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={s.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
        {(centerValue || centerLabel) && (
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central">
            {centerValue && <tspan x="50%" dy="-2" style={{ fontSize: 20, fontWeight: 700, fill: "var(--ink)" }}>{centerValue}</tspan>}
            {centerLabel && <tspan x="50%" dy="18" style={{ fontSize: 10, fill: "var(--ink-3)" }}>{centerLabel}</tspan>}
          </text>
        )}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slices.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Area chart (idősor, pl. hozzáadások az elmúlt N napban) ────────────────────

export function AreaChart({ points, height = 72, labels }: {
  points: number[];
  height?: number;
  labels?: [string, string];
}) {
  const w = 100; // viewBox szélesség (%)
  const max = Math.max(1, ...points);
  const n = points.length;
  const coords = points.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * w;
    const y = height - (v / max) * (height - 6) - 3;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img"
           aria-label={`Idősor, csúcsérték ${max}`}>
        <path d={area} fill="var(--primary-bg)" opacity="0.12" />
        <path d={line} fill="none" stroke="var(--primary-bg)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.4" fill="var(--primary-bg)" vectorEffect="non-scaling-stroke">
            <title>{points[i]}</title>
          </circle>
        ))}
      </svg>
      {labels && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{labels[0]}</span>
          <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{labels[1]}</span>
        </div>
      )}
    </div>
  );
}

// ── Horizontal bar chart (rangsor, pl. top helyfoglalók / műfajok) ─────────────

export interface HBarItem {
  label: string;
  value: number;
  valueLabel: string;
  sublabel?: string;
}

export function HBarChart({ items, barColor = "var(--primary-bg)" }: { items: HBarItem[]; barColor?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((item) => (
        <div key={item.label}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 12.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.label}>
              {item.label}
              {item.sublabel && <span style={{ fontSize: 11, color: "var(--ink-3)" }}> · {item.sublabel}</span>}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", flexShrink: 0 }}>{item.valueLabel}</span>
          </div>
          <div style={{ height: 7, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(item.value / max) * 100}%`, background: barColor, borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Stacked usage bar (lemez-helyfoglalás) ────────────────────────────────────

export function UsageBar({ used, total, warnAbove = 0.9 }: { used: number; total: number; warnAbove?: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = pct / 100 > warnAbove ? "var(--err)" : pct / 100 > 0.75 ? "var(--warn)" : "var(--primary-bg)";
  return (
    <div style={{ height: 8, background: "var(--surface-3)", borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-2)" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color }} />
    </div>
  );
}

// ── Segéd: bájt formázás ──────────────────────────────────────────────────────

export function fmtBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}
