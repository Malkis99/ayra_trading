import { test, expect, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { submitRegistration } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

async function requestMagicLink(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await submitRegistration(page, email);
  await expect(page.locator("#otp-input")).toBeVisible();
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`);
  return (await res.json()).link;
}

const errorScreen = (page: Page) => page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Повторить" }) });

test.describe("Cloud profile row", () => {
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/profiles-config?rows=1&table=1`);
  });

  test("new user without a profiles row -> /awakening, no error screen", async ({ page, request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/profiles-config?rows=0`);
    const link = await requestMagicLink(page, `norow_${Date.now()}@example.com`);
    await page.goto(link);
    await page.waitForURL("**/awakening**", { timeout: 8000 });
    await expect(errorScreen(page)).toHaveCount(0);
    await expect(page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]')).toBeVisible();
  });

  test("row still missing after onboarding: explains it once, no redirect loop", async ({ page, request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/profiles-config?rows=0`);
    const link = await requestMagicLink(page, `norow2_${Date.now()}@example.com`);
    await page.goto(link);
    await page.waitForURL("**/awakening**", { timeout: 8000 });
    await completeOnboarding(page, `NoRow${Date.now() % 100000}`, { after: "none" });
    await expect(errorScreen(page)).toContainText("Профиль не найден на сервере", { timeout: 10000 });
    // a clear message for the user, no technical details on screen
    await expect(page.getByTestId("profile-error-details")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/auth/continue");
  });

  test("profiles table missing (migration not applied): clear error screen with a retry button", async ({ page, request }) => {
    const link = await requestMagicLink(page, `notable_${Date.now()}@example.com`);
    await request.get(`${FAKE_SUPABASE}/__test/profiles-config?table=0`);
    await page.goto(link);
    await expect(errorScreen(page)).toContainText("Не удалось загрузить профиль", { timeout: 15000 });
    await expect(page.getByTestId("profile-error-details")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  });
});
