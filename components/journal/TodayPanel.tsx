"use client";

import React, { useMemo, useState } from "react";
import { CalendarCheck, ChevronDown, NotebookPen, Plus, Ban } from "lucide-react";
import type { Trade, TradingPlan } from "@/lib/journal/types";
import { summarizeToday } from "@/lib/journal/overview";
import { formatString } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n/types";
import { Button, Checkbox } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatSignedR } from "./JournalKpiStrip";

type Props = {
  trades: Trade[];
  plan: TradingPlan | null;
  onSavePlan?: (plan: TradingPlan) => void;
  tz: string;
  dict: Dictionary;
  lang: string;
  formatTradeValue: (t: Trade) => string;
  onAddTrade: () => void;
  onAddNoTrade: () => void;
  onAddNote: () => void;
  onOpenPlan: () => void;
  onOpenTrade: (t: Trade) => void;
  readOnly?: boolean;
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-mu">{title}</h3>
      {children}
    </div>
  );
}

const BIAS_TONE = { bullish: "border-long/40 bg-long/10 text-long", bearish: "border-short/40 bg-short/10 text-short", neutral: "border-edge bg-s2 text-mu" };

/** "Today" panel: plan, day checklist, discipline, daily R limit, last trade and quick actions. */
export function TodayPanel({
  trades,
  plan,
  onSavePlan,
  tz,
  dict,
  lang,
  formatTradeValue,
  onAddTrade,
  onAddNoTrade,
  onAddNote,
  onOpenPlan,
  onOpenTrade,
  readOnly,
}: Props) {
  const t = dict.journal.overview;
  const [open, setOpen] = useState(false);
  const s = useMemo(() => summarizeToday(trades, plan, tz), [trades, plan, tz]);
  const dateLabel = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const usedPct = s.dailyLimitR ? Math.min(100, (s.usedR / s.dailyLimitR) * 100) : 0;
  const riskTone = usedPct >= 100 ? "bg-short" : usedPct >= 60 ? "bg-amber-400" : "bg-vi";

  const toggleChecklist = (index: number, done: boolean) => {
    if (!plan || !onSavePlan) return;
    const checklist = plan.checklist.map((c, i) => (i === index ? { ...c, done } : c));
    onSavePlan({ ...plan, checklist, updatedAt: new Date().toISOString() });
  };

  const checklistLabel = (item: TradingPlan["checklist"][number]) =>
    item.key
      ? dict.journal.tradingPlan.checklistItems[item.key as keyof typeof dict.journal.tradingPlan.checklistItems] ?? item.key
      : item.text ?? "";

  return (
    <aside aria-label={t.todayTitle} className="rounded-lg border border-line bg-s1" data-testid="today-panel">
      {/* Phone/tablet: collapsible header */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left xl:hidden"
      >
        <CalendarCheck size={18} className="text-vi" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold text-tx">{t.showToday}</span>
        {s.trades.length > 0 && (
          <span className={cn("text-sm font-semibold tabular-nums", s.netR > 0 ? "text-long" : s.netR < 0 ? "text-short" : "text-mu")}>{formatSignedR(s.netR)}</span>
        )}
        <ChevronDown size={16} className={cn("text-mu transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      <div className={cn("space-y-3 px-4 pb-4 xl:block xl:pt-4", open ? "block border-t border-line pt-3" : "hidden")}>
        <div className="hidden items-baseline justify-between gap-2 xl:flex">
          <h2 className="font-serif text-lg font-bold text-tx">{t.todayTitle}</h2>
          <span className="text-xs text-mu first-letter:uppercase">{dateLabel}</span>
        </div>

        <Block title={t.todayPlan}>
          {plan && plan.bias.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {plan.bias.map((b, i) => (
                <li key={`${b.instrument}-${i}`} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", BIAS_TONE[b.direction])}>
                  {b.instrument} · {t.bias[b.direction]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mu">{t.noPlan}</p>
          )}
          <button type="button" onClick={onOpenPlan} className="min-h-[36px] text-sm font-semibold text-vi hover:underline">
            {plan ? t.openPlan : t.fillPlan}
          </button>
        </Block>

        {plan && plan.checklist.length > 0 && (
          <Block title={t.todayChecklist}>
            <div className="-my-1">
              {plan.checklist.map((item, i) => (
                <Checkbox key={`${item.key ?? item.text}-${i}`} label={checklistLabel(item)} checked={item.done} disabled={readOnly || !onSavePlan} onChange={(d) => toggleChecklist(i, d)} />
              ))}
            </div>
          </Block>
        )}

        <Block title={t.discipline}>
          {s.trades.length === 0 ? (
            <p className="text-sm text-mu">{t.noTradesToday}</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm text-tx">{formatString(t.disciplineValue, { clean: s.cleanCount, total: s.trades.length })}</p>
              <div className="h-2 overflow-hidden rounded-full bg-s2" aria-hidden="true">
                <div className="h-full rounded-full bg-long" style={{ width: `${(s.cleanCount / s.trades.length) * 100}%` }} />
              </div>
            </div>
          )}
        </Block>

        <Block title={t.dailyRisk}>
          {s.dailyLimitR ? (
            <div className="space-y-1.5" data-testid="daily-risk">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold tabular-nums text-tx">{formatString(t.dailyRiskValue, { used: s.usedR.toFixed(1), limit: s.dailyLimitR.toFixed(1) })}</span>
                {usedPct < 100 && <span className="text-xs text-mu">{formatString(t.dailyRiskLeft, { left: (s.dailyLimitR - s.usedR).toFixed(1) })}</span>}
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-s2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={s.dailyLimitR}
                aria-valuenow={Number(s.usedR.toFixed(2))}
                aria-label={t.dailyRisk}
              >
                <div className={cn("h-full rounded-full", riskTone)} style={{ width: `${usedPct}%` }} />
              </div>
              {usedPct >= 100 && <p className="text-xs text-short">{t.dailyRiskReached}</p>}
            </div>
          ) : (
            <p className="text-sm text-mu">{t.noDailyLimit}</p>
          )}
        </Block>

        <Block title={t.lastTrade}>
          {s.lastTrade ? (
            <button
              type="button"
              onClick={() => onOpenTrade(s.lastTrade!)}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-md bg-s2/60 px-3 text-left text-sm hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <span className="font-semibold text-tx">{s.lastTrade.instrument}</span>
              <span className={cn("text-xs font-semibold", s.lastTrade.direction === "long" ? "text-long" : "text-short")}>
                {s.lastTrade.direction === "long" ? dict.journal.addTradeModal.directionLong : dict.journal.addTradeModal.directionShort}
              </span>
              <span className={cn("ml-auto font-semibold tabular-nums", s.lastTrade.result === "win" ? "text-long" : s.lastTrade.result === "loss" ? "text-short" : "text-tx")}>
                {formatTradeValue(s.lastTrade)}
              </span>
            </button>
          ) : (
            <p className="text-sm text-mu">{t.noTrades}</p>
          )}
        </Block>

        {!readOnly && (
          <Block title={t.quickActions}>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" size="md" className="h-auto min-h-[60px] flex-col gap-1 px-1 py-2 text-xs" onClick={onAddTrade}>
                <Plus size={16} aria-hidden="true" />
                {t.addTrade}
              </Button>
              <Button variant="secondary" size="md" className="h-auto min-h-[60px] flex-col gap-1 px-1 py-2 text-xs" onClick={onAddNoTrade}>
                <Ban size={16} aria-hidden="true" />
                {t.addNoTrade}
              </Button>
              <Button variant="secondary" size="md" className="h-auto min-h-[60px] flex-col gap-1 px-1 py-2 text-xs" onClick={onAddNote}>
                <NotebookPen size={16} aria-hidden="true" />
                {t.addNote}
              </Button>
            </div>
          </Block>
        )}
      </div>
    </aside>
  );
}
