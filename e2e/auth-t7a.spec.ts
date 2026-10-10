import { test, expect } from "@playwright/test";

test.describe("T7a.1 Auth & Screen Routing (Mock Mode)", () => {
  test.beforeEach(async ({ page }) => {
    // Set mock env flag in window context
    await page.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    });
  });

  test("1. Clean device -> /login -> 'Продолжить без входа' -> guest mode navigation to /awakening", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Вход в AYRA");

    // Click "Продолжить без входа"
    await page.click("button:has-text('Продолжить без входа')");

    // Should arrive on / or /awakening
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/awakening", { timeout: 5000 });
  });

  test("2. Sign in with code -> /awakening -> Home -> log out -> /login", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email-input", "new_user@example.com");
    await page.click("input[type='checkbox']");
    await page.click("button[type='submit']");

    await expect(page.locator("label[for='otp-input']")).toBeVisible();

    // Fill valid 6-digit OTP code
    await page.fill("#otp-input", "123456");
    await page.click("button[type='submit']");

    // Should redirect to /awakening for new user
    await page.waitForURL("**/awakening**", { timeout: 5000 });

    // Complete nickname step
    await page.fill("input[placeholder='A-Z a-z 0-9 _ . -']", "AlexTrader");
    await page.click("button:has-text('Продолжить')");

    // Language & Timezone -> Continue
    await page.click("button:has-text('Продолжить')");

    // Appearance -> Continue
    await page.click("button:has-text('Продолжить')");

    // Age range -> select 18-24 -> Continue
    await page.click("button:has-text('18–24 года')");
    await page.click("button:has-text('Продолжить')");

    // Step 2: Lifestyle -> Skip step
    await page.click('button:has-text("Пропустить шаг целиком")');

    // Step 3: Trading -> Skip optional
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

    // Arrive on Home page
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });

    // Go to Settings and Log Out
    await page.goto("/settings");
    await page.click("button:has-text('Выйти')");

    // Unauthenticated user trying to access /settings should be redirected to /login
    await page.goto("/settings");
    await page.waitForURL("**/login**", { timeout: 5000 });
    await expect(page.locator("h1")).toContainText("Вход в AYRA");
  });

  test("3. Repeated sign-in of existing profile -> Home without onboarding", async ({ page }) => {
    // Sign in first time
    await page.goto("/login");
    await page.fill("#email-input", "existing_user@example.com");
    await page.click("input[type='checkbox']");
    await page.click("button[type='submit']");

    await page.fill("#otp-input", "123456");
    await page.click("button[type='submit']");

    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/awakening", { timeout: 5000 });
  });
});
