"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Moon, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatNumber, formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { modeSetPreview, selfReportXpOn } from "@/lib/game";
import { APP_CLOSED_QUESTS, QUEST_POOL, type QuestTemplate } from "@/lib/quests";
import { journalHref, planHref } from "@/lib/quests-view";
import { endOfDayRitual, morningProtocol, noTradesOn, reasonFor, type DayMode, type JournalSnapshot, type MissionStep } from "@/lib/quest-engine";
import { buttonClasses } from "@/components/ui/Button";
import { QuestCard } from "./QuestCard";
import { MissionCard } from "./MissionCard";
import { ModeSwitch } from "./ModeSwitch";
import { questTitle } from "./quest-text";

interface Props {
  core: QuestTemplate[];
  bonus: QuestTemplate[];
  replacedFrom: Record<string, string>;
  earned: { xp: number; coins: number };
  busyId: string | null;
  /** The active mode of the game day. */
  mode: DayMode;
  snapshot: JournalSnapshot;
  onActivate: (m: DayMode) => void;
  onComplete: (q: QuestTemplate) => void;
  onPass: (q: QuestTemplate) => void;
  onReplace: (q: QuestTemplate) => void;
}

const byIds = (ids: string[]) => ids.map((id) => QUEST_POOL.find((q) => q.id === id)).filter((q): q is QuestTemplate => !!q);

/**
 * Today: the four modes can be viewed at any time; only the active one can be done (docs/quests-ux-3.0-plan.md, 6).
 * Every core quest is shown (journal ones too, with a button to the exact place), so the counter matches the cards.
 */
export function TodayTab({ core, bonus, replacedFrom, earned, busyId, mode, snapshot, onActivate, onComplete, onPass, onReplace }: Props) {
  const { dict, lang } = useApp();
  const { gameState, gameDay } = useGame();
  const t = dict.questsPage.q1.today;
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

  const fromTitle = (id: string) => {
    if (preview) return undefined;
    const from = replacedFrom[id];
    const tpl = from ? QUEST_POOL.find((x) => x.id === from) : undefined;
    return tpl ? questTitle(dict, lang, tpl) : undefined;
  };
  const reasonKey = (id: string) => reasonFor(id, !!done[id], snapshot, gameDay);
  const journalCta = (id: string, key: ReturnType<typeof reasonKey>) => {
    const c = q2.journalCta;
    if (id === "q_riskcheck") return key === "riskNotChecked" ? c.q_riskcheckChecked : c.q_riskcheck;
    return id in c ? c[id as keyof typeof c] : undefined;
  };

  const card = (q: QuestTemplate, compact = false) => {
    const key = reasonKey(q.id);
    const from = carried[q.id];
    return (
      <QuestCard
        key={q.id}
        quest={q}
        compact={compact}
        done={!!done[q.id]}
        passed={!!passed[q.id] && !done[q.id]}
        readOnly={!isActiveView}
        reason={key ? q2.reasons[key] : undefined}
        carriedLabel={from ? formatString(q2.carried, { mode: q2.modes[from] }) : undefined}
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

  const stepHref = (s: MissionStep) => {
    if (s.key === "risk") return journalHref("q_riskcheck", reasonKey("q_riskcheck"));
    return planHref(s.key === "calendar" ? "events" : s.key);
  };

  const protocol = morningProtocol(snapshot, gameDay, done);
  const ritual = endOfDayRitual(snapshot, gameDay, done);
  const noTrades = noTradesOn(snapshot, gameDay);

  // done today in another mode and not part of this view (journal quests are shown by their missions)
  const shownIds = new Set([...shownCore, ...shownBonus].map((q) => q.id));
  const elsewhere = isActiveView ? byIds(Object.keys(done).filter((id) => done[id] && !shownIds.has(id) && !APP_CLOSED_QUESTS.has(id))) : [];
  const coreDone = shownCore.filter((q) => done[q.id]).length;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <ModeSwitch active={mode} viewed={viewed} busy={busyId === "mode"} onView={setViewed} onActivate={onActivate} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-mu" data-testid="today-earned">
            {formatString(t.earned, { xp: formatNumber(lang, earned.xp), coins: formatNumber(lang, earned.coins) })}
          </p>
          <p className="text-sm text-mu" data-testid="self-cap" title={formatString(q2.selfCap.note, { cap: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP })}>
            {formatString(q2.selfCap.progress, { xp: selfReportXpOn(gameState, gameDay), cap: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP })}
          </p>
        </div>

        <div id="mode-panel" role="tabpanel" aria-labelledby={`mode-tab-${viewed}`} data-testid="mode-panel" data-mode={viewed} className="space-y-4">
          {viewed === "rest" ? (
            <div className="rounded-lg border border-line bg-s1 px-5 py-10 text-center" data-testid="rest-panel">
              <Moon size={30} aria-hidden="true" className="mx-auto text-vi" />
              <h3 className="mt-2 font-serif text-lg font-bold text-tx">{t.restTitle}</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-mu">{t.restHint}</p>
            </div>
          ) : (
            <>
              {viewed === "study" && <p className="rounded-lg bg-s2/60 p-3 text-sm text-mu" data-testid="mode-note">{q2.modes.studyNote}</p>}
              {viewed === "recovery" && <p className="rounded-lg bg-s2/60 p-3 text-sm text-mu" data-testid="mode-note">{q2.modes.recoveryNote}</p>}

              {viewed === "trading" && (
                <MissionCard id="morning_protocol" kicker={q2.protocol.kicker} title={q2.protocol.title} desc={q2.protocol.desc} steps={protocol.steps} hasPlan={protocol.hasPlan} hrefFor={stepHref} />
              )}

              <section className="space-y-3" aria-labelledby="core-title">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="core-title" className="text-[15px] font-semibold text-tx">{dict.questsPage.todayTab.coreTitle}</h2>
                  <span className="text-sm text-mu" data-testid="core-count">
                    {coreDone} / {shownCore.length}
                  </span>
                </div>
                {shownCore.length > 0 ? shownCore.map((q) => card(q)) : <p className="rounded-lg bg-s2/60 p-4 text-sm text-mu">{t.allClear}</p>}
              </section>

              {(viewed === "trading" || viewed === "study") && (
                <MissionCard id="eod_ritual" kicker={q2.ritual.kicker} title={q2.ritual.title} desc={q2.ritual.desc} steps={ritual.steps} hasPlan={ritual.hasPlan} hrefFor={stepHref} />
              )}

              {shownBonus.length > 0 && (
                <section className="space-y-3">
                  <button
                    type="button"
                    aria-expanded={bonusOpen}
                    onClick={() => setBonusOpen((v) => !v)}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-md px-1 text-left text-[15px] font-semibold text-tx hover:text-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                  >
                    {formatString(t.bonusToggle, { n: shownBonus.length })}
                    <ChevronDown size={18} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${bonusOpen ? "rotate-180" : ""}`} />
                  </button>
                  {bonusOpen && shownBonus.map((q) => card(q, true))}
                </section>
              )}
            </>
          )}

          {elsewhere.length > 0 && (
            <section className="rounded-lg border border-line bg-s1 p-4" data-testid="done-elsewhere">
              <h2 className="text-[15px] font-semibold text-tx">{q2.otherModesTitle}</h2>
              <ul className="mt-2 space-y-1.5">
                {elsewhere.map((q) => (
                  <li key={q.id} className="flex items-center gap-2 text-sm text-tx">
                    <Check size={15} aria-hidden="true" className="text-success" />
                    {questTitle(dict, lang, q)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <aside className="min-w-0 space-y-4">
        <div className="rounded-lg border border-line bg-s1 p-4" data-testid="no-trade-card">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} aria-hidden="true" className="text-vi" />
            <h2 className="text-[15px] font-semibold text-tx">{t.noTradeTitle}</h2>
          </div>
          <p className="mt-1.5 text-sm text-mu">{t.noTradeDesc}</p>
          <p className="mt-2 text-sm font-semibold text-tx" data-testid="no-trade-count">
            {noTrades > 0 ? formatString(q2.noTrade.today, { n: noTrades }) : q2.noTrade.none}
          </p>
          <Link href="/journal?tab=trades" className={buttonClasses("ghost", "md", "mt-2 -ml-2")}>
            {t.noTradeCta}
          </Link>
        </div>
        <p className="rounded-lg bg-s2/60 p-3 text-xs text-mu">{t.restHint}</p>
        <p className="rounded-lg bg-s2/60 p-3 text-xs text-mu">{formatString(q2.selfCap.note, { cap: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP })}</p>
      </aside>
    </div>
  );
}
