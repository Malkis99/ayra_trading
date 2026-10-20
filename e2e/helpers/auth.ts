import { expect, type Page } from "@playwright/test";

/** Password every e2e account is registered with (test-only, fake server or auth mock). */
export const TEST_PASSWORD = "test-password-123";
const FAKE_SUPABASE = "http://127.0.0.1:54329";

/** /login → «Регистрация»: e-mail, password, consent, submit. The code screen comes next. */
export async function submitRegistration(page: Page, email: string, password = TEST_PASSWORD) {
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await page.fill("#email-input", email);
  await page.fill("#password-input", password);
  await page.click("input[type='checkbox']");
  await page.click("button[type='submit']");
}

/** /login → «Вход»: e-mail + password, no letter. */
export async function submitPasswordSignIn(page: Page, email: string, password = TEST_PASSWORD) {
  await page.getByRole("tab", { name: "Вход" }).click();
  await page.fill("#email-input", email);
  await page.fill("#password-input", password);
  await page.click("button[type='submit']");
}

/**
 * Fake Supabase: a new e-mail registers (password + the link from the confirmation letter),
 * a known one signs in with its password — the way a person uses the app after the password step.
 */
export async function signIn(page: Page, email: string, password = TEST_PASSWORD) {
  const known = (await (await page.request.get(`${FAKE_SUPABASE}/__test/password?email=${encodeURIComponent(email)}`)).json()).hasPassword;
  await page.goto("/login");
  if (known) {
    await submitPasswordSignIn(page, email, password);
    return;
  }
  await submitRegistration(page, email, password);
  await expect(page.locator("#otp-input")).toBeVisible();
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`);
  await page.goto((await res.json()).link);
}
