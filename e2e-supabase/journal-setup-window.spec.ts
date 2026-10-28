import { test, expect, type Page, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";
import { pickOption } from "../e2e/helpers/forms";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Setup plan PR 2: the first-run window of the Journal (docs/journal-setup-plan.md). e2e builds hide it unless a test
// asks for it (ayra_e2e_setup_window), so this file opts in for every page. Fake Supabase only.

async function device(browser: Browser, width = 1440, height = 900): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem("ayra_e2e_setup_window", "1"));
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height });
  return { ctx, page };
}

const q = (email: string) => encodeURIComponent(email);
const userIdOf = async (request: APIRequestContext, email: string) => ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${q(email)}`)).json()).id) as string;
const cloudTrades = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${q(email)}`)).json()) as { table: string }[]).filter((r) => r.table === "journal_trades").length;

/** An account whose device already has a journal made before the cloud (two trades). */
async function seedJournal(page: Page, userId: string) {
  await page.evaluate((id) => {
    const now = "2026-10-01T00:00:00.000Z";
    const trade = (tid: string) => ({ id: tid, accountId: "acc_main", instrument: "EURUSD", direction: "long", openedAt: now, pnlMoney: 10, status: "closed", createdAt: now, updatedAt: now, deletedAt: null, schemaVersion: 6 });
    localStorage.setItem(
      `ayra:${id}:ayra_journal_v1`,
      JSON.stringify({
        schemaVersion: 6,
        accounts: [{ id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: now, updatedAt: now, deletedAt: null }],
        trades: [trade("t1"), trade("t2")],
      })
    );
  }, userId);
}

const shotDir = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
};

test.describe("Journal first-run setup window", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("new account, cloud off: once; «?» hints; Save applies unit and session; not again after reload", async ({ browser }) => {
    const { ctx, page } = await device(browser);
    const email = `Setup1_${Date.now()}@example.com`;
    await signIn(page, email);
    await completeOnboarding(page, `Su1${Date.now() % 100000}`, { after: "left" });
    await page.goto("/journal");
    const win = page.getByTestId("journal-setup");
    await expect(win).toBeVisible({ timeout: 15000 });
    await expect(win).toContainText("Настроим Журнал");
    await expect(page.getByTestId("journal-setup-cloud")).toHaveCount(0); // cloud off: no cloud question
    await expect(page.getByTestId("journal-setup-account")).toHaveCount(0); // no accounts yet: nothing to choose

    await win.getByRole("button", { name: "Подсказка: Показатель результата по умолчанию" }).hover();
    await expect(win).toContainText("R — результат в рисках сделки");
    await page.keyboard.press("Escape"); // closes the hint, not the window
    await expect(win).toBeVisible();
    await shot(page, "setup-full-1440");

    await page.getByTestId("journal-setup-unit").getByRole("radio", { name: "$" }).click();
    await pickOption(page, "journal-setup-session-select", "Лондон");
    await page.getByTestId("journal-setup-save").click();
    await expect(win).toBeHidden();
    await expect(page.getByRole("radiogroup", { name: "Единицы" }).getByRole("radio", { name: "$" })).toHaveAttribute("aria-checked", "true");

    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("journal-setup")).toHaveCount(0);
    await page.goto("/settings/journal");
    await expect(page.getByTestId("journal-settings-session-select")).toContainText("Лондон");
    await ctx.close();
  });

  test("Skip changes nothing and the window does not come back", async ({ browser }) => {
    const { ctx, page } = await device(browser);
    const email = `Setup2_${Date.now()}@example.com`;
    await signIn(page, email);
    await completeOnboarding(page, `Su2${Date.now() % 100000}`, { after: "left" });
    await page.goto("/journal");
    await expect(page.getByTestId("journal-setup")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("journal-setup-skip").click();
    await expect(page.getByTestId("journal-setup")).toBeHidden();
    await expect(page.getByRole("radiogroup", { name: "Единицы" }).getByRole("radio", { name: "R" })).toHaveAttribute("aria-checked", "true");
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("journal-setup")).toHaveCount(0);
    await ctx.close();
  });

  test("cloud off, existing journal: no window; guest: no window", async ({ browser, request }) => {
    const { ctx, page } = await device(browser);
    const email = `Setup3_${Date.now()}@example.com`;
    await signIn(page, email);
    await completeOnboarding(page, `Su3${Date.now() % 100000}`, { after: "left" });
    await seedJournal(page, await userIdOf(request, email));
    await page.goto("/journal");
    await expect(page.getByTestId("trades-table")).toContainText("EURUSD");
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("journal-setup")).toHaveCount(0);
    await ctx.close();

    const g = await device(browser);
    await g.page.goto("/login");
    await g.page.getByRole("button", { name: "Продолжить без входа" }).click();
    await g.page.waitForURL((url) => url.pathname !== "/login");
    await g.page.goto("/journal");
    await g.page.waitForTimeout(2000);
    await expect(g.page.getByTestId("journal-setup")).toHaveCount(0);
    await g.ctx.close();
  });

  test("cloud on, journal not in the cloud: «Automatic» uploads at once with progress; «Manual» uploads nothing", async ({ browser, request }) => {
    // Automatic
    {
      const { ctx, page } = await device(browser);
      const email = `Setup4a_${Date.now()}@example.com`;
      await signIn(page, email);
      await completeOnboarding(page, `Su4a${Date.now() % 100000}`, { after: "left" });
      await seedJournal(page, await userIdOf(request, email));
      await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
      await page.goto("/journal");
      const win = page.getByTestId("journal-setup");
      await expect(win).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("journal-setup-cloud").getByRole("radio", { name: "Автоматически" })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("journal-setup-upload-note")).toContainText("начнёт загружаться в облако");
      await expect(page.getByTestId("journal-setup-backup")).toBeVisible();
      await shot(page, "setup-cloud-1440");
      await page.getByTestId("journal-setup-save").click();
      // the upload window starts by itself (nothing in the cloud yet): no «Upload» click
      await expect(page.getByTestId("initial-sync-done")).toContainText("Готово: журнал в облаке", { timeout: 20000 });
      expect(await cloudTrades(request, email)).toBe(2);
      await ctx.close();
    }
    // Manual
    {
      const { ctx, page } = await device(browser);
      const email = `Setup4m_${Date.now()}@example.com`;
      await signIn(page, email);
      await completeOnboarding(page, `Su4m${Date.now() % 100000}`, { after: "left" });
      await seedJournal(page, await userIdOf(request, email));
      await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
      await page.goto("/journal");
      await expect(page.getByTestId("journal-setup")).toBeVisible({ timeout: 15000 });
      await page.getByTestId("journal-setup-cloud").getByRole("radio", { name: "Вручную" }).click();
      await expect(page.getByTestId("journal-setup-upload-note")).toContainText("когда ты нажмёшь «Загрузить в облако»");
      await page.getByTestId("journal-setup-save").click();
      await expect(page.getByTestId("journal-setup")).toBeHidden();
      await page.waitForTimeout(4000);
      expect(await cloudTrades(request, email)).toBe(0);
      await expect(page.getByTestId("initial-sync-dialog")).toHaveCount(0);
      await expect(page.getByTestId("initial-sync-button")).toBeVisible();
      await page.goto("/settings/cloud");
      await expect(page.getByTestId("cloud-sync-mode").getByRole("radio", { name: "Вручную" })).toHaveAttribute("aria-checked", "true");
      await ctx.close();
    }
  });

  test("second device with the cloud on: settings come from the cloud, only the cloud question; 360px fits", async ({ browser, request }) => {
    const A = await device(browser);
    const email = `Setup5_${Date.now()}@example.com`;
    await signIn(A.page, email);
    await completeOnboarding(A.page, `Su5${Date.now() % 100000}`, { after: "left" });
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
    await A.page.goto("/journal");
    await expect(A.page.getByTestId("journal-setup")).toBeVisible({ timeout: 15000 });
    await A.page.getByTestId("journal-setup-unit").getByRole("radio", { name: "%" }).click();
    await A.page.getByTestId("journal-setup-save").click();
    await expect.poll(async () => {
      const rows = (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${q(email)}`)).json()) as { table: string; data: { preferences?: { defaultUnit?: string } } }[];
      return rows.find((r) => r.table === "journal_settings")?.data.preferences?.defaultUnit;
    }, { timeout: 15000 }).toBe("percent");

    const B = await device(browser, 360, 740);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await B.page.goto("/journal");
    const win = B.page.getByTestId("journal-setup");
    await expect(win).toBeVisible({ timeout: 15000 });
    await expect(win).toContainText("Настройки Журнала уже пришли с другого устройства");
    await expect(B.page.getByTestId("journal-setup-cloud")).toBeVisible();
    await expect(B.page.getByTestId("journal-setup-unit")).toHaveCount(0);
    expect(await B.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const save = (await B.page.getByTestId("journal-setup-save").boundingBox())!;
    expect(save.x + save.width).toBeLessThanOrEqual(360);
    await shot(B.page, "setup-cloud-only-360");
    await B.page.getByTestId("journal-setup-save").click();
    await expect(win).toBeHidden();
    await expect(B.page.getByRole("radiogroup", { name: "Единицы" }).getByRole("radio", { name: "%" })).toHaveAttribute("aria-checked", "true");
    await A.ctx.close();
    await B.ctx.close();
  });
});
