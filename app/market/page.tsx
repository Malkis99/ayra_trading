"use client";

import React, { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { useApp } from "@/lib/context";
import { Tabs } from "@/components/ui";
import { SessionsClock } from "@/components/market/SessionsClock";
import { MarketOverview } from "@/components/market/MarketOverview";
import { MarketChart } from "@/components/market/MarketChart";
import { MarketWatchlist } from "@/components/market/MarketWatchlist";
import { MarketCalendar, MarketNews } from "@/components/market/MarketCalendarNews";
import { TodayImportant } from "@/components/market/TodayImportant";
import { MarketEconomy } from "@/components/market/MarketEconomy";
import { INSTRUMENTS, type InstrumentId } from "@/lib/market/instruments";
import { useMarketCloudSync } from "@/lib/market/cloud-sync-engine";

/** Market sections; Backtests live in Academy (owner's navigation cleanup 2026-11-20). Scanner comes later. */
const MARKET_TABS = ["overview", "chart", "calendar", "news", "economy", "watchlist"] as const;
type MarketTab = (typeof MARKET_TABS)[number];
const isMarketTab = (v: string | null): v is MarketTab => !!v && (MARKET_TABS as readonly string[]).includes(v);

export default function MarketPage() {
  const { dict } = useApp();
  const t = dict.market;
  const [tab, setTabState] = useState<MarketTab>("overview");
  // the Watchlist, notes and the chart view in the account (0008), while the Market is open
  useMarketCloudSync();

  // The section is kept in the address (?tab=…): a link or a reload opens the same one.
  // A click on a symbol in a TradingView widget comes back as ?tvwidgetsymbol=… and opens the Chart.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("tab");
    if (isMarketTab(fromUrl)) setTabState(fromUrl);
    else if (params.has("tvwidgetsymbol")) setTabState("chart");
  }, []);
  const setTab = (next: MarketTab, symbol?: string) => {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    // the instrument belongs to the Chart only
    url.searchParams.delete("tvwidgetsymbol");
    if (symbol) url.searchParams.set("symbol", symbol);
    else url.searchParams.delete("symbol");
    window.history.replaceState(window.history.state, "", url.toString());
  };
  /** «Chart» buttons in the Overview and the Watchlist: the Chart of that instrument, in this browser tab. */
  const openChart = (id: InstrumentId) => {
    setTab("chart", INSTRUMENTS[id].symbol);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{t.title}</h1>
        <p className="mt-1 text-xs text-mu">{t.subtitle}</p>
      </div>

      <p className="flex items-start gap-2 rounded-md border border-line bg-s1 px-3 py-2 text-xs text-mu" data-testid="market-disclaimer">
        <Info size={14} className="mt-0.5 shrink-0 text-vi" aria-hidden="true" />
        <span>{t.disclaimer}</span>
      </p>

      <Tabs<MarketTab> items={MARKET_TABS.map((id) => ({ id, label: t.tabs[id] }))} value={tab} onChange={(next) => setTab(next)} label={t.tabsLabel} idPrefix="market" />

      <div role="tabpanel" id={`market-panel-${tab}`} aria-labelledby={`market-tab-${tab}`} className="space-y-4" data-testid={`market-panel-${tab}`}>
        {tab === "overview" ? (
          <>
            <TodayImportant />
            <SessionsClock />
            <MarketOverview onOpenChart={openChart} />
          </>
        ) : tab === "chart" ? (
          <MarketChart />
        ) : tab === "calendar" ? (
          <MarketCalendar />
        ) : tab === "news" ? (
          <MarketNews />
        ) : tab === "economy" ? (
          <MarketEconomy />
        ) : tab === "watchlist" ? (
          <MarketWatchlist onOpenChart={openChart} />
        ) : null}
      </div>
    </div>
  );
}
