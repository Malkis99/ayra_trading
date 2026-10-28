import { expect, type Page } from "@playwright/test";

/** Where the onboarding should have taken the page: home (default), anywhere but the onboarding, or not checked. */
type After = "home" | "left" | "none";

/**
 * The onboarding of a new account, every step skipped where it can be. WebKit may take the typing of the nickname
 * before the page is ready (the field stays empty and «Continue» does nothing): it is typed again until the step moves.
 */
export async function completeOnboarding(page: Page, nickname: string, opts: { after?: After } = {}) {
  await page.waitForURL("**/awakening**", { timeout: 15000 });
  const nick = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
  await expect(async () => {
    if (await nick.isVisible()) {
      await nick.fill(nickname, { timeout: 3000 });
      // the page took it (not wiped when it got ready)
      await page.waitForTimeout(300);
      await expect(nick).toHaveValue(nickname, { timeout: 1000 });
      await page.locator('button:has-text("Продолжить")').first().click({ timeout: 3000 });
    }
    await expect(nick).toBeHidden({ timeout: 3000 });
  }).toPass({ timeout: 45000 });
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
  const after = opts.after ?? "home";
  if (after === "home") await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
  if (after === "left") await page.waitForURL((url) => url.pathname !== "/awakening", { timeout: 15000 });
}
