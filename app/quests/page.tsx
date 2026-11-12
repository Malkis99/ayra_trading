"use client";

import React, { useMemo, useRef, useState } from "react";
import { HardDrive } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
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
  const { gameState, gameDay, completeQuestSafe, passQuest, replaceQuest } = useGame();
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
      const res = await completeQuestSafe(q.id, title, q.category, q.xpReward);
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
          <TodayTab core={core} bonus={bonus} replacedFrom={replacedFrom} earned={earned} busyId={busyId} onComplete={complete} onPass={pass} onReplace={replace} />
        )}
        {activeTab === "week" && <WeekTab days={days} weekCount={weekCount} />}
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
