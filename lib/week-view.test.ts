import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, checkAndApplyDateResets, completeSelfReportQuest, setDayMode, type GameState } from "./game";
import { clampWeek, dayDetail, defaultDay, earliestWeek, weekSummary, weekView } from "./week-view";
import { journalOnDay } from "./quest-engine";

const at = (iso: string) => new Date(iso);

function started(day: string, extra: Partial<GameState> = {}): GameState {
  const base = { ...INITIAL_GAME_STATE, createdAt: "2026-10-01", profile: { ...INITIAL_GAME_STATE.profile, timezone: "UTC" }, ...extra } as GameState;
  return checkAndApplyDateResets(base, at(`${day}T06:00:00Z`));
}
function tick(s: GameState, when: string) {
  for (const id of [...(s.questDay?.core || []), ...(s.questDay?.bonus || [])]) {
    const r = completeSelfReportQuest(s, id, id, "Mental", 30, at(when));
    if (r.state.completedQuestsToday[id]) return r.state;
  }
  throw new Error("nothing to tick");
}

describe("QH-4 week view: days from snapshots, the history, or nothing", () => {
  it("a snapshot day shows its mode and missions done; a history-only day shows its quests; a skipped day has no record", () => {
    // 2026-11-02 (Mon): history only (before snapshots); 11-03: snapshot; 11-04: not opened; 11-05: today
    let s = started("2026-11-03");
    s = tick(s, "2026-11-03T09:00:00Z");
    s = checkAndApplyDateResets(s, at("2026-11-05T07:00:00Z"));
    s = {
      ...s,
      history: [{ questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-02" }, ...s.history],
      dailyStats: { ...s.dailyStats, "2026-11-02": { questsCompleted: {}, totalQuestsCompleted: 1, xpGained: 30, coinsGained: 0, questsSkipped: 0, questsReplaced: 0, isRestDay: false, shieldUsed: false, rewardsClaimed: 0 } },
    };
    const days = weekView(s, "2026-11-02", "2026-11-05");
    const by = (k: string) => days.find((d) => d.key === k)!;
    expect(by("2026-11-02")).toMatchObject({ source: "history", status: "done", quests: 1, xp: 30 });
    expect(by("2026-11-02").core).toBeUndefined();
    expect(by("2026-11-03")).toMatchObject({ source: "snapshot", mode: s.questDays![0].mode, core: { done: 1, total: 3 } });
    expect(by("2026-11-04")).toMatchObject({ source: "none", quests: 0, xp: 0 });
    expect(by("2026-11-05")).toMatchObject({ isToday: true, source: "none" });
    expect(by("2026-11-06").status).toBe("future");

    const sum = weekSummary(days);
    expect(sum).toMatchObject({ active: 2, elapsed: 4, full: 0, fullOf: 1 });
    expect(sum.xp).toBe(30 + s.questDays![0].totals.xp);
  });

  it("the day panel: snapshot, history with «incomplete», empty, today, future — never invented", () => {
    let s = started("2026-11-03");
    s = setDayMode(s, "study", at("2026-11-03T10:00:00Z")).state;
    s = tick(s, "2026-11-03T11:00:00Z");
    s = checkAndApplyDateResets(s, at("2026-11-05T07:00:00Z"));
    s = { ...s, history: [{ questId: "q_walk", questTitle: "Прогулка", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-02" }, ...s.history] };
    const snap = dayDetail(s, "2026-11-03", "2026-11-05");
    expect(snap.kind).toBe("snapshot");
    if (snap.kind === "snapshot") {
      expect(snap.snap.modeChanges.map((m) => m.to)).toEqual(["study"]);
      expect(snap.entries).toHaveLength(1);
    }
    const hist = dayDetail(s, "2026-11-02", "2026-11-05");
    expect(hist).toMatchObject({ kind: "history", selfXp: 30 });
    expect(dayDetail(s, "2026-11-04", "2026-11-05").kind).toBe("empty");
    expect(dayDetail(s, "2026-11-05", "2026-11-05").kind).toBe("today");
    expect(dayDetail(s, "2026-11-06", "2026-11-05").kind).toBe("future");
    expect(dayDetail({ ...s, createdAt: "2026-11-01" }, "2026-10-30", "2026-11-05").kind).toBe("beforeStart");
  });

  it("weeks: the first week is the account's start, the address is clamped, the default day is today or the last day with records", () => {
    const s = started("2026-11-05", { createdAt: "2026-10-15" });
    expect(earliestWeek(s, "2026-11-05")).toBe("2026-10-12");
    expect(clampWeek("2026-11-30", "2026-10-12", "2026-11-02")).toBe("2026-11-02");
    expect(clampWeek("2026-09-01", "2026-10-12", "2026-11-02")).toBe("2026-10-12");
    expect(clampWeek("2026-10-22", "2026-10-12", "2026-11-02")).toBe("2026-10-19");
    expect(clampWeek("nonsense", "2026-10-12", "2026-11-02")).toBe("2026-11-02");
    const days = weekView(s, "2026-11-02", "2026-11-05");
    expect(defaultDay(days, null)).toBe("2026-11-05");
    expect(defaultDay(days, "2026-11-03")).toBe("2026-11-03");
    expect(defaultDay(days, "2026-11-07")).toBe("2026-11-05"); // a future day is not opened
  });

  it("the journal of a day: plan parts, plan before the first trade, trades with a stop, no-trade entries", () => {
    const snap = {
      trades: [
        { id: "t1", openedAt: "2026-11-03T10:00:00Z", stopLoss: 1.1 },
        { id: "t2", openedAt: "2026-11-03T12:00:00Z" },
        { id: "t3", openedAt: "2026-11-04T10:00:00Z", deletedAt: null },
      ],
      plans: [{ date: "2026-11-03", bias: [{ instrument: "EURUSD" }], levels: [1], limits: { maxTrades: 3 }, checklist: [], createdAt: "2026-11-03T08:00:00Z" }],
      weekPlans: [],
      noTrades: [{ id: "n1", date: "2026-11-03" }],
      timezone: "UTC",
    };
    expect(journalOnDay(snap, "2026-11-03")).toEqual({
      plan: { exists: true, bias: true, levels: true, limits: true, riskChecked: false, review: false, beforeFirstTrade: true, at: "2026-11-03T08:00:00Z" },
      trades: 2,
      withRisk: 1,
      maxTrades: 3,
      noTrades: 1,
    });
    expect(journalOnDay(snap, "2026-11-05").plan.exists).toBe(false);
  });

  it("reading a week changes nothing in the game", () => {
    let s = started("2026-11-03");
    s = tick(s, "2026-11-03T09:00:00Z");
    s = checkAndApplyDateResets(s, at("2026-11-05T07:00:00Z"));
    const before = JSON.stringify(s);
    weekView(s, "2026-11-02", "2026-11-05");
    for (const k of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) dayDetail(s, k, "2026-11-05");
    expect(JSON.stringify(s)).toBe(before);
  });
});
