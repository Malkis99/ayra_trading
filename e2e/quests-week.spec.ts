import { test, expect, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame, utcDay } from "./helpers/quests";

// Quest Hub QH-4 (docs/quest-hub-plan.md, 4.2): earlier weeks open (never future ones), a day opens a read-only
// panel from its snapshot or, before snapshots, from the history marked «incomplete»; reading changes nothing.

const today = utcDay();
const add = (k: string, n: number) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
const monday = add(today, -dow);
const lastMonday = add(monday, -7);
// a past day of this week when there is one (Tuesday on Wednesday or later), else a day of last week
const snapDay = dow >= 2 ? add(monday, 1) : add(lastMonday, 3);
const historyDay = add(lastMonday, 1);
const emptyDay = add(lastMonday, 2);

function seed() {
  const snap = {
    v: 1,
    day: snapDay,
    mode: "trading",
    catalogVersion: 2,
    core: ["q_riskcheck", "q_reflect", "q_stretching"],
    bonus: ["q_read_pages"],
    offered: ["q_riskcheck", "q_reflect", "q_walk", "q_stretching", "q_read_pages"],
    done: { q_riskcheck: { source: "journal", at: `${snapDay}T09:17:00.000Z`, xp: 40, coins: 10 }, q_read_pages: { source: "self", at: `${snapDay}T10:24:00.000Z`, xp: 30, coins: 0 } },
    passed: [],
    replaced: [{ from: "q_walk", to: "q_stretching" }],
    modeChanges: [],
    restDay: false,
    shieldUsed: false,
    totals: { xp: 70, coins: 10, selfXp: 30, quests: 2 },
    recordedAt: `${add(snapDay, 1)}T05:00:00.000Z`,
  };
  const history = [
    { questId: "q_riskcheck", questTitle: "Проверка дневного лимита риска", category: "Trading", xp: 40, coins: 10, completedAt: snapDay, at: `${snapDay}T09:17:00.000Z` },
    { questId: "q_read_pages", questTitle: "Прочитать 10 страниц", category: "Mental", xp: 30, coins: 0, completedAt: snapDay, at: `${snapDay}T10:24:00.000Z` },
    { questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: historyDay },
  ];
  const stat = (xp: number, coins: number, n: number) => ({ questsCompleted: {}, totalQuestsCompleted: n, xpGained: xp, coinsGained: coins, questsSkipped: 0, questsReplaced: 0, isRestDay: false, shieldUsed: false, rewardsClaimed: 0 });
  const questWeeks = [
    { v: 1, week: lastMonday, boss: "respectStop", bossResult: { state: "met", conditions: [{ key: "stopSet", source: "auto", state: "met", done: 4, total: 4 }], at: `${monday}T07:00:00.000Z` }, daysRecorded: [], totals: { xp: 30, coins: 0, quests: 1 }, recordedAt: `${monday}T05:00:00.000Z` },
  ];
  return baseGame({
    level: 5,
    xp: 40,
    coins: 200,
    createdAt: add(lastMonday, -14),
    lastQuestDate: today,
    lastWeeklyResetDate: monday,
    questDays: [snap],
    questWeeks,
    history,
    dailyStats: { [snapDay]: stat(70, 10, 2), [historyDay]: stat(30, 0, 1) },
  });
}

const param = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);

test.describe("Quest Hub interactive week (QH-4)", () => {
  test.use({ reducedMotion: "reduce" });

  test("weeks: back to earlier weeks, never into the future; the address keeps the week and the day", async ({ context, page }) => {
    await seedGame(context, seed());
    await page.goto("/quests?tab=week");
    await expect(page.getByTestId("week-next")).toBeDisabled();
    await expect(page.getByTestId(`week-day-${today}`)).toHaveAttribute("aria-current", "date");
    await expect(page.getByTestId("day-panel")).toHaveAttribute("data-kind", "today");
    // a future day cannot be opened
    if (dow < 6) await expect(page.getByTestId(`week-day-${add(today, 1)}`)).toBeDisabled();

    await page.getByTestId("week-prev").click();
    await expect.poll(() => param(page, "week")).toBe(lastMonday);
    await expect(page.getByTestId(`week-day-${lastMonday}`)).toBeVisible();
    await expect(page.getByTestId("week-current")).toBeVisible();
    await page.getByTestId(`week-day-${historyDay}`).click();
    await expect.poll(() => param(page, "day")).toBe(historyDay);
    await page.reload();
    await expect(page.getByTestId("day-panel")).toHaveAttribute("data-kind", "history");
    await page.getByTestId("week-current").click();
    await expect.poll(() => param(page, "week")).toBeNull();
    await expect(page.getByTestId("week-next")).toBeDisabled();

    // an address with a future week opens the current one; Back still switches tabs
    await page.goto(`/quests?tab=week&week=${add(monday, 14)}`);
    await expect(page.getByTestId(`week-day-${today}`)).toBeVisible();
    await page.getByRole("tab", { name: /Сегодня/ }).click();
    await expect.poll(() => param(page, "tab")).toBe("today");
    expect(param(page, "week")).toBeNull();
    await page.goBack();
    await expect.poll(() => param(page, "tab")).toBe("week");
  });

  test("a snapshot day: missions with status, source, time and reward; replacement; journal of the day; total; no buttons", async ({ context, page }) => {
    await seedGame(context, seed());
    await page.goto(`/quests?tab=week&week=${snapDay < monday ? lastMonday : monday}&day=${snapDay}`);
    const panel = page.getByTestId("day-panel");
    await expect(panel).toHaveAttribute("data-kind", "snapshot");
    await expect(panel.getByTestId("day-mode")).toHaveText("Торговля");
    await expect(panel.getByTestId("day-read-only")).toBeVisible();
    await expect(panel.getByTestId("day-incomplete")).toHaveCount(0);
    await expect(panel.getByTestId("day-missions")).toContainText("1 из 3");
    await expect(panel.getByTestId("day-quest-q_riskcheck")).toHaveAttribute("data-mark", "done");
    await expect(panel.getByTestId("day-quest-q_riskcheck")).toContainText("Журнал · 09:17");
    await expect(panel.getByTestId("day-quest-q_riskcheck")).toContainText("+40 XP · +10 Coins");
    await expect(panel.getByTestId("day-quest-q_reflect")).toContainText("не выполнено — без штрафа");
    await expect(panel.getByTestId("day-replaced-q_walk")).toContainText("Прогулка → Растяжка и осанка");
    await expect(panel.getByTestId("day-quest-q_read_pages")).toContainText("Самоотчёт · 10:24");
    await expect(panel.getByTestId("day-journal")).toContainText("по данным журнала сейчас");
    await expect(panel.getByTestId("day-total")).toContainText("+70 XP");
    await expect(panel.getByTestId("day-total")).toContainText("Самоотчёты: 30 из 90 XP");
    // read-only: nothing to press inside the panel
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(panel.getByRole("link")).toHaveCount(0);
  });

  test("before snapshots: the history only, marked incomplete; a day with no records says so; the past week shows its saved boss result", async ({ context, page }) => {
    await seedGame(context, seed());
    await page.goto(`/quests?tab=week&week=${lastMonday}&day=${historyDay}`);
    const panel = page.getByTestId("day-panel");
    await expect(panel).toHaveAttribute("data-kind", "history");
    await expect(panel.getByTestId("day-incomplete")).toHaveText("неполные данные");
    await expect(panel.getByTestId("day-incomplete-text")).toContainText("Какие миссии предлагались, режим, замены и пропуски — неизвестны");
    await expect(panel.getByTestId("day-quest-q_walk")).toContainText("Самоотчёт · время не сохранено");
    await expect(panel.getByTestId("day-missions")).toHaveCount(0);

    await page.getByTestId(`week-day-${emptyDay}`).click();
    await expect(panel).toHaveAttribute("data-kind", "empty");
    await expect(panel.getByTestId("day-message")).toHaveText("Нет записей за этот день");

    const boss = page.getByTestId("past-boss");
    await expect(boss).toHaveAttribute("data-state", "met");
    await expect(boss.getByTestId("past-boss-condition-stopSet")).toContainText("4 из 4");
    await expect(page.getByTestId("trading-days")).toHaveCount(0);
  });

  test("keyboard: arrows move between days; the selected day is announced as pressed", async ({ context, page }) => {
    await seedGame(context, seed());
    await page.goto(`/quests?tab=week&week=${lastMonday}&day=${lastMonday}`);
    const first = page.getByTestId(`week-day-${lastMonday}`);
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId(`week-day-${historyDay}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`week-day-${historyDay}`)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(first).toHaveAttribute("aria-pressed", "true");
  });

  test("reading weeks and days changes nothing saved: XP, Coins, level, history, snapshots", async ({ context, page }) => {
    await seedGame(context, seed());
    await page.goto("/quests?tab=week");
    await expect(page.getByTestId("day-panel")).toBeVisible();
    const before = await readGame(page);
    await page.getByTestId("week-prev").click();
    for (const k of [lastMonday, historyDay, emptyDay]) await page.getByTestId(`week-day-${k}`).click();
    await page.getByTestId("week-current").click();
    if (snapDay >= monday) await page.getByTestId(`week-day-${snapDay}`).click();
    await page.reload();
    await expect(page.getByTestId("day-panel")).toBeVisible();
    const after = await readGame(page);
    const pick = (g: typeof before) => ({ xp: g.xp, level: g.level, coins: g.coins, history: g.history, days: (g as unknown as { questDays: unknown }).questDays, weeks: (g as unknown as { questWeeks: unknown }).questWeeks });
    expect(pick(after)).toEqual(pick(before));
  });

  for (const width of [360, 390, 768, 1280, 1440, 1920]) {
    test(`${width}px: the week and a past week fit without sideways scroll; day cells are big enough`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await seedGame(context, seed());
      for (const q of ["?tab=week", `?tab=week&week=${lastMonday}&day=${historyDay}`]) {
        await page.goto(`/quests${q}`);
        await expect(page.getByTestId("day-panel")).toBeVisible();
        const overflow = await page.evaluate(() => {
          const main = document.querySelector("main");
          return Math.max(document.documentElement.scrollWidth - window.innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
        });
        expect(overflow).toBeLessThanOrEqual(0);
        for (const cell of await page.locator('[data-testid^="week-day-"]').all()) {
          const b = (await cell.boundingBox())!;
          expect(b.height).toBeGreaterThanOrEqual(44);
          expect(b.width).toBeGreaterThanOrEqual(36);
        }
        for (const id of ["week-prev", "week-next"]) {
          const b = (await page.getByTestId(id).boundingBox())!;
          expect(b.height).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }
});
