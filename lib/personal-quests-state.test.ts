import { describe, it, expect } from "vitest";
import { INITIAL_GAME_STATE, abandonPersonalQuest, checkAndApplyDateResets, createPersonalQuest, migrateState, restartPersonalQuest, type GameState } from "./game";
import { endDayOf } from "./personal-quests";
import * as fs from "fs";
import * as path from "path";

// QH-8.2: personal quests in the game state — created, kept, abandoned, restarted; nothing gives XP or Coins.

const ZONE = "Asia/Tbilisi"; // UTC+4: 22:30 UTC is already the next day there
const state = (extra: Partial<GameState> = {}): GameState =>
  ({ ...INITIAL_GAME_STATE, createdAt: "2026-10-01", lastQuestDate: "2026-11-16", profile: { ...INITIAL_GAME_STATE.profile, timezone: ZONE }, xp: 120, coins: 40, level: 3, ...extra }) as GameState;
const at = (iso: string) => new Date(iso);
const NOON = at("2026-11-16T08:00:00Z");
let n = 0;
const input = (over: Record<string, string> = {}) => ({
  id: `pq_test_${++n}`,
  questId: `pqq_test_${n}`,
  category: "learning" as const,
  verification: "app" as const,
  title: "Урок в день",
  goal: "Разобраться в структуре рынка",
  dailyAction: "Один урок и вывод в Журнале",
  startState: "Учусь урывками",
  expectedResult: "Учёба каждый день",
  ...over,
});

/** What a personal quest change must never touch. */
const economy = (s: GameState) => ({ xp: s.xp, coins: s.coins, level: s.level, history: s.history, coinLog: s.coinLog, chronicle: s.chronicle, achievements: s.achievements });

describe("old saves", () => {
  it("a save without personal quests gets an empty list; damaged runs are dropped, never guessed; nothing else changes", () => {
    const old = { ...state(), personalRuns: undefined };
    expect(migrateState(old).personalRuns).toEqual([]);
    const good = createPersonalQuest(state(), input(), NOON).state.personalRuns![0];
    const raw = { ...state(), personalRuns: [good, null, 5, { id: "x" }, { ...good, id: "pq_bad_cat", category: "nope" }, { ...good, id: "pq_bad_ver", category: "trading", verification: "self" }, { ...good, id: "pq_bad_day", startDay: "16.11" }, good] };
    const m = migrateState(raw);
    expect(m.personalRuns).toEqual([good]);
    expect(economy(m)).toEqual(economy(migrateState(state())));
  });
});

describe("creating", () => {
  it("starts on the account's game day (time zone), 30 days, active, no marks; gives nothing", () => {
    const before = state();
    // 22:30 UTC on the 16th is the 17th in Tbilisi
    const when = at("2026-11-16T22:30:00Z");
    const res = createPersonalQuest(before, input(), when);
    expect(res.ok).toBe(true);
    const run = res.state.personalRuns![0];
    expect(run).toMatchObject({ startDay: "2026-11-17", status: "active", marks: [], createdAt: "2026-11-16T22:30:00.000Z" });
    expect(endDayOf(run)).toBe("2026-12-16");
    // the same as the day change alone does (a new day starts at the first action of the day)
    expect(economy(res.state)).toEqual(economy(checkAndApplyDateResets(before, when)));
  });

  it("never in the past: a clock set back still starts on the day already reached", () => {
    const res = createPersonalQuest(state({ lastQuestDate: "2026-11-20" }), input(), at("2026-11-16T08:00:00Z"));
    expect(res.state.personalRuns![0].startDay).toBe("2026-11-20");
  });

  it("the same request twice (double click, reload, a second tab) saves one run", () => {
    const i = input();
    const first = createPersonalQuest(state(), i, NOON);
    const again = createPersonalQuest(first.state, i, NOON);
    expect(again).toMatchObject({ ok: true, runId: i.id });
    expect(again.state.personalRuns).toHaveLength(1);
    expect(again.state.personalRuns).toEqual(first.state.personalRuns);
  });

  it("limits: 3 active, 1 per category, verification of the category, every field; texts are trimmed", () => {
    let s = state();
    s = createPersonalQuest(s, input({ category: "learning" }), NOON).state;
    expect(createPersonalQuest(s, input({ category: "learning", verification: "self" }), NOON)).toMatchObject({ ok: false, reason: "categoryActive" });
    s = createPersonalQuest(s, input({ category: "habits", verification: "self" }), NOON).state;
    s = createPersonalQuest(s, input({ category: "trading" }), NOON).state;
    expect(s.personalRuns).toHaveLength(3);
    expect(createPersonalQuest(s, input({ category: "physical", verification: "self" }), NOON)).toMatchObject({ ok: false, reason: "maxActive" });
    const empty = state();
    expect(createPersonalQuest(empty, input({ category: "trading", verification: "self" }), NOON).reason).toBe("verificationNotAllowed");
    expect(createPersonalQuest(empty, input({ category: "physical", verification: "app" }), NOON).reason).toBe("verificationNotAllowed");
    expect(createPersonalQuest(empty, input({ startState: "   " }), NOON).reason).toBe("missingFields");
    expect(createPersonalQuest(empty, input({ title: "x".repeat(81) }), NOON).reason).toBe("tooLong");
    expect(createPersonalQuest(empty, input({ id: "bad id!" }), NOON).reason).toBe("badId");
    const trimmed = createPersonalQuest(empty, input({ title: "  Урок   в день  " }), NOON).state.personalRuns![0];
    expect(trimmed.title).toBe("Урок в день");
  });
});

describe("abandoning and restarting", () => {
  it("an abandoned run stays in the history, frees its slot and category at once; restart is a new run from today with no progress", () => {
    const i = input();
    let s = createPersonalQuest(state(), i, NOON).state;
    const before = economy(s);
    const ab = abandonPersonalQuest(s, i.id, at("2026-11-20T10:00:00Z"));
    expect(ab.ok).toBe(true);
    s = ab.state;
    expect(s.personalRuns![0]).toMatchObject({ id: i.id, status: "abandoned", abandonedAt: "2026-11-20T10:00:00.000Z" });
    expect(abandonPersonalQuest(s, i.id, at("2026-11-20T10:01:00Z"))).toMatchObject({ ok: false, reason: "notActive" });

    const re = restartPersonalQuest(s, i.id, "pq_restart_1", at("2026-11-20T11:00:00Z"));
    expect(re).toMatchObject({ ok: true, runId: "pq_restart_1" });
    const [fresh, old] = re.state.personalRuns!;
    expect(fresh).toMatchObject({ id: "pq_restart_1", questId: i.questId, startDay: "2026-11-20", marks: [], status: "active", restartOf: i.id, title: i.title });
    expect(old).toMatchObject({ id: i.id, status: "abandoned" });
    // the same restart again saves nothing new; an active run cannot be restarted
    expect(restartPersonalQuest(re.state, i.id, "pq_restart_1", at("2026-11-20T11:00:01Z")).state.personalRuns).toHaveLength(2);
    expect(restartPersonalQuest(re.state, "pq_restart_1", "pq_restart_2", at("2026-11-20T11:00:02Z")).reason).toBe("notAbandoned");
    // a second restart of the old run while the quest runs again: the same quest cannot run twice
    expect(restartPersonalQuest(re.state, i.id, "pq_restart_3", at("2026-11-20T11:00:03Z")).reason).toBe("sameQuestActive");
    expect(economy(re.state)).toEqual(before);
  });

  it("a restart waits for a free category", () => {
    const i = input({ category: "habits", verification: "self" });
    let s = createPersonalQuest(state(), i, NOON).state;
    s = abandonPersonalQuest(s, i.id, NOON).state;
    s = createPersonalQuest(s, input({ category: "habits", verification: "self" }), NOON).state;
    expect(restartPersonalQuest(s, i.id, "pq_restart_9", NOON).reason).toBe("categoryActive");
  });

  it("unknown runs are refused", () => {
    expect(abandonPersonalQuest(state(), "pq_nope_1", NOON).reason).toBe("notFound");
    expect(restartPersonalQuest(state(), "pq_nope_1", "pq_new_1", NOON).reason).toBe("notFound");
  });
});

describe("no rewards yet (QH-8.3 – QH-8.5)", () => {
  it("only the model and the simulation use marks, settling, achievements and the payout", () => {
    const roots = ["lib", "components", "app"].map((d) => path.join(__dirname, "..", d));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f.name) && !/\.test\.tsx?$/.test(f.name) && !/personal-quests\.ts$|econ-sim-qh8\.ts$/.test(f.name)) {
          const src = fs.readFileSync(p, "utf8");
          if (/\b(settleRun|confirmedDays|withAchievement|NO_RECORDS)\b/.test(src) || /econ-sim-qh8/.test(src)) offenders.push(p);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
