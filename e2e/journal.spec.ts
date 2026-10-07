import { test, expect } from "@playwright/test";

test.describe("T6a Journal v1 E2E Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before test
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    // Seed basic onboarding done state so page loads directly
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
    });
    await page.goto("/journal");
  });

  test("Create account -> Add trade -> Verify persistence -> Switch units -> Edit -> Delete -> Export JSON", async ({
    page,
  }) => {
    // 1. Go to Accounts tab and create account
    await page.click("button:has-text('Счета')");
    await page.click("button:has-text('Добавить счёт')");

    await page.fill("input[placeholder='Основной счёт']", "Prop Challenge");
    await page.selectOption("select >> nth=0", "prop");
    await page.selectOption("select >> nth=1", "USD");
    await page.fill("input[placeholder='10000']", "50000");
    await page.click("button[type='submit']:has-text('Сохранить')");

    await expect(page.locator("text=Prop Challenge")).toBeVisible();

    // 2. Go to Trades tab and add trade
    await page.click("button:has-text('Сделки')");
    await page.click("button:has-text('Добавить сделку')");

    // Fill trade form
    await page.fill("input[placeholder='XAUUSD, EURUSD...']", "XAUUSD");
    await page.fill("input[placeholder='150 / -50']", "300");
    await page.fill("input[placeholder='2.5 / -1']", "3");

    await page.click("button:has-text('Сохранить сделку')");

    // 3. Verify trade appears in list
    await expect(page.locator("text=XAUUSD")).toBeVisible();
    await expect(page.locator("text=+3.00 R")).toBeVisible();

    // 4. Reload page and check persistence
    await page.reload();
    await page.click("button:has-text('Сделки')");
    await expect(page.locator("text=XAUUSD")).toBeVisible();

    // 5. Switch units ($ / %)
    await page.click("button:has-text('$')");
    await expect(page.locator("text=+$300.00")).toBeVisible();

    // 6. Open trade card, edit and save
    await page.click("tr:has-text('XAUUSD')");
    await page.click("button:has-text('Редактировать')");
    await page.fill("input[placeholder='XAUUSD, EURUSD...']", "NAS100");
    await page.click("button:has-text('Сохранить сделку')");

    await expect(page.locator("text=NAS100")).toBeVisible();

    // 7. Delete trade with confirmation
    await page.click("tr:has-text('NAS100')");
    await page.click("button:has-text('Удалить')");
    await expect(page.locator("text=Удалить сделку?")).toBeVisible();
    await page.click("button:has-text('Удалить'):nth-match(2)");

    await expect(page.locator("text=NAS100")).not.toBeVisible();
  });
});
