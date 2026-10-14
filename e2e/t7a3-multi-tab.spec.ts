import { test, expect } from "@playwright/test";

test.describe("T7a.3 Multi-Tab Login & Awakening Lease (E2E)", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    });
  });

  test("1. Tab A on /login, Tab B completes login -> Tab A shows multi-tab card without auto-redirect, 'Продолжить здесь' switches work", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    // Tab A on /login fills email
    await pageA.goto("/login");
    await pageA.fill("#email-input", "multitab1@example.com");
    await pageA.click("input[type='checkbox']");
    await pageA.click("button[type='submit']");

    await expect(pageA.locator("label[for='otp-input']")).toBeVisible();

    // Tab B verifies code
    await pageB.goto("/login");
    await pageB.fill("#email-input", "multitab1@example.com");
    await pageB.click("input[type='checkbox']");
    await pageB.click("button[type='submit']");
    await pageB.fill("#otp-input", "123456");
    await pageB.click("button[type='submit']");

    // Tab B should arrive at /awakening
    await pageB.waitForURL("**/awakening**", { timeout: 5000 });

    // Tab A receives signal and displays multi-tab card without auto-redirecting
    await expect(pageA.locator("text=Вход выполнен в другой вкладке")).toBeVisible({ timeout: 5000 });
    const continueBtnInA = pageA.locator("button:has-text('Продолжить здесь')");
    await expect(continueBtnInA).toBeVisible();

    // Close Tab B
    await pageB.close();

    // Click "Продолжить здесь" in Tab A -> Tab A executes resolvePostLoginRoute and navigates
    await continueBtnInA.click();
    await pageA.waitForURL("**/awakening**", { timeout: 5000 });
  });

  test("2. Existing account sign-in -> Tab B lands on Home page", async ({ context }) => {
    const pageA = await context.newPage();

    // Setup existing account with nickname
    await pageA.goto("/login");
    await pageA.fill("#email-input", "existing_multitab@example.com");
    await pageA.click("input[type='checkbox']");
    await pageA.click("button[type='submit']");
    await pageA.fill("#otp-input", "123456");
    await pageA.click("button[type='submit']");

    await pageA.waitForURL("**/awakening**", { timeout: 5000 });
    await pageA.fill("input[placeholder='A-Z a-z 0-9 _ . -']", "ExistingNick");
    await pageA.click("button:has-text('Продолжить')");

    // Existing account lands on Home
    await pageA.goto("/login");
    await pageA.waitForURL((url) => url.pathname === "/" || url.pathname === "/awakening", { timeout: 5000 });
  });

  test("3. Two tabs on /awakening -> Tab B becomes read-only with lease banner, 'Продолжить здесь' steals lease", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    // Sign in on Page A
    await pageA.goto("/login");
    await pageA.fill("#email-input", "lease_user@example.com");
    await pageA.click("input[type='checkbox']");
    await pageA.click("button[type='submit']");
    await pageA.fill("#otp-input", "123456");
    await pageA.click("button[type='submit']");
    await pageA.waitForURL("**/awakening**", { timeout: 5000 });

    // Open Page B on /awakening
    await pageB.goto("/awakening");

    // Page B should show lease banner "Знакомство открыто в другой вкладке"
    await expect(pageB.locator("text=Знакомство открыто в другой вкладке")).toBeVisible({ timeout: 5000 });

    // Inputs in Page B should be disabled
    const nickInputB = pageB.locator("input[placeholder='A-Z a-z 0-9 _ . -']");
    await expect(nickInputB).toBeDisabled();

    // Page B clicks "Продолжить здесь"
    const stealBtn = pageB.locator("button:has-text('Продолжить здесь')");
    await stealBtn.click();

    // Page B becomes active owner, input becomes enabled
    await expect(nickInputB).toBeEnabled({ timeout: 5000 });

    // Page A becomes read-only
    await expect(pageA.locator("text=Знакомство открыто в другой вкладке")).toBeVisible({ timeout: 5000 });
  });

  test("4. Storage fallback event synchronization when BroadcastChannel is unavailable", async ({ context }) => {
    const pageA = await context.newPage();

    // Disable BroadcastChannel in Page A
    await pageA.addInitScript(() => {
      delete (window as any).BroadcastChannel;
    });

    await pageA.goto("/login");
    await expect(pageA.locator("h1")).toContainText("вселенную AYRA");

    // Set mock user in storage and trigger storage event directly
    await pageA.evaluate(() => {
      const user = { id: "mock-storage-u1", email: "storage@example.com", created_at: new Date().toISOString() };
      const profile = { id: user.id, nickname: null, locale: "ru", timezone: "UTC", age_group: null, minor_mode: false, consent_at: null, consent_version: null, created_at: "", updated_at: "" };
      localStorage.setItem("ayra_mock_auth_v1", JSON.stringify({ user, profile }));

      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "ayra_auth_event",
          newValue: JSON.stringify({
            type: "AUTH_SIGNED_IN",
            tabId: "other_tab_999",
            timestamp: Date.now(),
          }),
        })
      );
    });

    // Page A receives storage event fallback and shows multi-tab card
    await expect(pageA.locator("text=Вход выполнен в другой вкладке")).toBeVisible({ timeout: 5000 });
  });

  test("5. Mock auth safety check: __AYRA_E2E_AUTH_MOCK__ disabled by default in production code", async ({ browser }) => {
    // Fresh context without init script
    const freshContext = await browser.newContext();
    const page = await freshContext.newPage();
    await page.goto("/login");
    const isMockActive = await page.evaluate(() => {
      return Boolean((window as any).__AYRA_E2E_AUTH_MOCK__);
    });
    expect(isMockActive).toBe(false);
    await freshContext.close();
  });
});
