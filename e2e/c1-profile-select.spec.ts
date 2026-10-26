import { test, expect, type Page } from "@playwright/test";
import { submitRegistration } from "./helpers/auth";

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
  await submitRegistration(page, email);
  await page.fill("#otp-input", "123456");
  await page.click("button[type='submit']");
}

async function completeOnboarding(page: Page, nickname: string) {
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill(nickname);
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("18–24 года")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Пропустить шаг целиком")');
  await page.click('button:has-text("1–2 года")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Крипто")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Дисциплина")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Пропустить необязательные вопросы")');
  await page.click('button:has-text("Пропустить шаг целиком")');
  await page.click('button:has-text("Начать")');
}

async function accountGameState(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^ayra:.+:ayra_demo_v1$/.test(k));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
}

async function signInAndOnboard(page: Page, email: string, nickname: string) {
  await signIn(page, email);
  // A new account always starts with its own onboarding, regardless of guest data on the device
  await page.waitForURL("**/awakening**", { timeout: 5000 });
  await expect(page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]')).not.toHaveValue("GuestZed");
  await completeOnboarding(page, nickname);
}

test.describe("C1 /profile-select after onboarding", () => {
  test("guest data -> new account -> onboarding -> 'Перенести данные гостя' keeps account identity", async ({ page }) => {
    await seedGuest(page, GUEST_STATE);
    await page.goto("/");
    await expect(page.locator("body")).toContainText("GuestZed");

    await signInAndOnboard(page, "c1_use@example.com", "AccOne");
    await page.waitForURL("**/profile-select**", { timeout: 5000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Перенести данные гостя?");
    await expect(page.locator("main")).toContainText("GuestZed");

    await page.click("button:has-text('Перенести данные гостя')");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
    await expect(page.locator("body")).toContainText("AccOne");

    const account = await accountGameState(page);
    expect(account?.name).toBe("AccOne");
    expect(account?.level).toBe(3);
    const guest = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1")!));
    expect(guest.name).toBe("GuestZed");
  });

  test("'Не переносить' keeps the account clean and the decision is remembered", async ({ page }) => {
    await seedGuest(page, GUEST_STATE);
    await page.goto("/");
    await signInAndOnboard(page, "c1_fresh@example.com", "AccTwo");
    await page.waitForURL("**/profile-select**", { timeout: 5000 });

    await page.click("button:has-text('Не переносить')");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
    const account = await accountGameState(page);
    expect(account?.name).toBe("AccTwo");
    expect(account?.level ?? 1).toBe(1);

    await page.goto("/profile-select");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
  });

  test("'Решить позже' goes Home and Settings still offers the transfer", async ({ page }) => {
    await seedGuest(page, GUEST_STATE);
    await page.goto("/");
    await signInAndOnboard(page, "c1_later@example.com", "AccThree");
    await page.waitForURL("**/profile-select**", { timeout: 5000 });

    await page.click("button:has-text('Решить позже')");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
    await page.goto("/settings/cloud");
    await expect(page.getByRole("button", { name: "Скопировать в аккаунт" })).toBeVisible();
  });

  test("clean device without guest data: onboarding then Home, no transfer screen", async ({ page }) => {
    await seedGuest(page, null);
    await page.goto("/");
    await signInAndOnboard(page, "c1_clean@example.com", "AccFour");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
  });

  test("360px layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seedGuest(page, GUEST_STATE);
    await page.goto("/");
    await signInAndOnboard(page, "c1_mobile@example.com", "AccFive");
    await page.waitForURL("**/profile-select**", { timeout: 5000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator("button:has-text('Решить позже')")).toBeVisible();
  });
});
