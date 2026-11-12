"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { HardDrive } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { rewardedToday } from "@/lib/game";
import { lastWeekTradeCount, pickBoss, type DayMode, type JournalSnapshot } from "@/lib/quest-engine";
import { mondayOfKey } from "@/lib/day-key";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { QUEST_POOL, type QuestTemplate } from "@/lib/quests";
import { activityGrid, nextStep, todayEarned, todaysQuests, weekDays, weekQuestCount } from "@/lib/quests-view";
import { Tabs } from "@/components/ui/Tabs";
import { QuestsHero } from "@/components/quests/QuestsHero";
import { TodayTab } from "@/components/quests/TodayTab";
import { WeekTab } from "@/components/quests/WeekTab";
import { PathTab } from "@/components/quests/PathTab";
import { DisciplineTab } from "@/components/quests/DisciplineTab";
import { HistoryTab } from "@/components/quests/HistoryTab";
import { questTitle } from "@/components/quests/quest-text";

type QuestsTab = "today" | "week" | "path" | "discipline" | "history";
const TABS: QuestsTab[] = ["today", "week", "path", "discipline", "history"];

export default function QuestsPage() {
  const { dict, lang, showToast } = useApp();
  const { gameState, gameDay, rewards, passQuest, replaceQuest, setDayMode, fixWeekChallenge } = useGame();
  const { trades, plans, weekPlans, noTrades } = useJournal();
  const [activeTab, setActiveTab] = useState<QuestsTab>("today");
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const t = dict.questsPage;

  const { core, bonus, replacedFrom } = useMemo(() => todaysQuests(gameState, gameDay), [gameState, gameDay]);
  const days = useMemo(() => weekDays(gameState, gameDay), [gameState, gameDay]);
  const grid = useMemo(() => activityGrid(gameState, gameDay, 4), [gameState, gameDay]);
  const weekCount = useMemo(() => weekQuestCount(gameState, gameDay), [gameState, gameDay]);
  const earned = todayEarned(gameState, gameDay);
  const next = nextStep(gameState, core);
  const coreDone = core.filter((q) => gameState.completedQuestsToday[q.id]).length;

  // What the engine reads from the journal (no second journal, no second plan)
  const snapshot: JournalSnapshot = useMemo(
    () => ({ trades, plans, weekPlans, noTrades, timezone: gameState.profile?.timezone }),
    [trades, plans, weekPlans, noTrades, gameState.profile?.timezone]
  );
  const mode: DayMode = gameState.isRestDay ? "rest" : gameState.questDay?.day === gameDay ? gameState.questDay.mode : "trading";
  const modeLocked = rewardedToday(gameState, gameDay);

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
      if (res.ok) showToast(formatString(t.q2.modes.changed, { mode: t.q2.modes[m] }));
      else showToast(res.reason === "locked" ? t.q2.modes.locked : t.q1.today.notSaved);
    });

  const goToQuest = (questId: string) => {
    setActiveTab("today");
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="quest-card-${questId}"] button`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-bold text-tx md:text-3xl">{t.title}</h1>
          <p className="mt-1 text-sm text-mu">{t.subtitle}</p>
        </div>
      </header>

      <QuestsHero coreDone={coreDone} coreTotal={core.length} weekCount={weekCount} next={next} onNextQuest={goToQuest} />

      <Tabs<QuestsTab>
        items={TABS.map((id) => ({ id, label: t.tabs[id] }))}
        value={activeTab}
        onChange={setActiveTab}
        label={t.q1.tabsLabel}
        idPrefix="quests"
      />

      <div role="tabpanel" id={`quests-panel-${activeTab}`} aria-labelledby={`quests-tab-${activeTab}`} className="min-w-0">
        {activeTab === "today" && (
          <TodayTab
            core={core}
            bonus={bonus}
            replacedFrom={replacedFrom}
            earned={earned}
            busyId={busyId}
            mode={mode}
            modeLocked={modeLocked}
            snapshot={snapshot}
            onMode={changeMode}
            onComplete={complete}
            onPass={pass}
            onReplace={replace}
          />
        )}
        {activeTab === "week" && <WeekTab days={days} weekCount={weekCount} snapshot={snapshot} />}
        {activeTab === "path" && <PathTab />}
        {activeTab === "discipline" && <DisciplineTab grid={grid} />}
        {activeTab === "history" && <HistoryTab />}
      </div>

      <p className="flex items-start gap-2 text-xs text-mu" data-testid="device-note">
        <HardDrive size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
        {t.q1.deviceNote}
      </p>
    </div>
  );
}
