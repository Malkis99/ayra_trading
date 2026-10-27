import { expect, type Page } from "@playwright/test";

/**
 * The onboarding of a new account, every step skipped where it can be. The nickname step may not move: WebKit may
 * take the typing before the page is ready (the field stays empty), or the nickname is taken by an account of an
 * earlier test on the same server. It is typed again, from the second try with a random ending.
 */
export async function completeOnboarding(page: Page, nickname: string) {
  await page.waitForURL("**/awakening**", { timeout: 15000 });
  const nick = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
  let tries = 0;
  await expect(async () => {
    if (await nick.isVisible()) {
      const name = tries++ === 0 ? nickname : `${nickname.slice(0, 18)}${Math.floor(Math.random() * 1e5)}`;
      await nick.fill(name);
      await page.click('button:has-text("Продолжить")');
    }
    await expect(nick).toBeHidden({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
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
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
}
