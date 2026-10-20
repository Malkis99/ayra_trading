import { test, expect, type Page } from "@playwright/test";
import { submitRegistration } from "./helpers/auth";

// Sign-in screen in the "universe" and the right side of the top bar (guest vs signed-in).

async function mockAuth(page: Page) {
  await page.addInitScript(() => {
    (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
  });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectNoPersonalBadges(page: Page) {
  await expect(page.getByRole("button", { name: "Уведомления" })).toHaveCount(0);
  await expect(page.locator('header a[href="/plans"]')).toHaveCount(0);
  await expect(page.getByTestId("coins-chip")).toHaveCount(0);
}

for (const [w, h] of [
  [360, 740],
  [1440, 900],
] as const) {
  test(`login at ${w}px: only the centred card, no sidebar, bottom nav or badges`, async ({ page }) => {
    await mockAuth(page);
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Войди во вселенную");

    await expect(page.locator("aside")).toHaveCount(0);
    await expect(page.locator("nav")).toHaveCount(0);
    await expectNoPersonalBadges(page);
    await expectNoHorizontalScroll(page);

    // The card is centred horizontally and vertically
    const box = (await page.locator("form").first().evaluate((el) => {
      const card = el.closest("div.relative.rounded-2xl") as HTMLElement;
      const r = card.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }))!;
    expect(Math.abs(box.x - w / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - h / 2)).toBeLessThanOrEqual(h * 0.08);
  });
}

test("login: email sent state shows 'Проверь почту' with a resend timer", async ({ page }) => {
  await mockAuth(page);
  await page.goto("/login");
  await submitRegistration(page, "timer_user@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "Проверь почту" })).toBeVisible();
  const resend = page.getByRole("button", { name: /Отправить ещё раз через \d+ сек/ });
  await expect(resend).toBeDisabled();
});

test("guest top bar: no bell, plan chip or coins; language switch and sign-in instead", async ({ page }) => {
  await mockAuth(page);
  await page.goto("/login");
  await page.click("button:has-text('Продолжить без входа')");
  await page.goto("/journal");
  await expect(page.locator("header").first()).toBeVisible();
  await expectNoPersonalBadges(page);
  await expect(page.locator("header").getByRole("group", { name: "Язык интерфейса" })).toBeVisible();
  await expect(page.locator("header").getByRole("link", { name: "Войти" })).toBeVisible();
});

test("signed-in top bar: coins, then the bell, then the plan chip; avatar last on phones", async ({ page }) => {
  await mockAuth(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await submitRegistration(page, "badges_user@example.com");
  await page.fill("#otp-input", "123456");
  await page.click("button[type='submit']");
  await page.waitForURL((url) => url.pathname === "/awakening", { timeout: 10000 });

  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill("Badge_User");
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
  await page.getByRole("button", { name: "Пропустить анимацию" }).click();
  await page.getByRole("button", { name: "Начать" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });

  const header = page.locator("header").first();
  const coins = header.getByTestId("coins-chip");
  const plan = header.locator('a[href="/plans"]');
  const bell = header.getByRole("button", { name: "Уведомления" });
  await expect(coins).toBeVisible();
  await expect(plan).toBeVisible();
  await expect(bell).toBeVisible();
  const [cx, bx, px] = await Promise.all([coins, bell, plan].map(async (l) => (await l.boundingBox())!.x));
  expect(cx).toBeLessThan(bx);
  expect(bx).toBeLessThan(px);
  await expect(header.getByRole("group", { name: "Язык интерфейса" })).toHaveCount(0);

  // 360px: everything fits, nothing is cut off
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(plan).toBeInViewport();
  const avatar = header.getByRole("button", { name: "Профиль" });
  await expect(avatar).toBeInViewport();
  const [bx2, px2, ax] = await Promise.all([bell, plan, avatar].map(async (l) => (await l.boundingBox())!.x));
  expect(bx2).toBeLessThan(px2);
  expect(px2).toBeLessThan(ax);
  const overflow = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoHorizontalScroll(page);
});

async function lineCount(page: Page, testIdOrRole: { testId?: string; heading?: boolean }) {
  const loc = testIdOrRole.heading ? page.getByRole("heading", { level: 1 }) : page.getByTestId(testIdOrRole.testId!);
  return loc.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    // rects of one visual line can differ by a pixel or two (links, fonts): group them with a small tolerance
    const tops = Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => r.top).sort((a, b) => a - b);
    let lines = 0;
    let last = -Infinity;
    for (const t of tops) {
      if (t - last > 6) lines++;
      last = t;
    }
    return lines;
  });
}

for (const lang of ["ru", "en"] as const) {
  test(`login texts fit in one line (${lang}): title and subtitle (sign in), consent and age note (sign up) at 1440 and 768; all but the age note at 360`, async ({ page }) => {
    await mockAuth(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    if (lang === "en") await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(lang === "ru" ? "Войди во вселенную" : "Enter the AYRA universe");
    for (const [w, h] of [
      [1440, 900],
      [768, 1024],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      expect(await lineCount(page, { heading: true }), `title ${w}`).toBe(1);
      expect(await lineCount(page, { testId: "login-subtitle" }), `subtitle ${w}`).toBe(1);
      // consent and the age note are on the sign-up tab (auth plan PR C)
      await page.getByRole("tab", { name: lang === "ru" ? "Регистрация" : "Sign up" }).click();
      expect(await lineCount(page, { testId: "login-consent" }), `consent ${w}`).toBe(1);
      if (w > 360) expect(await lineCount(page, { testId: "login-age-note" }), `age note ${w}`).toBe(1);
      await page.getByRole("tab", { name: lang === "ru" ? "Вход" : "Sign in" }).click();
    }
  });
}
