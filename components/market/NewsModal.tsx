"use client";

import React from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { buttonClasses, Modal } from "@/components/ui";
import { clockIn } from "@/lib/market/feeds/calendar-view";
import type { NewsItem } from "@/lib/market/feeds/today";

/** «3 нояб., 19:00» in the user's zone. */
export function whenIn(ms: number, zone: string, lang: string): string {
  const day = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short", timeZone: zone }).format(ms);
  return `${day}, ${clockIn(ms, zone)}`;
}

/**
 * One official news item, opened on our site (PR 4–5): the title, the source with its trust mark, the time in the
 * user's zone and the source's own short description — never the article itself; «Open the original» leads there.
 * Closes with the cross, Esc or a click outside; on phones it fills the screen.
 */
export function NewsModal({ item, zone, onClose }: { item: NewsItem | null; zone: string; onClose: () => void }) {
  const { dict, lang } = useApp();
  const t = dict.market.officialNews;
  const sources = dict.market.calendar.own.sources;
  if (!item) return null;
  const source = sources[item.source];
  return (
    <Modal
      isOpen={!!item}
      onClose={onClose}
      title={<span data-testid="news-modal-title">{item.title}</span>}
      closeLabel={t.close}
      size="lg"
      fullOnMobile
      data-testid="news-modal"
      footer={
        <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className={buttonClasses()} data-testid="news-modal-original">
          <ExternalLink size={15} aria-hidden="true" />
          {t.original}
        </a>
      }
    >
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mu">
          <span className="inline-flex items-center gap-1 rounded border border-long/40 bg-long/10 px-1.5 py-px font-semibold text-long" title={formatString(dict.market.calendar.own.trustHint, { source })} data-testid="news-modal-trust">
            <ShieldCheck size={12} aria-hidden="true" />
            {dict.market.calendar.own.official}
          </span>
          <span className="font-semibold text-tx" data-testid="news-modal-source">
            {source}
          </span>
          <span aria-hidden="true">·</span>
          <span>{t.kinds[item.kind]}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.published_at} data-testid="news-modal-time">
            {whenIn(Date.parse(item.published_at), zone, lang)}
          </time>
        </p>
        {item.summary ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-tx" data-testid="news-modal-summary">
            {item.summary}
          </p>
        ) : (
          <p className="text-sm text-mu" data-testid="news-modal-no-summary">
            {t.noSummary}
          </p>
        )}
        <p className="text-[11px] text-mu">{t.onlySource}</p>
        <p className="text-xs font-semibold text-tx" data-testid="news-modal-disclaimer">
          {dict.market.notAdvice}
        </p>
      </div>
    </Modal>
  );
}
