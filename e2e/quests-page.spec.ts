import { test, expect } from "@playwright/test";
import { baseGame, firstSelfQuest, readGame, seedGame, totalXp, utcDay, activateMode } from "./helpers/quests";

// Quests & Discipline 2.0, Q1 (docs/quests-2.0-plan.md): only real data, «Replace» really replaces, rest gives nothing,
// goals ≤ 80 characters, history with the time.

const today = utcDay();
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return utcDay(d);
};

const rec = (over: Record<string, unknown> = {}) => ({
  questsCompleted: {},
  totalQuestsCompleted: 0,
  xpGained: 0,
  coinsGained: 0,
  questsSkipped: 0,
  questsReplaced: 0,
  isRestDay: false,
  shieldUsed: false,
  rewardsClaimed: 0,
  ...over,
});

test.describe("Quests page (Q1)", () => {
  test.use({ reducedMotion: "reduce" });

  test("every tab shows saved data only: today's earnings, the real week and 28 activity cells", async ({ context, page }) => {
    await seedGame(
      context,
      baseGame({
        createdAt: daysAgo(40),
        lastQuestDate: today,
        history: [
          { questId: "q_walk", questTitle: "Walk", category: "Physical", xp: 30, coins: 0, completedAt: daysAgo(1) },
          { questId: "q_read_pages", questTitle: "Read", category: "Mental", xp: 30, coins: 0, completedAt: daysAgo(1) },
        ],
        dailyStats: { [today]: rec({ xpGained: 70, coinsGained: 20 }), [daysAgo(2)]: rec({ isRestDay: true }) },
      })
    );
    await page.goto("/quests");
    await expect(page.getByTestId("today-earned")).toHaveText("Сегодня +70 XP · +20 Coins");

    for (const name of ["Неделя", "История", "Авторы", "Сегодня"]) {
      await page.getByRole("tab", { name }).click();
      await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    }

    await page.getByRole("tab", { name: "Неделя" }).click();
    await expect(page.locator(`[data-testid="week-day-${today}"]`)).toHaveAttribute("aria-current", "date");
    const yesterday = page.locator(`[data-testid="week-day-${daysAgo(1)}"]`);
    if (await yesterday.count()) await expect(yesterday).toHaveAttribute("data-status", "done");

    await page.getByRole("tab", { name: "История" }).click(); // the 12-week map is on History (QH-5)
    const cells = page.getByTestId("activity-cell");
    await expect(cells).toHaveCount(84);
    await expect(page.locator(`[data-testid="activity-cell"][data-status="rest"]`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="activity-cell"][data-status="done"][data-quests="2"]`)).toHaveCount(1);
  });

  test("«Replace» shows another quest; the third replacement says the limit is reached", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    await page.goto("/quests");
    const before = await firstSelfQuest(page);
    await before.card.getByRole("button", { name: /Ещё действия/ }).click();
    await before.card.getByRole("button", { name: /Заменить \(0 из 2\)/ }).click();
    await expect(page.getByText(/Задание заменено:/)).toBeVisible();
    await expect(page.getByTestId(`quest-card-${before.id}`)).toHaveCount(0);
    await expect(page.getByText(/Вместо «/).first()).toBeVisible();
    await expect.poll(async () => (await readGame(page)).replacementsUsedToday).toBe(1);

    // reload: the same replacement stays
    const replaced = Object.values((await readGame(page)).questReplacements || {})[0];
    await page.reload();
    await expect(page.getByTestId(`quest-card-${replaced}`)).toBeVisible();

    for (let i = 0; i < 2; i++) {
      const q = await firstSelfQuest(page);
      await q.card.getByRole("button", { name: /Ещё действия/ }).click();
      await q.card.getByRole("button", { name: /Заменить/ }).click();
      await page.waitForTimeout(300);
    }
    await expect(page.getByText("Замен сегодня больше нет (2 из 2)")).toBeVisible();
    expect((await readGame(page)).replacementsUsedToday).toBe(2);
  });

  test("rest on and off gives no XP or coins and keeps the final state", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    await page.goto("/quests");
    const g0 = await readGame(page);
    for (let i = 0; i < 4; i++) {
      await activateMode(page, i % 2 === 0 ? "rest" : "trading");
      await page.waitForTimeout(150);
    }
    const g1 = await readGame(page);
    expect(totalXp(g1)).toBe(totalXp(g0));
    expect(g1.coins).toBe(g0.coins);
    expect(g1.isRestDay).toBe(false);
    await activateMode(page, "rest");
    await expect(page.getByTestId("rest-panel")).toBeVisible();
    expect((await readGame(page)).dailyStats[today].isRestDay).toBe(true);
  });

  test("a completed quest appears in the history with its time and source", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    await page.goto("/quests");
    const q = await firstSelfQuest(page);
    await q.card.getByTestId("quest-complete").click();
    await expect(page.getByTestId(`quest-card-${q.id}`).getByTestId("quest-done")).toBeVisible();
    await page.getByRole("tab", { name: "История" }).click();
    await page.getByTestId("history-toggle").click(); // the full list is folded under the day panel (QH-5)
    const item = page.getByTestId("history-item").first();
    await expect(item).toContainText(/\d{2}:\d{2}/);
    await expect(item.getByTestId("quest-badge-self")).toBeVisible();
    await expect(item.getByTestId("history-reward")).not.toContainText("Coins");
  });

  test("goals: 80 characters are fine, 81 and spaces only are not; a long title fits a phone", async ({ context, page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await seedGame(context, baseGame({ lastQuestDate: today }));
    await page.goto("/quests"); // «My goals» sits in the progress rail of Today
    await page.getByTestId("goal-add").click();
    const input = page.getByTestId("goal-title");

    await input.fill("    ");
    await expect(page.getByTestId("goal-save")).toBeDisabled();

    await input.fill("Ж".repeat(81));
    await expect(page.getByTestId("goal-save")).toBeDisabled();
    await input.blur();
    await expect(page.getByTestId("goal-error")).toHaveText("Не длиннее 80 символов");

    const long = "Длинноеназваниецелибезпробелов".repeat(3).slice(0, 80);
    await input.fill(`  ${long}  `);
    await expect(page.getByTestId("goal-save")).toBeEnabled();
    await page.getByTestId("goal-save").click();
    await expect(page.getByTestId("goal-list")).toContainText(long);
    expect((await readGame(page)).customGoals.map((g) => g.title)).toContain(long);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
  });

  test("a goal can be deleted after confirming", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, customGoals: [{ id: "g1", title: "Удалить меня", category: "Trading", createdAt: today }] }));
    await page.goto("/quests?tab=history"); // and in the rail of History
    await page.getByRole("button", { name: "Удалить: Удалить меня" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByTestId("goal-list")).toHaveCount(0);
    expect((await readGame(page)).customGoals).toHaveLength(0);
  });

  test("storage full: no reward is shown or kept; after space is back the quest gives XP once", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, xp: 50 }));
    await page.goto("/quests");
    const q = await firstSelfQuest(page);
    const before = totalXp(await readGame(page));
    await page.evaluate(() => {
      const w = window as unknown as { __origSetItem?: typeof Storage.prototype.setItem };
      w.__origSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.endsWith("ayra_demo_v1")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return w.__origSetItem!.call(this, key, value);
      };
    });
    await q.card.getByTestId("quest-complete").click();
    await expect(page.getByText("Не удалось сохранить — ничего не начислено. Попробуйте ещё раз.")).toBeVisible();
    await expect(page.getByTestId(`quest-card-${q.id}`).getByTestId("quest-complete")).toBeVisible();
    expect(totalXp(await readGame(page))).toBe(before);
    await page.evaluate(() => {
      const w = window as unknown as { __origSetItem?: typeof Storage.prototype.setItem };
      Storage.prototype.setItem = w.__origSetItem!;
    });
    await page.getByTestId(`quest-card-${q.id}`).getByTestId("quest-complete").click();
    await expect(page.getByTestId(`quest-card-${q.id}`).getByTestId("quest-done")).toBeVisible();
    const g = await readGame(page);
    expect(g.history.filter((h) => h.questId === q.id)).toHaveLength(1);
    expect(totalXp(g) - before).toBe(g.history.find((h) => h.questId === q.id)!.xp);
  });

  test("the page says honestly where progress is kept", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    await page.goto("/quests");
    await expect(page.getByTestId("device-note")).toContainText("Прогресс хранится на этом устройстве");
  });
});
