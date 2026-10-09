import { test, expect } from "@playwright/test";

test.describe("T6d.1 Prop Rules & Safe Deletion E2E Flow", () => {
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
          schemaVersion: 5,
          accounts: [],
          trades: [],
        })
      );
    });
    await page.goto("/journal");
  });

  test("Primary Prop Selection, Star Toggle, Home Banner, and Safe Account Soft Delete with Undo", async ({
    page,
  }) => {
    // 1. Navigate to Accounts tab
    await page.click("button:has-text('Счета')");

    // 2. Create first prop account ("FTMO Phase 1")
    await page.click("button:has-text('Добавить счёт')");
    await page.fill("input[placeholder='Основной счёт']", "FTMO Phase 1");
    await page.selectOption("select", "prop");
    await page.fill("input[placeholder='10000']", "100000");
    await page.click("button[type='submit']:has-text('Сохранить')");

    // Configure prop rules for FTMO Phase 1
    await page.click("button:has-text('Настроить правила')");
    await page.fill("input[placeholder='Например: Фаза 1, Финал']", "Phase 1");
    await page.click("button:has-text('2. Лимиты')");
    await page.click("button:has-text('3. Расширенное')");
    await page.click("button:has-text('Сохранить')");

    // 3. Create second prop account ("Funded Account")
    await page.click("button:has-text('Добавить счёт')");
    await page.fill("input[placeholder='Основной счёт']", "Funded Account");
    await page.selectOption("select", "prop");
    await page.fill("input[placeholder='10000']", "200000");
    await page.click("button[type='submit']:has-text('Сохранить')");

    // Configure prop rules for Funded Account
    const fundedCard = page.locator("div.card").filter({ hasText: "Funded Account" }).first();
    await fundedCard.locator("button:has-text('Настроить правила')").click();
    await page.fill("input[placeholder='Например: Фаза 1, Финал']", "Funded Phase");
    await page.click("button:has-text('2. Лимиты')");
    await page.click("button:has-text('3. Расширенное')");
    await page.click("button:has-text('Сохранить')");

    // 4. Set "Funded Account" as explicit primary prop account by clicking Star
    const fundedStar = fundedCard.locator("button[aria-pressed]").first();
    await fundedStar.click();

    // Verify Star is pressed
    await expect(fundedStar).toHaveAttribute("aria-pressed", "true");

    // Check Home page displays Funded Account
    await page.goto("/");
    await expect(page.locator("text=Funded Account")).toBeVisible();

    // 5. Unset primary prop account by clicking Star again
    await page.goto("/journal");
    await page.click("button:has-text('Счета')");
    const starToUnset = page
      .locator("div.card")
      .filter({ hasText: "Funded Account" })
      .first()
      .locator("button[aria-pressed]")
      .first();
    await starToUnset.click();

    // Check Home page displays "Основной проп-счёт не выбран" banner
    await page.goto("/");
    await expect(page.locator("text=Основной проп-счёт не выбран")).toBeVisible();

    // 6. Click link in banner to go back to Accounts tab and reset auto selection
    await page.click("text=Выбрать в Счетах");
    await page.click("button:has-text('Счета')");
    await expect(page.locator("text=Выбирать автоматически")).toBeVisible();
    await page.click("text=Выбирать автоматически");

    // 7. Test Soft Delete with Undo on "Funded Account" (0 trades)
    const fundedDeleteBtn = page
      .locator("div.card")
      .filter({ hasText: "Funded Account" })
      .locator("button[title='Удалить']")
      .last();

    await fundedDeleteBtn.click();

    // Confirm dialog appears
    await expect(page.locator("text=Удаление счёта")).toBeVisible();
    await page.fill("input[placeholder='Funded Account']", "Funded Account");
    await page.click("button:has-text('Удалить')");

    // Undo toast bar appears
    await expect(page.locator("text=Счёт «Funded Account» удалён")).toBeVisible();
    await expect(page.locator("button:has-text('Отменить')")).toBeVisible();

    // Click Undo
    await page.click("button:has-text('Отменить')");

    // Funded Account is restored!
    await expect(page.locator("text=Funded Account").first()).toBeVisible();

    // 8. Test Trade-blocking constraint on "FTMO Phase 1"
    await page.click("button:has-text('Сделки')");
    await page.click("button:has-text('Добавить сделку')");
    await page.selectOption("[data-testid='account-select']", { label: "FTMO Phase 1 (USD)" });
    await page.fill("input[placeholder='XAUUSD, EURUSD...']", "EURUSD");
    await page.fill("input[placeholder='150 / -50']", "500");
    await page.click("button:has-text('Сохранить сделку')");

    // Attempt to delete FTMO Phase 1
    await page.click("button:has-text('Счета')");
    const ftmoDeleteBtn = page
      .locator("div.card")
      .filter({ hasText: "FTMO Phase 1" })
      .locator("button[title='Удалить']")
      .last();

    await ftmoDeleteBtn.click();

    // Dialog warns that account with trades cannot be deleted
    await expect(page.locator("text=Удаление недоступно")).toBeVisible();
    await expect(page.locator("text=содержит 1 сделок")).toBeVisible();
  });
});
