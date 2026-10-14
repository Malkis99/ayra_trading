import { test, expect, type Page } from "@playwright/test";

// The same character (appearance + equipment) must be drawn everywhere: sidebar, top bar, Home, Profile, Wardrobe.
const CUSTOM = "skin_deep hair_dreads hair_cyan outfit_crimson";

async function freshGuest(page: Page) {
  await page.goto("/awakening");
  await page.evaluate(() => localStorage.clear());
}

async function onboardWithCustomLook(page: Page) {
  await page.goto("/awakening");
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill("Look_Tester");
  await page.click('button:has-text("Продолжить")');
  await expect(page.getByRole("heading", { name: "Язык и часовой пояс" })).toBeVisible();
  await page.click('button:has-text("Продолжить")');
  await expect(page.getByRole("heading", { name: "Создай своего персонажа" })).toBeVisible();

  // Appearance: non-default presets in every category
  await page.getByRole("button", { name: "Глубокий тёмный" }).click();
  await page.getByRole("button", { name: "Бирюзовый" }).click();
  await page.getByRole("button", { name: "Дреды" }).click();
  await page.getByRole("button", { name: /Багровый рассвет/ }).click();
  await expect(page.locator("[data-character]").first()).toHaveAttribute("data-character", CUSTOM);
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

  // Finale shows the same character
  await expect(page.locator("[data-character]").first()).toHaveAttribute("data-character", CUSTOM);
  await page.click('button:has-text("Начать")');
  await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
}

async function allCharacters(page: Page) {
  return page.locator("[data-character]").evaluateAll((els) =>
    els.map((el) => ({
      where: el.closest("aside") ? "sidebar" : el.closest("header") ? "topbar" : "main",
      look: el.getAttribute("data-character"),
      gear: el.getAttribute("data-equipment"),
    }))
  );
}

test.describe("One character everywhere", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("custom look from onboarding is shown in sidebar, top bar, Home and Profile; gear changes update everywhere", async ({ page }) => {
    await freshGuest(page);
    await onboardWithCustomLook(page);

    const home = await allCharacters(page);
    expect(home.map((c) => c.where).sort()).toEqual(["main", "sidebar", "topbar"]);
    for (const c of home) expect(c.look, c.where).toBe(CUSTOM);

    await page.goto("/profile");
    await expect(page.locator("main [data-character]").first()).toBeVisible();
    const profile = await allCharacters(page);
    // sidebar + top bar + the profile hero
    expect(profile.length).toBeGreaterThanOrEqual(3);
    for (const c of profile) expect(c.look, c.where).toBe(CUSTOM);

    // Wardrobe: equip an item -> the same gear everywhere immediately, look unchanged
    await page.getByRole("tab", { name: "Гардероб" }).or(page.getByRole("button", { name: "Гардероб" })).first().click();
    const before = (await allCharacters(page)).find((c) => c.where === "sidebar")!.gear;
    await page.getByRole("button", { name: "Надеть", exact: true }).first().click();
    await expect
      .poll(async () => (await allCharacters(page)).find((c) => c.where === "sidebar")!.gear)
      .not.toBe(before);
    const after = await allCharacters(page);
    const sidebarGear = after.find((c) => c.where === "sidebar")!.gear;
    for (const c of after) {
      expect(c.look, c.where).toBe(CUSTOM);
      expect(c.gear, c.where).toBe(sidebarGear);
    }

    // Survives a reload (same saved state, no defaults on first render)
    await page.reload();
    await expect(page.locator("main [data-character]").first()).toBeVisible();
    for (const c of await allCharacters(page)) {
      expect(c.look, c.where).toBe(CUSTOM);
      expect(c.gear, c.where).toBe(sidebarGear);
    }
  });
});
