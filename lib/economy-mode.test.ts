import { beforeEach, describe, expect, it } from "vitest";
import { AppStorage } from "./storage";
import { ECONOMY_MODE_KEY, givesReward, laterMode, readStickyMode, rememberMode } from "./economy-mode";
import { INITIAL_GAME_STATE, type GameState } from "./game";
import { mirrorServerDay } from "./server-day-mirror";
import type { ServerDayStatus } from "./server-day-client";

const UID = "00000000-0000-0000-0000-00000000e001";

describe("Q4.4 economy mode — only forward", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(UID);
  });

  it("local until the server says otherwise; then never back, whatever is reported later", () => {
    expect(readStickyMode()).toBe("local");
    expect(rememberMode("local")).toBe("local");
    expect(AppStorage.getItem(ECONOMY_MODE_KEY)).toBeNull();
    expect(rememberMode("migration_pending")).toBe("migration_pending");
    expect(rememberMode("local")).toBe("migration_pending"); // a stale or failed answer never turns the device economy on
    expect(rememberMode("cloud_active")).toBe("cloud_active");
    expect(rememberMode("migration_pending")).toBe("cloud_active");
    expect(rememberMode("local")).toBe("cloud_active");
    expect(readStickyMode()).toBe("cloud_active");
    expect(laterMode("local", "cloud_active")).toBe("cloud_active");
  });

  it("the mode belongs to the account's space: the guest space stays local", () => {
    rememberMode("cloud_active");
    AppStorage.setUserId(null);
    expect(readStickyMode()).toBe("local");
  });
});

const base = (over: Partial<GameState> = {}): GameState => ({ ...INITIAL_GAME_STATE, lastQuestDate: "2026-11-20", completedQuestsToday: {}, ...over });

describe("Q4.4 a change that gives a reward", () => {
  it.each([
    ["XP", { xp: 10 }],
    ["a level", { level: 2 }],
    ["Coins", { coins: 5 }],
    ["an achievement", { achievements: { first_trade: true } }],
    ["a quest newly done", { completedQuestsToday: { q_walk: true } }],
  ] as Array<[string, Partial<GameState>]>)("%s", (_n, over) => {
    expect(givesReward(base(), base(over))).toBe(true);
  });
  it("accepting, a mode change, a new day (done marks cleared) give nothing", () => {
    expect(givesReward(base(), base({ questAccepted: { day: "2026-11-20", at: { m_lesson: "x" } } }))).toBe(false);
    expect(givesReward(base({ completedQuestsToday: { q_walk: true } }), base({ lastQuestDate: "2026-11-21", completedQuestsToday: {} }))).toBe(false);
    expect(givesReward(base(), base({ isRestDay: true }))).toBe(false);
  });
});

describe("Q4.4 the server's day on the device", () => {
  const st = (over: Partial<NonNullable<ServerDayStatus["day"]>> = {}): ServerDayStatus => ({
    state: "cloud_active",
    game_sync: false,
    game_day: "2026-11-20",
    day: {
      game_day: "2026-11-20", status: "open", mode: "study", mode_before_rest: null, study_first: "m_observation",
      core: ["m_observation", "m_backtest", "m_lesson"], carried: {}, accepted: { m_lesson: "2026-11-20T09:00:00Z" },
      passed: ["m_backtest"], bonus: ["q_read_pages", "q_lang_10m"], replacements: [{ from: "q_walk", to: "q_lang_10m", at: "x" }], paid: [], ...over,
    },
  });
  const now = new Date("2026-11-20T10:00:00Z");

  it("copies the set, the mode, acceptances, put-offs and replacements — and no XP, Coins or level", () => {
    const before = base({ xp: 30, coins: 7, level: 1, lastQuestDate: "2026-11-20", passedQuestsToday: { q_meditate: true }, lastSeenAt: now.getTime() } as Partial<GameState>);
    const after = mirrorServerDay(before, st(), now);
    expect(after.questDay).toMatchObject({ day: "2026-11-20", mode: "study", core: ["m_observation", "m_backtest", "m_lesson"], bonus: ["q_read_pages", "q_lang_10m"] });
    expect(after.questAccepted).toEqual({ day: "2026-11-20", at: { m_lesson: "2026-11-20T09:00:00Z" } });
    expect(after.passedQuestsToday).toEqual({ q_meditate: true, m_backtest: true, q_walk: true });
    expect(after.replacementsUsedToday).toBe(1);
    expect({ xp: after.xp, coins: after.coins, level: after.level }).toEqual({ xp: 30, coins: 7, level: 1 });
  });

  it("a mission the server paid shows as done (still no XP on the device); rest is rest", () => {
    const after = mirrorServerDay(base({ lastSeenAt: now.getTime() } as Partial<GameState>), st({ paid: ["m_lesson"], mode: "rest", mode_before_rest: "study" }), now);
    expect(after.completedQuestsToday.m_lesson).toBe(true);
    expect(after.isRestDay).toBe(true);
    expect(after.questDay?.modeBeforeRest).toBe("study");
    expect(after.xp).toBe(INITIAL_GAME_STATE.xp);
  });

  it("never goes back to an earlier day; a closed or missing day changes nothing", () => {
    const later = base({ lastQuestDate: "2026-11-21", lastSeenAt: now.getTime() } as Partial<GameState>);
    expect(mirrorServerDay(later, st(), now)).toBe(later);
    const s = base();
    expect(mirrorServerDay(s, { state: "cloud_active", game_sync: false, day: null }, now)).toBe(s);
    expect(mirrorServerDay(s, st({ status: "closed" }), now)).toBe(s);
  });
});
