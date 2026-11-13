import { test, expect } from "@playwright/test";
import { baseGame, readGame, seedGame, totalXp, utcDay } from "./helpers/quests";

// Quest Hub QH-2 (docs/quest-hub-plan.md, 4.1): the three missions are rows with the criterion «Done when…», the source,
// the reward and one action; the next step is marked inside its row; extras: challenges apart from habits (self-reports).

const today = utcDay();
const questDay = { day: today, mode: "trading", catalogVersion: 2, core: ["q_riskcheck", "q_logic_puzzle", "q_stretching"], bonus: ["q_review_mistake", "q_read_pages"] };
const game = (over: Record<string, unknown> = {}) =>
  baseGame({
    level: 7,
    xp: 164,
    coins: 420,
    lastQuestDate: today,
    questDay,
    completedQuestsToday: { q_bias: true, q_logic_puzzle: true },
    history: [
      { questId: "q_bias", questTitle: "Daily Bias перед сессией", category: "Trading", xp: 40, coins: 10, completedAt: today, at: `${today}T07:40:00.000Z` },
      { questId: "q_logic_puzzle", questTitle: "Логический анализ торговой модели", category: "Mental", xp: 35, coins: 0, completedAt: today, at: `${today}T08:12:00.000Z` },
    ],
    dailyStats: { [today]: { questsCompleted: { Trading: 1, Mental: 1 }, totalQuestsCompleted: 2, xpGained: 75, coinsGained: 10, questsSkipped: 0, questsReplaced: 0, isRestDay: false, shieldUsed: false, rewardsClaimed: 0 } },
    ...over,
  });

const missions = (page: import("@playwright/test").Page) => page.locator('[data-testid="missions"] [data-testid^="quest-card-"]');

test.describe("Quest Hub missions (QH-2)", () => {
  test.use({ reducedMotion: "reduce" });

  test("a mission row has the title, the criterion, the source, the reward and one action", async ({ context, page }) => {
    await seedGame(context, game());
    await page.goto("/quests");
    await expect(missions(page)).toHaveCount(3);
    await expect(page.getByTestId("next-step")).toHaveCount(0);

    const risk = page.getByTestId("quest-card-q_riskcheck");
    await expect(risk).toHaveAttribute("data-state", "next");
    await expect(risk.getByRole("heading", { name: "Лимит риска на день" })).toBeVisible();
    await expect(risk.getByTestId("quest-criterion")).toContainText("Готово, когда:");
    await expect(risk.getByTestId("quest-badge-journal")).toHaveText("Журнал");
    await expect(risk.getByTestId("quest-reward")).toHaveText("+40 XP · +10 Coins");
    await expect(risk.getByTestId("quest-journal-link")).toHaveText("Задать лимиты");

    // a done mission shows when it was done (the day's history), no button
    const puzzle = page.getByTestId("quest-card-q_logic_puzzle");
    await expect(puzzle.getByTestId("quest-done")).toContainText("Выполнено в 08:12");
    await expect(puzzle.getByRole("button")).toHaveCount(0);
    await expect(puzzle.getByRole("link")).toHaveCount(0);

    // a self-report says it is one: grey «Self-report», XP only, «Mark done» — never a journal check
    const stretch = page.getByTestId("quest-card-q_stretching");
    await expect(stretch.getByTestId("quest-badge-self")).toHaveText("Самоотчёт");
    await expect(stretch.getByTestId("quest-badge-journal")).toHaveCount(0);
    await expect(stretch.getByTestId("quest-reward")).toHaveText("+30 XP");
    await expect(stretch.getByTestId("quest-complete")).toHaveText("Отметить");

    // one main action per mission: at most one button or link besides the «…» menu
    for (const row of await missions(page).all()) {
      const main = row.locator('[data-testid="quest-complete"], [data-testid="quest-journal-link"]');
      expect(await main.count()).toBeLessThanOrEqual(1);
    }
    // the next step is marked once on the page
    await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  });

  test("extras: challenges apart from habits; habits are self-reports; the self-report limit is one line", async ({ context, page }) => {
    await seedGame(context, game());
    await page.goto("/quests");
    const challenges = page.getByTestId("extras-challenges");
    const habits = page.getByTestId("extras-habits");
    await expect(challenges.getByTestId("quest-card-q_review_mistake")).toBeVisible();
    await expect(challenges.getByTestId("no-trade-card")).toBeVisible();
    await expect(habits.getByTestId("quest-card-q_read_pages")).toBeVisible();
    await expect(habits.getByTestId("quest-badge-journal")).toHaveCount(0);
    await expect(habits).toContainText("самоотчёт · только XP");
    await expect(page.getByTestId("self-cap")).toHaveText("Самоотчёты сегодня: 35 из 90 XP");
  });

  for (const width of [360, 390, 768, 1280, 1440, 1920]) {
    test(`${width}px: mission rows fit, nothing scrolls sideways, buttons are big enough`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await seedGame(context, game());
      await page.goto("/quests");
      await expect(missions(page)).toHaveCount(3);
      const overflow = await page.evaluate(() => {
        const main = document.querySelector("main");
        return { doc: document.documentElement.scrollWidth - window.innerWidth, main: main ? main.scrollWidth - main.clientWidth : 0 };
      });
      expect(overflow.doc).toBeLessThanOrEqual(0);
      expect(overflow.main).toBeLessThanOrEqual(0);
      for (const row of await missions(page).all()) {
        const box = (await row.boundingBox())!;
        // the text column keeps a readable width: no word-per-line rows
        const body = (await row.locator(".m-body").boundingBox())!;
        expect(body.width).toBeGreaterThan(Math.min(240, box.width - 80));
        for (const el of await row.locator('[data-testid="quest-complete"], [data-testid="quest-journal-link"]').all()) {
          const b = (await el.boundingBox())!;
          expect(b.height).toBeGreaterThanOrEqual(44);
          expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
        }
      }
      if (width < 768) {
        // the first mission is whole on the first screen of a phone, its button too
        const first = (await missions(page).first().boundingBox())!;
        expect(first.y + first.height).toBeLessThanOrEqual(800 - 64);
      }
    });
  }

  test("marking a self-report and reloading keep XP, Coins, level and history right", async ({ context, page }) => {
    await seedGame(context, game());
    await page.goto("/quests");
    const before = await readGame(page);
    await page.getByTestId("quest-card-q_stretching").getByTestId("quest-complete").click();
    await expect(page.getByTestId("quest-card-q_stretching").getByTestId("quest-done")).toBeVisible();
    const after = await readGame(page);
    expect(totalXp(after) - totalXp(before)).toBe(30);
    expect(after.coins).toBe(before.coins);
    expect(after.history.length).toBe(before.history.length + 1);
    await page.reload();
    await expect(page.getByTestId("quest-card-q_stretching").getByTestId("quest-done")).toBeVisible();
    const reloaded = await readGame(page);
    expect(totalXp(reloaded)).toBe(totalXp(after));
    expect(reloaded.coins).toBe(after.coins);
    expect(reloaded.history.length).toBe(after.history.length);
  });
});
