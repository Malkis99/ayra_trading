import { test, expect, type Page } from "@playwright/test";

// Profile: tabs on top, the sticky character stage on the left (all tabs), the active tab on the right.

async function freshProfile(page: Page, path = "/profile") {
  await page.goto("/profile");
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await expect(page.getByTestId("profile-stage")).toBeVisible();
}

const TABS = ["Обзор", "Статистика", "Гардероб", "Достижения", "Редактировать профиль"];
const stageLook = (page: Page) => page.getByTestId("profile-stage").locator("[data-character]").first();
const sidebarLook = (page: Page) => page.locator("aside [data-character]").first();

async function signInAndOnboard(page: Page, email: string, nick: string) {
  await page.addInitScript(() => {
    (window as unknown as { __AYRA_E2E_AUTH_MOCK__: boolean }).__AYRA_E2E_AUTH_MOCK__ = true;
  });
  await page.goto("/login");
  await page.fill("#email-input", email);
  await page.click("input[type='checkbox']");
  await page.click("button[type='submit']");
  await page.fill("#otp-input", "123456");
  await page.click("button[type='submit']");
  await page.waitForURL((u) => u.pathname === "/awakening", { timeout: 10000 });
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill(nick);
  for (const s of ["Продолжить", "Продолжить", "Продолжить", "18–24 года", "Продолжить", "Пропустить шаг целиком", "1–2 года", "Продолжить", "Крипто", "Продолжить", "Дисциплина", "Продолжить", "Пропустить необязательные вопросы", "Пропустить шаг целиком"])
    await page.click(`button:has-text("${s}")`);
  await page.getByRole("button", { name: "Пропустить анимацию" }).click();
  await page.getByRole("button", { name: "Начать" }).click();
  await page.waitForURL((u) => u.pathname === "/");
}

test.describe("Profile", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("five tabs on top; the stage stays on every tab; ?tab= survives a reload; old links still work", async ({ page }) => {
    await freshProfile(page);
    const tablist = page.getByRole("tablist", { name: "Разделы профиля" });
    for (const name of TABS) await expect(tablist.getByRole("tab", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ещё" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Изменить персонажа" })).toHaveCount(0);

    for (const name of TABS) {
      await tablist.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByTestId("profile-stage")).toHaveCount(1);
      await expect(page.getByTestId("profile-stage")).toBeVisible();
    }
    await expect(page.getByTestId("profile-stage").locator("[data-character]")).toHaveCount(2); // front + back of one figure

    await tablist.getByRole("tab", { name: "Статистика" }).click();
    await expect(page.getByRole("heading", { name: "Профиль активности" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tab", { name: "Статистика" })).toHaveAttribute("aria-selected", "true");

    await page.goto("/profile?tab=settings");
    await expect(page.getByRole("tab", { name: "Редактировать профиль" })).toHaveAttribute("aria-selected", "true");
  });

  test("overview: header with nickname, pencil to edit, rank, level and XP; journal numbers", async ({ page }) => {
    await freshProfile(page);
    const header = page.getByTestId("overview-header");
    await expect(header.getByTestId("profile-nickname")).toHaveText("TraderOne");
    await expect(header).toContainText("Новичок пути");
    await expect(header).toContainText("Уровень 1");
    await expect(header.getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("overview-trader")).toContainText("Сделки");
    await header.getByRole("button", { name: "Редактировать профиль" }).click();
    await expect(page.getByRole("tab", { name: "Редактировать профиль" })).toHaveAttribute("aria-selected", "true");
  });

  test("appearance in Wardrobe: stage shows the draft at once; Save applies everywhere; Reset reverts", async ({ page }) => {
    await freshProfile(page, "/profile?tab=wardrobe");
    const before = await sidebarLook(page).getAttribute("data-character");
    const section = page.getByTestId("appearance-section");
    await section.getByRole("button", { name: "Дреды" }).click();
    await expect(stageLook(page)).toHaveAttribute("data-character", /hair_dreads/);
    await expect(sidebarLook(page)).toHaveAttribute("data-character", before!);
    await section.getByRole("button", { name: "Сбросить" }).click();
    await expect(stageLook(page)).toHaveAttribute("data-character", before!);

    await section.getByRole("button", { name: "Дреды" }).click();
    await section.getByRole("button", { name: "Бирюзовый" }).click();
    await section.getByRole("button", { name: "Сохранить" }).click();
    await expect(sidebarLook(page)).toHaveAttribute("data-character", /hair_dreads hair_cyan/);
    await expect(section.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });

  test("unsaved appearance: Stay, Discard and Save (tab switch and app link)", async ({ page }) => {
    await freshProfile(page, "/profile?tab=wardrobe");
    const before = await sidebarLook(page).getAttribute("data-character");
    const section = page.getByTestId("appearance-section");
    const dialog = page.getByTestId("unsaved-dialog");

    await section.getByRole("button", { name: "Дреды" }).click();
    await page.getByRole("tab", { name: "Достижения" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Остаться" }).last().click();
    await expect(page.getByRole("tab", { name: "Гардероб" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Достижения" }).click();
    await dialog.getByRole("button", { name: "Отбросить" }).click();
    await expect(page.getByRole("tab", { name: "Достижения" })).toHaveAttribute("aria-selected", "true");
    await expect(stageLook(page)).toHaveAttribute("data-character", before!);

    await page.getByRole("tab", { name: "Гардероб" }).click();
    await section.getByRole("button", { name: "Дреды" }).click();
    await page.locator("aside").getByRole("link", { name: "Журнал" }).click();
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await page.waitForURL((u) => u.pathname === "/journal");
    await expect(sidebarLook(page)).toHaveAttribute("data-character", /hair_dreads/);
  });

  test("equipment slot: chooser opens from the stage, equip shows on the character at once, take off", async ({ page }) => {
    await freshProfile(page);
    const slots = page.locator('[data-testid="stage-slot"]').filter({ visible: true });
    await expect(slots).toHaveCount(10);
    const head = slots.and(page.locator('[data-slot="Голова"]'));
    await expect(head).toHaveAttribute("data-filled", "false");
    const gearBefore = await stageLook(page).getAttribute("data-equipment");
    await head.click();
    const picker = page.getByTestId("slot-picker");
    await expect(picker).toBeVisible();
    await picker.locator('[data-testid="slot-item"][data-state="available"]').first().getByRole("button", { name: "Надеть" }).click();
    await expect(stageLook(page)).not.toHaveAttribute("data-equipment", gearBefore ?? "");
    await expect(head).toHaveAttribute("data-filled", "true");
    await picker.getByRole("button", { name: "Снять" }).click();
    await expect(head).toHaveAttribute("data-filled", "false");
    await expect(picker.locator('[data-state="locked"]').first()).toContainText("Откроется на уровне");
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
  });

  test("stage: background choice is saved; locked ones cannot be chosen; turning with the buttons", async ({ page }) => {
    await freshProfile(page);
    const stage = page.getByTestId("profile-stage");
    await page.locator('[data-testid="stage-bg-option"][data-bg="deep_space"]').click();
    await expect(stage).toHaveAttribute("data-background", "deep_space");
    const locked = page.locator('[data-testid="stage-bg-option"][data-bg="gold_dawn"]');
    await expect(locked).toHaveAttribute("aria-disabled", "true");
    await locked.click({ force: true });
    await expect(stage).toHaveAttribute("data-background", "deep_space");
    await page.reload();
    await expect(page.getByTestId("profile-stage")).toHaveAttribute("data-background", "deep_space");

    await page.getByRole("button", { name: "Повернуть вправо" }).click();
    const turner = page.getByTestId("profile-stage").locator('[style*="rotateY"]').first();
    await expect(turner).toHaveAttribute("style", /rotateY\(45deg\)/);
    await page.getByRole("button", { name: "Вернуть анфас" }).click();
    await expect(turner).toHaveAttribute("style", /rotateY\(0deg\)/);
  });

  test("edit profile (guest): bio and nickname save, show in the overview and sidebar, survive a reload; 14-day lock", async ({ page }) => {
    await freshProfile(page, "/profile?tab=edit");
    const form = page.getByTestId("edit-profile");
    await form.getByLabel("О себе").fill("Учусь торговать по плану");
    await form.getByTestId("edit-nickname").fill("Трейдер");
    await expect(form.getByText("Только латиница, цифры и _ . -")).toBeVisible();
    await expect(form.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await form.getByTestId("edit-nickname").fill("Nova_Trader");
    await form.getByLabel("Telegram").fill("x");
    await expect(form.getByText("Не похоже на профиль Telegram")).toBeVisible();
    await form.getByLabel("Telegram").fill("https://t.me/nova_trader");
    await form.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Профиль сохранён")).toBeVisible();

    await expect(page.locator("aside").first()).toContainText("Nova_Trader");
    await page.reload();
    await expect(form.getByLabel("О себе")).toHaveValue("Учусь торговать по плану");
    await expect(form.getByLabel("Telegram")).toHaveValue("@nova_trader");
    // next change only in 14 days
    await expect(form.getByTestId("edit-nickname")).toBeDisabled();
    await expect(form).toContainText("Ник можно сменить через 14 дн.");

    await page.getByRole("tab", { name: "Обзор" }).click();
    await expect(page.getByTestId("profile-nickname")).toHaveText("Nova_Trader");
    await expect(page.getByTestId("profile-bio")).toHaveText("Учусь торговать по плану");
  });

  test("edit profile: my posts can be deleted after confirmation; no app settings duplicated here", async ({ page }) => {
    await freshProfile(page);
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}");
      st.posts = ["Первый разбор недели", "Второй пост"];
      localStorage.setItem("ayra_demo_v1", JSON.stringify(st));
    });
    await page.goto("/profile?tab=edit");
    const form = page.getByTestId("edit-profile");
    for (const gone of ["Язык", "Часовой пояс", "Режим 16–17", "Уведомления", "Экспорт данных"]) await expect(form.getByText(gone, { exact: true })).toHaveCount(0);
    const list = page.getByTestId("my-posts");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await list.getByRole("listitem").first().getByRole("button", { name: "Удалить" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Второй пост");
  });

  test("signed-in: nickname goes to the account, updates the sidebar and is locked for 14 days after a change", async ({ page }) => {
    await signInAndOnboard(page, "nick_change@example.com", "First_Nick");
    await page.goto("/profile?tab=edit");
    const form = page.getByTestId("edit-profile");
    // the first change after onboarding is allowed at once
    await expect(form.getByTestId("edit-nickname")).toBeEnabled();
    await form.getByTestId("edit-nickname").fill("taken_nick");
    await form.getByRole("button", { name: "Сохранить" }).click();
    await expect(form.getByText("Этот ник уже занят. Выбери другой.")).toBeVisible();
    await form.getByTestId("edit-nickname").fill("Second_Nick");
    await form.getByLabel("О себе").fill("Аккаунт");
    await form.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("aside").first()).toContainText("Second_Nick");
    await expect(form.getByTestId("edit-nickname")).toBeDisabled();
    await page.reload();
    await expect(page.locator("aside").first()).toContainText("Second_Nick");
    await expect(form.getByLabel("О себе")).toHaveValue("Аккаунт");
    await expect(form.getByTestId("edit-nickname")).toBeDisabled();
  });

  test("360px: stage on top, slots in a row, tabs below; no horizontal scroll on any tab", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await freshProfile(page);
    const stage = await page.getByTestId("profile-stage").boundingBox();
    const tabs = await page.getByRole("tablist", { name: "Разделы профиля" }).boundingBox();
    expect(stage!.y).toBeLessThan(tabs!.y);
    expect(stage!.height).toBeGreaterThan(740 * 0.4);
    for (const name of TABS) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      const overflow = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
      });
      expect(overflow, name).toBeLessThanOrEqual(0);
    }
  });

  test("onboarding: going back and changing the nickname does not start the 14 days; the first change after it is free", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __AYRA_E2E_AUTH_MOCK__: boolean }).__AYRA_E2E_AUTH_MOCK__ = true;
    });
    await page.goto("/login");
    await page.fill("#email-input", "back_and_forth@example.com");
    await page.click("input[type='checkbox']");
    await page.click("button[type='submit']");
    await page.fill("#otp-input", "123456");
    await page.click("button[type='submit']");
    await page.waitForURL((u) => u.pathname === "/awakening", { timeout: 10000 });
    const nick = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
    await nick.fill("Draft_One");
    await page.click('button:has-text("Продолжить")');
    await page.getByRole("button", { name: "Назад" }).click();
    await nick.fill("Draft_Two");
    for (const s of ["Продолжить", "Продолжить", "Продолжить", "18–24 года", "Продолжить", "Пропустить шаг целиком", "1–2 года", "Продолжить", "Крипто", "Продолжить", "Дисциплина", "Продолжить", "Пропустить необязательные вопросы", "Пропустить шаг целиком"])
      await page.click(`button:has-text("${s}")`);
    await page.getByRole("button", { name: "Пропустить анимацию" }).click();
    await page.getByRole("button", { name: "Начать" }).click();
    await page.waitForURL((u) => u.pathname === "/");

    const server = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_mock_auth_v1") || "{}").profile);
    expect(server.nickname).toBe("Draft_Two");
    expect(server.nickname_changed_at ?? null).toBeNull();

    await page.goto("/profile?tab=edit");
    const form = page.getByTestId("edit-profile");
    await expect(form.getByTestId("edit-nickname")).toBeEnabled();
    await expect(form.getByTestId("edit-nickname")).toHaveValue("Draft_Two");
  });

  test("before migration 0003 (no server column): the 14-day rule still holds from the local date", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __AYRA_MOCK_BEFORE_0003__: boolean }).__AYRA_MOCK_BEFORE_0003__ = true;
    });
    await signInAndOnboard(page, "before_0003@example.com", "Old_Nick");
    await page.goto("/profile?tab=edit");
    const form = page.getByTestId("edit-profile");
    await form.getByTestId("edit-nickname").fill("New_Nick");
    await form.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("aside").first()).toContainText("New_Nick");
    const server = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_mock_auth_v1") || "{}").profile);
    expect(server.nickname).toBe("New_Nick");
    expect("nickname_changed_at" in server).toBe(false);
    await page.reload();
    await expect(form.getByTestId("edit-nickname")).toBeDisabled();
    await expect(form).toContainText("Ник можно сменить через 14 дн.");
  });
});
