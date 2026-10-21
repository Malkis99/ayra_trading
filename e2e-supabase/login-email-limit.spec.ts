import { test, expect } from "@playwright/test";
import { submitRegistration } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Auth plan PR A: the e-mail sending limit gets a clear message (what happened, when to retry, sign in with a
// password instead); a code asked again too soon says in how many seconds. Technical details stay.
test.describe("Login: clear messages when letters are refused", () => {
  test.use({ reducedMotion: "reduce" });

  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/email-limit`);
  });

  test("e-mail limit of the project: what to do and when; asked too soon: in N seconds", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await request.get(`${FAKE_SUPABASE}/__test/email-limit?mode=limit`);
    await page.goto("/login");
    await submitRegistration(page, `Limit_${Date.now()}@example.com`);
    const error = page.getByTestId("login-error");
    await expect(error).toContainText("Сейчас нельзя отправить письмо: сработал лимит отправки");
    await expect(error).toContainText("Повтори примерно через час");
    await expect(error).toContainText("Если у тебя уже есть пароль — войди с паролем");
    await expect(error).toContainText("Технические детали");
    await expect(page.locator("#otp-input")).toHaveCount(0);

    await request.get(`${FAKE_SUPABASE}/__test/email-limit?mode=soon`);
    await page.getByRole("tab", { name: "Вход" }).click();
    await page.getByTestId("forgot-link").click();
    await page.fill("#email-input", `Soon_${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Отправить код" }).click();
    await expect(page.getByTestId("login-error")).toContainText("Код можно запросить ещё раз через 42 с");
  });
});
