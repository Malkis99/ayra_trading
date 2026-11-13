import { test, expect, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame, totalXp, utcDay } from "./helpers/quests";

// QH-3 (docs/quest-hub-plan.md, 5): a closed game day is saved once as it was; nothing is invented, nothing is given
// again; 120 days are kept; old saves keep every value.

type Snap = { day: string; done: Record<string, { source: string; at?: string }>; offered: string[]; incomplete?: string[]; recordedAt: string };
const snaps = async (page: Page) => ((await readGame(page)) as unknown as { questDays?: Snap[] }).questDays || [];
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function tickFirstSelf(page: Page) {
  const card = page.locator('[data-testid="missions"] [data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-complete") }).first();
  const id = ((await card.getAttribute("data-testid")) || "").replace("quest-card-", "");
  await card.getByTestId("quest-complete").click();
  await expect(page.getByTestId(`quest-card-${id}`).getByTestId("quest-done")).toBeVisible();
  return id;
}

test.describe("Quest Hub day snapshots (QH-3)", () => {
  test.use({ reducedMotion: "reduce" });

  test("midnight with two tabs open: yesterday is saved once, as it was; nothing is given again", async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    for (const p of [a, b]) await p.clock.install({ time: new Date("2026-11-12T23:57:00Z") });
    // a new account: the day 11-12 starts in this version, so its set is tracked from the first minute
    await seedGame(context, baseGame());
    await a.goto("/quests");
    await b.goto("/quests");
    const id = await tickFirstSelf(a);
    const xpBefore = totalXp(await readGame(a));

    // both tabs pass midnight (each checks the day every minute)
    await Promise.all([a.clock.runFor(4 * 60 * 1000), b.clock.runFor(4 * 60 * 1000)]);
    await expect.poll(async () => (await readGame(a)).lastQuestDate).toBe("2026-11-13");
    await expect.poll(async () => (await readGame(b)).lastQuestDate).toBe("2026-11-13");
    const list = await snaps(a);
    expect(list.map((s) => s.day)).toEqual(["2026-11-12"]);
    expect(list[0].done[id]).toMatchObject({ source: "self" });
    expect(list[0].offered).toContain(id);
    expect(totalXp(await readGame(a))).toBe(xpBefore);

    // a reload in each tab keeps the same snapshot (written once, never rewritten)
    const recorded = list[0].recordedAt;
    await a.reload();
    await b.reload();
    await expect(a.getByTestId("missions")).toBeVisible();
    const again = await snaps(b);
    expect(again).toHaveLength(1);
    expect(again[0].recordedAt).toBe(recorded);
    expect(totalXp(await readGame(b))).toBe(xpBefore);
  });

  test("back after 10 days with a save from before QH-3: one honest snapshot, no made-up days, every value kept", async ({ context, page }) => {
    const last = addDays(utcDay(), -10);
    // a Q2 day set (no QH-3 tracking) with one done quest
    const questDay = { day: last, mode: "trading", catalogVersion: 2, core: ["q_riskcheck", "q_logic_puzzle", "q_stretching"], bonus: ["q_read_pages"] };
    const history = [{ questId: "q_logic_puzzle", questTitle: "Логический анализ торговой модели", category: "Mental", xp: 35, coins: 0, completedAt: last, at: `${last}T09:00:00.000Z` }];
    const goals = [{ id: "g1", title: "Без сдвига стопа", category: "Trading", createdAt: "2026-11-01" }];
    const saved = baseGame({
      level: 6,
      xp: 120,
      coins: 340,
      equipment: { top: 1, bottom: 3, shoes: 5 },
      achievements: { first_quest: true },
      unlockedTitles: ["novice"],
      customGoals: goals,
      lastQuestDate: last,
      questDay,
      completedQuestsToday: { q_logic_puzzle: true },
      history,
    });
    await seedGame(context, saved);
    await page.goto("/quests");
    await expect(page.getByTestId("missions")).toBeVisible();
    const g = await readGame(page);
    const list = await snaps(page);
    expect(list.map((s) => s.day)).toEqual([last]);
    expect(list[0].incomplete).toEqual(["offered", "modeChanges"]);
    expect(list[0].done.q_logic_puzzle).toMatchObject({ source: "self", at: `${last}T09:00:00.000Z` });
    const kept = g as unknown as Record<string, unknown>;
    expect({ level: g.level, xp: g.xp, coins: g.coins, equipment: kept.equipment, achievements: kept.achievements, goals: g.customGoals, history: g.history }).toEqual({
      level: 6,
      xp: 120,
      coins: 340,
      equipment: { top: 1, bottom: 3, shoes: 5 },
      achievements: { first_quest: true },
      goals,
      history,
    });
    await page.reload();
    await expect(page.getByTestId("missions")).toBeVisible();
    expect((await snaps(page)).map((s) => s.recordedAt)).toEqual(list.map((s) => s.recordedAt));
  });

  test("a 120-day save: loads, keeps its snapshots, a new reward still saves; real storage size", async ({ context, page }) => {
    const today = utcDay();
    const snap = (i: number) => {
      const day = addDays(today, -i);
      return {
        v: 1,
        day,
        mode: "trading",
        catalogVersion: 2,
        core: ["q_riskcheck", "q_logic_puzzle", "q_stretching"],
        bonus: ["q_review_mistake", "q_read_pages"],
        offered: ["q_riskcheck", "q_logic_puzzle", "q_stretching", "q_review_mistake", "q_read_pages", "q_backtest"],
        done: { q_bias: { source: "journal", at: `${day}T07:40:00.000Z`, xp: 40, coins: 10 }, q_logic_puzzle: { source: "self", at: `${day}T08:12:00.000Z`, xp: 35, coins: 0 } },
        passed: [],
        replaced: [{ from: "q_stretching", to: "q_backtest" }],
        modeChanges: [{ to: "study", at: `${day}T10:00:00.000Z` }],
        restDay: false,
        shieldUsed: false,
        totals: { xp: 75, coins: 10, selfXp: 35, quests: 2 },
        recordedAt: `${addDays(day, 1)}T06:00:00.000Z`,
      };
    };
    const questDays = Array.from({ length: 120 }, (_, i) => snap(i + 1));
    const history = questDays.flatMap((d) => [
      { questId: "q_bias", questTitle: "Daily Bias перед сессией", category: "Trading", xp: 40, coins: 10, completedAt: d.day, at: `${d.day}T07:40:00.000Z` },
      { questId: "q_logic_puzzle", questTitle: "Логический анализ торговой модели", category: "Mental", xp: 35, coins: 0, completedAt: d.day, at: `${d.day}T08:12:00.000Z` },
    ]);
    await seedGame(context, baseGame({ lastQuestDate: addDays(today, -1), questDays, history, coins: 1200 }));
    await page.goto("/quests");
    await expect(page.getByTestId("missions")).toBeVisible();
    // yesterday was closed now: its own snapshot was already there, so it is kept, the oldest one leaves the window
    const list = await snaps(page);
    expect(list).toHaveLength(120);
    expect(list[0].day).toBe(addDays(today, -1));
    expect(list[119].day).toBe(addDays(today, -120));
    expect((await readGame(page)).history).toHaveLength(240);

    const sizes = await page.evaluate(() => {
      const bytes = (s: string) => new TextEncoder().encode(s).length;
      const game = localStorage.getItem("ayra_demo_v1") || "{}";
      const parsed = JSON.parse(game);
      let all = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        all += bytes(k) + bytes(localStorage.getItem(k) || "");
      }
      return { game: bytes(game), days: bytes(JSON.stringify(parsed.questDays || [])), all };
    });
    console.log(`[QH-3 storage] game save ${sizes.game} B, of it day snapshots ${sizes.days} B; all localStorage ${sizes.all} B`);
    expect(sizes.days).toBeLessThan(120 * 1200);

    // a reward of today still saves next to 120 snapshots
    const before = totalXp(await readGame(page));
    await tickFirstSelf(page);
    expect(totalXp(await readGame(page))).toBeGreaterThan(before);
  });

  test("a closed week keeps its challenge result once, by the journal, with no XP or Coins", async ({ context, page }) => {
    const today = utcDay();
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDays(today, -dow);
    const lastMonday = addDays(monday, -7);
    const trade = (id: string, day: string, over: Record<string, unknown> = {}) => ({ id, accountId: "acc_1", instrument: "EURUSD", direction: "long", status: "closed", openedAt: `${day}T09:00:00.000Z`, result: "win", emotions: [], mistakes: [], verification: "unverified", source: "manual", createdAt: `${day}T09:00:00.000Z`, updatedAt: `${day}T09:00:00.000Z`, attachmentIds: [], ...over });
    const journal = JSON.stringify({
      schemaVersion: 6,
      accounts: [{ id: "acc_1", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-10-08T00:00:00.000Z" }],
      trades: [trade("t1", addDays(lastMonday, 1), { stopLoss: 1.09 }), trade("t2", addDays(lastMonday, 2), { stopLoss: 1.08, mistakes: ["moved_stop"] })],
      plans: [],
      weekPlans: [],
      noTrades: [],
    });
    const questWeeks = [{ v: 1, week: lastMonday, boss: "respectStop", daysRecorded: [], totals: { xp: 0, coins: 0, quests: 0 }, recordedAt: `${monday}T06:00:00.000Z` }];
    await seedGame(context, baseGame({ lastQuestDate: today, lastWeeklyResetDate: monday, questWeeks, coins: 50 }), { ayra_journal_v1: journal });
    await page.goto("/quests");
    await expect(page.getByTestId("missions")).toBeVisible();
    type W = { week: string; bossResult?: { state: string; conditions: Array<{ key: string; state: string; done: number; total: number }>; at: string } };
    const weeks = async () => ((await readGame(page)) as unknown as { questWeeks: W[] }).questWeeks;
    await expect.poll(async () => (await weeks())[0]?.bossResult?.state).toBe("notMet");
    const w = (await weeks())[0];
    expect(w.bossResult!.conditions.find((c) => c.key === "stopSet")).toMatchObject({ state: "met", done: 2, total: 2 });
    expect(w.bossResult!.conditions.find((c) => c.key === "stopNotMoved")).toMatchObject({ state: "notMet", done: 1, total: 2 });
    const g = await readGame(page);
    expect(g.coins).toBe(50);
    expect(totalXp(g)).toBe(0);
    // written once: a reload does not evaluate it again
    await page.reload();
    await expect(page.getByTestId("missions")).toBeVisible();
    expect((await weeks())[0].bossResult!.at).toBe(w.bossResult!.at);
  });
});
