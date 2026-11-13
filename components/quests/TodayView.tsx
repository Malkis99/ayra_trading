"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Moon } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { modeSetPreview, selfReportXpOn } from "@/lib/game";
import { APP_CLOSED_QUESTS, QUEST_POOL, type QuestTemplate } from "@/lib/quests";
import { journalHref, planHref } from "@/lib/quests-view";
import { endOfDayRitual, morningProtocol, noTradesOn, reasonFor, type DayMode, type JournalSnapshot, type MissionStep } from "@/lib/quest-engine";
import { Button, buttonClasses } from "@/components/ui/Button";
import { QuestItem } from "./QuestItem";
import { PlanSteps } from "./PlanSteps";
import { ModeSwitch } from "./ModeSwitch";
import { questTitle } from "./quest-text";

interface Props {
  core: QuestTemplate[];
  bonus: QuestTemplate[];
  replacedFrom: Record<string, string>;
  busyId: string | null;
  /** The active mode of the game day. */
  mode: DayMode;
  /** The quest of the «next step» (its button is the primary one). */
  nextQuestId?: string;
  snapshot: JournalSnapshot;
  onActivate: (m: DayMode) => void;
  onComplete: (q: QuestTemplate) => void;
  onPass: (q: QuestTemplate) => void;
  onReplace: (q: QuestTemplate) => void;
}

const byIds = (ids: string[]) => ids.map((id) => QUEST_POOL.find((q) => q.id === id)).filter((q): q is QuestTemplate => !!q);

/**
 * Today (docs/quests-ux-3.0-plan.md): the three missions of the day are the one focus; modes are a compact row that can
 * show any mode (only the active one can be done); the day plan, extra quests and the rest come after, quieter.
 */
export function TodayView({ core, bonus, replacedFrom, busyId, mode, nextQuestId, snapshot, onActivate, onComplete, onPass, onReplace }: Props) {
  const { dict, lang } = useApp();
  const { gameState, gameDay } = useGame();
  const p = dict.questsPage.q2.page;
  const q2 = dict.questsPage.q2;
  const [bonusOpen, setBonusOpen] = useState(false);
  const [viewed, setViewed] = useState<DayMode>(mode);
  const done = gameState.completedQuestsToday;
  const passed = gameState.passedQuestsToday;

  // a change of the active mode (here or in another tab) shows that mode
  useEffect(() => setViewed(mode), [mode]);

  const isActiveView = viewed === mode;
  const preview = useMemo(() => (isActiveView ? null : modeSetPreview(gameState, viewed)), [isActiveView, gameState, viewed]);
  const shownCore = preview ? byIds(preview.core) : core;
  const shownBonus = preview ? byIds(preview.bonus) : bonus;
  const carried = (preview ? preview.carried : gameState.questDay?.day === gameDay ? gameState.questDay.carried : undefined) || {};
  const coreDone = shownCore.filter((q) => done[q.id]).length;

  const reasonKey = (id: string) => reasonFor(id, !!done[id], snapshot, gameDay);
  const journalCta = (id: string, key: ReturnType<typeof reasonKey>) => {
    const c = q2.journalCta;
    if (id === "q_riskcheck") return key === "riskNotChecked" ? c.q_riskcheckChecked : c.q_riskcheck;
    return id in c ? c[id as keyof typeof c] : undefined;
  };
  const fromTitle = (id: string) => {
    if (preview) return undefined;
    const from = replacedFrom[id];
    const tpl = from ? QUEST_POOL.find((x) => x.id === from) : undefined;
    return tpl ? questTitle(dict, lang, tpl) : undefined;
  };

  const item = (q: QuestTemplate, variant: "tile" | "row", slot?: number) => {
    const key = reasonKey(q.id);
    const from = carried[q.id];
    return (
      <QuestItem
        key={q.id}
        quest={q}
        variant={variant}
        slot={slot}
        done={!!done[q.id]}
        passed={!!passed[q.id] && !done[q.id]}
        readOnly={!isActiveView}
        emphasize={isActiveView && q.id === nextQuestId}
        carriedLabel={from ? formatString(p.from, { mode: q2.modes[from] }) : undefined}
        replacedFromTitle={fromTitle(q.id)}
        journalHref={APP_CLOSED_QUESTS.has(q.id) ? journalHref(q.id, key) : undefined}
        journalCta={journalCta(q.id, key)}
        busy={busyId === q.id}
        replaceUsed={gameState.replacementsUsedToday}
        replaceMax={GAME_CONFIG.QUEST_REPLACEMENTS_PER_DAY}
        onComplete={() => onComplete(q)}
        onPass={() => onPass(q)}
        onReplace={() => onReplace(q)}
      />
    );
  };

  const stepHref = (s: MissionStep) => (s.key === "risk" ? journalHref("q_riskcheck", reasonKey("q_riskcheck")) : planHref(s.key === "calendar" ? "events" : s.key));
  const protocol = viewed === "trading" ? morningProtocol(snapshot, gameDay, done).steps : [];
  const ritual = viewed === "trading" || viewed === "study" ? endOfDayRitual(snapshot, gameDay, done).steps : [];
  const noTrades = noTradesOn(snapshot, gameDay);

  // done today in another mode and not part of this view (journal quests are shown by the day plan)
  const shownIds = new Set([...shownCore, ...shownBonus].map((q) => q.id));
  const elsewhere = isActiveView ? byIds(Object.keys(done).filter((id) => done[id] && !shownIds.has(id) && !APP_CLOSED_QUESTS.has(id))) : [];

  return (
    <div className="space-y-8">
      {/* the one focus: three missions of the day */}
      <section aria-labelledby="missions-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 id="missions-title" className="font-serif text-xl font-bold text-tx">{p.missions}</h2>
            {viewed !== "rest" && (
              <span className="text-sm text-mu" data-testid="core-count">
                {coreDone} / {shownCore.length}
              </span>
            )}
          </div>
          <ModeSwitch active={mode} viewed={viewed} onView={setViewed} />
        </div>

        {!isActiveView && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-vi/40 px-3 py-2" data-testid="mode-viewing">
            <span className="text-sm text-mu">{formatString(p.viewing, { mode: q2.modes[viewed] })}</span>
            <Button size="sm" disabled={busyId === "mode"} aria-busy={busyId === "mode" || undefined} onClick={() => onActivate(viewed)} data-testid="mode-activate">
              {p.activate}
            </Button>
          </div>
        )}

        <div id="mode-panel" role="tabpanel" aria-labelledby={`mode-tab-${viewed}`} data-testid="mode-panel" data-mode={viewed}>
          {viewed === "rest" ? (
            <div className="flex items-center gap-4 rounded-2xl border border-line bg-s1 p-5" data-testid="rest-panel">
              <Moon size={26} aria-hidden="true" className="shrink-0 text-vi" />
              <div>
                <h3 className="font-serif text-lg font-bold text-tx">{p.restTitle}</h3>
                <p className="text-sm text-mu">{p.restText}</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-3">{shownCore.map((q, i) => item(q, "tile", i + 1))}</div>
          )}
        </div>
      </section>

      {/* everything else: quieter and further down */}
      {viewed !== "rest" && (protocol.length > 0 || ritual.length > 0 || shownBonus.length > 0 || elsewhere.length > 0) && (
        <section aria-labelledby="more-title" className="space-y-3">
          <h2 id="more-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{p.more}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {(protocol.length > 0 || ritual.length > 0) && <PlanSteps protocol={protocol} ritual={ritual} hrefFor={stepHref} />}

            <div className="min-w-0 space-y-3">
              {shownBonus.length > 0 && (
                <section className="rounded-2xl border border-line bg-s1/60 px-4 py-1">
                  <button
                    type="button"
                    aria-expanded={bonusOpen}
                    onClick={() => setBonusOpen((v) => !v)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-sm font-semibold text-tx hover:text-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                  >
                    {formatString(p.bonus, { n: shownBonus.length })}
                    <span className="flex items-center gap-2 text-xs font-normal text-mu">
                      <span data-testid="self-cap">{formatString(p.selfCap, { xp: selfReportXpOn(gameState, gameDay), cap: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP })}</span>
                      <ChevronDown size={16} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${bonusOpen ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {bonusOpen && <div className="divide-y divide-line/60 border-t border-line/60">{shownBonus.map((q) => item(q, "row"))}</div>}
                </section>
              )}

              {elsewhere.length > 0 && (
                <section className="rounded-2xl border border-line bg-s1/60 p-4" data-testid="done-elsewhere">
                  <h3 className="text-sm font-semibold text-tx">{p.elsewhere}</h3>
                  <ul className="mt-2 space-y-1">
                    {elsewhere.map((q) => (
                      <li key={q.id} className="flex items-center gap-2 text-sm text-mu">
                        <Check size={14} aria-hidden="true" className="text-success" />
                        {questTitle(dict, lang, q)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-s1/60 px-4 py-2" data-testid="no-trade-card">
                <span className="min-w-0 text-sm text-mu">
                  {p.noTrade}
                  {noTrades > 0 && (
                    <span className="block text-xs font-semibold text-tx" data-testid="no-trade-count">
                      {formatString(p.noTradeToday, { n: noTrades })}
                    </span>
                  )}
                </span>
                <Link href="/journal?tab=trades" className={buttonClasses("ghost", "sm", "shrink-0")}>
                  {p.go}
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
