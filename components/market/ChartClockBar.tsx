"use client";

import React, { useMemo } from "react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { timeZoneLabel } from "@/lib/timezones";
import { cn } from "@/components/ui";
import { useClock } from "@/lib/market/live-clock";
import { MAIN_SESSIONS, isForexOpen, occurrences, statusFromList, wallAt, type MainSessionId, type WindowDef } from "@/lib/market/sessions";
import { marketKindOf, marketState } from "@/lib/market/market-hours";
import type { InstrumentId } from "@/lib/market/instruments";
import { Countdown } from "./LiveTimer";

/** The user's exact time, ticking every second (only this element re-renders with the seconds). */
function ExactTime({ zone }: { zone: string }) {
  const now = useClock("second");
  if (!now) return null;
  const w = wallAt(now, zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const s = Math.floor(now / 1000) % 60;
  return (
    <span className="font-mono font-semibold tabular-nums text-tx" role="timer" aria-live="off" data-testid="market-chart-clock-time">
      {pad(w.h)}:{pad(w.mi)}:{pad(s)}
    </span>
  );
}

/**
 * Next to the chart (PR «Fullscreen + time and session»): the user's exact time in their own zone, the session going
 * on now (from the sessions block, with the user's session hours) and whether the instrument's market is open.
 */
export function ChartClockBar({ instrument, zone, defs }: { instrument: InstrumentId; zone: string; defs: Record<MainSessionId, WindowDef> }) {
  const { dict, lang } = useApp();
  const t = dict.market.chart.clock;
  const names = dict.market.sessions.names;
  const now = useClock("minute");

  const sessions = useMemo(() => {
    if (!now) return null;
    const list = MAIN_SESSIONS.map((id) => ({ id, status: statusFromList(id, occurrences(defs[id], now), now) }));
    const open = list.filter((s) => s.status.state === "open").map((s) => s.id);
    const next = list
      .map((s) => (s.status.state === "closed" && s.status.next ? { id: s.id, at: s.status.next.start } : null))
      .filter((x): x is { id: MainSessionId; at: number } => !!x)
      .sort((a, b) => a.at - b.at)[0];
    return { open, next };
  }, [now, defs]);

  if (!now || !sessions) return null;

  const weekend = !isForexOpen(now);
  const kind = marketKindOf(instrument);
  const market = marketState(kind, now);
  const sessionText = weekend
    ? t.weekend
    : sessions.open.length
      ? formatString(t.session, { name: sessions.open.map((id) => names[id]).join(" + ") })
      : t.between;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mu" data-testid="market-chart-clock">
      <span className="inline-flex items-center gap-1.5">
        <ExactTime zone={zone} />
        <span data-testid="market-chart-clock-zone">{timeZoneLabel(zone, lang, new Date(now))}</span>
      </span>
      <span className="inline-flex items-center gap-1.5" data-testid="market-chart-clock-session">
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", sessions.open.length && !weekend ? "bg-vi" : "bg-mu/50")} />
        <span className="text-tx">{sessionText}</span>
        {!weekend && !sessions.open.length && sessions.next && (
          <span>
            {" · "}
            {formatString(t.next, { name: names[sessions.next.id] })} <Countdown to={sessions.next.at} format="human" />
          </span>
        )}
      </span>
      <span className="inline-flex flex-wrap items-center gap-x-1.5" data-testid="market-chart-clock-market" data-open={market.open}>
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", market.open ? "bg-long" : "border border-mu/70")} />
        <span className="text-tx">{kind === "crypto" ? t.allDay : market.open ? t.open : t.closed}</span>
        {market.changeAt !== null && (
          <span>
            {" · "}
            {market.open ? t.closesIn : t.opensIn} <Countdown to={market.changeAt} format="human" />
          </span>
        )}
        {kind === "stocks" && <span data-testid="market-chart-clock-note">{` (${t.nyse})`}</span>}
        {kind === "cfd" && <span data-testid="market-chart-clock-note">{` (${t.cfd})`}</span>}
      </span>
    </div>
  );
}
