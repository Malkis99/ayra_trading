import { test, expect, type Page } from "@playwright/test";

// Profile: hero + five tabs (overview, character, wardrobe, achievements, settings).

async function freshProfile(page: Page) {
  await page.goto("/profile");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/profile");
  await expect(page.getByTestId("profile-nickname")).toBeVisible();
}

const TABS = ["Обзор", "Персонаж", "Гардероб", "Достижения", "Настройки"];

async function look(page: Page, locator = page.locator("main section[aria-label='Твой персонаж'] [data-character]")) {
  return locator.first().getAttribute("data-character");
}

test.describe("Profile", () => {
  test("hero and all five tabs are visible; each tab opens; ?tab= is kept on reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshProfile(page);
    const tablist = page.getByRole("tablist", { name: "Разделы профиля" });
    for (const name of TABS) await expect(tablist.getByRole("tab", { name })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ещё" })).toHaveCount(0);

    await expect(page.getByTestId("overview-trader")).toBeVisible();
    await expect(page.getByTestId("overview-goals")).toBeVisible();
    await expect(page.getByTestId("overview-achievements")).toBeVisible();
    await expect(page.getByTestId("overview-quests")).toBeVisible();

    await tablist.getByRole("tab", { name: "Достижения" }).click();
    await expect(page).toHaveURL(/tab=achievements/);
    await expect(page.getByTestId("achievement-card")).toHaveCount(14);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Достижения" })).toHaveAttribute("aria-selected", "true");
  });

  test("character editor: preview changes at once, the character changes only after Save; Reset reverts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshProfile(page);
    const before = await look(page);
    await page.getByRole("button", { name: "Изменить персонажа" }).click();
    await expect(page).toHaveURL(/tab=character/);

    const preview = page.getByRole("img", { name: "Предпросмотр" }).locator("[data-character]");
    await page.getByRole("button", { name: "Дреды" }).click();
    await expect(preview).toHaveAttribute("data-character", /hair_dreads/);
    expect(await look(page)).toBe(before);

    await page.getByRole("button", { name: "Сбросить" }).click();
    await expect(preview).toHaveAttribute("data-character", before!);

    await page.getByRole("button", { name: "Дреды" }).click();
    await page.getByRole("button", { name: "Бирюзовый" }).click();
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => look(page)).toMatch(/hair_dreads hair_cyan/);
    // the same character in the sidebar
    await expect(page.locator("aside [data-character]").first()).toHaveAttribute("data-character", /hair_dreads hair_cyan/);
    await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });

  test("wardrobe: equip and take off in one click", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshProfile(page);
    await page.getByRole("tab", { name: "Гардероб" }).click();
    const firstAvailable = page.locator('[data-testid="wardrobe-item"][data-state="available"]').first();
    const name = await firstAvailable.locator("p").first().innerText();
    await firstAvailable.getByRole("button", { name: "Надеть" }).click();
    const card = page.locator('[data-testid="wardrobe-item"]', { hasText: name }).first();
    await expect(card).toHaveAttribute("data-state", "equipped");
    await card.getByRole("button", { name: "Снять" }).click();
    await expect(card).toHaveAttribute("data-state", "available");

    await page.getByRole("button", { name: "Закрыто" }).click();
    const locked = page.locator('[data-testid="wardrobe-item"]');
    await expect(locked.first()).toHaveAttribute("data-state", "locked");
    await expect(locked.first().getByRole("button")).toHaveCount(0);
  });

  test("settings: nickname is Latin only and updates the hero", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshProfile(page);
    await page.getByRole("tab", { name: "Настройки" }).click();
    const nick = page.getByLabel("Никнейм");
    await nick.fill("Трейдер");
    await expect(page.getByText("Только латиница, цифры и _ . -")).toBeVisible();
    await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await nick.fill("Nova_Trader");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByTestId("profile-nickname")).toHaveText("Nova_Trader");
    // guests have no account to delete: they get the sign-in entry instead
    await expect(page.getByRole("button", { name: "Удалить аккаунт" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Войти для сохранения данных в облаке" })).toBeVisible();
  });

  test("360px: no horizontal scroll on any tab", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await freshProfile(page);
    for (const name of TABS) {
      await page.getByRole("tab", { name }).click();
      await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
      const overflow = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
      });
      expect(overflow, name).toBeLessThanOrEqual(0);
    }
  });
});
