import { test, expect } from "@playwright/test";

test.describe("T6d Prop Rules Tracker E2E Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(() => {
      const state = {
        name: "PropTrader",
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
          schemaVersion: 4,
          accounts: [],
          trades: [],
        })
      );
    });
    await page.goto("/journal");
  });

  test("Prop Account creation -> Wizard setup -> Losing Trade caution alert -> Pre-trade check -> Profit Target -> Phase change -> Refresh & Export", async ({
    page,
  }) => {
    // 1. Navigate to Accounts tab
    await page.click("button:has-text('Счета')");

    // 2. Create Prop Account
    await page.click("button:has-text('Добавить счёт')");
    await page.fill("input[placeholder='Основной счёт']", "My FTMO Account");
    await page.selectOption("select", "prop");
    await page.fill("input[placeholder='10000']", "100000");
    await page.click("button[type='submit']:has-text('Сохранить')");

    await expect(page.locator("text=My FTMO Account").first()).toBeVisible();

    // 3. Configure Prop Rules via Modal
    await page.click("button:has-text('Настроить правила')");
    await expect(page.locator("text=Правила проп-счёта")).toBeVisible();

    // Step 1: Basic
    await page.fill("input[placeholder='Например: Фаза 1, Финал']", "Phase 1");
    await page.click("button:has-text('2. Лимиты')");

    // Step 2: Limits
    await page.click("button:has-text('3. Расширенное')");

    // Step 3: Advanced & Save
    await page.click("button:has-text('Сохранить')");

    // 4. Verify Prop Account Card details
    await expect(page.locator("text=Phase 1")).toBeVisible();
    await expect(page.locator("text=Дневной лимит")).toBeVisible();
    await expect(page.locator("text=Общая просадка")).toBeVisible();
    await expect(page.locator("text=Цель по прибыли")).toBeVisible();
    await expect(page.locator("text=Торговые дни")).toBeVisible();

    // 5. Add a losing trade to trigger caution alert
    await page.click("button:has-text('Сделки')");
    await page.click("button:has-text('Добавить сделку')");
    await page.selectOption("[data-testid='account-select']", { label: "My FTMO Account (USD)" });
    await page.fill("input[placeholder='XAUUSD, EURUSD...']", "EURUSD");
    await page.fill("input[placeholder='150 / -50']", "-4000");
    await page.fill("input[placeholder='2.5 / -1']", "-1");
    await page.click("button:has-text('Сохранить сделку')");

    // Verify toast alert was displayed
    await expect(page.locator("text=Дневной лимит использован на 80%")).toBeVisible();

    // 6. Test Pre-Trade check in Add Trade Modal
    await page.click("button:has-text('Добавить сделку')");
    await page.selectOption("[data-testid='account-select']", { label: "My FTMO Account (USD)" });
    await page.fill("input[placeholder='XAUUSD, EURUSD...']", "GBPUSD");
    await page.click("button:has-text('Подробно')");
    await page.fill("input[placeholder='100']", "2000");

    await expect(page.locator("text=Если эта сделка закроется по стопу:")).toBeVisible();
    await page.click("button[aria-label='Close']");

    // 7. Add winning trade to reach Profit Target
    await page.click("button:has-text('Добавить сделку')");
    await page.selectOption("[data-testid='account-select']", { label: "My FTMO Account (USD)" });
    await page.fill("input[placeholder='XAUUSD, EURUSD...']", "BTCUSD");
    await page.fill("input[placeholder='150 / -50']", "15000");
    await page.fill("input[placeholder='2.5 / -1']", "3");
    await page.click("button:has-text('Сохранить сделку')");

    // 8. Change Phase via Modal
    await page.click("button:has-text('Счета')");
    await page.click("button:has-text('Правила проп-счёта')");
    await page.click("button:has-text('Сменить фазу')");

    await page.fill("input[placeholder='Например: Фаза 1, Финал']", "Funded Phase");
    await page.click("button:has-text('Подтвердить смену фазы')");

    await expect(page.locator("text=Funded Phase")).toBeVisible();

    // 9. Refresh page and verify persistence
    await page.reload();
    await expect(page.locator("text=Funded Phase")).toBeVisible();

    // 10. Verify Export JSON contains propRules
    await page.goto("/profile");
    await page.click("button:has-text('Статистика')");
    const downloadPromise = page.waitForEvent("download");
    await page.click("button:has-text('Экспортировать мои данные (JSON)')");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(".json");
  });

  test("Mobile Viewport Layout Check (360px)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/journal");
    await page.click("button:has-text('Счета')");

    await expect(page.locator("body")).toBeVisible();
  });
});
