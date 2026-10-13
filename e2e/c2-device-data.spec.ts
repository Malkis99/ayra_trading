import { test, expect, type Page } from "@playwright/test";

const USER_ID = "mock-user-id-c2";

/** Seeds a guest profile and a signed-in mock account (with cloud nickname) before any app script runs. */
async function seed(page: Page, opts: { accountData?: boolean } = {}) {
  await page.addInitScript(
    ({ userId, accountData }) => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
      if (sessionStorage.getItem("e2e_seeded")) return;
      sessionStorage.setItem("e2e_seeded", "1");
      localStorage.setItem("ayra_guest_dismissed", "1");
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({ name: "GuestZed", level: 3, xp: 40, onboarding: { status: "done", answers: { nickname: "GuestZed" } } })
      );
      const now = new Date().toISOString();
      localStorage.setItem(
        "ayra_mock_auth_v1",
        JSON.stringify({
          user: { id: userId, email: "c2@example.com", created_at: now },
          profile: {
            id: userId,
            nickname: "CloudNick",
            locale: "ru",
            timezone: "UTC",
            age_group: "25-34",
            minor_mode: false,
            consent_at: now,
            consent_version: "1.0-draft",
            created_at: now,
            updated_at: now,
          },
        })
      );
      if (accountData) {
        localStorage.setItem(
          `ayra:${userId}:ayra_demo_v1`,
          JSON.stringify({ name: "CloudNick", level: 5, xp: 10, onboarding: { status: "done", answers: {} } })
        );
      }
    },
    { userId: USER_ID, accountData: !!opts.accountData }
  );
}

const card = (page: Page) => page.locator(".card", { hasText: "Данные на этом устройстве" });

test.describe("C2 Settings: data on this device", () => {
  test("shows the guest summary, exports JSON and copies the guest into an empty account", async ({ page }) => {
    await seed(page);
    await page.goto("/settings");
    await expect(card(page)).toContainText("GuestZed");

    const downloadPromise = page.waitForEvent("download");
    await card(page).getByRole("button", { name: "Экспортировать" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^ayra-guest-\d{4}-\d{2}-\d{2}\.json$/);

    await card(page).getByRole("button", { name: "Скопировать в аккаунт" }).click();
    await expect(card(page)).toContainText("Данные гостя скопированы в аккаунт");
    await expect(card(page).getByRole("button", { name: "Скопировать в аккаунт" })).toHaveCount(0);

    const account = await page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`)!), USER_ID);
    expect(account.name).toBe("CloudNick");
    expect(account.level).toBe(3);
  });

  test("hides copy when the account already has data; deletes guest data after typed confirmation", async ({ page }) => {
    await seed(page, { accountData: true });
    await page.goto("/settings");
    await expect(card(page)).toContainText("GuestZed");
    await expect(card(page).getByRole("button", { name: "Скопировать в аккаунт" })).toHaveCount(0);

    await card(page).getByRole("button", { name: "Удалить данные гостя" }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Удалить данные гостя" });
    await expect(confirm).toBeDisabled();
    await dialog.locator("input").fill("УДАЛИТЬ");
    await confirm.click();

    await expect(card(page)).toContainText("Гостевых данных на устройстве нет");
    const guest = await page.evaluate(() => localStorage.getItem("ayra_demo_v1"));
    expect(guest).toBeNull();
    const account = await page.evaluate((id) => localStorage.getItem(`ayra:${id}:ayra_demo_v1`), USER_ID);
    expect(account).not.toBeNull();
  });

  test("signs out and deletes account data from the device, guest data stays", async ({ page }) => {
    await seed(page, { accountData: true });
    await page.goto("/settings");

    await card(page).getByRole("button", { name: "Выйти и удалить данные аккаунта с этого устройства" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("input").fill("ВЫЙТИ");
    await dialog.getByRole("button", { name: "Выйти и удалить", exact: true }).click();

    await expect
      .poll(() => page.evaluate((id) => Object.keys(localStorage).filter((k) => k.startsWith(`ayra:${id}:`)).length, USER_ID))
      .toBe(0);
    const guest = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1")!));
    expect(guest.name).toBe("GuestZed");
  });

  test("360px layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed(page);
    await page.goto("/settings");
    await expect(card(page)).toContainText("GuestZed");
    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
