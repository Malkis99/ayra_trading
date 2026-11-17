"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HardDrive } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { chooseWeekPath, closedBossResult, reasonFor, type DayMode, type JournalSnapshot } from "@/lib/quest-engine";
import { mondayOfKey } from "@/lib/day-key";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { questById, type QuestTemplate } from "@/lib/quests";
import { pendingMissionClaims, questStates as questStatesOf, type VerifyFailure } from "@/lib/game";
import type { MissionData } from "@/lib/missions";
import { missionSourceLabel } from "@/components/quests/quest-text";
import { nextStep, todayEarned, todaysQuests, weekDays, weekQuestCount } from "@/lib/quests-view";
import { QuestsHeader } from "@/components/quests/QuestsHeader";
import { TodayView } from "@/components/quests/TodayView";
import { WeekCard, WeekTab } from "@/components/quests/WeekTab";
import { PastWeekBoss, TradingDaysPicker, WeekGoals, WeekObjectives, WeeklyBoss } from "@/components/quests/WeekMissions";
import { LastWeekResult, WeekTrophies } from "@/components/quests/WeekChallenge";
import { addDaysToKey } from "@/lib/day-key";
import { clampWeek, dayDetail, defaultDay, earliestWeek, weekView } from "@/lib/week-view";
import { GoalsCard } from "@/components/quests/GoalsCard";
import { StreakRuleCard } from "@/components/quests/DisciplineTab";
import { ActivityMap, HistoryStatsBlock } from "@/components/quests/HistoryOverview";
import { DayPanel } from "@/components/quests/DayPanel";
import { historyDefaultDay, historyMap, historyStats } from "@/lib/history-view";
import { HistoryTab } from "@/components/quests/HistoryTab";
import { PathMain, PathRail } from "@/components/quests/PersonalPath";
import { HUB_TABS, HubColumns, HubTabs, parseHubTab, type HubTab } from "@/components/quests/HubLayout";
import { questTitle } from "@/components/quests/quest-text";

/** Quest Hub (docs/quest-hub-plan.md): the profile strip, four top-level tabs that switch the page, two columns. */
export default function QuestsPage() {
  const { dict, lang, showToast } = useApp();
  const { gameState, gameDay, rewards, passQuest, replaceQuest, setDayMode, fixWeekChallenge, recordWeekBossResult, acceptMission, verifyMission } = useGame();
  const { trades, plans, weekPlans, noTrades, notes, ready: journalReady, cloudSettled, getAllRecords } = useJournal();
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
    // a tab opens at its start: the week and day chosen on «Week» are not carried over
    url.searchParams.delete("week");
    url.searchParams.delete("day");
    window.history.pushState(null, "", url.toString());
    // a tab switched from far below starts at its top
    const top = tabsRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) tabsRef.current?.scrollIntoView({ block: "start" });
  }, []);

  const { core, bonus, replacedFrom } = useMemo(() => todaysQuests(gameState, gameDay), [gameState, gameDay]);
  const days = useMemo(() => weekDays(gameState, gameDay), [gameState, gameDay]);

  // The Week tab (QH-4): the week and the open day are in the address (?week=…&day=…), replaced, not added to the
  // history (Back still switches tabs). Future weeks and weeks before the account cannot be opened.
  const currentWeek = mondayOfKey(gameDay);
  const firstWeek = useMemo(() => earliestWeek(gameState, gameDay), [gameState, gameDay]);
  const shownWeek = clampWeek(searchParams.get("week"), firstWeek, currentWeek);
  const shownDays = useMemo(() => weekView(gameState, shownWeek, gameDay), [gameState, shownWeek, gameDay]);
  const shownDay = defaultDay(shownDays, searchParams.get("day"));
  const dayInfo = useMemo(() => dayDetail(gameState, shownDay, gameDay), [gameState, shownDay, gameDay]);
  // The History tab (QH-5): 12 weeks from the same day views; the open day is in the address (?day=…, replaced)
  const histMap = useMemo(() => historyMap(gameState, gameDay), [gameState, gameDay]);
  const histStats = useMemo(() => historyStats(gameState, histMap), [gameState, histMap]);
  const histDay = historyDefaultDay(histMap, activeTab === "history" ? searchParams.get("day") : null);
  const histDetail = useMemo(() => dayDetail(gameState, histDay, gameDay), [gameState, histDay, gameDay]);
  const selectHistoryDay = useCallback((day: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "history");
    url.searchParams.set("day", day);
    window.history.replaceState(null, "", url.toString());
  }, []);
  const setWeekParams = useCallback((week: string, day?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "week");
    if (week) url.searchParams.set("week", week);
    else url.searchParams.delete("week");
    if (day) url.searchParams.set("day", day);
    else url.searchParams.delete("day");
    window.history.replaceState(null, "", url.toString());
  }, []);
  const weekCount = useMemo(() => weekQuestCount(gameState, gameDay), [gameState, gameDay]);
  const earned = todayEarned(gameState, gameDay);
  const coreDone = core.filter((q) => gameState.completedQuestsToday[q.id]).length;
  // QH-6.5: while a cloud journal loads its copy, missions are not paid yet (lib/game.ts claims only after it). The page
  // says so, and marks the missions the journal already confirms. Only shown — the payment is MissionClaimSync's.
  const syncing = journalReady && !cloudSettled;
  // QH-6.6: the quest state of each mission (accepted in the game, ready from the saved journal); nothing here pays
  const missionData = useCallback((): MissionData => {
    const all = getAllRecords();
    return { plans: all.plans || [], notes: all.notes || [], trades: all.trades || [], timezone: gameState.profile?.timezone };
  }, [getAllRecords, gameState.profile?.timezone]);
  const questStates = useMemo(
    // states from the first frame (accepted / available / completed come from the game); «ready» only once the journal is read
    () => questStatesOf(gameState, journalReady ? missionData() : { plans: [], notes: [], trades: [], timezone: gameState.profile?.timezone }, new Date()),
    // the journal lists change after every save
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [journalReady, gameState, missionData, plans, notes, trades]
  );
  // My path (QH-8.3): data-confirmed days are read from the Journal only once it is read and its cloud copy is in
  const pathJournal = useMemo(
    () => (journalReady && cloudSettled ? missionData() : null),
    // the journal lists change after every save
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [journalReady, cloudSettled, missionData, plans, notes, trades]
  );
  const [verifyFailures, setVerifyFailures] = useState<Record<string, string>>({});
  const [justCompleted, setJustCompleted] = useState<string | undefined>(undefined);
  const failureText = (id: string, f: VerifyFailure) => {
    const r = t.q2.quest.reasons as Record<string, string>;
    return formatString(r[f.reason] || r.notAvailable, { min: f.min ?? "", source: missionSourceLabel(dict, id) || "" });
  };
  const accept = (q: QuestTemplate) => {
    setVerifyFailures((x) => ({ ...x, [q.id]: "" }));
    if (!acceptMission(q.id)) showToast(t.q2.quest.notSaved);
  };
  const verify = (q: QuestTemplate) =>
    runOnce(q.id, async () => {
      if (!cloudSettled) {
        setVerifyFailures((x) => ({ ...x, [q.id]: t.q2.quest.reasons.syncing }));
        return;
      }
      const res = await verifyMission(q.id, missionData());
      if (res.saveFailed) {
        showToast(t.q2.quest.notSaved);
        return;
      }
      if (res.paid) {
        setVerifyFailures((x) => ({ ...x, [q.id]: "" }));
        setJustCompleted(q.id);
        if (res.leveledUp) showToast(formatString(dict.chronicleEvents.levelUp, { level: res.newLevel ?? gameState.level }));
        return;
      }
      if (res.failure) setVerifyFailures((x) => ({ ...x, [q.id]: failureText(q.id, res.failure!) }));
    });

  const waitingSync = useMemo(() => {
    if (!syncing) return new Set<string>();
    const all = getAllRecords();
    const pending = pendingMissionClaims(gameState, { plans: all.plans || [], notes: all.notes || [], trades: all.trades || [], timezone: gameState.profile?.timezone }, new Date());
    return new Set<string>((pending?.fresh || []).map((c) => c.id));
    // the journal lists change after every save
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing, gameState, getAllRecords, plans, notes, trades]);

  // What the engine reads from the journal (no second journal, no second plan)
  // notes with deleted ones (as the mission checks read them: a deleted earlier copy still makes a text not new)
  const snapshot: JournalSnapshot = useMemo(
    () => ({ trades, plans, weekPlans, noTrades, notes: getAllRecords().notes || [], timezone: gameState.profile?.timezone }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trades, plans, weekPlans, noTrades, notes, getAllRecords, gameState.profile?.timezone]
  );
  const mode: DayMode = gameState.isRestDay ? "rest" : gameState.questDay?.day === gameDay ? gameState.questDay.mode : "trading";
  const next = nextStep(gameState, core, mode, (id) => reasonFor(id, !!gameState.completedQuestsToday[id], snapshot, gameDay));

  // The week's path is chosen once a week and saved (QH-7.1): only when the journal is read and, for a cloud journal,
  // the cloud copy is in — a choice is never made from missing data (last week's trades may still be loading)
  const week = mondayOfKey(gameDay);
  useEffect(() => {
    if (gameState.questWeek?.week === week || !journalReady || !cloudSettled) return;
    fixWeekChallenge({ week, boss: chooseWeekPath(snapshot, gameDay) });
  }, [week, journalReady, cloudSettled, gameState.questWeek?.week, fixWeekChallenge, snapshot, gameDay]);

  // A closed week keeps its challenge result, written once by the journal of this device (QH-3; nothing is given).
  // It waits until the journal is read AND, for a cloud journal, the cloud copy fetched after opening is in: while the
  // cloud is loading, offline or in error the result stays pending (never a «not met» from incomplete data).
  const closedWeek = gameState.questWeeks?.find((w) => w.week < week && w.boss && !w.bossResult);
  useEffect(() => {
    if (!journalReady || !cloudSettled || !closedWeek?.boss) return;
    const { state, conditions } = closedBossResult(closedWeek.boss, snapshot, closedWeek.week);
    recordWeekBossResult(closedWeek.week, { state, conditions, at: new Date().toISOString() });
  }, [journalReady, cloudSettled, closedWeek, snapshot, recordWeekBossResult]);

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
        const to = res.replacementId ? questById(res.replacementId) : undefined;
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
          syncing={syncing}
          waitingSync={waitingSync}
          questStates={questStates}
          verifyFailures={verifyFailures}
          justCompleted={justCompleted}
          onAccept={accept}
          onVerify={verify}
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
      main: (
        <WeekTab
          week={shownWeek}
          days={shownDays}
          selected={shownDay}
          detail={dayInfo}
          isCurrent={shownWeek === currentWeek}
          canGoBack={shownWeek > firstWeek}
          snapshot={snapshot}
          onWeek={(w) => setWeekParams(w === currentWeek ? "" : w)}
          onDay={(d) => setWeekParams(shownWeek === currentWeek ? "" : shownWeek, d)}
          onOpenToday={() => setTab("today")}
        />
      ),
      rail:
        shownWeek === currentWeek ? (
          <>
            <WeeklyBoss snapshot={snapshot} />
            <LastWeekResult week={currentWeek} onOpen={() => setWeekParams(addDaysToKey(currentWeek, -7))} />
            <TradingDaysPicker />
          </>
        ) : (
          <>
            <PastWeekBoss week={shownWeek} />
            <WeekObjectives snapshot={snapshot} dayKey={shownWeek} past />
            <WeekGoals snapshot={snapshot} dayKey={shownWeek} />
          </>
        ),
    },
    history: {
      main: (
        <div className="space-y-4">
          <HistoryStatsBlock stats={histStats} />
          <ActivityMap map={histMap} selected={histDay} onSelect={selectHistoryDay} />
          <DayPanel detail={histDetail} snapshot={snapshot} onOpenToday={() => setTab("today")} />
          <HistoryTab />
        </div>
      ),
      rail: (
        <>
          <WeekTrophies />
          <GoalsCard />
          <StreakRuleCard />
        </>
      ),
    },
    path: { main: <PathMain journal={pathJournal} />, rail: <PathRail /> },
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
