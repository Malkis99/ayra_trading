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
function ExactTime({ zone, className }: { zone: string; className?: string }) {
  const now = useClock("second");
  if (!now) return null;
  const w = wallAt(now, zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const s = Math.floor(now / 1000) % 60;
  return (
    <span className={cn("font-mono font-semibold tabular-nums text-tx", className)} role="timer" aria-live="off" data-testid="market-chart-clock-time">
      {pad(w.h)}:{pad(w.mi)}:{pad(s)}
    </span>
  );
}

const Dot = ({ on, open }: { on?: boolean; open?: boolean }) => (
  <span aria-hidden="true" className={cn("inline-block h-2 w-2 shrink-0 rounded-full", open ? "bg-long" : on ? "bg-vi" : on === false ? "bg-mu/50" : "border border-mu/70")} />
);

/**
 * «Time + session + market» next to the chart (PR «Fullscreen + time and session», then a card, owner 2026-11-02):
 * the user's exact time in their own zone, the session going on now (the sessions block with the user's hours) and
 * whether the instrument's market is open, with the schedule it follows. A card in the right column (or under the
 * chart on phones), or a thin strip over the chart.
 */
export function ChartClock({
  instrument,
  zone,
  defs,
  variant,
  className,
}: {
  instrument: InstrumentId;
  zone: string;
  defs: Record<MainSessionId, WindowDef>;
  variant: "card" | "strip";
  className?: string;
}) {
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
  const sessionOn = !weekend && sessions.open.length > 0;
  const sessionText = weekend
    ? t.weekend
    : sessions.open.length
      ? formatString(t.session, { name: sessions.open.map((id) => names[id]).join(" + ") })
      : t.between;
  const nextSession = !weekend && !sessions.open.length && sessions.next && (
    <span>
      {" · "}
      {formatString(t.next, { name: names[sessions.next.id] })} <Countdown to={sessions.next.at} format="human" />
    </span>
  );
  const change = market.changeAt !== null && (
    <span>
      {" · "}
      {market.open ? t.closesIn : t.opensIn} <Countdown to={market.changeAt} format="human" />
    </span>
  );
  const note = { crypto: t.crypto, forex: t.forex, cfd: t.cfd, stocks: t.nyse }[kind];
  const zoneName = timeZoneLabel(zone, lang, new Date(now));

  if (variant === "strip") {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mu", className)} data-testid="market-chart-clock" data-variant="strip">
        <span className="inline-flex items-center gap-1.5">
          <ExactTime zone={zone} />
          <span data-testid="market-chart-clock-zone">{zoneName}</span>
        </span>
        <span className="inline-flex items-center gap-1.5" data-testid="market-chart-clock-session">
          <Dot on={sessionOn} />
          <span className="text-tx">{sessionText}</span>
          {nextSession}
        </span>
        <span className="inline-flex flex-wrap items-center gap-x-1.5" data-testid="market-chart-clock-market" data-open={market.open}>
          <Dot open={market.open} />
          <span className="text-tx">{market.open ? t.open : t.closed}</span>
          {change}
        </span>
        <span data-testid="market-chart-clock-note">{note}</span>
      </div>
    );
  }

  return (
    <section className={cn("space-y-2 rounded-xl border border-line bg-s1 p-3", className)} aria-label={t.title} data-testid="market-chart-clock" data-variant="card">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-mu">{t.title}</p>
        <ExactTime zone={zone} className="block text-2xl leading-tight" />
        <p className="text-[11px] text-mu" data-testid="market-chart-clock-zone">
          {zoneName}
        </p>
      </div>
      <p className="flex items-start gap-2 text-sm text-tx" data-testid="market-chart-clock-session">
        <span className="flex h-5 shrink-0 items-center">
          <Dot on={sessionOn} />
        </span>
        <span className="min-w-0">
          {sessionText}
          {nextSession}
        </span>
      </p>
      <p className="flex items-start gap-2 text-sm text-tx" data-testid="market-chart-clock-market" data-open={market.open}>
        <span className="flex h-5 shrink-0 items-center">
          <Dot open={market.open} />
        </span>
        <span className="min-w-0">
          {market.open ? t.open : t.closed}
          {change}
        </span>
      </p>
      <p className="text-[11px] leading-snug text-mu" data-testid="market-chart-clock-note">
        {note}
      </p>
    </section>
  );
}
