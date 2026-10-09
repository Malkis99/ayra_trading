import { test, expect } from "@playwright/test";

test.describe("T7a Auth & Onboarding Flow (Mock Mode)", () => {
  test.beforeEach(async ({ page }) => {
    // Set mock env flag in window context
    await page.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    });
  });

  test("full auth cycle: login with OTP -> onboarding -> nickname collision -> success -> settings account -> logout -> guest mode", async ({ page }) => {
    // 1. Visit /login
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Вход в AYRA");

    // Fill email
    await page.fill("#email-input", "trader_test@example.com");

    // Check consent checkbox
    await page.click("input[type='checkbox']");

    // Click "Получить код"
    await page.click("button[type='submit']");

    // OTP Code step should appear
    await expect(page.locator("label[for='otp-input']")).toBeVisible();

    // Fill wrong code 999999 -> expired code error
    await page.fill("#otp-input", "999999");
    await page.click("button[type='submit']");
    await expect(page.locator(".max-w-md")).toContainText("Срок действия кода истёк");

    // Fill valid OTP code 123456
    await page.fill("#otp-input", "123456");
    await page.click("button[type='submit']");

    // Should redirect to /awakening (new profile)
    await page.waitForURL("**/awakening**");

    // Step 1: Nickname step -> Enter taken nickname 'taken_nick'
    await page.fill("input[placeholder='A-Z a-z 0-9 _ . -']", "taken_nick");
    await page.click("button:has-text('Продолжить')");

    // Error message for taken nickname should appear
    await expect(page.locator("main")).toContainText("Никнейм уже занят");

    // Enter valid unique nickname
    await page.fill("input[placeholder='A-Z a-z 0-9 _ . -']", "UniqueTrader99");
    await page.click("button:has-text('Продолжить')");

    // Next step: Language & Timezone -> Click Продолжить
    await page.click("button:has-text('Продолжить')");

    // Step 1 sub-step 3: Appearance -> Click Продолжить
    await page.click("button:has-text('Продолжить')");

    // Step 1 sub-step 4: Age range -> Pick 18-24 -> Click Продолжить
    await page.click("button:has-text('18–24 года')");
    await page.click("button:has-text('Продолжить')");

    // Step 2: Lifestyle -> Skip step
    await page.click('button:has-text("Пропустить шаг целиком")');

    // Step 3: Trading Profile
    await page.click('button:has-text("1–2 года")');
    await page.click('button:has-text("Продолжить")');

    await page.click('button:has-text("Крипто")');
    await page.click('button:has-text("Продолжить")');

    await page.click('button:has-text("Дисциплина")');
    await page.click('button:has-text("Продолжить")');

    await page.click('button:has-text("Пропустить необязательные вопросы")');

    // Step 4: Goals -> Skip step
    await page.click('button:has-text("Пропустить шаг целиком")');

    // Step 5: Final Screen -> Click "Начать"
    const startButton = page.locator('button:has-text("Начать")');
    await expect(startButton).toBeVisible();
    await startButton.click();

    // Should arrive on Home page
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });

    // Go to Settings page
    await page.goto("/settings");
    await expect(page.locator("h1")).toContainText("Настройки");

    // Verify Account section shows email trader_test@example.com
    await expect(page.locator("main")).toContainText("trader_test@example.com");

    // Click "Выйти"
    await page.click("button:has-text('Выйти')");

    // Navigate to Settings
    await page.goto("/settings");
    // Verify Guest status
    await expect(page.locator("main")).toContainText("Гость");
  });
});
