"use client";

import React, { useEffect, useState } from "react";
import { ChevronRight, RotateCw, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/context";
import { cn } from "@/components/ui";
import { levelOf } from "@/lib/market/feeds/calendar-view";
import { feed, type NewsItem } from "@/lib/market/feeds/today";
import { useMarketNews } from "@/lib/market/feeds/use-market-news";
import { NewsModal, whenIn } from "./NewsModal";
import { useUserZone } from "./TodayImportant";

const DOT = { high: "bg-short", medium: "bg-amber-300", low: "bg-mu" } as const;
const TONE = { high: "border-short/70 bg-short/15 text-tx", medium: "border-amber-300/70 bg-amber-300/15 text-tx", low: "border-mu/70 bg-mu/15 text-tx" } as const;
/** How far back the feed reads. */
const FEED_DAYS = 30;

/**
 * Market → News → «Official» (PR 5): the Fed, the ECB, the White House, BLS and BEA, without noise — only rows the
 * collector kept visible, high importance by default, repeats merged, the source and time on every item. A click
 * opens the item on our site (title, source, time, the source's description, «Open the original»).
 */
export function OfficialNews() {
  const { dict, lang } = useApp();
  const t = dict.market.officialNews;
  const own = dict.market.calendar.own;
  const zone = useUserZone();
  const [from, setFrom] = useState(0);
  useEffect(() => setFrom(Date.now() - FEED_DAYS * 86_400_000), []);
  const [state, retry] = useMarketNews(from, 300);
  const [levels, setLevels] = useState<(1 | 2 | 3)[]>([3]);
  const [open, setOpen] = useState<NewsItem | null>(null);

  const toggle = (l: 1 | 2 | 3) => setLevels((cur) => (cur.includes(l) ? (cur.length > 1 ? cur.filter((x) => x !== l) : cur) : [...cur, l]));
  const items = state.status === "ready" ? feed(state.items, levels) : [];

  return (
    <section className="space-y-3" data-testid="official-news" aria-label={t.title}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={dict.market.calendar.importance} data-testid="official-news-levels">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-mu">{dict.market.calendar.importance}</span>
        {([3, 2, 1] as const).map((l) => {
          const on = levels.includes(l);
          const level = levelOf(l);
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(l)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi", on ? TONE[level] : "border-line text-mu hover:border-vi/50 hover:text-tx")}
              data-testid={`official-news-level-${level}`}
            >
              <span aria-hidden="true" className={cn("inline-block h-2 w-2 rounded-full", DOT[level], !on && "opacity-50")} />
              {dict.market.calendar.levels[level]}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-mu">{t.howFiltered}</p>

      <div className="overflow-hidden rounded-xl border border-line bg-s1">
        {state.status === "loading" && <p className="px-4 py-10 text-center text-xs text-mu">{own.loading}</p>}
        {state.status === "unavailable" && (
          <p className="px-4 py-10 text-center text-xs text-mu" role="status" data-testid="official-news-unavailable">
            {t.unavailable}
          </p>
        )}
        {state.status === "error" && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center" role="alert" data-testid="official-news-error">
            <p className="text-xs text-mu">{own.error}</p>
            <button type="button" onClick={retry} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-tx hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
              <RotateCw size={13} aria-hidden="true" />
              {own.retry}
            </button>
          </div>
        )}
        {state.status === "ready" && items.length === 0 && (
          <p className="px-4 py-10 text-center text-xs text-mu" role="status" data-testid="official-news-empty">
            {t.empty}
          </p>
        )}
        {state.status === "ready" && items.length > 0 && (
          <ul className="divide-y divide-line/70" data-testid="official-news-list">
            {items.map((n) => {
              const source = own.sources[n.source];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(n)}
                    className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-s2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi md:px-4"
                    data-testid="official-news-item"
                    data-id={n.id}
                    data-level={levelOf(n.importance)}
                  >
                    <span aria-hidden="true" className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", DOT[levelOf(n.importance)])} />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-mu">
                        <span className="inline-flex items-center gap-1 rounded border border-long/40 bg-long/10 px-1 py-px font-semibold text-long">
                          <ShieldCheck size={11} aria-hidden="true" />
                          {own.official}
                        </span>
                        <span className="font-semibold text-tx">{source}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t.kinds[n.kind]}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={n.published_at} data-testid="official-news-time">
                          {whenIn(Date.parse(n.published_at), zone, lang)}
                        </time>
                      </span>
                      <span className="block text-sm font-semibold text-tx" data-testid="official-news-title">
                        {n.title}
                      </span>
                      {n.summary && <span className="block line-clamp-2 text-xs text-mu">{n.summary}</span>}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className="mt-1 shrink-0 text-mu" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-[11px] text-mu">
        <p data-testid="official-news-sources">{t.sourcesLine}</p>
        <p className="font-semibold text-tx" data-testid="official-news-disclaimer">
          {dict.market.notAdvice}
        </p>
      </div>
      <NewsModal item={open} zone={zone} onClose={() => setOpen(null)} />
    </section>
  );
}
