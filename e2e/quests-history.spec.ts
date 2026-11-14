import { test, expect, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame, utcDay } from "./helpers/quests";

// Quest Hub QH-5 (docs/quest-hub-plan.md, 4.3): the History tab — 12 weeks of saved days as a map, honest figures,
// a read-only day panel (the same as on «Week»). Nothing is invented; reading changes nothing.

const add = (k: string, n: number) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const stat = (xp: number, coins: number, n: number, over: Record<string, unknown> = {}) => ({ questsCompleted: {}, totalQuestsCompleted: n, xpGained: xp, coinsGained: coins, questsSkipped: 0, questsReplaced: 0, isRestDay: false, shieldUsed: false, rewardsClaimed: 0, ...over });
const snapshot = (day: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  day,
  mode: "trading",
  catalogVersion: 2,
  core: ["q_riskcheck", "q_logic_puzzle", "q_stretching"],
  bonus: ["q_read_pages"],
  offered: ["q_riskcheck", "q_logic_puzzle", "q_stretching", "q_read_pages"],
  done: { q_riskcheck: { source: "journal", at: `${day}T09:00:00.000Z`, xp: 40, coins: 10 } },
  passed: [],
  replaced: [],
  modeChanges: [],
  restDay: false,
  shieldUsed: false,
  totals: { xp: 40, coins: 10, selfXp: 0, quests: 1 },
  recordedAt: `${add(day, 1)}T05:00:00.000Z`,
  ...over,
});

/** Days before `today`: a history-only day (before snapshots), a full snapshot day, a rest day, a shield day. */
function seed(today: string, extra: Record<string, unknown> = {}) {
  const old = add(today, -20);
  const full = add(today, -3);
  const rest = add(today, -2);
  const shield = add(today, -1);
  const fullDone = {
    q_riskcheck: { source: "journal", at: `${full}T09:00:00.000Z`, xp: 40, coins: 10 },
    q_logic_puzzle: { source: "self", at: `${full}T10:00:00.000Z`, xp: 35, coins: 0 },
    q_stretching: { source: "self", at: `${full}T11:00:00.000Z`, xp: 30, coins: 0 },
  };
  const questDays = [
    snapshot(shield, { done: {}, shieldUsed: true, totals: { xp: 0, coins: 0, selfXp: 0, quests: 0 } }),
    snapshot(rest, { mode: "rest", modeBeforeRest: "trading", restDay: true, done: {}, modeChanges: [{ to: "rest", at: `${rest}T08:00:00.000Z` }], totals: { xp: 0, coins: 0, selfXp: 0, quests: 0 } }),
    snapshot(full, { done: fullDone, replaced: [{ from: "q_walk", to: "q_stretching" }], modeChanges: [{ to: "study", at: `${full}T07:00:00.000Z` }, { to: "trading", at: `${full}T08:00:00.000Z` }], totals: { xp: 105, coins: 10, selfXp: 65, quests: 3 } }),
  ];
  const history = [
    { questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: old },
    ...Object.entries(fullDone).map(([id, d]) => ({ questId: id, questTitle: id, category: "Mental", xp: d.xp, coins: d.coins, completedAt: full, at: d.at })),
  ];
  return {
    days: { old, full, rest, shield },
    game: baseGame({
      level: 6,
      xp: 120,
      coins: 340,
      equipment: { top: 1, bottom: 3, shoes: 5 },
      achievements: { first_quest: true },
      createdAt: add(today, -100),
      lastQuestDate: today,
      currentStreak: 4,
      bestStreak: 9,
      questDays,
      history,
      dailyStats: { [old]: stat(30, 0, 1), [full]: stat(105, 10, 3), [rest]: stat(0, 0, 0, { isRestDay: true }), [shield]: stat(0, 0, 0, { shieldUsed: true }) },
      ...extra,
    }),
  };
}

const cell = (page: Page, day: string) => page.locator(`[data-testid="activity-cell"][data-day="${day}"]`);

test.describe("Quest Hub History (QH-5)", () => {
  test.use({ reducedMotion: "reduce" });

  test("the map: 84 days, today marked, future closed, rest / shield / before snapshots as they are; a day opens read-only", async ({ context, page }) => {
    const today = utcDay();
    const { game, days } = seed(today);
    await seedGame(context, game);
    await page.goto("/quests?tab=history");
    await expect(page.getByTestId("activity-cell")).toHaveCount(84);
    await expect(cell(page, today)).toHaveAttribute("aria-current", "date");
    const future = page.locator('[data-testid="activity-cell"][data-status="future"]');
    for (const f of await future.all()) await expect(f).toBeDisabled();
    await expect(cell(page, days.rest)).toHaveAttribute("data-status", "rest");
    await expect(cell(page, days.shield)).toHaveAttribute("data-status", "shield");
    await expect(cell(page, days.old)).toHaveAttribute("data-source", "history");
    await expect(cell(page, days.old)).toHaveAttribute("aria-label", /неполные данные/);
    await expect(cell(page, days.full)).toHaveAttribute("data-source", "snapshot");

    // the default day: the last day with records
    await expect(cell(page, days.shield)).toHaveAttribute("aria-pressed", "true");
    await cell(page, days.full).click();
    const panel = page.getByTestId("day-panel");
    await expect(panel).toHaveAttribute("data-kind", "snapshot");
    await expect(panel.getByTestId("day-missions")).toContainText("3 из 3");
    await expect(panel.getByTestId("day-quest-q_riskcheck")).toContainText("Журнал · 09:00");
    await expect(panel.getByTestId("day-replaced-q_walk")).toBeVisible();
    await expect(panel.getByTestId("day-mode-changes")).toContainText("Учёба");
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("day")).toBe(days.full);
    await page.reload();
    await expect(cell(page, days.full)).toHaveAttribute("aria-pressed", "true");

    // a rest day lists no missions as «not done»
    await cell(page, days.rest).click();
    await expect(panel.getByTestId("day-rest")).toContainText("День отдыха");
    await expect(panel.getByTestId("day-missions")).toHaveCount(0);
    // a day before snapshots: the history only, marked incomplete
    await cell(page, days.old).click();
    await expect(panel).toHaveAttribute("data-kind", "history");
    await expect(panel.getByTestId("day-incomplete")).toBeVisible();
  });

  test("figures: counted from snapshots where they exist, never estimated without them", async ({ context, page }) => {
    const today = utcDay();
    const { game } = seed(today);
    await seedGame(context, game);
    await page.goto("/quests?tab=history");
    await expect(page.getByTestId("streak-current")).toContainText("4");
    await expect(page.getByTestId("streak-best")).toContainText("9");
    await expect(page.getByTestId("stat-active")).toContainText("2 из");
    await expect(page.getByTestId("stat-full")).toContainText("1 из 2"); // the rest day asks for no missions
    await expect(page.getByTestId("stat-core")).toContainText("3 из 6");
    await expect(page.getByTestId("stat-xp")).toContainText("+135");
    await expect(page.getByTestId("stat-coins")).toContainText("+10");
    await expect(page.getByTestId("stat-shields")).toContainText(/^\s*1\s*Щитов использовано/);
    await expect(page.getByTestId("history-reliability")).toContainText("Точные данные — с");
    // the totals say what they include: one-time rewards for first actions are not part of them
    await expect(page.getByTestId("stat-xp")).toContainText("без разовых наград");
    await expect(page.getByTestId("history-totals-note")).toContainText("Разовые награды за первые действия сюда не входят");

    // an old save without any snapshot: full days and missions are «—», with the reason
    const old = seed(today, { questDays: [] });
    await page.evaluate((g) => localStorage.setItem("ayra_demo_v1", JSON.stringify(g)), old.game);
    await page.reload();
    await expect(page.getByTestId("stat-full")).toContainText("—");
    await expect(page.getByTestId("stat-full")).toContainText("появится после первого дня со снимком");
    await expect(page.getByTestId("stat-core")).toContainText("—");
    await expect(page.getByTestId("history-reliability")).toContainText("Снимков дней за этот период ещё нет");
  });

  test("the new year inside the 12 weeks and the account time zone", async ({ context, page }) => {
    // 2027-01-06 21:30 UTC is already 2027-01-07 in Tbilisi
    await page.clock.install({ time: new Date("2027-01-06T21:30:00Z") });
    const { game } = seed("2027-01-07", { profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: false, timezone: "Asia/Tbilisi" } });
    await seedGame(context, game);
    await page.goto("/quests?tab=history");
    await expect(cell(page, "2027-01-07")).toHaveAttribute("aria-current", "date");
    await expect(cell(page, "2026-12-31")).toBeVisible();
    await expect(cell(page, "2027-01-01")).toBeVisible();
    await expect(cell(page, "2027-01-08")).toBeDisabled();
    await expect(page.getByTestId("activity-cell").first()).toHaveAttribute("data-day", "2026-10-19");
  });

  test("keyboard: arrows move by day and by week the way the map is drawn (desktop and phone)", async ({ context, page }) => {
    const today = utcDay();
    const { game, days } = seed(today);
    await seedGame(context, game);
    await page.goto(`/quests?tab=history&day=${add(today, -30)}`);
    const start = add(today, -30);
    await cell(page, start).focus();
    await page.keyboard.press("ArrowRight"); // desktop (from 1024 px): a column is a week
    await expect(cell(page, add(start, 7))).toBeFocused();
    await expect(cell(page, add(start, 7))).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowDown");
    await expect(cell(page, add(start, 8))).toBeFocused();
    await page.keyboard.press("End");
    await expect(cell(page, today)).toBeFocused();

    await page.setViewportSize({ width: 390, height: 800 });
    await cell(page, days.old).click();
    await cell(page, days.old).focus();
    await page.keyboard.press("ArrowRight"); // phone: a row is a week
    await expect(cell(page, add(days.old, 1))).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(cell(page, add(days.old, 8))).toBeFocused();
  });

  test("reading the history changes nothing: XP, Coins, level, items, achievements, history, snapshots", async ({ context, page }) => {
    const today = utcDay();
    const { game, days } = seed(today);
    await seedGame(context, game);
    await page.goto("/quests?tab=history");
    await expect(page.getByTestId("activity-map")).toBeVisible();
    const pick = (g: Record<string, unknown>) => ({ xp: g.xp, level: g.level, coins: g.coins, equipment: g.equipment, achievements: g.achievements, history: g.history, days: g.questDays });
    const before = pick((await readGame(page)) as unknown as Record<string, unknown>);
    for (const d of [days.old, days.full, days.rest, days.shield, today]) await cell(page, d).click();
    await page.getByTestId("history-toggle").click();
    await expect(page.getByTestId("history-item")).toHaveCount(4);
    await page.reload();
    await expect(page.getByTestId("activity-map")).toBeVisible();
    expect(pick((await readGame(page)) as unknown as Record<string, unknown>)).toEqual(before);
  });

  for (const width of [360, 390, 768, 1280, 1440, 1920]) {
    test(`${width}px: no sideways scroll; day cells are big enough to tap`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      const { game } = seed(utcDay());
      await seedGame(context, game);
      await page.goto("/quests?tab=history");
      await expect(page.getByTestId("activity-map")).toBeVisible();
      const overflow = await page.evaluate(() => {
        const main = document.querySelector("main");
        return Math.max(document.documentElement.scrollWidth - window.innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
      });
      expect(overflow).toBeLessThanOrEqual(0);
      const min = 36;
      for (const c of (await page.getByTestId("activity-cell").all()).slice(0, 14)) {
        const b = (await c.boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(min);
        expect(b.height).toBeGreaterThanOrEqual(min);
      }
    });
  }
});
