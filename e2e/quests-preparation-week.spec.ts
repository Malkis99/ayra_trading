import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { activateMode, baseGame, readGame, seedGame } from "./helpers/quests";

// QH-7.1 «Preparation week»: a week path without trades. Fixed clock: Wednesday 18 November 2026, 10:00 UTC.

const SHOTS = process.env.QH71_SHOTS; // screenshots for the PR only (never in CI)
const NOW = "2026-11-18T10:00:00Z";
const MONDAY = "2026-11-16";
const LAST = "2026-11-09";
const TEXT = "Урок: вход только после закрытия свечи за уровнем, без догоняющих входов по рынку и без спешки.";

type Saved = Awaited<ReturnType<typeof readGame>> & {
  questWeek?: { week: string; boss: string };
  weekTrophies?: Array<{ week: string; boss: string }>;
};
const game = (page: Page) => readGame(page) as Promise<Saved>;
let n = 0;
const lesson = (createdAt: string) => ({ id: `n${++n}`, templateKey: "lesson", title: "", body: `${TEXT} (${createdAt})`, tags: [], pinned: false, createdAt, updatedAt: createdAt, archivedAt: null });
const weekPlan = (week: string, updatedAt: string) => ({ weekStartDate: week, goals: [], summary: "Итог недели: три урока по входам, вывод — ждать подтверждения уровня и не спешить.", createdAt: updatedAt, updatedAt });
const journal = (notes: unknown[] = [], weekPlans: unknown[] = [], trades: unknown[] = []) => JSON.stringify({ schemaVersion: 6, accounts: [], trades, plans: [], weekPlans, noTrades: [], notes });
const closedPrep = { v: 1, week: LAST, boss: "preparationWeek", daysRecorded: [], totals: { xp: 0, coins: 0, quests: 0 }, recordedAt: `${MONDAY}T05:00:00.000Z` };

async function seed(context: BrowserContext, opts: { notes?: unknown[]; weekPlans?: unknown[]; trades?: unknown[]; extra?: Record<string, unknown>; lang?: string } = {}) {
  await seedGame(context, baseGame({ coins: 50, lastQuestDate: MONDAY, lastWeeklyResetDate: MONDAY, ...opts.extra }), {
    ayra_journal_v1: journal(opts.notes, opts.weekPlans, opts.trades),
    ayra_lang: opts.lang || "ru",
  });
}
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test.describe("Preparation week (QH-7.1)", () => {
  test.use({ timezoneId: "UTC" });
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date(NOW) });
  });

  test("a week without trades: «Preparation week» is chosen once and saved; nothing done yet — in progress, 0 of 3", async ({ context, page }) => {
    await seed(context);
    await page.goto("/quests?tab=week");
    const boss = page.getByTestId("weekly-boss");
    await expect(boss).toHaveAttribute("data-boss", "preparationWeek");
    await expect(boss).toContainText("Неделя подготовки");
    await expect(boss).toContainText("Торговать не нужно");
    await expect(boss.getByTestId("boss-overall")).toHaveText("В процессе");
    await expect(boss.getByTestId("challenge-phase")).toHaveAttribute("data-phase", "active");
    await expect(boss.getByTestId("boss-condition-activeDays")).toContainText("0 из 3");
    await expect(boss.getByTestId("boss-open-journal")).toHaveAttribute("href", "/journal?tab=plan");
    await expect.poll(async () => (await game(page)).questWeek).toEqual({ week: MONDAY, boss: "preparationWeek" });
  });

  test("partial: two days with lessons (three notes on one day count once) — 2 of 3; the days show which", async ({ context, page }) => {
    await seed(context, { notes: [lesson(`${MONDAY}T09:00:00.000Z`), lesson(`${MONDAY}T11:00:00.000Z`), lesson(`${MONDAY}T15:00:00.000Z`), lesson("2026-11-18T08:00:00.000Z")] });
    await page.goto("/quests?tab=week");
    const boss = page.getByTestId("weekly-boss");
    await expect(boss.getByTestId("boss-condition-activeDays")).toContainText("2 из 3");
    // two different counters, two different names: days with completed quests (left) and preparation days (the card)
    await expect(boss.getByTestId("boss-condition-activeDays")).toContainText("Дней подготовки");
    await expect(page.getByTestId("week-summary")).toContainText("Дней с заданиями");
    await expect(boss.getByTestId(`challenge-day-${MONDAY}`)).toHaveAttribute("data-state", "met");
    await expect(boss.getByTestId("challenge-day-2026-11-17")).toHaveAttribute("data-state", "noTrades");
    await expect(boss.getByTestId("challenge-day-2026-11-18")).toHaveAttribute("data-state", "met");
    await expect(boss.getByTestId("boss-overall")).toHaveText("В процессе");
    await shot(page, "prep-partial");
  });

  test("three different days and a saved summary: «Condition met»", async ({ context, page }) => {
    await seed(context, { notes: [lesson(`${MONDAY}T09:00:00.000Z`), lesson("2026-11-17T09:00:00.000Z"), lesson("2026-11-18T08:00:00.000Z")], weekPlans: [weekPlan(MONDAY, "2026-11-18T08:30:00.000Z")] });
    await page.goto("/quests?tab=week");
    const boss = page.getByTestId("weekly-boss");
    await expect(boss.getByTestId("challenge-phase")).toHaveAttribute("data-phase", "conditionMet");
    await expect(boss.getByTestId("boss-overall")).toHaveText("Все условия выполнены");
    await expect(boss.getByTestId("boss-condition-weekSummary")).toHaveAttribute("data-state", "met");
    await boss.scrollIntoViewIfNeeded();
    await shot(page, "prep-condition-met");
  });

  test("a won closed week: one trophy «Preparation week», no XP or Coins; a reload and a second tab add nothing", async ({ context, page }) => {
    await seed(context, {
      notes: [lesson(`${LAST}T09:00:00.000Z`), lesson("2026-11-11T09:00:00.000Z"), lesson("2026-11-14T09:00:00.000Z")],
      weekPlans: [weekPlan(LAST, "2026-11-15T18:00:00.000Z")],
      extra: { questWeeks: [closedPrep] },
    });
    const second = await context.newPage();
    await second.clock.install({ time: new Date(NOW) });
    await Promise.all([page.goto("/quests?tab=week"), second.goto("/quests?tab=week")]);
    const last = page.getByTestId("last-week-result");
    await expect(last).toHaveAttribute("data-phase", "completed");
    await expect(last.getByTestId("trophy-card")).toContainText("Победа: «Неделя подготовки»");
    await expect(last.getByTestId("trophy-card")).toContainText("3 из 3");
    await expect(second.getByTestId("last-week-result")).toHaveAttribute("data-phase", "completed");
    await last.scrollIntoViewIfNeeded();
    await shot(page, "prep-trophy");
    await page.reload();
    const g = await game(page);
    expect(g.weekTrophies!.map((t) => [t.week, t.boss])).toEqual([[LAST, "preparationWeek"]]);
    expect(g.coins).toBe(50);
  });

  test("a closed week with two active days: «Not completed», no trophy, no penalty", async ({ context, page }) => {
    await seed(context, { notes: [lesson(`${LAST}T09:00:00.000Z`), lesson("2026-11-11T09:00:00.000Z")], weekPlans: [weekPlan(LAST, "2026-11-15T18:00:00.000Z")], extra: { questWeeks: [closedPrep] } });
    await page.goto("/quests?tab=week");
    await expect(page.getByTestId("last-week-result")).toHaveAttribute("data-phase", "notCompleted");
    const g = await game(page);
    expect({ trophies: g.weekTrophies || [], coins: g.coins }).toEqual({ trophies: [], coins: 50 });
  });

  test("an assigned trading challenge is not replaced in a week without trades; a mode change keeps it", async ({ context, page }) => {
    await seed(context, { extra: { questWeek: { week: MONDAY, boss: "respectStop" } } });
    await page.goto("/quests?tab=week");
    await expect(page.getByTestId("weekly-boss")).toHaveAttribute("data-boss", "respectStop");
    await page.goto("/quests");
    await activateMode(page, "study");
    await page.goto("/quests?tab=week");
    await expect(page.getByTestId("weekly-boss")).toHaveAttribute("data-boss", "respectStop");
    expect((await game(page)).questWeek).toEqual({ week: MONDAY, boss: "respectStop" });
  });

  test("English", async ({ context, page }) => {
    await seed(context, { lang: "en", notes: [lesson(`${MONDAY}T09:00:00.000Z`)] });
    await page.goto("/quests?tab=week");
    const boss = page.getByTestId("weekly-boss");
    await expect(boss).toContainText("Preparation Week");
    await expect(boss.getByTestId("boss-overall")).toHaveText("In progress");
    await expect(boss.getByTestId("boss-condition-activeDays")).toContainText("Preparation days — at least 3 different days");
    await expect(page.getByTestId("week-summary")).toContainText("Days with quests");
    await expect(boss.getByTestId("boss-victory-rule")).toContainText("Several records on one day are one active day");
  });

  for (const [label, width, height] of [["mobile", 390, 844], ["desktop", 1440, 900]] as const) {
    test(`${label} ${width}: the preparation week card fits`, async ({ context, page }) => {
      await page.setViewportSize({ width, height });
      await seed(context, { notes: [lesson(`${MONDAY}T09:00:00.000Z`), lesson("2026-11-18T08:00:00.000Z")] });
      await page.goto("/quests?tab=week");
      await expect(page.getByTestId("weekly-boss")).toHaveAttribute("data-boss", "preparationWeek");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByTestId("weekly-boss").scrollIntoViewIfNeeded();
      await shot(page, `${label}-prep`);
    });
  }
});
