import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, checkAndApplyDateResets, completeQuest, grantFirstAction, completeSelfReportQuest, gameDayKey, replaceQuest, setDayMode, type GameState } from "./game";
import { HISTORY_WEEKS, historyDefaultDay, historyMap, historyStats, mapLook } from "./history-view";
import { addDaysToKey } from "./day-key";

const at = (iso: string) => new Date(iso);

function started(day: string, extra: Partial<GameState> = {}, zone = "UTC"): GameState {
  const base = { ...INITIAL_GAME_STATE, createdAt: "2026-06-01", profile: { ...INITIAL_GAME_STATE.profile, timezone: zone }, ...extra } as GameState;
  return checkAndApplyDateResets(base, at(`${day}T06:00:00Z`));
}
const JOURNAL = ["q_bias", "q_riskcheck", "q_reflect", "q_tradelog"];
function tickAll(s: GameState, day: string, n = 3): GameState {
  let k = 0;
  for (const id of s.questDay?.core || []) {
    if (k >= n) break;
    const when = at(`${day}T09:0${k}:00Z`);
    // a journal quest closes from the journal (completeQuest stands in for it), a self-report is ticked
    const r = JOURNAL.includes(id) ? { state: completeQuest(s, id, id, "Trading", 40, 10, when).state } : completeSelfReportQuest(s, id, id, "Mental", 30, when);
    if (r.state.completedQuestsToday[id]) {
      s = r.state;
      k++;
    }
  }
  return s;
}

describe("QH-5 history: 12 weeks of saved days", () => {
  it("84 days, oldest week first, Monday … Sunday, across the new year; future days are not counted", () => {
    const today = "2027-01-06"; // Wednesday
    const s = started(today, { createdAt: "2026-06-01" });
    const map = historyMap(s, today);
    expect(map).toHaveLength(HISTORY_WEEKS);
    expect(map.flat()).toHaveLength(84);
    expect(map[11][0].key).toBe("2027-01-04");
    expect(map[0][0].key).toBe("2026-10-19");
    expect(map.flat().filter((d) => d.status === "future").map((d) => d.key)).toEqual(["2027-01-07", "2027-01-08", "2027-01-09", "2027-01-10"]);
    expect(map.flat().find((d) => d.key === today)!.isToday).toBe(true);
    // the days across the year boundary follow one another
    const keys = map.flat().map((d) => d.key);
    expect(keys.indexOf("2027-01-01") - keys.indexOf("2026-12-31")).toBe(1);
    const stats = historyStats(s, map);
    expect(stats.days).toBe(80);
    expect(stats.full).toBeNull();
    expect(stats.core).toBeNull();
  });

  it("figures: snapshot days give full days and missions; history-only days count as active, never as missions", () => {
    let s = started("2026-11-02");
    s = tickAll(s, "2026-11-02", 3); // a full day
    s = checkAndApplyDateResets(s, at("2026-11-03T06:00:00Z"));
    s = tickAll(s, "2026-11-03", 1); // one mission
    s = completeQuest(s, "q_bias", "Bias", "Trading", 40, 10, at("2026-11-03T10:00:00Z")).state;
    s = checkAndApplyDateResets(s, at("2026-11-05T06:00:00Z")); // 11-04 not opened
    // an old day before snapshots, with one quest in the history
    s = {
      ...s,
      history: [{ questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: "2026-10-28" }, ...s.history],
      dailyStats: { ...s.dailyStats, "2026-10-28": { questsCompleted: {}, totalQuestsCompleted: 1, xpGained: 30, coinsGained: 0, questsSkipped: 0, questsReplaced: 0, isRestDay: false, shieldUsed: false, rewardsClaimed: 0 } },
    };
    const map = historyMap(s, "2026-11-05");
    const stats = historyStats(s, map);
    expect(stats.snapshotDays).toBe(2);
    expect(stats.partialDays).toBe(1);
    expect(stats.snapshotsFrom).toBe("2026-11-02");
    expect(stats.full).toEqual({ done: 1, of: 2 });
    expect(stats.core).toEqual({ done: 4, of: 6 });
    expect(stats.active).toBe(3);
    const day = (k: string) => map.flat().find((d) => d.key === k)!;
    expect(mapLook(day("2026-11-02"))).toBe("high");
    expect(mapLook(day("2026-11-03"))).toBe("low");
    expect(day("2026-10-28").source).toBe("history");
    expect(day("2026-11-04").source).toBe("none");
    expect(stats.xp).toBe(30 + s.dailyStats["2026-11-02"].xpGained + s.dailyStats["2026-11-03"].xpGained);
    expect(stats.coins).toBe(s.dailyStats["2026-11-02"].coinsGained + s.dailyStats["2026-11-03"].coinsGained);
  });

  it("rest days, shields and an empty day: counted as they are, an empty day is not a failure", () => {
    let s = started("2026-11-02");
    s = setDayMode(s, "rest", at("2026-11-02T08:00:00Z")).state;
    s = checkAndApplyDateResets(s, at("2026-11-03T06:00:00Z"));
    s = checkAndApplyDateResets(s, at("2026-11-04T06:00:00Z")); // 11-03 opened, nothing done: a shield
    const map = historyMap(s, "2026-11-04");
    const stats = historyStats(s, map);
    const day = (k: string) => map.flat().find((d) => d.key === k)!;
    expect(mapLook(day("2026-11-02"))).toBe("rest");
    expect(mapLook(day("2026-11-03"))).toBe("shield");
    expect(stats.restDays).toBe(1);
    expect(stats.shieldsUsed).toBe(1);
    expect(stats.active).toBe(0);
    expect(stats.full).toEqual({ done: 0, of: 1 }); // the shield day had missions; the rest day asks for none
  });

  it("a day with a mode change and a replacement is a snapshot day with its missions", () => {
    let s = started("2026-11-03");
    const id = s.questDay!.core.find((x) => !["q_bias", "q_riskcheck", "q_reflect", "q_tradelog"].includes(x))!;
    s = replaceQuest(s, id, [...s.questDay!.core, ...s.questDay!.bonus], at("2026-11-03T07:00:00Z")).state;
    s = setDayMode(s, "study", at("2026-11-03T08:00:00Z")).state;
    s = tickAll(s, "2026-11-03", 2);
    s = checkAndApplyDateResets(s, at("2026-11-04T06:00:00Z"));
    const d = historyMap(s, "2026-11-04").flat().find((x) => x.key === "2026-11-03")!;
    expect(d).toMatchObject({ source: "snapshot", mode: "study", core: { done: 2, total: 3 } });
    expect(s.questDays![0].replaced).toHaveLength(1);
  });

  it("the map follows the game day of the account zone (Tbilisi is ahead at 21:00 UTC)", () => {
    let s = started("2026-11-03", {}, "Asia/Tbilisi");
    s = checkAndApplyDateResets(s, at("2026-11-03T21:00:00Z"));
    const today = gameDayKey(s, at("2026-11-03T21:00:00Z"));
    expect(today).toBe("2026-11-04");
    const map = historyMap(s, today);
    expect(map.flat().find((d) => d.isToday)!.key).toBe("2026-11-04");
    expect(map.flat().find((d) => d.key === "2026-11-03")!.source).toBe("snapshot");
  });

  it("default day: the requested one (not future), else the last day with records, else today", () => {
    let s = started("2026-11-02");
    s = tickAll(s, "2026-11-02", 1);
    s = checkAndApplyDateResets(s, at("2026-11-05T06:00:00Z"));
    const map = historyMap(s, "2026-11-05");
    expect(historyDefaultDay(map, null)).toBe("2026-11-02");
    expect(historyDefaultDay(map, "2026-11-04")).toBe("2026-11-04");
    expect(historyDefaultDay(map, "2026-11-20")).toBe("2026-11-02");
    const fresh = started("2026-11-05");
    expect(historyDefaultDay(historyMap(fresh, "2026-11-05"), null)).toBe("2026-11-05");
  });

  it("the period totals are the day statistics: a one-time first-action reward is not in them (the label says so)", () => {
    let s = started("2026-11-02");
    s = tickAll(s, "2026-11-02", 1);
    const dayXp = s.dailyStats["2026-11-02"].xpGained;
    const first = grantFirstAction(s, "trade", at("2026-11-02T12:00:00Z"));
    expect(first.xp).toBeGreaterThan(0);
    s = checkAndApplyDateResets(first.state, at("2026-11-03T06:00:00Z"));
    const stats = historyStats(s, historyMap(s, "2026-11-03"));
    expect(stats.xp).toBe(dayXp);
  });

  it("reading the history changes nothing and creates no reward", () => {
    let s = started("2026-11-02");
    s = tickAll(s, "2026-11-02", 3);
    s = checkAndApplyDateResets(s, at("2026-11-04T06:00:00Z"));
    const before = JSON.stringify(s);
    historyStats(s, historyMap(s, "2026-11-04"));
    historyStats(s, historyMap(s, addDaysToKey("2026-11-04", 400)));
    expect(JSON.stringify(s)).toBe(before);
  });
});
