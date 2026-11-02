"use client";

import React, { useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useApp } from "@/lib/context";
import { Popover, useOutsideClose } from "@/components/ui/forms/popover";
import { cn } from "@/components/ui";
import { CHART_INTERVALS, type ChartInterval } from "@/lib/market/instruments";
import { toggleFavorite } from "@/lib/market/chart-workspace";
import { HOTKEY_COUNT } from "@/lib/market/chart-tools";
import { formatString } from "@/lib/i18n";

/**
 * Timeframes (PR 1.3b): the favourite ones as buttons (1m, 5m, 15m, 1h, 4h, 1D by default) and «+» with every
 * timeframe to add or remove from the bar. The current one is shown even when it is not a favourite.
 */
export function IntervalBar({
  value,
  favorites,
  onChange,
  onFavorites,
}: {
  value: ChartInterval;
  favorites: readonly ChartInterval[];
  onChange: (interval: ChartInterval) => void;
  onFavorites: (next: ChartInterval[]) => void;
}) {
  const { dict } = useApp();
  const t = dict.market.chart;
  const [open, setOpen] = useState(false);
  const plus = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useOutsideClose([plus, panel], open, () => setOpen(false));
  const shown = CHART_INTERVALS.filter((i) => favorites.includes(i) || i === value);
  // keys 1–6 switch the first six favourites
  const hotkeyOf = (interval: ChartInterval) => {
    const i = favorites.indexOf(interval);
    return i >= 0 && i < HOTKEY_COUNT ? i + 1 : null;
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div role="radiogroup" aria-label={t.intervalsLabel} className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="market-chart-intervals">
        {shown.map((interval) => (
          <button
            key={interval}
            type="button"
            role="radio"
            aria-checked={value === interval}
            onClick={() => onChange(interval)}
            title={hotkeyOf(interval) ? formatString(dict.market.chart.tools.hotkey, { n: hotkeyOf(interval)! }) : undefined}
            aria-keyshortcuts={hotkeyOf(interval) ? String(hotkeyOf(interval)) : undefined}
            className={cn(
              "min-w-[2.5rem] shrink-0 rounded-md px-2 py-1.5 text-xs font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
              value === interval ? "bg-pri text-tx" : "text-mu hover:bg-s2 hover:text-tx"
            )}
            data-testid={`market-chart-interval-${interval}`}
          >
            {t.intervals[interval]}
          </button>
        ))}
      </div>
      <button
        ref={plus}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t.moreIntervals}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        data-testid="market-chart-intervals-more"
      >
        <Plus size={16} aria-hidden="true" />
      </button>
      {open && (
        <Popover anchor={plus} open panelRef={panel} role="dialog" aria-label={t.moreIntervals} minWidth={220} preferredHeight={360} className="max-w-[16rem]">
          <div className="space-y-2 p-3" data-testid="market-chart-favorites">
            <p className="text-xs text-mu">{t.favoritesHint}</p>
            <p className="hidden text-xs text-mu md:block" data-testid="market-chart-hotkeys-hint">
              {dict.market.chart.tools.hotkeysHint}
            </p>
            <ul className="grid grid-cols-3 gap-1">
              {CHART_INTERVALS.map((interval) => {
                const on = favorites.includes(interval);
                return (
                  <li key={interval}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => onFavorites(toggleFavorite(favorites, interval))}
                      className={cn(
                        "flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                        on ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-mu hover:text-tx"
                      )}
                      data-testid={`market-chart-favorite-${interval}`}
                    >
                      {on && <Check size={12} aria-hidden="true" />}
                      {t.intervals[interval]}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Popover>
      )}
    </div>
  );
}
