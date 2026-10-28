"use client";

import React, { useEffect, useState } from "react";
import { BarChart3, CalendarDays, Eye, FlaskConical, Info, Landmark, LayoutGrid, Newspaper } from "lucide-react";
import { useApp } from "@/lib/context";
import { Chip, EmptyState, Tabs } from "@/components/ui";
import { SessionsClock } from "@/components/market/SessionsClock";

/** Market sections (owner's decision 2026-10-28, `docs/market-plan.md` section 8); Scanner comes later. */
const MARKET_TABS = ["overview", "chart", "calendar", "news", "economy", "backtest", "watchlist"] as const;
type MarketTab = (typeof MARKET_TABS)[number];
const isMarketTab = (v: string | null): v is MarketTab => !!v && (MARKET_TABS as readonly string[]).includes(v);

const SOON_ICONS: Record<MarketTab, React.ReactNode> = {
  overview: <LayoutGrid size={18} />,
  chart: <BarChart3 size={18} />,
  calendar: <CalendarDays size={18} />,
  news: <Newspaper size={18} />,
  economy: <Landmark size={18} />,
  backtest: <FlaskConical size={18} />,
  watchlist: <Eye size={18} />,
};

export default function MarketPage() {
  const { dict } = useApp();
  const t = dict.market;
  const [tab, setTabState] = useState<MarketTab>("overview");

  // The section is kept in the address (?tab=…): a link or a reload opens the same one
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (isMarketTab(fromUrl)) setTabState(fromUrl);
  }, []);
  const setTab = (next: MarketTab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const soon = (id: MarketTab) => (
    <EmptyState
      icon={SOON_ICONS[id]}
      title={
        <span className="inline-flex items-center gap-2">
          {t.soon[id].title}
          <Chip tone="accent">{t.soon.badge}</Chip>
        </span>
      }
      description={t.soon[id].text}
    />
  );

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

      <Tabs<MarketTab> items={MARKET_TABS.map((id) => ({ id, label: t.tabs[id] }))} value={tab} onChange={setTab} label={t.tabsLabel} idPrefix="market" />

      <div role="tabpanel" id={`market-panel-${tab}`} aria-labelledby={`market-tab-${tab}`} className="space-y-4" data-testid={`market-panel-${tab}`}>
        {tab === "overview" ? (
          <>
            <SessionsClock />
            {soon("overview")}
          </>
        ) : (
          soon(tab)
        )}
      </div>
    </div>
  );
}
