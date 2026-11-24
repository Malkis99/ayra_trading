import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, migrateState, recordPlanAchievements, recordPropRulesSaved, unlockedBetween, type GameState } from "./game";

// Q4.7 (docs/q4-7-achievement-unlock.md): firstPlan, firstReview and plans7 keep their rule in checkAchievements (the
// Journal's day plans); firstPropRules keeps its own (prop rules saved). Achievements never pay XP or Coins.

const plan = (date: string, review = false) => ({
  date,
  bias: [],
  levels: [],
  events: [],
  checklist: [],
  createdAt: `${date}T08:00:00.000Z`,
  updatedAt: `${date}T08:00:00.000Z`,
  ...(review ? { review: { rating: 4, whatWorked: "", whatToImprove: "", lesson: "", completedAt: `${date}T20:00:00.000Z` } } : {}),
});
const days = (n: number) => Array.from({ length: n }, (_, i) => plan(`2026-11-${String(i + 1).padStart(2, "0")}`));
// a real save: the starter outfit is worn, so stylist was unlocked by the first check of the game (its own rule)
const base = (): GameState => ({ ...migrateState({ ...INITIAL_GAME_STATE, xp: 35, coins: 12, level: 2 }), achievements: { stylist: true } });
const money = (s: GameState) => ({ xp: s.xp, coins: s.coins, level: s.level });
// chronicle entries are events or (old saves) plain strings
const unlockEvents = (s: GameState) => s.chronicle.filter((e) => typeof e !== "string" && e.type === "achievementUnlocked");

describe("Q4.7 day-plan achievements (recordPlanAchievements)", () => {
  it("before the rule is met: nothing turns on and the state is the same object (nothing to write)", () => {
    const s = base();
    const r = recordPlanAchievements(s, []);
    expect(r.newlyUnlocked).toEqual([]);
    expect(r.state).toBe(s);
  });

  it("the first plan: firstPlan only; no XP, Coins or level; one chronicle entry", () => {
    const s = base();
    const r = recordPlanAchievements(s, days(1));
    expect(r.newlyUnlocked).toEqual(["firstPlan"]);
    expect(r.state.achievements).toEqual({ stylist: true, firstPlan: true });
    expect(money(r.state)).toEqual(money(s));
    expect(unlockEvents(r.state)).toEqual([{ type: "achievementUnlocked", achievementId: "firstPlan" }]);
  });

  it("again with the same plans: nothing new, the same object (no duplicate)", () => {
    const once = recordPlanAchievements(base(), days(1)).state;
    const twice = recordPlanAchievements(once, days(1));
    expect(twice.newlyUnlocked).toEqual([]);
    expect(twice.state).toBe(once);
  });

  it("firstReview only with a plan whose review is completed", () => {
    expect(recordPlanAchievements(base(), [plan("2026-11-01")]).newlyUnlocked).not.toContain("firstReview");
    const r = recordPlanAchievements(base(), [plan("2026-11-01"), plan("2026-11-02", true)]);
    expect(r.newlyUnlocked.sort()).toEqual(["firstPlan", "firstReview"]);
  });

  it("plans7: six plans are not enough, the seventh unlocks it", () => {
    const six = recordPlanAchievements(base(), days(6)).state;
    expect(six.achievements.plans7).toBeUndefined();
    const seven = recordPlanAchievements(six, days(7));
    expect(seven.newlyUnlocked).toEqual(["plans7"]);
    expect(money(seven.state)).toEqual(money(base()));
  });

  it("achievements already on stay on; nothing is reset", () => {
    const s = { ...base(), achievements: { stylist: true, firstQuest: true, author: true, consciousRefusal: true } };
    const r = recordPlanAchievements(s, days(1));
    expect(r.state.achievements).toEqual({ stylist: true, firstQuest: true, author: true, consciousRefusal: true, firstPlan: true });
    // checkAchievements lists consciousRefusal again when it is already on — never counted as new here
    expect(r.newlyUnlocked).toEqual(["firstPlan"]);
  });

  it("an old save without an achievements field: migrated, then unlocked as usual", () => {
    const old = migrateState({ name: "Old", level: 1, xp: 10, coins: 3 } as unknown as GameState);
    const r = recordPlanAchievements(old, days(7));
    // its starter outfit (added by the migration) meets stylist's own rule at this first check, as at any other check
    expect(r.newlyUnlocked.sort()).toEqual(["firstPlan", "plans7", "stylist"]);
    expect(money(r.state)).toEqual(money(old));
  });

  it("a save that already has them: nothing changes", () => {
    const s = { ...base(), achievements: { stylist: true, firstPlan: true, firstReview: true, plans7: true } };
    const r = recordPlanAchievements(s, [...days(6), plan("2026-11-07", true)]);
    expect(r.newlyUnlocked).toEqual([]);
    expect(r.state).toBe(s);
  });
});

describe("Q4.7 firstPropRules (recordPropRulesSaved + unlockedBetween, as the game context saves it)", () => {
  it("the first save of prop rules: firstPropRules turns on; no XP, Coins or level", () => {
    const s = base();
    const r = recordPropRulesSaved(s);
    expect(unlockedBetween(s, r.state)).toEqual(["firstPropRules"]);
    expect(money(r.state)).toEqual(money(s));
  });

  it("later saves: nothing turns on (the context then writes nothing and shows the usual «saved»)", () => {
    const once = recordPropRulesSaved(base()).state;
    const again = recordPropRulesSaved(once);
    expect(unlockedBetween(once, again.state)).toEqual([]);
    expect(again.state.achievements).toEqual(once.achievements);
    expect(unlockEvents(again.state).length).toBe(1);
  });
});
