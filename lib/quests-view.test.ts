import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, type GameState } from "./game";
import { activityGrid, nextStep, todayEarned, weekDays, weekQuestCount } from "./quests-view";
import { QUEST_POOL } from "./quests";

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

  it("the next step: the day's preparation in the journal first, then core quests, the review, evening habits last", () => {
    const pool = (id: string) => QUEST_POOL.find((q) => q.id === id)!;
    const core = [pool("q_sleep_prep"), pool("q_logic_puzzle"), pool("q_stretching")];
    const prep = ["q_bias", "q_riskcheck", "q_reflect"];
    const doneAll = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]));

    // trading morning: the day plan first (E2: never «sleep prep» as the first step), straight to the right block
    expect(nextStep(state({}), core, "trading")).toMatchObject({ kind: "journal", href: "/journal?tab=plan&focus=bias" });
    const biasDone = state({ completedQuestsToday: doneAll(["q_bias"]) });
    expect(nextStep(biasDone, core, "trading")).toMatchObject({ kind: "journal", href: "/journal?tab=plan&focus=limits" });
    expect(nextStep(biasDone, core, "trading", () => "riskNotChecked")).toMatchObject({ href: "/journal?tab=plan&focus=checklist" });
    // then core quests, evening habits after the review
    const prepDone = state({ completedQuestsToday: doneAll(["q_bias", "q_riskcheck"]) });
    expect(nextStep(prepDone, core, "trading")).toMatchObject({ kind: "quest", quest: { id: "q_logic_puzzle" } });
    const dayDone = state({ completedQuestsToday: doneAll(["q_bias", "q_riskcheck", "q_logic_puzzle", "q_stretching"]) });
    expect(nextStep(dayDone, core, "trading")).toMatchObject({ kind: "journal", href: "/journal?tab=plan&focus=review" });
    const reviewed = state({ completedQuestsToday: doneAll([...prep, "q_logic_puzzle", "q_stretching"]) });
    expect(nextStep(reviewed, core, "trading")).toMatchObject({ kind: "quest", quest: { id: "q_sleep_prep" } });
    expect(nextStep(state({ completedQuestsToday: doneAll([...prep, ...core.map((q) => q.id)]) }), core, "trading").kind).toBe("done");
    // a quest put off for today is never suggested; recovery has no journal preparation; rest
    expect(nextStep(state({ passedQuestsToday: doneAll(["q_logic_puzzle"]), completedQuestsToday: doneAll(["q_bias", "q_riskcheck"]) }), core, "trading")).toMatchObject({ quest: { id: "q_stretching" } });
    expect(nextStep(state({}), core, "recovery")).toMatchObject({ kind: "quest", quest: { id: "q_logic_puzzle" } });
    expect(nextStep(state({ isRestDay: true }), core, "trading").kind).toBe("rest");
    expect(nextStep(state({}), core, "rest").kind).toBe("rest");
  });
});
