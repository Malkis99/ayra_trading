"use client";

import React from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { cn } from "@/components/ui";
import { INSTRUMENTS, type InstrumentId } from "@/lib/market/instruments";
import { WATCHLIST_LIMIT } from "@/lib/market/watchlist";
import type { PanelSide } from "@/lib/market/chart-workspace";

/**
 * The Watchlist next to the chart (PR 1.3b): our own list (TradingView's `watchlist` panel cannot take the site's
 * style), a click shows the instrument on the chart. Folds to a thin strip on wide screens, to its header on phones.
 */
export function ChartWatchlistPanel({
  ids,
  current,
  onPick,
  folded,
  onFold,
  side,
  wide,
}: {
  ids: readonly InstrumentId[];
  current: InstrumentId;
  onPick: (id: InstrumentId) => void;
  folded: boolean;
  onFold: (folded: boolean) => void;
  side: PanelSide;
  wide: boolean;
}) {
  const { dict } = useApp();
  const t = dict.market;
  const FoldIcon = wide ? (side === "right" ? (folded ? ChevronLeft : ChevronRight) : folded ? ChevronRight : ChevronLeft) : folded ? ChevronDown : ChevronUp;
  const foldButton = (
    <button
      type="button"
      onClick={() => onFold(!folded)}
      aria-expanded={!folded}
      aria-controls="market-chart-panel-list"
      aria-label={folded ? t.chart.panel.unfold : t.chart.panel.fold}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
      data-testid="market-chart-panel-fold"
    >
      <FoldIcon size={16} aria-hidden="true" />
    </button>
  );

  if (folded && wide) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center rounded-xl border border-line bg-s1 py-1" aria-label={t.chart.panel.title} data-testid="market-chart-panel" data-folded="true">
        {foldButton}
      </aside>
    );
  }

  return (
    <aside
      className={cn("flex min-h-0 flex-col rounded-xl border border-line bg-s1", wide ? "w-60 shrink-0" : "w-full")}
      aria-label={t.chart.panel.title}
      data-testid="market-chart-panel"
      data-folded={folded ? "true" : "false"}
    >
      <div className="flex items-center gap-2 border-b border-line py-1 pl-3 pr-1">
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-mu">{t.chart.panel.title}</span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-mu" title={formatString(t.watchlist.count, { n: ids.length, max: WATCHLIST_LIMIT })} data-testid="market-chart-panel-count">
          {ids.length}/{WATCHLIST_LIMIT}
        </span>
        {foldButton}
      </div>
      {!folded && (
        <div id="market-chart-panel-list" className="min-h-0 flex-1 overflow-y-auto">
          {ids.length === 0 ? (
            <p className="p-3 text-xs text-mu" data-testid="market-chart-panel-empty">
              {t.chart.panel.empty}
            </p>
          ) : (
            <ul className="py-1">
              {ids.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    aria-current={id === current ? "true" : undefined}
                    className={cn(
                      "flex w-full min-w-0 items-baseline justify-between gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi",
                      id === current ? "bg-pri/25" : "hover:bg-s2"
                    )}
                    data-testid={`market-chart-panel-${id}`}
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-tx">{t.instruments[id]}</span>
                    <span className="shrink-0 text-[11px] text-mu">{INSTRUMENTS[id].ticker}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
