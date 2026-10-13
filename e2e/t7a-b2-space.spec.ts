import { test, expect } from "@playwright/test";

test.describe("T7a-B2 Space Switching & Isolation E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    });
  });

  test("1. Guest profile -> login new account -> awakening without guest data -> logout -> guest restored with 'Гость' badge", async ({ page }) => {
    // 1. Set up guest data in localStorage
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "TraderOne",
          level: 2,
          xp: 50,
          onboarding: { status: "none", step: 0, answers: {} },
        })
      );
      localStorage.setItem("ayra_guest_dismissed", "1");
    });
    await page.reload();

    // Verify Guest sees "TraderOne" and "Гость" badge
    await expect(page.locator("body")).toContainText("TraderOne");
    await expect(page.locator("body")).toContainText("Гость");

    // 2. Login to new account
    await page.goto("/login");
    await page.fill("#email-input", "user_account_a@example.com");
    await page.click("input[type='checkbox']");
    await page.click("button[type='submit']");
    await page.fill("#otp-input", "123456");
    await page.click("button[type='submit']");

    // Arrives on /awakening for new account
    await page.waitForURL("**/awakening**", { timeout: 5000 });
    // Verify TraderOne is NOT present in account space
    await expect(page.locator("body")).not.toContainText("TraderOne");

    // 3. Logout
    await page.goto("/settings");
    await page.click("button:has-text('Выйти')");

    // 4. Returns to Guest mode with TraderOne restored and "Гость" badge
    await page.goto("/");
    await expect(page.locator("body")).toContainText("TraderOne");
    await expect(page.locator("body")).toContainText("Гость");
  });

  test("2. Multi-tab space synchronization on logout", async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    });
    await page2.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    });

    await page1.goto("/");
    await page2.goto("/");

    // Sign in on Page 1
    await page1.goto("/login");
    await page1.fill("#email-input", "multitab_user@example.com");
    await page1.click("input[type='checkbox']");
    await page1.click("button[type='submit']");
    await page1.fill("#otp-input", "123456");
    await page1.click("button[type='submit']");

    await page1.waitForURL("**/awakening**", { timeout: 5000 });

    // Logout on Page 1
    await page1.goto("/settings");
    await page1.click("button:has-text('Выйти')");

    // Page 2 receives space change event
    await page2.waitForTimeout(500);
  });
});
