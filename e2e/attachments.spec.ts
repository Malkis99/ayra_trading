import { test, expect } from "@playwright/test";
import path from "path";

test.describe("T6c-2b Screenshot Attachments E2E Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase("ayra_attachments_v1");
    });
    await page.evaluate(() => {
      const state = {
        name: "ScreenshotTrader",
        level: 1,
        xp: 0,
        coins: 0,
        createdAt: "2026-10-08",
        completedQuestsToday: {},
        lastQuestDate: "2026-10-08",
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
          schemaVersion: 3,
          accounts: [
            {
              id: "acc_real_1",
              name: "Main USD",
              type: "personal",
              currency: "USD",
              startBalance: 10000,
              platform: "manual",
              createdAt: "2026-10-08T00:00:00.000Z",
            },
          ],
          trades: [],
        })
      );
    });
    await page.goto("/journal");
  });

  test("Add Trade with Screenshot -> Lightbox Viewer -> Rejection of SVG/Disguised files -> Persistence & Deletion", async ({
    page,
  }) => {
    // 1. Open Add Trade modal & expand detailed section
    await page.click("button:has-text('Добавить сделку')");
    await page.fill("input[placeholder='XAUUSD, EURUSD...']", "BTCUSD");
    await page.fill("input[placeholder='150 / -50']", "300");
    await page.fill("input[placeholder='2.5 / -1']", "3");

    // Toggle detailed mode accordion
    await page.locator("button:has-text('Подробно')").click();
    await expect(page.locator("text=Добавить скриншот")).toBeVisible();

    // 2. Attach valid PNG screenshot fixture
    const pngPath = path.join(process.cwd(), "e2e/fixtures/test-screenshot.png");
    const fileInput = page.locator("input[type='file'][accept='image/*']");
    await fileInput.setInputFiles(pngPath);

    // Wait for thumbnail preview to render in modal
    await expect(page.locator(".aspect-video").first()).toBeVisible();

    // Save trade
    await page.click("button:has-text('Сохранить сделку')");

    // 3. Switch to Trades subtab and verify trade entry
    await page.click("button:has-text('Сделки')");
    await expect(page.locator("text=BTCUSD").first()).toBeVisible();

    // 4. Reload page to verify persistence
    await page.reload();
    await page.click("button:has-text('Сделки')");
    await expect(page.locator("text=BTCUSD").first()).toBeVisible();

    // 5. Open trade view modal and click screenshot thumbnail to trigger Lightbox
    await page.locator("text=BTCUSD").first().click();
    await expect(page.getByRole("heading", { name: "Карточка сделки" })).toBeVisible();

    // Click preview thumbnail inside trade detail
    const thumb = page.locator(".aspect-video").first();
    await thumb.click();

    // Verify Lightbox Viewer modal elements
    await expect(page.locator("button:has-text('Скачать')")).toBeVisible();

    // Close Lightbox with Esc
    await page.keyboard.press("Escape");
    await expect(page.locator("button:has-text('Скачать')")).not.toBeVisible();

    // Close trade detail modal by clicking close button
    await page.locator(".card button:has-text('✕')").click();

    // 6. Test SVG / Disguised file rejection
    await page.click("button:has-text('Добавить сделку')");
    await page.locator("button:has-text('Подробно')").click();

    const svgPath = path.join(process.cwd(), "e2e/fixtures/invalid.svg");
    const fileInputModal = page.locator("input[type='file'][accept='image/*']");
    await fileInputModal.setInputFiles(svgPath);

    // Expect error message
    await expect(page.locator("text=Разрешены только PNG, JPEG, WebP")).toBeVisible();

    await page.keyboard.press("Escape");

    // 7. Delete trade and verify clean removal
    await page.locator("text=BTCUSD").first().click();
    await page.locator("button:has-text('Удалить')").last().click();
    await page.locator(".bg-rose-600:has-text('Удалить')").click();

    await expect(page.locator("text=BTCUSD")).not.toBeVisible();
  });

  test("Mobile 360px viewport responsiveness check", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/journal");

    await expect(page.getByRole("heading", { name: "Журнал" })).toBeVisible();
    await page.click("button:has-text('Сделки')");
    await expect(page.locator("select").first()).toBeVisible();
  });
});
