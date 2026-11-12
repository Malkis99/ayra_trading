import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, type GameState } from "./game";
import { activityGrid, nextStep, todayEarned, weekDays, weekQuestCount } from "./quests-view";
import { getTodaysQuests } from "./quests";

const rec = (over: Partial<GameState["dailyStats"][string]> = {}) => ({
  questsCompleted: {},
  totalQuestsCompleted: 0,
  xpGained: 0,
  coinsGained: 0,
  questsSkipped: 0,
  questsReplaced: 0,
  isRestDay: false,
  shieldUsed: false,
  rewardsClaimed: 0,
  ...over,
});

const h = (questId: string, completedAt: string) => ({ questId, questTitle: questId, category: "Mental", xp: 30, coins: 0, completedAt });

function state(over: Partial<GameState>): GameState {
  return { ...INITIAL_GAME_STATE, createdAt: "2026-11-01", history: [], dailyStats: {}, ...over } as GameState;
}

describe("quests view: only saved data", () => {
  const today = "2026-11-12"; // Thursday
  const s = state({
    history: [h("q_walk", "2026-11-09"), h("q_read_pages", "2026-11-09"), h("q_walk", "2026-11-12")],
    dailyStats: {
      "2026-11-09": rec({ totalQuestsCompleted: 5, xpGained: 90 }), // journal events inflate this counter: not used for quests
      "2026-11-10": rec({ isRestDay: true }),
      "2026-11-11": rec({ shieldUsed: true }),
      "2026-11-12": rec({ xpGained: 70, coinsGained: 20 }),
    },
  });

  it("the week: real statuses per day", () => {
    const days = weekDays(s, today);
    expect(days.map((d) => d.key)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(days.map((d) => d.status)).toEqual(["done", "rest", "shield", "done", "future", "future", "future"]);
    expect(days[0].quests).toBe(2); // from the quest history, not dailyStats
    expect(days[3].isToday).toBe(true);
    expect(weekQuestCount(s, today)).toBe(3);
  });

  it("days without a record are «no data», days before the profile are «before start»", () => {
    const days = weekDays(state({ createdAt: "2026-11-11" }), today);
    expect(days[0].status).toBe("beforeStart");
    expect(days[2].status).toBe("noData");
    expect(days[3].status).toBe("today");
  });

  it("the 4-week grid ends with this week and has 28 cells", () => {
    const grid = activityGrid(s, today, 4);
    expect(grid).toHaveLength(4);
    expect(grid.flat()).toHaveLength(28);
    expect(grid[3][0].key).toBe("2026-11-09");
    expect(grid[0][0].key).toBe("2026-10-19");
    expect(grid[0][0].status).toBe("beforeStart");
  });

  it("today's earnings come from dailyStats of the game day", () => {
    expect(todayEarned(s, today)).toEqual({ xp: 70, coins: 20 });
    expect(todayEarned(s, "2026-11-13")).toEqual({ xp: 0, coins: 0 });
  });

  it("the next step: first open core quest, the journal for app-checked ones, rest, done", () => {
    const { core } = getTodaysQuests(today);
    const open = nextStep(state({}), core);
    expect(["quest", "journal"]).toContain(open.kind);
    const allDone = state({ completedQuestsToday: Object.fromEntries(core.map((q) => [q.id, true])) });
    expect(nextStep(allDone, core).kind).toBe("done");
    expect(nextStep(state({ isRestDay: true }), core).kind).toBe("rest");
    const journalFirst = [{ ...core[0], id: "q_bias" }, ...core.slice(1)];
    expect(nextStep(state({}), journalFirst)).toMatchObject({ kind: "journal", href: "/journal?tab=plan" });
  });
});
