"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { Chip, cn } from "@/components/ui";
import {
  SESSIONS,
  clockOf,
  dayBounds,
  intervalLabel,
  londonNewYorkOverlap,
  occurrences,
  primaryOccurrence,
  splitDuration,
  statusFromList,
  type Occurrence,
  type StatusId,
  type WindowDef,
} from "@/lib/market/sessions";

type Row = { id: StatusId; name: string; kind: "session" | "killzone" | "overlap"; list: Occurrence[] };

/**
 * The day bar from PR #110 (00–24 on the user's clock), now folded under «Show 24 h». Follows the minute clock of
 * the page; the live countdowns are in the cards above.
 */
export function DayTimeline({ now, zone, killzones }: { now: number; zone: string; killzones: WindowDef[] }) {
  const { dict } = useApp();
  const t = dict.market.sessions;
  const d = t.day;

  const left = (ms: number) => {
    const { d: dd, h, m } = splitDuration(ms);
    return [dd ? formatString(t.duration.d, { n: dd }) : "", h ? formatString(t.duration.h, { n: h }) : "", !dd && (m || !h) ? formatString(t.duration.m, { n: m }) : ""].filter(Boolean).join(" ");
  };

  const { from, to } = dayBounds(now, zone);
  const span = to - from;
  const pct = (ms: number) => ((ms - from) / span) * 100;
  const clip = (list: Occurrence[]) => list.filter((o) => o.end > from && o.start < to).map((o) => ({ ...o, start: Math.max(o.start, from), end: Math.min(o.end, to) }));

  const overlap = londonNewYorkOverlap(now);
  const sessionRows: Row[] = [
    ...SESSIONS.map((s) => ({ id: s.id, name: s.id === "asia" ? d.asia : t.names[s.id], kind: "session" as const, list: occurrences(s, now) })),
    { id: "overlap", name: d.overlapName, kind: "overlap", list: overlap },
  ];
  const killzoneRows: Row[] = killzones.map((k) => ({ id: k.id, name: t.names[k.id], kind: "killzone" as const, list: occurrences(k, now) }));

  const row = (r: Row) => {
    const status = statusFromList(r.id, r.list, now);
    const primary = primaryOccurrence(r.list, from, to);
    const hours = primary ? intervalLabel(primary, zone, from, to) : d.notToday;
    const statusText =
      status.state === "open" ? formatString(d.openUntil, { left: left(status.end - now) }) : status.next ? formatString(d.opensIn, { left: left(status.next.start - now) }) : "";
    const overlay = r.id === "london" || r.id === "newyork" ? clip(overlap) : [];
    return (
      <li key={r.id} className="space-y-1.5" data-testid={`market-window-${r.id}`} data-state={status.state}>
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-sm font-semibold", r.kind === "overlap" ? "text-vi" : "text-tx")}>{r.name}</span>
            <span className="text-xs tabular-nums text-mu" data-testid={`market-window-${r.id}-hours`}>
              {hours}
            </span>
          </div>
          {statusText && (
            <span className="rounded-full bg-s1">
              <Chip tone={status.state === "open" ? "accent" : "neutral"} data-testid={`market-window-${r.id}-status`}>
                {statusText}
              </Chip>
            </span>
          )}
        </div>
        <div className="relative h-3 overflow-hidden rounded-full border border-line bg-s2" aria-hidden="true">
          {clip(r.list).map((o) => (
            <span
              key={o.start}
              className={cn(
                "absolute inset-y-0 rounded-full",
                r.kind === "killzone" ? "bg-vi/60" : r.kind === "overlap" ? "bg-vi" : "bg-pri/80",
                status.state === "open" && "ring-1 ring-inset ring-tx/70"
              )}
              style={{ left: `${pct(o.start)}%`, width: `${pct(o.end) - pct(o.start)}%` }}
            />
          ))}
          {overlay.map((o) => (
            <span key={`ov-${o.start}`} className="absolute inset-y-0 bg-vi/70" style={{ left: `${pct(o.start)}%`, width: `${pct(o.end) - pct(o.start)}%` }} />
          ))}
        </div>
      </li>
    );
  };

  const nowPct = pct(now);
  return (
    <div className="relative" data-testid="market-timeline">
      <p className="mb-1 text-xs text-mu">{d.title}</p>
      <div className="relative h-6">
        <span
          className="absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-tx px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink"
          style={{ left: `${Math.min(92, Math.max(8, nowPct))}%` }}
          data-testid="market-now-mark"
        >
          {formatString(d.nowMark, { time: clockOf(now, zone) })}
        </span>
      </div>
      <div className="relative mb-2 h-4 text-[11px] tabular-nums text-mu" aria-hidden="true">
        {["00", "06", "12", "18", "24"].map((h, i) => (
          <span key={h} className={cn("absolute top-0", i === 0 ? "" : i === 4 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${i * 25}%` }}>
            {h}
          </span>
        ))}
      </div>
      <div className="relative space-y-4">
        {[25, 50, 75].map((p) => (
          <span key={p} aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-line/70" style={{ left: `${p}%` }} />
        ))}
        <span aria-hidden="true" className="pointer-events-none absolute -top-6 bottom-0 z-10 w-0.5 -translate-x-1/2 bg-tx/90" style={{ left: `${nowPct}%` }} data-testid="market-now-line" />
        <div className="space-y-3">
          <h3 className="relative z-20 text-xs font-semibold uppercase tracking-wide text-mu">{d.sessionsGroup}</h3>
          <ul className="space-y-3">{sessionRows.map(row)}</ul>
          <p className="relative z-20 text-[11px] text-mu">{d.overlapHint}</p>
        </div>
        <div className="space-y-3">
          <h3 className="relative z-20 text-xs font-semibold uppercase tracking-wide text-mu">{d.killzonesGroup}</h3>
          <ul className="space-y-3">{killzoneRows.map(row)}</ul>
        </div>
      </div>
    </div>
  );
}
