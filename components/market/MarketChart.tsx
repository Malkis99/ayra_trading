"use client";

import React, { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { browserTimeZone } from "@/lib/timezones";
import { cn } from "@/components/ui";
import { CATEGORIES, CHART_INTERVALS, INSTRUMENTS, instrumentBySymbol, type ChartInterval, type InstrumentId } from "@/lib/market/instruments";
import { displayZoneOf } from "@/lib/market/sessions";
import { useMarketSettings } from "@/lib/market/settings-store";
import { addTo, isFull, removeFrom } from "@/lib/market/watchlist";
import { useChartPrefs, useWatchlist } from "@/lib/market/watchlist-store";
import { InstrumentPicker } from "./InstrumentPicker";
import { SourceLine } from "./SourceLine";
import { TradingViewWidget, widgetConfig } from "./TradingViewWidget";

const CHART_HEIGHT = 460;

/** The instrument in the address: `?symbol=` (our links) or `?tvwidgetsymbol=` (a click inside a widget). */
function symbolFromUrl(): { id?: InstrumentId; unknown?: string } {
  const params = new URLSearchParams(window.location.search);
  const symbol = params.get("symbol") ?? params.get("tvwidgetsymbol");
  if (!symbol) return {};
  const found = instrumentBySymbol(symbol);
  return found ? { id: found.id } : { unknown: symbol };
}

function keepInUrl(id: InstrumentId) {
  const url = new URL(window.location.href);
  url.searchParams.set("symbol", INSTRUMENTS[id].symbol);
  url.searchParams.delete("tvwidgetsymbol");
  window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * Market → Chart (PR 1.3): TradingView's chart of an instrument from our catalog only, opened on the latest data.
 * The widget's own toolbar is hidden (its «Indicators» menu has «buy / sell» ratings); the timeframe is our buttons,
 * 1 hour by default, the chosen one is remembered. Times in the display time of the sessions block.
 */
export function MarketChart() {
  const { dict, lang } = useApp();
  const t = dict.market;
  const game = useOptionalGame();
  const [prefs, setPrefs, prefsLoaded] = useChartPrefs();
  const [watchlist, setWatchlist, listLoaded] = useWatchlist();
  const [settings, , settingsLoaded] = useMarketSettings();
  const [origin, setOrigin] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // The address wins over the last instrument on this device
  useEffect(() => {
    if (!prefsLoaded || ready) return;
    setOrigin(window.location.origin);
    const fromUrl = symbolFromUrl();
    const id = fromUrl.id ?? prefs.instrument;
    if (fromUrl.unknown) setNotice(formatString(t.chart.notInCatalog, { symbol: fromUrl.unknown, name: t.instruments[id] }));
    if (id !== prefs.instrument) setPrefs({ ...prefs, instrument: id });
    keepInUrl(id);
    setReady(true);
  }, [prefsLoaded, ready, prefs, setPrefs, t]);

  if (!ready || !listLoaded || !settingsLoaded || !origin) return <section className="card min-h-[480px]" data-testid="market-chart" aria-busy="true" />;

  const id = prefs.instrument;
  const inst = INSTRUMENTS[id];
  const name = t.instruments[id];
  const inList = watchlist.ids.includes(id);
  const listFull = !inList && isFull(watchlist);
  const zone = displayZoneOf(settings.display, game?.gameState.profile.timezone || browserTimeZone());

  const pick = (next: InstrumentId) => {
    setNotice(null);
    setPrefs({ ...prefs, instrument: next });
    keepInUrl(next);
  };
  const chooseInterval = (interval: ChartInterval) => setPrefs({ ...prefs, interval });

  return (
    <section className="card space-y-3" data-testid="market-chart" aria-labelledby="market-chart-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="market-chart-title" className="font-serif text-lg font-bold text-tx" data-testid="market-chart-name">
            {name}
          </h2>
          <p className="text-[11px] text-mu">{inst.ticker}</p>
        </div>
        <button
          type="button"
          onClick={() => setWatchlist(inList ? removeFrom(watchlist, id) : addTo(watchlist, id))}
          disabled={listFull}
          aria-pressed={inList}
          title={listFull ? formatString(t.watchlist.full, { n: watchlist.ids.length }) : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
            inList ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-tx hover:border-vi/50",
            listFull && "cursor-not-allowed opacity-50"
          )}
          data-testid="market-chart-watch"
        >
          <Star size={14} aria-hidden="true" className={inList ? "fill-current text-vi" : undefined} />
          {inList ? t.chart.inList : t.chart.addToList}
        </button>
      </div>
      {listFull && (
        <p className="text-xs text-mu" data-testid="market-chart-full">
          {formatString(t.watchlist.full, { n: watchlist.ids.length })}
        </p>
      )}

      <div role="radiogroup" aria-label={t.chart.intervalsLabel} className="flex flex-wrap gap-1" data-testid="market-chart-intervals">
        {CHART_INTERVALS.map((interval) => (
          <button
            key={interval}
            type="button"
            role="radio"
            aria-checked={prefs.interval === interval}
            onClick={() => chooseInterval(interval)}
            className={cn(
              "min-w-[2.75rem] rounded-md px-2.5 py-1.5 text-xs font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
              prefs.interval === interval ? "bg-pri text-tx" : "bg-s2/60 text-mu hover:text-tx"
            )}
            data-testid={`market-chart-interval-${interval}`}
          >
            {t.chart.intervals[interval]}
          </button>
        ))}
      </div>

      {notice && (
        <p className="rounded-md bg-s2/50 px-3 py-2 text-xs text-tx" role="status" data-testid="market-chart-notice">
          {notice}
        </p>
      )}

      <TradingViewWidget
        key={`${inst.symbol}-${prefs.interval}-${zone}-${lang}`}
        widget="advanced-chart"
        config={widgetConfig(
          {
            autosize: true,
            symbol: inst.symbol,
            interval: prefs.interval,
            timezone: zone === "UTC" ? "Etc/UTC" : zone,
            style: "1",
            hide_top_toolbar: true,
            hide_side_toolbar: true,
            hide_volume: true,
            allow_symbol_change: false,
            save_image: false,
            calendar: false,
            details: false,
            hotlist: false,
            withdateranges: false,
            support_host: "https://www.tradingview.com",
          },
          lang === "en" ? "en" : "ru",
          origin
        )}
        height={CHART_HEIGHT}
        label={formatString(t.chart.label, { name })}
        loadingText={t.overview.loading}
        errorText={t.overview.unavailable}
        retryLabel={t.overview.retry}
        testId="market-chart-widget"
      />
      <SourceLine delay={inst.delay} testId="market-chart-source" />

      <div className="space-y-2 border-t border-line pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{t.chart.picker}</h3>
        <InstrumentPicker idPrefix="market-chart" selected={(x) => x === id} onPick={pick} initialCategory={CATEGORIES.find((c) => c.ids.includes(id))?.id} />
      </div>
    </section>
  );
}
