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

  test("wardrobe: title and frame are chosen in two simple rows", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshProfile(page);
    await page.getByRole("tab", { name: "Гардероб" }).click();
    const styling = page.getByTestId("wardrobe-styling");
    const frames = styling.getByRole("radiogroup", { name: "Рамка" });
    await frames.getByRole("radio", { name: "Фиолетовая" }).click();
    await expect(frames.getByRole("radio", { name: "Фиолетовая" })).toHaveAttribute("aria-checked", "true");
    await expect(styling.getByRole("radiogroup", { name: "Титул" }).getByRole("radio", { name: /Новичок пути/ })).toHaveAttribute("aria-checked", "true");
    // locked titles are shown, but cannot be chosen
    await expect(styling.getByText("Легенда")).toBeVisible();
    await expect(styling.getByRole("radio", { name: "Легенда" })).toHaveCount(0);
  });

  test("settings: my posts can be deleted after confirmation; time zone is shown in Russian", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshProfile(page);
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}");
      st.posts = ["Первый разбор недели", "Второй пост"];
      localStorage.setItem("ayra_demo_v1", JSON.stringify(st));
    });
    await page.goto("/profile?tab=settings");
    const list = page.getByTestId("my-posts");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await list.getByRole("listitem").first().getByRole("button", { name: "Удалить" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).last().click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await list.getByRole("listitem").first().getByRole("button", { name: "Удалить" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Второй пост");

    const tz = page.getByLabel("Часовой пояс");
    await expect(tz).toContainText("UTC");
    await expect(tz).not.toContainText("/");
  });

  test("unsaved character changes: Stay, Discard and Save in the dialog (tabs and app links)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await freshProfile(page);
    const before = await look(page);
    await page.getByRole("tab", { name: "Персонаж" }).click();
    await page.getByRole("button", { name: "Дреды" }).click();

    // Stay
    await page.getByRole("tab", { name: "Гардероб" }).click();
    const dialog = page.getByTestId("unsaved-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Остаться" }).last().click();
    await expect(page.getByRole("tab", { name: "Персонаж" })).toHaveAttribute("aria-selected", "true");

    // Discard
    await page.getByRole("tab", { name: "Гардероб" }).click();
    await dialog.getByRole("button", { name: "Отбросить" }).click();
    await expect(page.getByRole("tab", { name: "Гардероб" })).toHaveAttribute("aria-selected", "true");
    expect(await look(page)).toBe(before);

    // Save, leaving through a sidebar link
    await page.getByRole("tab", { name: "Персонаж" }).click();
    await page.getByRole("button", { name: "Дреды" }).click();
    await page.locator("aside").getByRole("link", { name: "Журнал" }).click();
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await page.waitForURL((u) => u.pathname === "/journal");
    await expect(page.locator("aside [data-character]").first()).toHaveAttribute("data-character", /hair_dreads/);
  });
});
