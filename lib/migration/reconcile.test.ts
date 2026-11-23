import { describe, expect, it } from "vitest";
import { capSave, capSaveDeviceB, coinLogSave, legacySave, missionsSave, tamperedSave } from "../../test-fixtures/q4-5-4/saves";
import { journalEvidence, levelForTotalXp, reconcile, saveVersionOf, totalXpOf, type Snapshot } from "./reconcile";

const snap = (id: string, state: Record<string, unknown>, install = `inst_${id}`): Snapshot => ({ snapshotId: id, installId: install, receivedAt: "2026-11-24T00:00:00Z", state });
const TZ = "UTC";
const keys = (r: ReturnType<typeof reconcile>) => r.events.map((e) => `${e.key}=${e.xp}/${e.coins}`);
const codes = (r: ReturnType<typeof reconcile>) => r.conflicts.map((c) => `${c.code}@${c.subject}`);

describe("Q4.5-4 levels and formats", () => {
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
});

describe("Q4.5-4 one device: what is proven, what is a candidate", () => {
  it("a save from before any record: nothing proven, the whole progress is a legacy candidate with its reasons", () => {
    const r = reconcile([snap("s1", legacySave)], TZ);
    expect(r.events).toEqual([]);
    expect(r.legacy[0].original).toMatchObject({ level: 3, totalXp: 330, coins: 120, saveVersion: "legacy" });
    expect(r.legacy[0].candidate).toEqual({ xp: 330, coins: 120 });
    expect(r.legacy[0].reasons.map((x) => x.code)).toEqual(["journal_xp_by_day", "coins_before_log", "legacy_format"]);
    expect(r.proposed).toMatchObject({ confirmedXp: 0, confirmedCoins: 0, level: 1, originalLevel: 3, levelGap: 2 });
    expect(r.achievements).toEqual(["firstTrade"]);
  });

  it("after #98: quests from history; a first action of the old rule cannot be told from the new one (44 min of old rule)", () => {
    const r = reconcile([snap("s1", capSave)], TZ);
    // the old rule (note: 10 Coins) lived 14:50–15:34 UTC, all within the deploy margin: the smaller amount is proven
    expect(keys(r)).toEqual(["first:note=10/5", "first:trade=20/20", "quest:2026-10-27:q_bias=40/10", "quest:2026-10-28:q_reflect=40/10"]);
    expect(codes(r)).toEqual(["first_action_time_uncertain@first:note"]);
    expect(r.legacy[0].confirmed).toEqual({ xp: 110, coins: 45 });
    expect(r.legacy[0].candidate).toEqual({ xp: 15, coins: 12 }); // the journal XP; 7 Coins nothing explains + 5 uncertain
    // 55 XP recorded on 10-27, 40 of it quests: 15 XP of journal actions — known, never proven
    expect(r.legacy[0].reasons.find((x) => x.code === "journal_xp_by_day")?.xp).toBe(15);
  });

  it("after #99: first actions with the NEW amounts; daily rewards only from the coin log, in the account's zone", () => {
    const r = reconcile([snap("s1", coinLogSave)], TZ);
    expect(keys(r)).toEqual(["daily:2026-11-01=0/10", "daily:2026-11-02=0/15", "first:dayPlan=10/5", "quest:2026-11-01:q_bias=40/10"]);
    expect(r.legacy[0].candidate).toEqual({ xp: 0, coins: 30 }); // the 30 Coins before the coin log
    // the same reward seen from a zone 9 hours ahead lands on its own game day there
    expect(reconcile([snap("s1", coinLogSave)], "Asia/Tokyo").events.map((e) => e.key)).toContain("daily:2026-11-02");
  });

  it("missions and personal quests: only PAID completions; the run id is the key", () => {
    const r = reconcile([snap("s1", missionsSave)], TZ);
    expect(keys(r)).toEqual(["pq:run_gold_1=250/0", "quest:2026-11-16:m_lesson=40/10", "quest:2026-11-16:m_observation=40/10"]);
    expect(r.legacy[0].candidate).toEqual({ xp: 0, coins: 0 });
    expect(r.proposed).toMatchObject({ confirmedXp: 330, level: 3, levelGap: 0 });
  });

  it("a tampered save: nothing out of rule is proven; the cap cuts a day; the level/XP and the balance are flagged", () => {
    const r = reconcile([snap("s1", tamperedSave)], TZ);
    expect(codes(r)).toEqual([
      "amount_out_of_rule@quest:2026-11-05:q_fake",
      "balance_below_records@s1",
      "daily_coin_cap@quest:2026-11-06:q_b",
      "first_action_before_rules@first:trade",
      "level_xp_inconsistent@s1",
    ]);
    expect(keys(r)).toEqual(["quest:2026-11-06:q_a=40/60", "quest:2026-11-06:q_b=40/40"]);
  });
});

describe("Q4.5-4 several devices", () => {
  it("the same event on two devices counts ONCE; a different amount confirms the smaller and records the conflict", () => {
    const r = reconcile([snap("a", capSave), snap("b", capSaveDeviceB)], TZ);
    const bias = r.events.find((e) => e.key === "quest:2026-10-27:q_bias")!;
    expect(bias).toMatchObject({ xp: 40, coins: 10, sources: ["a", "b"] });
    expect(r.events.find((e) => e.key === "quest:2026-10-28:q_reflect")).toMatchObject({ xp: 30, coins: 10 });
    expect(codes(r)).toContain("amount_mismatch@quest:2026-10-28:q_reflect");
    // first:trade once (its amount is the same under both rules: 20/20)
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
    const one = reconcile([snap("a", capSave), snap("b", capSaveDeviceB), snap("c", coinLogSave)], TZ, { a: "h1", b: "h2", c: "h3" });
    const two = reconcile([snap("c", coinLogSave), snap("a", capSave), snap("b", capSaveDeviceB)], TZ, { a: "h1", b: "h2", c: "h3" });
    expect(two).toEqual(one);
    expect(one.inputs).toEqual(["a:h1", "b:h2", "c:h3"]);
  });

  it("first actions on the rule change: the smaller amount is proven, the difference is a conflict", () => {
    const r = reconcile([snap("a", { firstActions: { note: "2026-10-27T15:40:00Z" }, level: 1, xp: 10, coins: 10 })], TZ);
    expect(keys(r)).toEqual(["first:note=10/5"]);
    expect(r.conflicts).toEqual([expect.objectContaining({ code: "first_action_time_uncertain", subject: "first:note", coins: 5 })]);
  });
});

describe("Q4.5-4 Journal records are evidence only (V3)", () => {
  it("cloud records are listed next to the candidate and change no number", () => {
    const r = reconcile([snap("s1", capSave)], TZ);
    const before = JSON.stringify(r);
    expect(journalEvidence(r.legacy[0], { "2026-10-27": 2 })).toEqual([{ day: "2026-10-27", recordsThatDay: 2 }]);
    expect(JSON.stringify(r)).toBe(before);
    // a candidate without journal XP gets no evidence list
    expect(journalEvidence(reconcile([snap("m", missionsSave)], TZ).legacy[0], { "2026-11-16": 3 })).toEqual([]);
  });
});
