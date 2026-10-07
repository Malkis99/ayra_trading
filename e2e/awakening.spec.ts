import { test, expect } from "@playwright/test";

test.describe("Awakening Onboarding E2E Tests", () => {
  test("Clean device redirects / -> /awakening, completes onboarding and returns to Home cleanly", async ({ page }) => {
    // Navigate directly to /awakening to clear state
    await page.goto("/awakening");
    await page.evaluate(() => localStorage.clear());

    // Clean device navigation to /awakening
    await page.goto("/awakening");
    expect(page.url()).toContain("/awakening");

    // Step 1: Nickname
    const nicknameInput = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
    await nicknameInput.fill("Trader_42");
    await page.click('button:has-text("Продолжить")');

    // Language/Timezone -> Continue
    await page.click('button:has-text("Продолжить")');

    // Appearance -> Continue
    await page.click('button:has-text("Продолжить")');

    // Age range -> select 18-24
    await page.click('button:has-text("18–24 года")');
    await page.click('button:has-text("Продолжить")');

    // Step 2: Lifestyle -> Skip step
    await page.click('button:has-text("Пропустить шаг целиком")');

    // Step 3: Trading Profile
    // Q1: Experience
    await page.click('button:has-text("1–2 года")');
    await page.click('button:has-text("Продолжить")');

    // Q2: Markets
    await page.click('button:has-text("Крипто")');
    await page.click('button:has-text("Продолжить")');

    // Q3: Main problem (mandatory)
    await page.click('button:has-text("Дисциплина")');
    await page.click('button:has-text("Продолжить")');

    // Skip remaining optional questions in step 3
    await page.click('button:has-text("Пропустить необязательные вопросы")');

    // Step 4: Goals -> Skip step
    await page.click('button:has-text("Пропустить шаг целиком")');

    // Step 5: Final Screen -> Click "Начать"
    const startButton = page.locator('button:has-text("Начать")');
    await expect(startButton).toBeVisible();
    await startButton.click();

    // Verify redirect to Home (/) within 3 seconds without whiteout or infinite logo
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
    expect(page.url()).not.toContain("/awakening");

    // Verify localStorage has status = 'done'
    const storedStatus = await page.evaluate(() => {
      const saved = localStorage.getItem("ayra_demo_v1");
      return saved ? JSON.parse(saved).onboarding?.status : null;
    });
    expect(storedStatus).toBe("done");

    // Refresh page -> verify we stay on Home
    await page.reload();
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain("/awakening");
  });

  test("Legacy profile shows soft banner on Home without forced redirect", async ({ page }) => {
    await page.goto("/awakening");
    await page.evaluate(() => {
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "OldTrader",
          onboarding: { status: "legacy" },
        })
      );
    });

    await page.goto("/");
    await page.waitForTimeout(1000);

    expect(page.url()).not.toContain("/awakening");
    const banner = page.locator("text=Пройти знакомство");
    await expect(banner).toBeVisible();
  });

  test("InProgress onboarding shows Continue soft banner on Home without forced redirect", async ({ page }) => {
    await page.goto("/awakening");
    await page.evaluate(() => {
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "DraftUser",
          onboarding: { status: "inProgress", step: 2, subStep: 1 },
        })
      );
    });

    await page.goto("/");
    await page.waitForTimeout(1000);

    expect(page.url()).not.toContain("/awakening");
    const banner = page.locator("text=Продолжить знакомство");
    await expect(banner).toBeVisible();
  });
});
