import { test, expect } from "@playwright/test";

test.describe("T6b Journal Dashboard, Calendar & Reports E2E Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(() => {
      const state = {
        name: "TestTrader",
        level: 1,
        xp: 0,
        coins: 0,
        createdAt: "2026-10-05",
        completedQuestsToday: {},
        lastQuestDate: "2026-10-05",
        onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
        profile: {
          appearance: {
            skinTone: "skin_fair",
            hairstyle: "hair_buzz",
            hairColor: "hair_black",
            outfit: "outfit_obsidian",
          },
          minorMode: false,
          timezone: "UTC",
        },
      };
      localStorage.setItem("ayra_demo_v1", JSON.stringify(state));
      localStorage.setItem(
        "ayra_journal_v1",
        JSON.stringify({
          schemaVersion: 1,
          accounts: [
            {
              id: "acc_real_1",
              name: "Main USD",
              type: "personal",
              currency: "USD",
              startBalance: 10000,
              platform: "manual",
              createdAt: "2026-10-05T00:00:00.000Z",
            },
          ],
          trades: [],
        })
      );
    });
    await page.goto("/journal");
  });

  test("Dashboard demo mode -> KPI & Equity Curve -> Calendar Month -> Reports Slices & Matrix -> Exit Demo -> Add Real Trade", async ({
    page,
  }) => {
    // 1. Enable Demo Mode from empty state
    await expect(page.locator("button:has-text('Показать пример')")).toBeVisible();
    await page.click("button:has-text('Показать пример')");

    // Verify Demo Banner & KPI Cards
    await expect(page.locator("text=Демо-данные (только просмотр)")).toBeVisible();
    await expect(page.locator("text=Кривая капитала (Equity)")).toBeVisible();

    // 2. Unit Switcher (R / $ / %)
    await page.getByRole("button", { name: "$", exact: true }).click();
    await page.getByRole("button", { name: "%", exact: true }).click();
    await page.getByRole("button", { name: "R", exact: true }).click();

    // 3. Calendar Interaction
    await expect(page.locator("text=Итог месяца")).toBeVisible();
    // Open a day cell
    const dayCell = page.locator("button:has-text('15')").first();
    if (await dayCell.isVisible()) {
      await dayCell.click();
      await expect(page.locator("text=Итог дня:")).toBeVisible();
      await page.click("button:has-text('Отмена')");
    }

    // 4. Reports Tab & Process x Outcome Matrix
    await page.click("button:has-text('Отчёты')");
    await expect(page.locator("text=Матрица «Процесс × Результат»")).toBeVisible();
    await expect(page.locator("text=Правильно")).toBeVisible();

    // Switch slice chip
    await page.click("button:has-text('Сессия')");
    await expect(page.locator("table")).toBeVisible();

    // 5. Exit Demo Mode
    await page.click("button:has-text('Дашборд')");
    await page.click("button:has-text('Выйти из примера')");
    await expect(page.locator("text=Демо-данные (только просмотр)")).not.toBeVisible();

    // 6. Add real trade and verify it appears in Dashboard and Calendar
    await page.click("button:has-text('Добавить сделку')");
    await page.fill("input[placeholder='XAUUSD, EURUSD...']", "XAUUSD");
    await page.fill("input[placeholder='150 / -50']", "500");
    await page.fill("input[placeholder='2.5 / -1']", "2.5");
    await page.click("button:has-text('Сохранить сделку')");

    // Verify trade appears in Dashboard recent trades
    await expect(page.locator("text=XAUUSD").first()).toBeVisible();
    await expect(page.locator("text=+2.50 R").first()).toBeVisible();
  });
});
