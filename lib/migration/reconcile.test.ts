import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../game-config";
import { MISSION_TEMPLATES, QUEST_POOL } from "../quests";
import { capDayDeviceA, capDayDeviceB, capSave, capSaveDeviceB, coinLogSave, legacySave, missionsSave, tamperedSave } from "../../test-fixtures/q4-5-4/saves";
import {
  ALGORITHM,
  DAILY_COIN_CAP,
  DAILY_REWARD_BOUNDS,
  FIRST_ACTION_RULES,
  QUEST_BOUNDS,
  isDay,
  isIsoTime,
  journalEvidence,
  levelForTotalXp,
  reconcile,
  saveVersionOf,
  totalXpOf,
  type Snapshot,
} from "./reconcile";

const snap = (id: string, state: Record<string, unknown>, install = `inst_${id}`): Snapshot => ({ snapshotId: id, installId: install, state });
const TZ = "UTC";
const keys = (r: ReturnType<typeof reconcile>) => r.events.map((e) => `${e.key}=${e.xp}/${e.coins}`);
const codes = (r: ReturnType<typeof reconcile>) => r.conflicts.map((c) => `${c.code}@${c.subject}`);
const coinsOfDay = (r: ReturnType<typeof reconcile>, day: string) =>
  r.events.filter((e) => e.day === day && (e.kind === "quest" || e.kind === "daily")).reduce((a, e) => a + e.coins, 0);

describe("Q4.5-4 levels, formats and strict readers", () => {
  it("total XP from level + XP in level (80 + 40·n to leave level n: 120, 160, …), and back", () => {
    expect(totalXpOf(1, 50)).toBe(50);
    expect(totalXpOf(3, 50)).toBe(330);
    expect(levelForTotalXp(330)).toBe(3);
    expect(levelForTotalXp(279)).toBe(2);
    expect(levelForTotalXp(119)).toBe(1);
  });
  it("every save format is told apart", () => {
    expect(saveVersionOf(legacySave)).toBe("legacy");
    expect(saveVersionOf(capSave)).toBe("first_actions");
    expect(saveVersionOf(coinLogSave)).toBe("history_at+first_actions+coin_log");
    expect(saveVersionOf(missionsSave)).toBe("history_at+coin_log+missions+pq_paid");
  });
  it("only real days and the exact time form the game writes are records (the database reads the same)", () => {
    expect([isDay("2026-11-01"), isDay("2026-02-30"), isDay("2026-13-01"), isDay("1999-12-31"), isDay("2026-1-01"), isDay(20261101)]).toEqual([true, false, false, false, false, false]);
    expect([isIsoTime("2026-11-01T07:00:00Z"), isIsoTime("2026-11-01T07:00:00.123Z"), isIsoTime("2026-11-01T24:00:00Z"), isIsoTime("2026-11-01T07:00:00+03:00"), isIsoTime("2026-11-01 07:00:00Z")])
      .toEqual([true, true, false, false, false]);
  });
  it("an unknown time zone is refused, never replaced", () => {
    expect(() => reconcile([snap("s1", capSave)], "Mars/Olympus")).toThrow();
  });
});

describe("Q4.5-4 rules of the past are the game's own (a change to the game must change the reconciliation too)", () => {
  it("first-action amounts after #99 are the game's current ones; XP was the same under both rules", () => {
    expect(FIRST_ACTION_RULES.after).toEqual(GAME_CONFIG.FIRST_ACTION_REWARDS);
    for (const k of Object.keys(FIRST_ACTION_RULES.after)) expect(FIRST_ACTION_RULES.before[k].xp).toBe(FIRST_ACTION_RULES.after[k].xp);
  });
  it("the daily cap is the game's; a daily reward in the coin log is at most the largest reward value", () => {
    expect(DAILY_COIN_CAP.amount).toBe(GAME_CONFIG.DAILY_COIN_CAP);
    expect(DAILY_REWARD_BOUNDS.max).toBe(Math.max(...GAME_CONFIG.DAILY_REWARD_VALUES));
  });
  it("no quest the game can pay today is above the quest bounds (the git-history scan proved the past)", () => {
    const all = [...QUEST_POOL, ...MISSION_TEMPLATES];
    expect(Math.max(GAME_CONFIG.QUEST_XP, ...all.map((q) => q.xpReward))).toBeLessThanOrEqual(QUEST_BOUNDS.xp);
    expect(Math.max(GAME_CONFIG.QUEST_COINS, ...all.map((q) => q.coinsReward))).toBeLessThanOrEqual(QUEST_BOUNDS.coins);
  });
});

describe("Q4.5-4 one device: what is proven, what is a candidate", () => {
  it("a save from before any record: nothing proven, the whole progress is a legacy candidate with its reasons", () => {
    const r = reconcile([snap("s1", legacySave)], TZ);
    expect(r.algorithm).toBe(ALGORITHM);
    expect(r.events).toEqual([]);
    expect(r.legacy[0].original).toMatchObject({ level: 3, totalXp: 330, coins: 120, saveVersion: "legacy" });
    expect(r.legacy[0].candidate).toEqual({ xp: 330, coins: 120 });
    expect(r.legacy[0].reasons).toEqual([{ code: "journal_xp_by_day", xp: 30, count: 1 }, { code: "coins_before_log" }, { code: "legacy_format" }]);
    expect(r.proposed).toMatchObject({ confirmedXp: 0, confirmedCoins: 0, level: 1, originalLevel: 3, levelGap: 2 });
    expect(r.achievements).toEqual(["firstTrade"]);
  });

  it("after #98, before the coin log: a first action of either rule — the smaller amount is proven, the rest is a candidate", () => {
    const r = reconcile([snap("s1", capSave)], TZ);
    expect(keys(r)).toEqual(["first:note=10/5", "first:trade=20/20", "quest:2026-10-27:q_bias=40/10", "quest:2026-10-28:q_reflect=40/10"]);
    expect(r.conflicts).toEqual([{ code: "first_action_unlogged", subject: "s1/first:note", xp: 0, coins: 5 }]);
    expect(r.legacy[0].confirmed).toEqual({ xp: 110, coins: 45 });
    expect(r.legacy[0].candidate).toEqual({ xp: 15, coins: 12 }); // the journal XP; 7 Coins nothing explains + 5 unproven
    expect(r.legacy[0].reasons.find((x) => x.code === "journal_xp_by_day")).toEqual({ code: "journal_xp_by_day", xp: 15, count: 1 });
  });

  it("after #99: the coin log PROVES a first action's amount; daily rewards only from the coin log, in the account's zone", () => {
    const r = reconcile([snap("s1", coinLogSave)], TZ);
    expect(keys(r)).toEqual(["daily:2026-11-01=0/10", "daily:2026-11-02=0/15", "first:dayPlan=10/5", "quest:2026-11-01:q_bias=40/10"]);
    expect(r.conflicts).toEqual([]);
    expect(r.legacy[0].candidate).toEqual({ xp: 0, coins: 30 }); // the 30 Coins before the coin log
    expect(r.legacy[0].reasons).toEqual([{ code: "coins_before_log", since: "2026-10-29T00:00:00Z" }]);
    expect(reconcile([snap("s1", coinLogSave)], "Asia/Tokyo").events.map((e) => e.key)).toContain("daily:2026-11-02");
  });

  it("the import first action: 20 Coins only with the coin log; outside it 10 (the old rule's), the 10 more a candidate", () => {
    const logged = reconcile([snap("s1", { level: 1, xp: 10, coins: 20, firstActions: { import: "2026-11-01T08:00:00.000Z" }, coinLog: [{ at: "2026-11-01T08:00:00.000Z", source: "firstAction", amount: 20, kind: "import" }] })], TZ);
    expect(keys(logged)).toEqual(["first:import=10/20"]);
    expect(logged.conflicts).toEqual([]);
    const unlogged = reconcile([snap("s1", { level: 1, xp: 10, coins: 10, firstActions: { import: "2026-11-01T08:00:00.000Z" }, coinLog: [] })], TZ);
    expect(keys(unlogged)).toEqual(["first:import=10/10"]);
    expect(unlogged.conflicts).toEqual([{ code: "first_action_unlogged", subject: "s1/first:import", xp: 0, coins: 10 }]);
    // a logged amount that is no rule's: the smaller one, and the conflict
    const odd = reconcile([snap("s1", { level: 1, xp: 10, coins: 5, firstActions: { note: "2026-11-01T08:00:00.000Z" }, coinLog: [{ at: "2026-11-01T08:00:00.000Z", source: "firstAction", amount: 50, kind: "note" }] })], TZ);
    expect(keys(odd)).toEqual(["first:note=10/5"]);
    expect(codes(odd)).toEqual(["amount_out_of_rule@s1/first:note"]);
  });

  it("missions and personal quests: only PAID completions; the run id is the key", () => {
    const r = reconcile([snap("s1", missionsSave)], TZ);
    expect(keys(r)).toEqual(["pq:run_gold_1=250/0", "quest:2026-11-16:m_lesson=40/10", "quest:2026-11-16:m_observation=40/10"]);
    expect(r.legacy[0].candidate).toEqual({ xp: 0, coins: 0 });
    expect(r.proposed).toMatchObject({ confirmedXp: 330, level: 3, levelGap: 0 });
  });

  it("a tampered save: nothing above what a quest ever paid is proven; the level/XP and the balance are flagged", () => {
    const r = reconcile([snap("s1", tamperedSave)], TZ);
    expect(codes(r)).toEqual([
      "amount_out_of_rule@s1/quest:2026-11-05:q_fake",
      "amount_out_of_rule@s1/quest:2026-11-06:q_a",
      "amount_out_of_rule@s1/quest:2026-11-06:q_b",
      "balance_below_records@s1",
      "level_xp_inconsistent@s1",
    ]);
    expect(keys(r)).toEqual(["first:trade=20/20"]);
  });

  it("malformed records are conflicts, never events (fractions, strings, impossible days and times)", () => {
    const r = reconcile([snap("s1", {
      history: [{ questId: "q", xp: 40.5, coins: 10, completedAt: "2026-11-01" }, { questId: "q2", xp: 40, coins: 10, completedAt: "2026-02-30" }, { questId: "q 3", xp: 40, coins: 10, completedAt: "2026-11-01" }],
      firstActions: { trade: "yesterday", constructor: "2026-11-01T00:00:00Z" },
      coinLog: [{ source: "dailyReward", at: "2026-11-01T07:00:00Z", amount: "10" }, { source: "dailyReward", at: "2026-11-01T07:00:00Z", amount: 0 }],
      personalLedger: [{ runId: "r1", xp: 250, day: "2026-11-01", paid: "true" }, { runId: "r2", xp: 999, day: "2026-11-01", paid: true }],
    })], TZ);
    expect(r.events).toEqual([]);
    expect(codes(r)).toEqual([
      "amount_out_of_rule@s1/daily:2026-11-01",
      "amount_out_of_rule@s1/pq:r2",
      "bad_record@s1/coinLog/0",
      "bad_record@s1/firstActions",
      "bad_record@s1/firstActions",
      "bad_record@s1/history/0",
      "bad_record@s1/history/1",
      "bad_record@s1/history/2",
    ]);
  });
});

describe("Q4.5-4 several devices", () => {
  it("the same event on two devices counts ONCE; a different amount confirms the smaller and records the conflict", () => {
    const r = reconcile([snap("a", capSave), snap("b", capSaveDeviceB)], TZ);
    const bias = r.events.find((e) => e.key === "quest:2026-10-27:q_bias")!;
    expect(bias).toMatchObject({ xp: 40, coins: 10, sources: ["a", "b"] });
    expect(r.events.find((e) => e.key === "quest:2026-10-28:q_reflect")).toMatchObject({ xp: 30, coins: 10 });
    expect(r.conflicts).toContainEqual({ code: "amount_mismatch", subject: "quest:2026-10-28:q_reflect", xp: 10, coins: 0 });
    expect(r.events.filter((e) => e.key === "first:trade")).toHaveLength(1);
    expect(r.proposed.confirmedXp).toBe(40 + 30 + 10 + 20 + 10); // bias, reflect (min), walk, trade, note
    expect(r.achievements).toEqual(["firstNote", "firstTrade", "streak3"]);
  });

  it("legacy candidates are per snapshot — never summed; the proposal does not include them", () => {
    const r = reconcile([snap("a", legacySave), snap("b", { ...legacySave, coins: 140 })], TZ);
    expect(r.legacy.map((l) => l.candidate)).toEqual([{ xp: 330, coins: 120 }, { xp: 330, coins: 140 }]);
    expect(r.proposed.confirmedXp + r.proposed.confirmedCoins).toBe(0);
  });

  it("deterministic: any order of the snapshots gives the same result", () => {
    const one = reconcile([snap("a", capSave), snap("b", capSaveDeviceB), snap("c", coinLogSave), snap("d", capDayDeviceA), snap("e", capDayDeviceB)], TZ, { a: "h1", b: "h2", c: "h3", d: "h4", e: "h5" });
    const two = reconcile([snap("e", capDayDeviceB), snap("c", coinLogSave), snap("a", capSave), snap("d", capDayDeviceA), snap("b", capSaveDeviceB)], TZ, { a: "h1", b: "h2", c: "h3", d: "h4", e: "h5" });
    expect(two).toEqual(one);
    expect(one.inputs).toEqual(["a:h1", "b:h2", "c:h3", "d:h4", "e:h5"]);
  });
});

describe("Q4.5-4 the daily Coins cap over ALL devices (owner review 2026-11-23)", () => {
  it("70 + 70 Coins of different events on one day from two devices → 100 confirmed, 40 a conflict, never auto-credited", () => {
    const r = reconcile([snap("a", capDayDeviceA), snap("b", capDayDeviceB)], TZ);
    expect(r.events).toHaveLength(14); // each event once
    expect(coinsOfDay(r, "2026-11-03")).toBe(100);
    const cut = r.conflicts.filter((c) => c.code === "daily_coin_cap");
    expect(cut.reduce((a, c) => a + c.coins, 0)).toBe(40);
    // the highest keys of the day are cut first (a fixed order — not the order of the snapshots)
    expect(cut.map((c) => c.subject)).toEqual(["quest:2026-11-03:qb_3", "quest:2026-11-03:qb_4", "quest:2026-11-03:qb_5", "quest:2026-11-03:qb_6"]);
    expect(r.proposed.confirmedCoins).toBe(100);
    expect(r.proposed.confirmedXp).toBe(14 * 40); // XP is never capped
    // the cut 40 stays in device B's candidate (a reviewer decides it; nothing is credited by itself)
    expect(r.legacy.map((l) => l.candidate.coins)).toEqual([0, 40]);
  });

  it("the same 70 Coins seen on both devices are ONE set of events: under the cap, nothing cut", () => {
    const r = reconcile([snap("a", capDayDeviceA), snap("b", capDayDeviceA)], TZ);
    expect(coinsOfDay(r, "2026-11-03")).toBe(70);
    expect(r.conflicts.filter((c) => c.code === "daily_coin_cap")).toEqual([]);
  });

  it("the daily reward counts toward the cap; first actions never did (outside the cap since #98)", () => {
    const daily = { coinLogSince: "2026-11-01T00:00:00.000Z", coinLog: [{ at: "2026-11-03T06:00:00.000Z", source: "dailyReward", amount: 25 }, { at: "2026-11-03T06:30:00.000Z", source: "firstAction", amount: 20, kind: "trade" }], firstActions: { trade: "2026-11-03T06:30:00.000Z" } };
    const r = reconcile([snap("a", capDayDeviceA), snap("b", { ...capDayDeviceB, history: capDayDeviceB.history.slice(0, 2), ...daily })], TZ);
    // quests 70 + 20 + daily 25 = 115 → 15 cut; the first action's 20 Coins untouched
    expect(coinsOfDay(r, "2026-11-03")).toBe(100);
    expect(r.conflicts.filter((c) => c.code === "daily_coin_cap").reduce((a, c) => a + c.coins, 0)).toBe(15);
    expect(r.events.find((e) => e.key === "first:trade")).toMatchObject({ coins: 20 });
  });

  it("before #98 there was no cap: a day before 2026-10-27 is never cut", () => {
    const old = (s: typeof capDayDeviceA) => ({ ...s, history: s.history.map((h) => ({ ...h, completedAt: "2026-10-20", at: h.at.replace("2026-11-03", "2026-10-20") })) });
    const r = reconcile([snap("a", old(capDayDeviceA)), snap("b", old(capDayDeviceB))], TZ);
    expect(coinsOfDay(r, "2026-10-20")).toBe(140);
    expect(r.conflicts.filter((c) => c.code === "daily_coin_cap")).toEqual([]);
  });

  it("the result does not depend on the order of the snapshots", () => {
    expect(reconcile([snap("b", capDayDeviceB), snap("a", capDayDeviceA)], TZ)).toEqual(reconcile([snap("a", capDayDeviceA), snap("b", capDayDeviceB)], TZ));
  });
});

describe("Q4.5-4 Journal records are evidence only (V3)", () => {
  it("cloud records are listed next to the candidate and change no number", () => {
    const r = reconcile([snap("s1", capSave)], TZ);
    const before = JSON.stringify(r);
    expect(journalEvidence(r.legacy[0], { "2026-10-27": 2 })).toEqual([{ day: "2026-10-27", recordsThatDay: 2 }]);
    expect(JSON.stringify(r)).toBe(before);
    expect(journalEvidence(reconcile([snap("m", missionsSave)], TZ).legacy[0], { "2026-11-16": 3 })).toEqual([]);
  });
});
