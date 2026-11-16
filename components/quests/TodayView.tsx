"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookCheck, Check, Moon, Sprout, Swords } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { modeSetPreview, selfReportXpOn } from "@/lib/game";
import { APP_CLOSED_QUESTS, CATALOG3_MISSIONS, isJournalConfirmed, questById, type QuestTemplate } from "@/lib/quests";
import { journalHref, planHref } from "@/lib/quests-view";
import type { QuestState } from "@/lib/game";
import { endOfDayRitual, morningProtocol, noTradesOn, reasonFor, type DayMode, type JournalSnapshot, type MissionStep } from "@/lib/quest-engine";
import { Button, buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { QuestItem } from "./QuestItem";
import { PlanSteps } from "./PlanSteps";
import { ModeSwitch } from "./ModeSwitch";
import { HABIT_QUESTS, questShortTitle, questTitle } from "./quest-text";
import { VerificationBadge } from "./VerificationBadge";

interface Props {
  core: QuestTemplate[];
  bonus: QuestTemplate[];
  replacedFrom: Record<string, string>;
  busyId: string | null;
  /** The active mode of the game day. */
  mode: DayMode;
  /** The quest of the «next step»: it is marked in its own row (a mission, a day plan step or an extra). */
  nextQuestId?: string;
  snapshot: JournalSnapshot;
  /** The journal's cloud copy is still loading: missions from new records are paid after the sync (QH-6.5). */
  syncing?: boolean;
  /** Missions the journal already confirms that wait for the sync to be paid. */
  waitingSync?: ReadonlySet<string>;
  /** QH-6.6: the quest state of each catalog-3 mission of the active set (available, accepted, ready, completed). */
  questStates?: Record<string, QuestState>;
  /** QH-6.6: why the last «Verify» of a mission did not confirm it (translated). */
  verifyFailures?: Record<string, string>;
  /** QH-6.6: the mission completed by a «Verify» just now. */
  justCompleted?: string;
  onAccept?: (q: QuestTemplate) => void;
  onVerify?: (q: QuestTemplate) => void;
  onActivate: (m: DayMode) => void;
  onComplete: (q: QuestTemplate) => void;
  onPass: (q: QuestTemplate) => void;
  onReplace: (q: QuestTemplate) => void;
}

const byIds = (ids: string[]) => ids.map((id) => questById(id)).filter((q): q is QuestTemplate => !!q);

/**
 * Today (docs/quest-hub-plan.md, 4.1): the three missions of the day are rows and the one focus; the next step is marked
 * inside its row. Below them, quieter: the day plan, extra challenges and everyday habits (self-reports) apart.
 */
export function TodayView({ core, bonus, replacedFrom, busyId, mode, nextQuestId, snapshot, syncing, waitingSync, questStates, verifyFailures, justCompleted, onAccept, onVerify, onActivate, onComplete, onPass, onReplace }: Props) {
  const { dict, lang } = useApp();
  const { gameState, gameDay } = useGame();
  const p = dict.questsPage.q2.page;
  const m = dict.questsPage.q2.mission;
  const q2 = dict.questsPage.q2;
  const [viewed, setViewed] = useState<DayMode>(mode);
  const done = gameState.completedQuestsToday;
  const passed = gameState.passedQuestsToday;
  const tz = gameState.profile?.timezone;

  // a change of the active mode (here or in another tab) shows that mode
  useEffect(() => setViewed(mode), [mode]);

  const isActiveView = viewed === mode;
  const preview = useMemo(() => (isActiveView ? null : modeSetPreview(gameState, viewed)), [isActiveView, gameState, viewed]);
  const shownCore = preview ? byIds(preview.core) : core;
  const shownBonus = preview ? byIds(preview.bonus) : bonus;
  const carried = (preview ? preview.carried : gameState.questDay?.day === gameDay ? gameState.questDay.carried : undefined) || {};
  // a mission is done when it was confirmed and paid (QH-6.4: the journal closes it; nothing is shown as done before)
  const isDone = (id: string) => !!done[id];
  const coreDone = shownCore.filter((q) => isDone(q.id)).length;

  // when a quest was done today: the last entry of the day's history (shown on the row, in the account time zone)
  const doneAt = useMemo(() => {
    const out: Record<string, string> = {};
    const fmt = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined });
    for (const h of gameState.history || []) {
      if (h.completedAt !== gameDay || !h.at) continue;
      const d = new Date(h.at);
      if (!isNaN(d.getTime())) out[h.questId] = fmt.format(d);
    }
    return out;
  }, [gameState.history, gameDay, lang, tz]);

  const reasonKey = (id: string) => reasonFor(id, !!done[id], snapshot, gameDay);
  const journalCta = (id: string, key: ReturnType<typeof reasonKey>) => {
    const c = q2.journalCta;
    if (id === "q_riskcheck") return key === "riskNotChecked" ? c.q_riskcheckChecked : c.q_riskcheck;
    if (id === "q_bias" && key === "noLevels") return c.q_biasLevels;
    return id in c ? c[id as keyof typeof c] : undefined;
  };
  const fromTitle = (id: string) => {
    if (preview) return undefined;
    const from = replacedFrom[id];
    const tpl = from ? questById(from) : undefined;
    return tpl ? questShortTitle(dict, lang, tpl) : undefined;
  };

  const item = (q: QuestTemplate, variant: "mission" | "extra", slot?: number) => {
    const key = reasonKey(q.id);
    const from = carried[q.id];
    return (
      <QuestItem
        key={q.id}
        quest={q}
        variant={variant}
        slot={slot}
        done={isDone(q.id)}
        doneAt={doneAt[q.id]}
        passed={!!passed[q.id] && !isDone(q.id)}
        readOnly={!isActiveView}
        next={isActiveView && q.id === nextQuestId}
        carriedLabel={from ? formatString(p.from, { mode: q2.modes[from] }) : undefined}
        replacedFromTitle={fromTitle(q.id)}
        journalHref={isJournalConfirmed(q.id) ? journalHref(q.id, key) : undefined}
        journalCta={journalCta(q.id, key)}
        waitingSync={isActiveView && !!waitingSync?.has(q.id)}
        questState={isActiveView && variant === "mission" ? questStates?.[q.id] : undefined}
        verifyFailure={verifyFailures?.[q.id]}
        justCompleted={justCompleted === q.id}
        onAccept={() => onAccept?.(q)}
        onVerify={() => onVerify?.(q)}
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
  // catalog 3: the day review is a trading mission (a study day before catalog 3 kept it as its evening step)
  const catalog3 = shownCore.some((q) => CATALOG3_MISSIONS.has(q.id));
  const ritual = viewed === "trading" || (viewed === "study" && !catalog3) ? endOfDayRitual(snapshot, gameDay, done).steps : [];
  const noTrades = noTradesOn(snapshot, gameDay);
  const challenges = shownBonus.filter((q) => !HABIT_QUESTS.has(q.id));
  const habits = shownBonus.filter((q) => HABIT_QUESTS.has(q.id));

  // done today in another mode and not part of this view (journal quests are shown by the day plan)
  const shownIds = new Set([...shownCore, ...shownBonus].map((q) => q.id));
  const elsewhere = isActiveView ? byIds(Object.keys(done).filter((id) => done[id] && !shownIds.has(id) && !APP_CLOSED_QUESTS.has(id))) : [];
  const hasPlan = protocol.length > 0 || ritual.length > 0;

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* the one focus: three missions of the day */}
      <section aria-labelledby="missions-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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

        {syncing && viewed !== "rest" && (
          <p role="status" className="rounded-xl border border-[#e5b98a]/40 bg-[#e5b98a]/[0.06] px-3 py-2 text-sm text-tx" data-testid="missions-syncing">
            {m.syncing}
          </p>
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
            <div className="missions space-y-2.5" data-testid="missions">
              {shownCore.map((q, i) => item(q, "mission", i + 1))}
            </div>
          )}
        </div>
      </section>

      {/* everything else: quieter and further down */}
      {viewed !== "rest" && (
        <section aria-labelledby="more-title" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h2 id="more-title" className="text-base font-bold text-tx">{m.extras}</h2>
              <p className="mt-0.5 text-xs text-mu" data-testid="extras-note">
                {formatString(m.extrasNote, { cap: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP })}
              </p>
            </div>
            <span className="text-xs text-mu" data-testid="self-cap">
              {formatString(m.selfCap, { xp: selfReportXpOn(gameState, gameDay), cap: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP })}
            </span>
          </div>
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {hasPlan && (
              <div className="min-w-0">
                <PlanSteps
                  protocol={protocol}
                  ritual={ritual}
                  hrefFor={stepHref}
                  nextQuestId={isActiveView && !shownCore.some((q) => q.id === nextQuestId) ? nextQuestId : undefined}
                  missionTitle={(id) => {
                    // catalog 3: the plan's steps are parts of the day's missions; their reward is the mission's, not a second one
                    const tpl = shownCore.find((q) => q.id === id);
                    return tpl ? questShortTitle(dict, lang, tpl) : undefined;
                  }}
                />
              </div>
            )}
            <div className="min-w-0 space-y-3">
              <ExtrasGroup testId="extras-challenges" icon={<Swords size={15} aria-hidden="true" />} title={m.challenges} note={m.challengesNote}>
                {challenges.map((q) => item(q, "extra"))}
                <div className="flex items-center gap-3 py-2.5" data-testid="no-trade-card">
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-success/[0.08] text-success">
                    <BookCheck size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold leading-snug text-tx">{m.noTrade}</h4>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mu">
                      <VerificationBadge source="journal" label={p.journal} />
                      {noTrades > 0 && (
                        <span className="font-semibold text-tx" data-testid="no-trade-count">
                          {formatString(p.noTradeToday, { n: noTrades })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Link href="/journal?tab=trades" className={buttonClasses("secondary", "sm", "shrink-0")} aria-label={`${m.noTradeGo}: ${m.noTrade}`}>
                    {m.noTradeGo}
                  </Link>
                </div>
              </ExtrasGroup>
              {habits.length > 0 && (
                <ExtrasGroup testId="extras-habits" icon={<Sprout size={15} aria-hidden="true" />} title={m.habits} note={m.habitsNote} quiet>
                  {habits.map((q) => item(q, "extra"))}
                </ExtrasGroup>
              )}
              {elsewhere.length > 0 && (
                <section className="rounded-2xl border border-line bg-s1/50 p-4" data-testid="done-elsewhere">
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
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/** A group of the extras: challenges (trading practice, by choice) or habits (self-reports, quieter). */
function ExtrasGroup({ testId, icon, title, note, quiet, children }: { testId: string; icon: React.ReactNode; title: string; note: string; quiet?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border px-4 pb-1 pt-3", quiet ? "border-dashed border-line" : "border-line bg-s1/60")} data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-tx">
          <span className={quiet ? "text-mu" : "text-vi"}>{icon}</span>
          {title}
        </h3>
        <span className="text-xs text-mu">{note}</span>
      </div>
      <div className="mt-1 divide-y divide-line/60">{children}</div>
    </section>
  );
}
