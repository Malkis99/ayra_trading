import { describe, it, expect } from "vitest";
import {
  INITIAL_GAME_STATE,
  checkAndApplyDateResets,
  claimDailyReward,
  completeQuest,
  grantFirstAction,
  isClockBehind,
  recordLoggedTrade,
  type GameState,
} from "./game";
import { GAME_CONFIG } from "./game-config";
import { APP_CLOSED_QUESTS, QUEST_POOL, questReward } from "./quests";

// Economy on this device until 0007 (docs/economy-coins-plan.md, owner decisions 2026-10-27)

const day = (iso: string) => new Date(`${iso}T12:00:00`);
const fresh = (): GameState => ({ ...INITIAL_GAME_STATE, lastQuestDate: "2026-10-27" } as GameState);
const trade = (id: string, openedAt = "2026-10-27T09:00:00") => ({ id, accountId: "acc", instrument: "US30", direction: "long", openedAt, verification: "unverified" });

describe("daily coin cap (quests + daily reward)", () => {
  it(`coins from quests and the daily reward stop at ${GAME_CONFIG.DAILY_COIN_CAP} a day; XP still counts`, () => {
    let s = fresh();
    s = claimDailyReward(s, day("2026-10-27")).state; // 10
    for (let i = 0; i < 20; i++) s = completeQuest(s, `q_${i}`, "q", "Trading", 40, 10, day("2026-10-27")).state;
    expect(s.coins).toBe(GAME_CONFIG.DAILY_COIN_CAP);
    expect(s.dailyStats["2026-10-27"].coinsGained).toBe(GAME_CONFIG.DAILY_COIN_CAP);
    // the next day the cap starts again
    s = completeQuest(s, "q_next", "q", "Trading", 40, 10, day("2026-10-28")).state;
    expect(s.coins).toBe(GAME_CONFIG.DAILY_COIN_CAP + 10);
  });

  it("the honest maximum of a day (day 7 of the reward + the quests the app checks) fits under the cap", () => {
    const appQuestsCoins = QUEST_POOL.filter((q) => APP_CLOSED_QUESTS.has(q.id)).reduce((s, q) => s + questReward(q).coins, 0);
    expect(Math.max(...GAME_CONFIG.DAILY_REWARD_VALUES) + appQuestsCoins).toBeLessThanOrEqual(GAME_CONFIG.DAILY_COIN_CAP);
  });
});

describe("device clock moved back", () => {
  const seenTomorrow = (): GameState => ({ ...fresh(), lastSeenAt: day("2026-10-28").getTime() });

  it("no new day: quests and the daily reward are not renewed by putting the date back", () => {
    let s = fresh();
    s = claimDailyReward(s, day("2026-10-28")).state; // claimed «tomorrow» (clock forward)
    const coins = s.coins;
    // clock back to today: the reward of «today» is not given, quests are not reset
    const back = claimDailyReward(s, day("2026-10-27"));
    expect(back.claimedCoins).toBe(0);
    expect(back.state.coins).toBe(coins);
    expect(isClockBehind(s, day("2026-10-27"))).toBe(true);
  });

  it("no coins and no XP while behind; everything works again once real time catches up", () => {
    const s = seenTomorrow();
    expect(completeQuest(s, "q_walk", "q", "Physical", 30, 5, day("2026-10-27")).state.coins).toBe(s.coins);
    const t = recordLoggedTrade(s, trade("t1"), [], day("2026-10-27"));
    expect(t.xpAwarded).toBe(0);
    expect(t.state.coins).toBe(s.coins);
    const reset = checkAndApplyDateResets({ ...s, completedQuestsToday: { q_walk: true } }, day("2026-10-27"));
    expect(reset.completedQuestsToday).toEqual({ q_walk: true });
    // a small difference (under 10 minutes) is not «moved back»
    expect(isClockBehind({ lastSeenAt: Date.now() }, new Date(Date.now() - 60_000))).toBe(false);
    // real time reached the latest seen time: rewards again
    const later = completeQuest(s, "q_walk", "q", "Physical", 30, 5, new Date(day("2026-10-28").getTime() + 1000));
    expect(later.state.coins).toBe(s.coins + 5);
  });

  it("every reward call moves «the latest seen time» forward", () => {
    const s = completeQuest(fresh(), "q_walk", "q", "Physical", 30, 0, day("2026-10-27")).state;
    expect(s.lastSeenAt).toBe(day("2026-10-27").getTime());
  });
});

describe("quests the app checks vs self-reported", () => {
  it("only quests the app closes itself give coins", () => {
    for (const q of QUEST_POOL) {
      const r = questReward(q);
      // what the card shows = what is paid (app-closed quests: QUEST_XP / QUEST_COINS in lib/game.ts)
      expect(r).toEqual(APP_CLOSED_QUESTS.has(q.id) ? { xp: GAME_CONFIG.QUEST_XP, coins: GAME_CONFIG.QUEST_COINS } : { xp: q.xpReward, coins: 0 });
    }
    expect([...APP_CLOSED_QUESTS].sort()).toEqual(["q_bias", "q_reflect", "q_riskcheck", "q_tradelog"]);
  });
});

describe("first action of a kind: once per account", () => {
  it("gives its coins and XP once, outside the daily cap; the second time nothing", () => {
    const capped: GameState = { ...fresh(), dailyStats: { "2026-10-27": { coinsGained: GAME_CONFIG.DAILY_COIN_CAP } as never } };
    const first = grantFirstAction(capped, "trade", day("2026-10-27"));
    expect(first.coins).toBe(GAME_CONFIG.FIRST_ACTION_REWARDS.trade.coins);
    expect(first.state.coins).toBe(capped.coins + GAME_CONFIG.FIRST_ACTION_REWARDS.trade.coins);
    expect(first.state.firstActions?.trade).toBeTruthy();
    const again = grantFirstAction(first.state, "trade", day("2026-10-28"));
    expect(again.coins).toBe(0);
    expect(again.state.coins).toBe(first.state.coins);
  });
});

describe("coin history (the «Coins» tab)", () => {
  it("records quests with coins, the daily reward and first actions — what, when, how much; nothing for 0 coins", () => {
    let s = fresh();
    s = completeQuest(s, "q_tradelog", "Запись сделки", "Discipline", 40, 10, day("2026-10-27")).state;
    s = completeQuest(s, "q_walk", "Прогулка", "Physical", 30, 0, day("2026-10-27")).state; // self-reported: no coins
    s = claimDailyReward(s, day("2026-10-27")).state;
    s = grantFirstAction(s, "note", day("2026-10-27")).state;
    expect(s.coinLog?.map((e) => [e.source, e.amount])).toEqual([
      ["firstAction", GAME_CONFIG.FIRST_ACTION_REWARDS.note.coins],
      ["dailyReward", 10],
      ["quest", 10],
    ]);
    expect(s.coinLog?.[2]).toMatchObject({ questId: "q_tradelog", title: "Запись сделки", at: day("2026-10-27").toISOString() });
  });

  it("a capped credit is recorded with the amount actually given", () => {
    const record = { questsCompleted: {}, totalQuestsCompleted: 0, xpGained: 0, coinsGained: GAME_CONFIG.DAILY_COIN_CAP - 3, questsSkipped: 0, questsReplaced: 0, isRestDay: false, shieldUsed: false, rewardsClaimed: 0 };
    const nearCap: GameState = { ...fresh(), dailyStats: { "2026-10-27": record } };
    const s = completeQuest(nearCap, "q_bias", "Bias", "Trading", 40, 10, day("2026-10-27")).state;
    expect(s.coinLog?.[0].amount).toBe(3);
  });

  it("the history starts when this version first runs; earlier coins stay in the balance only", () => {
    const old = checkAndApplyDateResets({ ...fresh(), coins: 250, coinLog: undefined, coinLogSince: undefined } as unknown as GameState, day("2026-10-27"));
    expect(old.coins).toBe(250);
    expect(old.coinLog).toEqual([]);
    expect(typeof old.coinLogSince).toBe("string");
  });
});
