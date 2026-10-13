import { test, expect } from "@playwright/test";

test.describe("T7a-B3 Bug Proof E2E", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    });
  });

  test("Tab B callback opens /auth/callback with guest profile in localStorage and new user session -> goes to /awakening in account space", async ({ context }) => {
    // 1. Setup Tab A with guest profile in localStorage
    const pageA = await context.newPage();
    await pageA.goto("/");
    await pageA.evaluate(() => {
      localStorage.setItem("ayra_demo_v1", JSON.stringify({
        name: "GuestLevel10",
        level: 10,
        xp: 1000,
        coins: 500,
        onboarding: { status: "none", step: 0, answers: {} }
      }));
    });

    // Tab A goes to /login and enters email
    await pageA.goto("/login");
    await pageA.fill("#email-input", "tab_b_test@example.com");
    await pageA.click("input[type='checkbox']");
    await pageA.click("button[type='submit']");
    await expect(pageA.locator("label[for='otp-input']")).toBeVisible();

    // 2. Tab B opens from scratch on /auth/callback?...
    // Simulate Supabase magic link redirect with mock auth session preset in localStorage
    const pageB = await context.newPage();
    await pageB.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
      // Set mock session for tab B before load
      const user = { id: "mock-b-user-999", email: "tab_b_test@example.com", created_at: new Date().toISOString() };
      const profile = {
        id: user.id,
        nickname: null,
        locale: "ru",
        timezone: "UTC",
        age_group: null,
        minor_mode: false,
        consent_at: new Date().toISOString(),
        consent_version: "1.0-draft",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      localStorage.setItem("ayra_mock_auth_v1", JSON.stringify({ user, profile }));
    });

    await pageB.goto("/auth/callback?code=mock-code");

    // Expect Tab B to end up at /awakening and NOT show guest name "GuestLevel10"
    await pageB.waitForURL("**/awakening**", { timeout: 5000 });
    const guestText = pageB.locator("text=GuestLevel10");
    await expect(guestText).not.toBeVisible();
  });
});
