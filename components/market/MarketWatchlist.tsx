"use client";

import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, BarChart3, Eye, Plus, X } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { Button, EmptyState } from "@/components/ui";
import { INSTRUMENTS, symbolsOf, type InstrumentId, instrumentName } from "@/lib/market/instruments";
import { WATCHLIST_LIMIT, addTo, isFull, move, removeFrom } from "@/lib/market/watchlist";
import { useWatchlist } from "@/lib/market/watchlist-store";
import { useMarketInAccount } from "@/lib/market/cloud-sync-engine";
import { InstrumentPicker } from "./InstrumentPicker";
import { SourceLine } from "./SourceLine";
import { TradingViewWidget, widgetConfig } from "./TradingViewWidget";

const ROW_HEIGHT = 36;
const QUOTES_HEAD = 72;

/**
 * Market → Watchlist (PR 1.3): catalog instruments in the user's order, kept on this device (the cloud comes later,
 * owner's decision 2026-11-01), at most 30. One TradingView quotes table for the whole list; under it our rows with
 * «Chart», up / down (no dragging: works with a finger and a keyboard) and «Remove».
 */
export function MarketWatchlist({ onOpenChart }: { onOpenChart: (id: InstrumentId) => void }) {
  const { dict, lang } = useApp();
  const t = dict.market;
  const [list, setList, loaded] = useWatchlist();
  const inAccount = useMarketInAccount();
  const [adding, setAdding] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  if (!loaded || !origin) return <section className="card min-h-[200px]" data-testid="market-watchlist" aria-busy="true" />;

  const full = isFull(list);
  const toggle = (id: InstrumentId) => setList(list.ids.includes(id) ? removeFrom(list, id) : addTo(list, id));
  // the delay of the strictest instrument in the list
  const delays = list.ids.map((id) => INSTRUMENTS[id].delay);
  const delay = delays.includes("delayed") ? "delayed" : delays.includes("mayDelay") ? "mayDelay" : "realtime";

  return (
    <section className="card space-y-3" data-testid="market-watchlist" aria-labelledby="market-watchlist-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="market-watchlist-title" className="font-serif text-lg font-bold text-tx">
            {t.watchlist.title}
          </h2>
          <p className="text-[11px] text-mu" data-testid="market-watchlist-count">
            {formatString(t.watchlist.count, { n: list.ids.length, max: WATCHLIST_LIMIT })} · {inAccount ? t.watchlist.accountNote : t.watchlist.deviceNote}
          </p>
        </div>
        <Button variant={adding ? "primary" : "secondary"} onClick={() => setAdding((v) => !v)} aria-expanded={adding} data-testid="market-watchlist-add">
          {adding ? null : <Plus size={14} aria-hidden="true" />}
          <span>{adding ? t.watchlist.done : t.watchlist.add}</span>
        </Button>
      </div>

      {full && (
        <p className="rounded-md bg-s2/50 px-3 py-2 text-xs text-tx" role="status" data-testid="market-watchlist-full">
          {formatString(t.watchlist.full, { n: list.ids.length })}
        </p>
      )}

      {adding && (
        <InstrumentPicker idPrefix="market-watchlist" selected={(id) => list.ids.includes(id)} disabled={() => full} onPick={toggle} />
      )}

      {list.ids.length === 0 ? (
        !adding && <EmptyState icon={<Eye size={18} />} title={t.watchlist.emptyTitle} description={t.watchlist.emptyText} />
      ) : (
        <>
          <div className="min-w-0 rounded-xl border border-line bg-s1 p-3">
            <TradingViewWidget
              key={`${list.ids.join(",")}-${lang}`}
              widget="market-quotes"
              config={widgetConfig(
                {
                  width: "100%",
                  height: QUOTES_HEAD + ROW_HEIGHT * list.ids.length,
                  showSymbolLogo: true,
                  symbolsGroups: [{ name: t.watchlist.title, symbols: symbolsOf(list.ids).map((name) => ({ name })) }],
                },
                lang === "en" ? "en" : "ru",
                origin
              )}
              height={QUOTES_HEAD + ROW_HEIGHT * list.ids.length}
              label={t.watchlist.quotes}
              loadingText={t.overview.loading}
              errorText={t.overview.unavailable}
              retryLabel={t.overview.retry}
              testId="market-watchlist-widget"
            />
            <SourceLine delay={delay} testId="market-watchlist-source" />
          </div>

          <ol className="divide-y divide-line/60" data-testid="market-watchlist-rows">
            {list.ids.map((id, i) => {
              const name = instrumentName(id, t.instruments);
              const iconButton = "grid h-9 w-9 shrink-0 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-30 disabled:hover:bg-transparent";
              return (
                <li key={id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-1.5" data-testid={`market-watchlist-row-${id}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-tx">{name}</span>
                    <span className="block text-[11px] text-mu">{INSTRUMENTS[id].ticker}</span>
                  </span>
                  <span className="flex items-center gap-0.5">
                    <button type="button" onClick={() => onOpenChart(id)} className={iconButton} aria-label={`${t.watchlist.openChart}: ${name}`} data-testid={`market-watchlist-chart-${id}`}>
                      <BarChart3 size={16} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setList(move(list, id, -1))} disabled={i === 0} className={iconButton} aria-label={`${t.watchlist.up}: ${name}`} data-testid={`market-watchlist-up-${id}`}>
                      <ArrowUp size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setList(move(list, id, 1))}
                      disabled={i === list.ids.length - 1}
                      className={iconButton}
                      aria-label={`${t.watchlist.down}: ${name}`}
                      data-testid={`market-watchlist-down-${id}`}
                    >
                      <ArrowDown size={16} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setList(removeFrom(list, id))} className={iconButton} aria-label={`${t.watchlist.remove}: ${name}`} data-testid={`market-watchlist-remove-${id}`}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
