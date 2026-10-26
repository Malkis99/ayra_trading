import { test, expect, type Page } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Settings by sections (docs/settings-sections-plan.md): /settings/<section>; desktop menu on the left; phone list,
// a section screen with «← Settings»; direct links (cloud badge → Cloud and data). Fake Supabase only.

async function completeOnboarding(page: Page, nickname: string) {
  await page.waitForURL("**/awakening**", { timeout: 10000 });
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill(nickname);
  for (const b of ["Продолжить", "Продолжить", "Продолжить", "18–24 года", "Продолжить", "Пропустить шаг целиком", "1–2 года", "Продолжить", "Крипто", "Продолжить", "Дисциплина", "Продолжить", "Пропустить необязательные вопросы", "Пропустить шаг целиком", "Начать"]) {
    await page.click(`button:has-text("${b}")`);
  }
  await page.waitForURL((url) => url.pathname !== "/awakening", { timeout: 10000 });
}

const SECTIONS = [
  ["profile", "Профиль"],
  ["journal", "Журнал"],
  ["cloud", "Облако и данные"],
  ["account", "Аккаунт и безопасность"],
  ["interface", "Интерфейс"],
  ["privacy", "Приватность"],
] as const;

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

const shotDir = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
};

test.describe("Settings by sections", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);

  test("desktop: menu on the left, every section on its own address, back works; sign out here, delete data only in Cloud and data", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = `SetD_${Date.now()}@example.com`;
    await signIn(page, email);
    await completeOnboarding(page, `SetD${Date.now() % 100000}`);
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);

    await page.goto("/settings");
    const menu = page.getByTestId("settings-menu");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("settings-list")).toBeHidden();
    await expect(menu.getByRole("link", { name: "Профиль" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Профиль");
    await shot(page, "settings-sections-1440");

    for (const [slug, title] of SECTIONS) {
      await menu.getByRole("link", { name: title }).click();
      await page.waitForURL(`**/settings/${slug}`);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(title);
      await expect(menu.getByRole("link", { name: title })).toHaveAttribute("aria-current", "page");
      await noHorizontalScroll(page);
    }
    await page.goBack();
    await page.waitForURL("**/settings/interface");

    // «Sign out» in Account and security; «Sign out and delete data» only in Cloud and data
    await page.goto("/settings/account");
    await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Выйти и удалить данные аккаунта с этого устройства" })).toHaveCount(0);
    await page.goto("/settings/cloud");
    await expect(page.getByRole("button", { name: "Выйти и удалить данные аккаунта с этого устройства" })).toBeVisible();
    await shot(page, "settings-cloud-1440");

    // Journal shows where the cloud switch is now and links to it
    await page.goto("/settings/journal");
    const link = page.getByTestId("journal-settings-cloud-link");
    await expect(link).toContainText("Синхронизация с облаком: Автоматически");
    await link.getByRole("link", { name: "Изменить" }).click();
    await page.waitForURL("**/settings/cloud#mode");
    await expect(page.getByTestId("cloud-sync-mode")).toBeInViewport();

    // the cloud badge leads straight to Cloud and data
    await page.goto("/journal");
    await page.getByTestId("sync-badge").click();
    await page.getByTestId("sync-badge-settings").click();
    await page.waitForURL("**/settings/cloud");

    // unknown section: the usual «not found» page (Next streams it with status 200, like other not-found pages inside a layout)
    await page.goto("/settings/nothing-here");
    await expect(page.getByText("This page could not be found")).toBeVisible();
    await expect(page.getByTestId("settings-menu")).toHaveCount(0);
  });

  test("phone 360: list of sections with status lines → section screen with «← Settings»; the phone back returns to the list", async ({ page, request }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const email = `SetM_${Date.now()}@example.com`;
    await signIn(page, email);
    await completeOnboarding(page, `SetM${Date.now() % 100000}`);
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);

    await page.goto("/settings");
    const list = page.getByTestId("settings-list");
    await expect(list).toBeVisible();
    await expect(page.getByTestId("settings-menu")).toBeHidden();
    for (const [slug, title] of SECTIONS) await expect(page.getByTestId(`settings-list-${slug}`)).toContainText(title);
    await expect(page.getByTestId("settings-list-account")).toContainText("Пароль задан");
    await expect(page.getByTestId("settings-list-cloud")).toContainText("Автоматически");
    await noHorizontalScroll(page);
    await shot(page, "settings-list-360");

    await page.getByTestId("settings-list-account").click();
    await page.waitForURL("**/settings/account");
    await expect(page.getByTestId("settings-back")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Аккаунт и безопасность");
    await noHorizontalScroll(page);
    await shot(page, "settings-account-360");

    await page.getByTestId("settings-back").click();
    await page.waitForURL((url) => url.pathname === "/settings");
    await expect(list).toBeVisible();

    await page.getByTestId("settings-list-cloud").click();
    await page.waitForURL("**/settings/cloud");
    await noHorizontalScroll(page);
    await shot(page, "settings-cloud-360");
    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/settings");
    await expect(list).toBeVisible();
  });
});
