import { test, expect, type Page } from "@playwright/test";

async function freshVisitor(page: Page, seedGuest = false) {
  await page.addInitScript((seed) => {
    (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    if (seed) {
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({ name: "GuestZed", level: 7, xp: 40, onboarding: { status: "done", answers: {} } })
      );
    }
  }, seedGuest);
}

test.describe("Home for visitors who are not signed in", () => {
  test("shows shared blocks and a sign-in card, but no personal data", async ({ page }) => {
    await freshVisitor(page, true);
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/");

    const main = page.locator("main");
    await expect(main).toContainText("Войди в аккаунт, чтобы видеть свой прогресс");
    await expect(main).toContainText("Тема дня");
    await expect(main).toContainText("Пример задания");
    await expect(main).toContainText("Скоро здесь появятся посты трейдеров");
    await expect(main).toContainText("Не является финансовой рекомендацией");

    // No personal data anywhere on the page (local guest profile stays hidden)
    await expect(page.locator("body")).not.toContainText("GuestZed");
    await expect(main).not.toContainText("Ежедневная награда");
    await expect(main).not.toContainText("Твой персонаж");
  });

  test("'Продолжить без входа' switches to the local guest dashboard", async ({ page }) => {
    await freshVisitor(page, true);
    await page.goto("/");
    await page.getByRole("button", { name: "Продолжить без входа" }).click();
    await expect(page.locator("body")).toContainText("GuestZed");
    await expect(page.locator("main")).toContainText("Твой персонаж");
    // Shared blocks are rendered once, not duplicated
    await expect(page.locator("main h4", { hasText: "Тема дня" })).toHaveCount(1);
  });

  test("other sections still require sign-in or the guest choice", async ({ page }) => {
    await freshVisitor(page);
    await page.goto("/journal");
    await page.waitForURL("**/login**", { timeout: 5000 });
  });

  test("360px: no horizontal overflow, sign-in button tappable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await freshVisitor(page);
    await page.goto("/");
    const signIn = page.locator("main").getByRole("link", { name: "Войти" });
    await expect(signIn).toBeVisible();
    const box = await signIn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
