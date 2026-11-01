"use client";

import React, { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useApp } from "@/lib/context";
import { Tabs } from "@/components/ui";
import { CATEGORIES, CORE_INSTRUMENTS, isCategoryId, symbolsOf, type CategoryId, type InstrumentId } from "@/lib/market/instruments";
import { TradingViewWidget, widgetConfig } from "@/components/market/TradingViewWidget";
import { SourceLine } from "./SourceLine";

const CORE_HEIGHT = 200;
const ROW_HEIGHT = 36;
const QUOTES_HEAD = 72;
const CATEGORY_KEY = "cat";

/**
 * Market cards (PR 1.2): the D-14 core (DXY, S&P 500, Nasdaq, gold, oil, BTC) as small TradingView cards, then the
 * five categories — one table at a time. Every block names its source and how fresh the data is. «Chart» buttons
 * (PR 1.3) open the Chart of that instrument in the same browser tab.
 */
export function MarketOverview({ onOpenChart }: { onOpenChart: (id: InstrumentId) => void }) {
  const { dict, lang } = useApp();
  const t = dict.market.overview;
  const names = dict.market.instruments;
  const locale = lang === "en" ? "en" : "ru";
  const [origin, setOrigin] = useState("");
  const [category, setCategoryState] = useState<CategoryId>("forex");

  useEffect(() => {
    setOrigin(window.location.origin);
    const fromUrl = new URLSearchParams(window.location.search).get(CATEGORY_KEY);
    if (isCategoryId(fromUrl)) setCategoryState(fromUrl);
  }, []);
  const setCategory = (next: CategoryId) => {
    setCategoryState(next);
    const url = new URL(window.location.href);
    url.searchParams.set(CATEGORY_KEY, next);
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const widgetTexts = { loadingText: t.loading, errorText: t.unavailable, retryLabel: t.retry };
  const active = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
  const chartLabel = dict.market.watchlist.openChart;

  // Widgets wait for the address of the page (clicks on a symbol lead back here)
  if (!origin) return null;

  return (
    <div className="space-y-4" data-testid="market-overview">
      <section className="space-y-2" aria-labelledby="market-core-title">
        <h2 id="market-core-title" className="font-serif text-lg font-bold text-tx">
          {t.coreTitle}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="market-core">
          {CORE_INSTRUMENTS.map((inst) => (
            <li key={inst.id} className="min-w-0 rounded-xl border border-line bg-s1 p-3" data-testid={`market-core-${inst.id}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="min-w-0 truncate text-sm font-semibold text-tx">{names[inst.id]}</h3>
                <button
                  type="button"
                  onClick={() => onOpenChart(inst.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-vi hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                  aria-label={`${chartLabel}: ${names[inst.id]}`}
                  data-testid={`market-core-${inst.id}-chart`}
                >
                  <BarChart3 size={14} aria-hidden="true" />
                  {chartLabel}
                </button>
              </div>
              <TradingViewWidget
                widget="mini-symbol-overview"
                config={widgetConfig({ symbol: inst.symbol, width: "100%", height: CORE_HEIGHT, dateRange: "1D", trendLineColor: "rgba(163, 138, 209, 1)", underLineColor: "rgba(80, 52, 143, 0.3)" }, locale, origin)}
                height={CORE_HEIGHT}
                label={names[inst.id]}
                testId={`market-core-${inst.id}-widget`}
                {...widgetTexts}
              />
              <SourceLine delay={inst.delay} testId={`market-core-${inst.id}-source`} />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2" aria-labelledby="market-categories-title">
        <h2 id="market-categories-title" className="font-serif text-lg font-bold text-tx">
          {t.categoriesTitle}
        </h2>
        <Tabs<CategoryId> items={CATEGORIES.map((c) => ({ id: c.id, label: t.categories[c.id] }))} value={category} onChange={setCategory} label={t.categoriesTitle} idPrefix="market-cat" />
        <div
          role="tabpanel"
          id={`market-cat-panel-${active.id}`}
          aria-labelledby={`market-cat-tab-${active.id}`}
          className="min-w-0 space-y-2 rounded-xl border border-line bg-s1 p-3"
          data-testid={`market-category-${active.id}`}
        >
          {active.id === "bonds" && (
            <p className="text-xs text-mu" data-testid="market-bonds-note">
              {t.bondsNote}
            </p>
          )}
          <TradingViewWidget
            key={active.id}
            widget="market-quotes"
            config={widgetConfig(
              { width: "100%", height: QUOTES_HEAD + ROW_HEIGHT * active.ids.length, showSymbolLogo: true, symbolsGroups: [{ name: t.categories[active.id], symbols: symbolsOf(active.ids).map((name) => ({ name })) }] },
              locale,
              origin
            )}
            height={QUOTES_HEAD + ROW_HEIGHT * active.ids.length}
            label={t.categories[active.id]}
            testId={`market-category-${active.id}-widget`}
            {...widgetTexts}
          />
          <SourceLine delay={active.delay} testId={`market-category-${active.id}-source`} />
          {/* the table rows are TradingView's: our own buttons open the Chart in this tab */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2" data-testid={`market-category-${active.id}-charts`}>
            <span className="text-[11px] text-mu">{t.openChart}</span>
            {active.ids.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onOpenChart(id)}
                className="rounded-md bg-s2/60 px-2 py-1 text-[11px] font-semibold text-tx hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                aria-label={`${chartLabel}: ${names[id]}`}
                data-testid={`market-category-chart-${id}`}
              >
                {names[id]}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
