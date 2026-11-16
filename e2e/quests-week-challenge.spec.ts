import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame } from "./helpers/quests";

// QH-7: the week challenge cycle and its trophy. Fixed clock: Wednesday 18 November 2026, 10:00 UTC (account zone UTC).
// Last week (9–15 Nov) was closed with the challenge «Respect your stop»; its result is written by the Journal on open.

const SHOTS = process.env.QH7_SHOTS; // screenshots for the PR only (never in CI)
const NOW = "2026-11-18T10:00:00Z";
const MONDAY = "2026-11-16";
const LAST = "2026-11-09";

type Saved = Awaited<ReturnType<typeof readGame>> & {
  weekTrophies?: Array<{ week: string; boss: string; at: string }>;
  questWeeks?: Array<{ week: string; bossResult?: { state: string } }>;
  chronicle?: Array<string | { type: string }>;
  coinLog?: unknown[];
};
const game = (page: Page) => readGame(page) as Promise<Saved>;

const trade = (id: string, openedAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  accountId: "acc_1",
  instrument: "EURUSD",
  direction: "long",
  status: "closed",
  openedAt,
  result: "win",
  emotions: [],
  mistakes: [],
  verification: "unverified",
  source: "manual",
  createdAt: openedAt,
  updatedAt: openedAt,
  schemaVersion: 6,
  stopLoss: 1.08,
  ...extra,
});
const journal = (trades: unknown[]) => JSON.stringify({ schemaVersion: 6, accounts: [{ id: "acc_1", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-10-01T00:00:00.000Z" }], trades, plans: [], weekPlans: [], noTrades: [], notes: [] });
const closedWeek = (extra: Record<string, unknown> = {}) => ({ v: 1, week: LAST, boss: "respectStop", daysRecorded: [], totals: { xp: 0, coins: 0, quests: 0 }, recordedAt: `${MONDAY}T05:00:00.000Z`, ...extra });

/** An account whose last week waits for its result; `lastWeek` trades decide it. */
async function seedClosed(context: BrowserContext, lastWeek: unknown[], thisWeek: unknown[] = [], lang = "ru") {
  await seedGame(
    context,
    baseGame({ level: 3, xp: 20, coins: 120, createdAt: "2026-10-20", lastQuestDate: MONDAY, lastWeeklyResetDate: MONDAY, questWeeks: [closedWeek()], questWeek: { week: MONDAY, boss: "respectStop" } }),
    { ayra_journal_v1: journal([...lastWeek, ...thisWeek]), ayra_lang: lang }
  );
}
const goodLastWeek = [trade("l1", `${LAST}T09:00:00.000Z`), trade("l2", "2026-11-11T09:00:00.000Z"), trade("l3", "2026-11-13T09:00:00.000Z")];
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(1300); // after the trophy's reveal
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test.describe("Week challenge cycle and trophies (QH-7)", () => {
  test.use({ timezoneId: "UTC" });
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date(NOW) });
  });

  test("a new account: an active challenge with its rule, days and time left; no trophies, nothing invented", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: "" }), { ayra_journal_v1: journal([]) });
    await page.goto("/quests?tab=week");
    const boss = page.getByTestId("weekly-boss");
    await expect(boss.getByTestId("challenge-phase")).toHaveAttribute("data-phase", "active");
    await expect(boss.getByTestId("challenge-time-left")).toHaveText("До конца недели: 4 дн. 14 ч");
    await expect(boss.getByTestId("boss-victory-rule")).toContainText("Неделя без сделок — не поражение");
    await expect(boss.getByTestId("boss-until-end")).toContainText("XP и Coins за испытание не начисляются");
    // Mon, Tue: no trades (not failures); today Wednesday; Thu–Sun ahead
    await expect(boss.getByTestId(`challenge-day-${MONDAY}`)).toHaveAttribute("data-state", "noTrades");
    await expect(boss.getByTestId("challenge-day-2026-11-19")).toHaveAttribute("data-state", "future");
    await expect(page.getByTestId("last-week-result")).toHaveCount(0);
    await page.goto("/quests?tab=history");
    await expect(page.getByTestId("week-trophies")).toContainText("Пока нет трофеев");
  });

  test("the current week: trades by the rule → «Condition met»; a slip on one day shows on that day only", async ({ context, page }) => {
    await seedClosed(context, [], [trade("c1", `${MONDAY}T09:00:00.000Z`), trade("c2", "2026-11-17T09:00:00.000Z", { mistakes: ["moved_stop"] })]);
    await page.goto("/quests?tab=week");
    const boss = page.getByTestId("weekly-boss");
    await expect(boss.getByTestId(`challenge-day-${MONDAY}`)).toHaveAttribute("data-state", "met");
    await expect(boss.getByTestId("challenge-day-2026-11-17")).toHaveAttribute("data-state", "notMet");
    await expect(boss.getByTestId("challenge-phase")).toHaveAttribute("data-phase", "active");
  });

  test("a won week: checked once on open → trophy with a reveal, in History, the profile and the story; no XP or Coins; once only", async ({ context, page }) => {
    await seedClosed(context, goodLastWeek, [trade("c1", `${MONDAY}T09:00:00.000Z`)]);
    await page.goto("/quests?tab=week");
    const last = page.getByTestId("last-week-result");
    await expect(last).toHaveAttribute("data-phase", "completed");
    const card = last.getByTestId("trophy-card");
    await expect(card).toContainText("Победа: «Уважай свой стоп»");
    await expect(card).toContainText("У каждой сделки задан стоп или риск: 3 из 3");
    await expect(card).toHaveAttribute("data-new", "true");
    await expect(card.getByTestId("trophy-new")).toHaveText("Новый трофей");
    await expect(page.getByTestId("weekly-boss").getByTestId("challenge-phase")).toHaveAttribute("data-phase", "conditionMet");
    await last.scrollIntoViewIfNeeded();
    await shot(page, "week-completed");
    const g = await game(page);
    expect(g.weekTrophies!.map((t) => [t.week, t.boss])).toEqual([[LAST, "respectStop"]]);
    expect(g.chronicle!.filter((c) => typeof c === "object" && c.type === "weekTrophy")).toHaveLength(1);
    expect({ coins: g.coins, xp: g.xp, level: g.level }).toEqual({ coins: 120, xp: 20, level: 3 });
    // a reload: the same trophy, shown plainly (the reveal was once), nothing more written
    await page.reload();
    await expect(page.getByTestId("last-week-result").getByTestId("trophy-card")).toHaveAttribute("data-new", "false");
    const g2 = await game(page);
    expect({ trophies: g2.weekTrophies!.length, coins: g2.coins, xp: g2.xp }).toEqual({ trophies: 1, coins: 120, xp: 20 });
    // the closed week view: completed, with the trophy and the recorded conditions
    await page.getByTestId("last-week-open").click();
    await expect(page.getByTestId("past-boss").getByTestId("challenge-phase")).toHaveAttribute("data-phase", "completed");
    await expect(page.getByTestId("past-boss").getByTestId("trophy-card")).toBeVisible();
    await expect(page.getByTestId("past-boss-condition-stopSet")).toHaveAttribute("data-state", "met");
    await shot(page, "past-week-completed");
    // History and the profile
    await page.goto("/quests?tab=history");
    await expect(page.getByTestId("week-trophies").getByTestId("trophy-card")).toHaveCount(1);
    await expect(page.getByTestId("week-trophies-count")).toHaveText("Трофеев: 1");
    await shot(page, "history-trophies");
    await page.goto("/profile");
    await page.getByRole("tab", { name: "Достижения" }).click();
    await expect(page.getByTestId("week-trophies").getByTestId("trophy-card")).toHaveCount(1);
  });

  test("two tabs open the closed week at once: one result, one trophy, one story entry", async ({ context, page }) => {
    await seedClosed(context, goodLastWeek);
    const second = await context.newPage();
    await second.clock.install({ time: new Date(NOW) });
    await Promise.all([page.goto("/quests?tab=week"), second.goto("/quests?tab=week")]);
    await expect(page.getByTestId("last-week-result")).toHaveAttribute("data-phase", "completed");
    await expect(second.getByTestId("last-week-result")).toHaveAttribute("data-phase", "completed");
    await page.reload();
    const g = await game(page);
    expect(g.weekTrophies).toHaveLength(1);
    expect(g.chronicle!.filter((c) => typeof c === "object" && c.type === "weekTrophy")).toHaveLength(1);
  });

  test("a week with a slip: «Not completed», no trophy, no penalty", async ({ context, page }) => {
    await seedClosed(context, [trade("l1", `${LAST}T09:00:00.000Z`), trade("l2", "2026-11-11T09:00:00.000Z", { mistakes: ["moved_stop"] })]);
    await page.goto("/quests?tab=week");
    const last = page.getByTestId("last-week-result");
    await expect(last).toHaveAttribute("data-phase", "notCompleted");
    await expect(last).toContainText("это не наказание");
    await expect(last.getByTestId("trophy-card")).toHaveCount(0);
    await shot(page, "week-not-completed");
    const g = await game(page);
    expect({ trophies: g.weekTrophies || [], coins: g.coins, xp: g.xp }).toEqual({ trophies: [], coins: 120, xp: 20 });
  });

  test("a week without trades: «Not applicable», not a loss, no trophy", async ({ context, page }) => {
    await seedClosed(context, []);
    await page.goto("/quests?tab=week");
    const last = page.getByTestId("last-week-result");
    await expect(last).toHaveAttribute("data-phase", "notApplicable");
    await expect(last).toContainText("Это не поражение");
    expect((await game(page)).weekTrophies || []).toEqual([]);
  });

  test("an existing account: a win recorded before trophies existed shows its trophy; the old result is not changed", async ({ context, page }) => {
    const result = { state: "met", conditions: [{ key: "stopSet", source: "auto", state: "met", done: 4, total: 4 }], at: `${MONDAY}T07:00:00.000Z` };
    await seedGame(context, baseGame({ coins: 80, lastQuestDate: MONDAY, lastWeeklyResetDate: MONDAY, questWeeks: [closedWeek({ bossResult: result })] }), { ayra_journal_v1: journal([]) });
    await page.goto("/quests?tab=week");
    await expect(page.getByTestId("last-week-result").getByTestId("trophy-card")).toContainText("4 из 4");
    const g = await game(page);
    expect(g.questWeeks![0].bossResult).toEqual(result);
    expect(g.weekTrophies!.map((t) => t.at)).toEqual([result.at]);
    expect(g.coins).toBe(80);
  });

  test("English, reduced motion: labels, and the new trophy appears without animation", async ({ context, page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedClosed(context, goodLastWeek, [], "en");
    await page.goto("/quests?tab=week");
    const card = page.getByTestId("last-week-result").getByTestId("trophy-card");
    await expect(card).toContainText("Won: «Respect Your Stop»");
    await expect(card).toContainText("Week of November 9–15");
    await expect(card.getByTestId("trophy-new")).toHaveText("New trophy");
    expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await expect(page.getByTestId("last-week-result").getByTestId("challenge-phase")).toHaveText("Completed");
    await expect(page.getByTestId("weekly-boss").getByTestId("challenge-time-left")).toHaveText("Week ends in: 4 d 14 h");
  });

  for (const [label, width, height] of [["mobile", 390, 844], ["desktop", 1440, 900]] as const) {
    test(`${label} ${width}: the week fits without horizontal scroll`, async ({ context, page }) => {
      await page.setViewportSize({ width, height });
      await seedClosed(context, goodLastWeek, [trade("c1", `${MONDAY}T09:00:00.000Z`), trade("c2", "2026-11-17T09:00:00.000Z", { mistakes: ["moved_stop"] })]);
      await page.goto("/quests?tab=week");
      await expect(page.getByTestId("last-week-result")).toHaveAttribute("data-phase", "completed");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `${label}-week-active`);
      if (label === "mobile") {
        // the rail sits under the main column on a phone: the challenge and last week, each in view
        await page.getByTestId("weekly-boss").scrollIntoViewIfNeeded();
        await shot(page, "mobile-challenge");
        await page.getByTestId("last-week-result").scrollIntoViewIfNeeded();
        await shot(page, "mobile-last-week");
      }
    });
  }
});
