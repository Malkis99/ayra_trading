"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useApp } from "@/lib/context";
import { INSTRUMENTS, symbolsOf, type InstrumentId } from "@/lib/market/instruments";
import { SourceLine } from "./SourceLine";
import { TradingViewWidget, widgetConfig } from "./TradingViewWidget";

/** Optional quotes for the full list. Query/category changes do not rebuild the iframe. */
export function WatchlistQuotes({ ids, origin }: { ids: InstrumentId[]; origin: string }) {
  const { dict, lang } = useApp(), t = dict.market;
  const [open, setOpen] = useState(false);
  const delays = ids.map(id => INSTRUMENTS[id].delay);
  const delay = delays.includes("delayed") ? "delayed" : delays.includes("mayDelay") ? "mayDelay" : "realtime";
  const height = 72 + 36 * ids.length;
  return <details className="group min-w-0 rounded-md border border-line bg-s1 px-3 py-2" onToggle={event => setOpen(event.currentTarget.open)} data-testid="market-watchlist-quotes">
    <summary className="flex min-h-[28px] cursor-pointer list-none items-center justify-between gap-2 rounded text-xs text-mu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi [&::-webkit-details-marker]:hidden" data-testid="market-watchlist-quotes-summary">
      {t.watchlist.quotes}<ChevronDown size={15} aria-hidden="true" className="shrink-0 text-vi group-open:rotate-180" />
    </summary>
    <div className="min-w-0 space-y-2 pt-2">
      {open && <div tabIndex={0} role="region" aria-label={t.watchlist.quotesScroll}
        className="max-h-80 overflow-auto overscroll-contain rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi" data-testid="market-watchlist-quotes-scroll">
        <div className="min-w-[680px]">
          <TradingViewWidget key={`${ids.join(",")}-${lang}`} widget="market-quotes"
            config={widgetConfig({ width: "100%", height, showSymbolLogo: true,
              symbolsGroups: [{ name: t.watchlist.title, symbols: symbolsOf(ids).map(name => ({ name })) }] }, lang, origin)}
            height={height} label={t.watchlist.quotes} loadingText={t.overview.loading} errorText={t.overview.unavailable}
            retryLabel={t.overview.retry} testId="market-watchlist-widget" />
        </div>
      </div>}
      <SourceLine delay={delay} testId="market-watchlist-source" />
    </div>
  </details>;
}
