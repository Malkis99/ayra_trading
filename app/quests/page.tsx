"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HardDrive } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { lastWeekTradeCount, pickBoss, reasonFor, type DayMode, type JournalSnapshot } from "@/lib/quest-engine";
import { mondayOfKey } from "@/lib/day-key";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { QUEST_POOL, type QuestTemplate } from "@/lib/quests";
import { activityGrid, nextStep, todayEarned, todaysQuests, weekDays, weekQuestCount } from "@/lib/quests-view";
import { QuestsHeader } from "@/components/quests/QuestsHeader";
import { TodayView } from "@/components/quests/TodayView";
import { WeekCard, WeekTab } from "@/components/quests/WeekTab";
import { TradingDaysPicker, WeeklyBoss } from "@/components/quests/WeekMissions";
import { GoalsCard } from "@/components/quests/GoalsCard";
import { DisciplineSummary, StreakRuleCard } from "@/components/quests/DisciplineTab";
import { HistoryTab } from "@/components/quests/HistoryTab";
import { CreatorsRules, CreatorsSoon } from "@/components/quests/CreatorsTab";
import { HUB_TABS, HubColumns, HubTabs, parseHubTab, type HubTab } from "@/components/quests/HubLayout";
import { questTitle } from "@/components/quests/quest-text";

/** Quest Hub (docs/quest-hub-plan.md): the profile strip, four top-level tabs that switch the page, two columns. */
export default function QuestsPage() {
  const { dict, lang, showToast } = useApp();
  const { gameState, gameDay, rewards, passQuest, replaceQuest, setDayMode, fixWeekChallenge } = useGame();
  const { trades, plans, weekPlans, noTrades } = useJournal();
  const searchParams = useSearchParams();
  const activeTab = parseHubTab(searchParams.get("tab"));
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const t = dict.questsPage;
  const h = t.q2.hub;

  // A tab is a history entry (?tab=week): «Back» and «Forward» switch tabs; the Next router keeps useSearchParams in step
  const setTab = useCallback((tab: HubTab) => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === tab) return;
    url.searchParams.set("tab", tab);
    window.history.pushState(null, "", url.toString());
    // a tab switched from far below starts at its top
    const top = tabsRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) tabsRef.current?.scrollIntoView({ block: "start" });
  }, []);

  const { core, bonus, replacedFrom } = useMemo(() => todaysQuests(gameState, gameDay), [gameState, gameDay]);
  const days = useMemo(() => weekDays(gameState, gameDay), [gameState, gameDay]);
  const grid = useMemo(() => activityGrid(gameState, gameDay, 4), [gameState, gameDay]);
  const weekCount = useMemo(() => weekQuestCount(gameState, gameDay), [gameState, gameDay]);
  const earned = todayEarned(gameState, gameDay);
  const coreDone = core.filter((q) => gameState.completedQuestsToday[q.id]).length;

  // What the engine reads from the journal (no second journal, no second plan)
  const snapshot: JournalSnapshot = useMemo(
    () => ({ trades, plans, weekPlans, noTrades, timezone: gameState.profile?.timezone }),
    [trades, plans, weekPlans, noTrades, gameState.profile?.timezone]
  );
  const mode: DayMode = gameState.isRestDay ? "rest" : gameState.questDay?.day === gameDay ? gameState.questDay.mode : "trading";
  const next = nextStep(gameState, core, mode, (id) => reasonFor(id, !!gameState.completedQuestsToday[id], snapshot, gameDay));

  // The week challenge is saved once a week, and only when last week's data exists to choose it from
  const week = mondayOfKey(gameDay);
  const hasLastWeek = lastWeekTradeCount(snapshot, gameDay) > 0;
  useEffect(() => {
    if (gameState.questWeek?.week === week || !hasLastWeek) return;
    fixWeekChallenge({ week, boss: pickBoss(snapshot, gameDay) });
  }, [week, hasLastWeek, gameState.questWeek?.week, fixWeekChallenge, snapshot, gameDay]);

  // One request at a time per page: a double click does not queue a second one (the store also checks it)
  const runOnce = async (id: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(id);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  const complete = (q: QuestTemplate) =>
    runOnce(q.id, async () => {
      const title = questTitle(dict, lang, q);
      const res = await rewards.completeSelfReport({ id: q.id, title, category: q.category, xp: q.xpReward });
      if (res.saveFailed) {
        showToast(t.q1.today.notSaved);
        return;
      }
      if (!res.completed) return;
      if (res.capped) {
        showToast(formatString(t.q2.selfCap.capped, { xp: res.xp, cap: GAME_CONFIG.SELF_REPORT_DAILY_XP_CAP }));
        return;
      }
      showToast(res.leveledUp ? formatString(dict.chronicleEvents.levelUp, { level: res.newLevel ?? gameState.level }) : formatString(t.todayTab.rewardXp, { xp: res.xp }));
    });

  const pass = (q: QuestTemplate) => {
    passQuest(q.id);
    showToast(t.todayTab.notTodayToast);
  };

  const replace = (q: QuestTemplate) =>
    runOnce(q.id, async () => {
      const max = GAME_CONFIG.QUEST_REPLACEMENTS_PER_DAY;
      const res = await replaceQuest(q.id, [...core, ...bonus].map((x) => x.id));
      if (res.success) {
        const to = QUEST_POOL.find((x) => x.id === res.replacementId);
        showToast(formatString(t.q1.today.replaceDone, { title: to ? questTitle(dict, lang, to) : "" }));
      } else if (res.reason === "notSaved") {
        showToast(t.q1.today.notSaved);
      } else if (res.reason === "limit") {
        showToast(formatString(t.q1.today.replaceLimit, { max }));
      } else {
        showToast(t.q1.today.replaceNone);
      }
    });

  const changeMode = (m: DayMode) =>
    runOnce("mode", async () => {
      const res = await setDayMode(m);
      showToast(res.ok ? formatString(t.q2.modes.changed, { mode: t.q2.modes[m] }) : t.q1.today.notSaved);
    });

  const badge = "rounded-full px-1.5 text-[11px] font-bold";
  const tabItems = HUB_TABS.map((id) => ({
    id,
    label: t.tabs[id],
    badge:
      id === "today" && mode !== "rest" && core.length > 0 ? (
        <span className={`${badge} text-vi`} aria-label={formatString(h.todayCountAria, { done: coreDone, total: core.length })}>
          {formatString(h.todayCount, { done: coreDone, total: core.length })}
        </span>
      ) : id === "creators" ? (
        <span className={`${badge} border border-line text-mu`}>{h.soon}</span>
      ) : undefined,
  }));

  const openWeek = () => setTab("week");
  const panels: Record<HubTab, { main: React.ReactNode; rail: React.ReactNode }> = {
    today: {
      main: (
        <TodayView
          core={core}
          bonus={bonus}
          replacedFrom={replacedFrom}
          busyId={busyId}
          mode={mode}
          nextQuestId={next.kind === "quest" || next.kind === "journal" ? next.quest.id : undefined}
          snapshot={snapshot}
          onActivate={changeMode}
          onComplete={complete}
          onPass={pass}
          onReplace={replace}
        />
      ),
      rail: (
        <>
          <WeekCard days={days} weekCount={weekCount} onOpen={openWeek} />
          <WeeklyBoss snapshot={snapshot} compact onOpenWeek={openWeek} />
          <GoalsCard />
        </>
      ),
    },
    week: {
      main: <WeekTab days={days} weekCount={weekCount} snapshot={snapshot} />,
      rail: (
        <>
          <WeeklyBoss snapshot={snapshot} />
          <TradingDaysPicker />
        </>
      ),
    },
    history: {
      main: (
        <div className="space-y-5">
          <DisciplineSummary grid={grid} />
          <HistoryTab />
        </div>
      ),
      rail: (
        <>
          <GoalsCard />
          <StreakRuleCard />
        </>
      ),
    },
    creators: { main: <CreatorsSoon />, rail: <CreatorsRules /> },
  };

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-4">
      <h1 className="sr-only">{t.q2.page.title}</h1>

      <QuestsHeader earned={earned} />

      <div ref={tabsRef} className="scroll-mt-4">
        <HubTabs value={activeTab} onChange={setTab} label={h.tabsLabel} items={tabItems} />
      </div>

      <div role="tabpanel" id={`quests-panel-${activeTab}`} aria-labelledby={`quests-tab-${activeTab}`} className="min-w-0 pt-1" data-testid="hub-panel" data-tab={activeTab}>
        <HubColumns main={panels[activeTab].main} rail={panels[activeTab].rail} railLabel={h.rail} />
      </div>

      <p className="flex items-center justify-center gap-2 pt-2 text-xs text-mu" data-testid="device-note">
        <HardDrive size={13} aria-hidden="true" className="shrink-0" />
        {t.q2.page.device}
      </p>
    </div>
  );
}
