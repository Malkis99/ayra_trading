import React from "react";

type Point = { period: string; value: number; group: string };

function ordinal(period: string) {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  return quarter ? Date.UTC(Number(quarter[1]), (Number(quarter[2]) - 1) * 3) : Date.parse(period);
}

/** Groups encode series/unit/stage/vintage; gaps and incompatible versions are never joined. */
export function EconomyHistoryChart({ points, empty, format, cadence = "monthly" }: {
  points: Point[]; empty: string; format: (value: number) => string; cadence?: "monthly" | "weekly";
}) {
  const rows = [...points].filter(point => Number.isFinite(point.value) && Number.isFinite(ordinal(point.period)))
    .sort((a, b) => ordinal(a.period) - ordinal(b.period));
  const groups = new Map<string, Set<string>>();
  rows.forEach(row => groups.set(row.group, (groups.get(row.group) ?? new Set()).add(row.period)));
  if (![...groups.values()].some(periods => periods.size >= 2)) return <p className="text-xs text-mu">{empty}</p>;
  const values = rows.map(row => row.value);
  const min = Math.min(...values), max = Math.max(...values);
  const first = ordinal(rows[0].period), last = ordinal(rows.at(-1)!.period);
  const xy = (point: Point) => ({ x: 8 + (ordinal(point.period) - first) / Math.max(1, last - first) * 304,
    y: max === min ? 38 : 66 - (point.value - min) / (max - min) * 56 });
  return <div className="space-y-1 rounded-md bg-s1 p-2">
    <svg data-economy-chart viewBox="0 0 320 76" className="h-20 w-full text-vi" aria-hidden="true">
      <path d="M8 10H312 M8 38H312 M8 66H312" stroke="currentColor" opacity=".15" />
      {rows.map((point, i) => {
        const a = xy(point), prior = rows[i - 1];
        const distance = prior ? ordinal(point.period) - ordinal(prior.period) : 0;
        const consecutive = prior && (cadence === "weekly" ? distance === 7 * 86_400_000
          : Number(point.period.slice(0, 4)) * 12 + Number(point.period.slice(5, 7)) - Number(prior.period.slice(0, 4)) * 12 - Number(prior.period.slice(5, 7)) === 1);
        const b = prior && point.group === prior.group && consecutive ? xy(prior) : null;
        return <g key={point.group + point.period}>
          {b && <line data-history-segment x1={b.x} y1={b.y} x2={a.x} y2={a.y} stroke="currentColor" strokeWidth="1.5" />}
          <circle cx={a.x} cy={a.y} r="2" fill="currentColor"><title>{point.period} · {format(point.value)}</title></circle>
        </g>;
      })}
    </svg>
    <div className="flex justify-between gap-2 text-xs text-mu"><span>{rows[0].period}</span><span>{rows.at(-1)!.period}</span></div>
  </div>;
}
