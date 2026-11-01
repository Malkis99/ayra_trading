"use client";

import React, { useEffect, useState } from "react";
import { useApp } from "@/lib/context";
import { Tabs } from "@/components/ui";
import { CATEGORIES, CORE_INSTRUMENTS, isCategoryId, type CategoryId, type DataDelay } from "@/lib/market/instruments";
import { TRADINGVIEW_HOME, TradingViewWidget, widgetConfig } from "@/components/market/TradingViewWidget";

const CORE_HEIGHT = 200;
const ROW_HEIGHT = 36;
const QUOTES_HEAD = 72;
const CATEGORY_KEY = "cat";

/**
 * Market cards (PR 1.2): the D-14 core (DXY, S&P 500, Nasdaq, gold, oil, BTC) as small TradingView cards, then the
 * five categories — one table at a time. Every block names its source and how fresh the data is.
 */
export function MarketOverview() {
  const { dict, lang } = useApp();
  const t = dict.market.overview;
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

  const source = (delay: DataDelay, testId: string) => (
    <p className="text-[11px] text-mu" data-testid={testId}>
      {t.sourcePrefix}{" "}
      <a href={TRADINGVIEW_HOME} target="_blank" rel="noopener noreferrer nofollow" className="text-vi hover:underline">
        {t.sourceName}
      </a>{" "}
      · {t.delay[delay]}
    </p>
  );
  const widgetTexts = { loadingText: t.loading, errorText: t.unavailable, retryLabel: t.retry };
  const active = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

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
              <h3 className="text-sm font-semibold text-tx">{t.core[inst.id]}</h3>
              <TradingViewWidget
                widget="mini-symbol-overview"
                config={widgetConfig({ symbol: inst.symbol, width: "100%", height: CORE_HEIGHT, dateRange: "1D", trendLineColor: "rgba(163, 138, 209, 1)", underLineColor: "rgba(80, 52, 143, 0.3)" }, locale, origin)}
                height={CORE_HEIGHT}
                label={t.core[inst.id]}
                testId={`market-core-${inst.id}-widget`}
                {...widgetTexts}
              />
              {source(inst.delay, `market-core-${inst.id}-source`)}
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
              { width: "100%", height: QUOTES_HEAD + ROW_HEIGHT * active.symbols.length, showSymbolLogo: true, symbolsGroups: [{ name: t.categories[active.id], symbols: active.symbols.map((name) => ({ name })) }] },
              locale,
              origin
            )}
            height={QUOTES_HEAD + ROW_HEIGHT * active.symbols.length}
            label={t.categories[active.id]}
            testId={`market-category-${active.id}-widget`}
            {...widgetTexts}
          />
          {source(active.delay, `market-category-${active.id}-source`)}
        </div>
      </section>
    </div>
  );
}
