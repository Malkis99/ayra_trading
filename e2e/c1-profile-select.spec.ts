import { test, expect, type Page } from "@playwright/test";

const GUEST_STATE = {
  name: "GuestZed",
  level: 3,
  xp: 40,
  onboarding: { status: "done", step: 5, answers: { nickname: "GuestZed" } },
};

async function seedGuest(page: Page, state: object | null) {
  await page.addInitScript((seed) => {
    (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    localStorage.setItem("ayra_guest_dismissed", "1");
    if (seed) localStorage.setItem("ayra_demo_v1", JSON.stringify(seed));
  }, state);
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email-input", email);
  await page.click("input[type='checkbox']");
  await page.click("button[type='submit']");
  await page.fill("#otp-input", "123456");
  await page.click("button[type='submit']");
}

async function accountGameState(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^ayra:.+:ayra_demo_v1$/.test(k));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
}

test.describe("C1 /profile-select", () => {
  test("guest profile -> sign in -> 'Использовать этот профиль' copies it into the account", async ({ page }) => {
    await seedGuest(page, GUEST_STATE);
    await page.goto("/");
    await expect(page.locator("body")).toContainText("GuestZed");

    await signIn(page, "c1_use@example.com");
    await page.waitForURL("**/profile-select**", { timeout: 5000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("На этом устройстве есть профиль");
    await expect(page.locator("main")).toContainText("GuestZed");

    await page.click("button:has-text('Использовать этот профиль')");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
    await expect(page.locator("body")).toContainText("GuestZed");

    const account = await accountGameState(page);
    expect(account?.name).toBe("GuestZed");
    expect(account?.level).toBe(3);
    const guest = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1")!));
    expect(guest.name).toBe("GuestZed");
  });

  test("'Начать заново' opens onboarding without guest data, guest stays intact", async ({ page }) => {
    await seedGuest(page, GUEST_STATE);
    await page.goto("/");
    await signIn(page, "c1_fresh@example.com");
    await page.waitForURL("**/profile-select**", { timeout: 5000 });

    await page.click("button:has-text('Начать заново')");
    await page.waitForURL("**/awakening**", { timeout: 5000 });
    await expect(page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]')).not.toHaveValue("GuestZed");

    const account = await accountGameState(page);
    expect(account?.name ?? "").not.toBe("GuestZed");
    const guest = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1")!));
    expect(guest.name).toBe("GuestZed");

    // Decision is remembered: reload does not bring the selection screen back
    await page.goto("/");
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain("/profile-select");
  });

  test("'Решить позже' signs out and returns to the guest profile", async ({ page }) => {
    await seedGuest(page, GUEST_STATE);
    await page.goto("/");
    await signIn(page, "c1_later@example.com");
    await page.waitForURL("**/profile-select**", { timeout: 5000 });

    await page.click("button:has-text('Решить позже')");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
    await expect(page.locator("body")).toContainText("GuestZed");
    await expect(page.locator("body")).toContainText("Гость");
  });

  test("clean device without guest data goes straight to onboarding", async ({ page }) => {
    await seedGuest(page, null);
    await page.goto("/");
    await signIn(page, "c1_clean@example.com");
    await page.waitForURL("**/awakening**", { timeout: 5000 });
  });

  test("360px layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seedGuest(page, GUEST_STATE);
    await page.goto("/");
    await signIn(page, "c1_mobile@example.com");
    await page.waitForURL("**/profile-select**", { timeout: 5000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator("button:has-text('Решить позже')")).toBeVisible();
  });
});
