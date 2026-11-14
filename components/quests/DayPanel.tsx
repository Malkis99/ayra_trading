"use client";

import React from "react";
import { CalendarClock, Check, Clock, Info, Lock, Minus, Moon, RotateCcw, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { APP_CLOSED_QUESTS, QUEST_POOL } from "@/lib/quests";
import { journalOnDay, type JournalSnapshot } from "@/lib/quest-engine";
import type { DayDetail, HistoryEntry } from "@/lib/week-view";
import type { DaySnapshot, DoneEntry } from "@/lib/day-snapshots";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { historyTitle, questShortTitle } from "./quest-text";
import { formatDayKey } from "./WeekTab";
import { MODE_ICONS } from "./ModeSwitch";

type Mark = "done" | "open" | "passed" | "replaced";

/** One line of the panel: a mark, a title, a status line and the reward (read-only, no buttons). */
function Line({ mark, title, sub, reward, testId }: { mark: Mark; title: string; sub: string; reward?: string; testId?: string }) {
  const Icon = mark === "done" ? Check : mark === "replaced" ? RotateCcw : mark === "passed" ? Clock : Minus;
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid={testId} data-mark={mark}>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md",
          mark === "done" ? "bg-success/[0.14] text-success" : mark === "replaced" ? "bg-vi/10 text-vi" : mark === "passed" ? "bg-[#e5b98a]/10 text-[#e5b98a]" : "bg-s2 text-mu"
        )}
      >
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-semibold leading-snug", mark === "done" ? "text-tx" : "text-tx/80")}>{title}</div>
        <div className="text-xs text-mu">{sub}</div>
      </div>
      {reward && <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-tx/80">{reward}</span>}
    </li>
  );
}

function Block({ title, note, children, testId }: { title: string; note?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="min-w-0" data-testid={testId}>
      <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-mu">
        {title}
        {note && <span className="ml-1.5 font-normal normal-case tracking-normal">· {note}</span>}
      </h4>
      {children}
    </section>
  );
}

/**
 * A past day of the week (docs/quest-hub-plan.md, 4.2): what the snapshot or the history kept, the journal of that day
 * as it is now, the day total. Only viewing: nothing here can give or change a reward.
 */
export function DayPanel({ detail, snapshot, onOpenToday }: { detail: DayDetail; snapshot: JournalSnapshot; onOpenToday: () => void }) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const v = dict.questsPage.q2.weekView;
  const p = dict.questsPage.q2.page;
  const tz = gameState.profile?.timezone;
  const date = formatDayKey(detail.key, lang, { weekday: "long", day: "numeric", month: "long" });
  const time = (iso?: string) => (iso ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined }).format(new Date(iso)) : "");
  const reward = (xp?: number, coins?: number) => (xp == null ? undefined : coins ? `+${xp} XP · +${coins} Coins` : `+${xp} XP`);
  const titleOf = (id: string, saved?: string) => {
    const tpl = QUEST_POOL.find((q) => q.id === id);
    return tpl ? questShortTitle(dict, lang, tpl) : historyTitle(dict, id, saved || id);
  };
  const sourceOf = (id: string) => (APP_CLOSED_QUESTS.has(id) ? p.journal : p.self);
  const doneSub = (id: string, at?: string) => (at ? formatString(v.statusDone, { source: sourceOf(id), time: time(at) }) : formatString(v.statusDoneNoTime, { source: sourceOf(id) }));

  const header = (chips: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 pb-3">
      <h3 className="font-serif text-lg font-bold text-tx first-letter:uppercase sm:text-xl" data-testid="day-panel-title">
        {date}
      </h3>
      <div className="flex flex-wrap items-center gap-2 text-xs text-mu">{chips}</div>
    </div>
  );
  const readOnly = (
    <span className="inline-flex items-center gap-1.5" data-testid="day-read-only">
      <Lock size={13} aria-hidden="true" />
      {v.readOnly}
    </span>
  );
  const incompleteChip = (
    <span className="rounded-full border border-[#e5b98a]/50 px-2 py-0.5 font-semibold text-[#e5b98a]" data-testid="day-incomplete">
      {v.incomplete}
    </span>
  );

  const shell = (children: React.ReactNode, state: string) => (
    <section className="rounded-2xl border border-line bg-s1 p-4 sm:p-5" data-testid="day-panel" data-kind={detail.kind} data-state={state} aria-labelledby="day-panel-heading">
      <span id="day-panel-heading" className="sr-only">
        {date}
      </span>
      {children}
    </section>
  );

  if (detail.kind === "today" || detail.kind === "future" || detail.kind === "beforeStart" || detail.kind === "empty") {
    const text =
      detail.kind === "today"
        ? { title: v.today, body: v.todayText }
        : detail.kind === "future"
          ? { title: v.future, body: "" }
          : detail.kind === "beforeStart"
            ? { title: v.before, body: "" }
            : { title: detail.shieldUsed ? v.shield : v.empty, body: v.emptyText };
    return shell(
      <>
        {header(detail.kind === "today" ? null : readOnly)}
        <div className="mt-3 flex items-start gap-3">
          <CalendarClock size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-mu" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-tx" data-testid="day-message">
              {text.title}
            </p>
            {text.body && <p className="mt-0.5 text-sm text-mu">{text.body}</p>}
            {detail.kind === "today" && (
              <button type="button" onClick={onOpenToday} className={buttonClasses("secondary", "md", "mt-3")} data-testid="day-open-today">
                {v.todayOpen}
              </button>
            )}
          </div>
        </div>
      </>,
      detail.kind
    );
  }

  const j = journalOnDay(snapshot, detail.key);
  const journal = (
    <Block title={v.journal} note={v.journalNote} testId="day-journal">
      <ul className="divide-y divide-line/60">
        <Line
          mark={j.plan.exists ? "done" : "open"}
          title={v.jPlan}
          sub={j.plan.exists ? [[j.plan.bias && v.jBias, j.plan.levels && v.jLevels, j.plan.limits && v.jLimits].filter(Boolean).join(", "), j.plan.beforeFirstTrade === true ? v.jPlanBefore : j.plan.beforeFirstTrade === false ? v.jPlanAfter : ""].filter(Boolean).join(" · ") : v.jPlanNone}
        />
        <Line
          mark={j.trades > 0 ? "done" : "open"}
          title={j.trades > 0 ? formatString(v.jTrades, { n: j.trades }) : v.jTradesNone}
          sub={[j.trades > 0 ? formatString(v.jWithRisk, { n: j.withRisk, total: j.trades }) : "", j.maxTrades != null ? formatString(v.jLimit, { n: j.maxTrades }) : "", j.noTrades > 0 ? formatString(v.jNoTrade, { n: j.noTrades }) : ""].filter(Boolean).join(" · ") || "—"}
        />
        <Line mark={j.plan.review ? "done" : "open"} title={v.jReview} sub={j.plan.review ? v.jReviewDone : v.jReviewNone} />
      </ul>
    </Block>
  );

  const total = (xp: number, coins: number, selfXp: number) => (
    <Block title={v.total} testId="day-total">
      <p className="mt-1.5 text-base font-bold text-tx">
        +{xp} XP{coins > 0 && <span className="text-go"> · +{coins} Coins</span>}
      </p>
      <p className="text-xs text-mu">{formatString(v.totalSelf, { xp: selfXp, cap: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP })}</p>
      <p className="text-xs text-mu">{v.totalNote}</p>
    </Block>
  );

  const restLine = (rest: boolean, shield: boolean) =>
    (rest || shield) && (
      <p className="flex items-center gap-2 rounded-xl bg-vi/[0.08] px-3 py-2 text-sm text-tx" data-testid="day-rest">
        {rest ? <Moon size={15} aria-hidden="true" className="text-vi" /> : <ShieldCheck size={15} aria-hidden="true" className="text-vi" />}
        {rest ? v.rest : v.shield}
      </p>
    );

  if (detail.kind === "history") {
    return shell(
      <>
        {header(
          <>
            {readOnly}
            {incompleteChip}
          </>
        )}
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <p className="flex items-start gap-2 rounded-xl border border-[#e5b98a]/30 bg-[#e5b98a]/[0.05] px-3 py-2.5 text-sm text-tx/90" data-testid="day-incomplete-text">
              <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[#e5b98a]" />
              {v.incompleteText}
            </p>
            {restLine(detail.restDay, detail.shieldUsed)}
            {detail.entries.length > 0 && (
              <Block title={v.doneHistory} testId="day-done-history">
                <ul className="divide-y divide-line/60">
                  {detail.entries.map((h, i) => (
                    <Line key={`${h.questId}-${i}`} mark="done" title={titleOf(h.questId, h.questTitle)} sub={doneSub(h.questId, h.at)} reward={reward(h.xp, h.coins)} testId={`day-quest-${h.questId}`} />
                  ))}
                </ul>
              </Block>
            )}
          </div>
          <div className="min-w-0 space-y-4">
            {journal}
            {total(detail.xp, detail.coins, detail.selfXp)}
          </div>
        </div>
      </>,
      "history"
    );
  }

  // a day snapshot
  const snap: DaySnapshot = detail.snap;
  const entryAt = (id: string, d?: DoneEntry) => d?.at || detail.entries.find((h: HistoryEntry) => h.questId === id)?.at;
  const replacedTo = new Map(snap.replaced.map((r) => [r.to, r.from]));
  const status = (id: string): { mark: Mark; sub: string; reward?: string } => {
    const d = snap.done[id];
    if (d) return { mark: "done", sub: doneSub(id, entryAt(id, d)), reward: reward(d.xp, d.coins) };
    if (snap.passed.includes(id)) return { mark: "passed", sub: v.statusPassed };
    return { mark: "open", sub: v.statusOpen };
  };
  const missionIds = snap.core;
  const coreDone = missionIds.filter((id) => !!snap.done[id]).length;
  const shown = new Set([...snap.core, ...snap.bonus]);
  const other = Object.keys(snap.done).filter((id) => !shown.has(id));
  const gaps = snap.incomplete || [];

  return shell(
    <>
      {header(
        <>
          {snap.mode && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-tx" data-testid="day-mode">
              {React.createElement(MODE_ICONS[snap.mode], { size: 13, "aria-hidden": true })}
              {dict.questsPage.q2.modes[snap.mode]}
            </span>
          )}
          {readOnly}
          {gaps.length > 0 && incompleteChip}
        </>
      )}
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {gaps.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-[#e5b98a]/30 bg-[#e5b98a]/[0.05] px-3 py-2.5 text-sm text-tx/90" data-testid="day-incomplete-text">
              <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[#e5b98a]" />
              {gaps.includes("set") ? v.incompleteSet : v.incompleteOffered}
            </p>
          )}
          {restLine(snap.restDay, snap.shieldUsed)}
          {missionIds.length > 0 && (
            <Block title={formatString(v.missionsCount, { done: coreDone, total: missionIds.length })} testId="day-missions">
              <ul className="divide-y divide-line/60">
                {missionIds.map((id) => {
                  const s = status(id);
                  const from = replacedTo.get(id);
                  return <Line key={id} {...s} title={titleOf(id)} sub={from ? `${s.sub} · ${formatString(v.replacedLine, { from: titleOf(from), to: titleOf(id) })}` : s.sub} testId={`day-quest-${id}`} />;
                })}
              </ul>
            </Block>
          )}
          {(snap.bonus.length > 0 || snap.replaced.length > 0) && (
            <Block title={v.extras} testId="day-extras">
              <ul className="divide-y divide-line/60">
                {snap.bonus.map((id) => (
                  <Line key={id} {...status(id)} title={titleOf(id)} testId={`day-quest-${id}`} />
                ))}
                {snap.replaced.map((r) => (
                  <Line key={`r-${r.from}`} mark="replaced" title={formatString(v.replacedLine, { from: titleOf(r.from), to: titleOf(r.to) })} sub={v.statusReplaced} testId={`day-replaced-${r.from}`} />
                ))}
              </ul>
            </Block>
          )}
          {other.length > 0 && (
            <Block title={v.doneOther} testId="day-done-other">
              <ul className="divide-y divide-line/60">
                {other.map((id) => (
                  <Line key={id} {...status(id)} title={titleOf(id, detail.entries.find((h) => h.questId === id)?.questTitle)} testId={`day-quest-${id}`} />
                ))}
              </ul>
            </Block>
          )}
          {snap.modeChanges.length > 0 && (
            <Block title={v.modeChanges} testId="day-mode-changes">
              <ul className="mt-1 space-y-1 text-sm text-tx/90">
                {snap.modeChanges.map((m, i) => (
                  <li key={i}>{formatString(v.modeChange, { mode: dict.questsPage.q2.modes[m.to], time: time(m.at) })}</li>
                ))}
              </ul>
            </Block>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          {journal}
          {total(snap.totals.xp, snap.totals.coins, snap.totals.selfXp)}
        </div>
      </div>
    </>,
    "snapshot"
  );
}
