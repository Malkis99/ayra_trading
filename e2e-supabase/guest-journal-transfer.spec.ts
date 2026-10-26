import { test, expect, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Variant A (owner decision 2026-10-25): the guest JOURNAL moves into the account and goes to the cloud like any
// other change; the cloud badge tells the truth; the guest's level, XP and Coins are not moved. Fake Supabase only.

async function completeOnboarding(page: Page, nickname: string) {
  await page.waitForURL("**/awakening**", { timeout: 10000 });
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill(nickname);
  for (const b of ["Продолжить", "Продолжить", "Продолжить", "18–24 года", "Продолжить", "Пропустить шаг целиком", "1–2 года", "Продолжить", "Крипто", "Продолжить", "Дисциплина", "Продолжить", "Пропустить необязательные вопросы", "Пропустить шаг целиком", "Начать"]) {
    await page.click(`button:has-text("${b}")`);
  }
  await page.waitForURL((url) => url.pathname !== "/awakening", { timeout: 10000 });
}

/** A device with guest data: level 3, 40 XP, 25 Coins and a journal of one account and two trades. */
async function guestDevice(browser: Browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    if (localStorage.getItem("e2e_seeded_guest")) return;
    localStorage.setItem("e2e_seeded_guest", "1");
    localStorage.setItem("ayra_guest_dismissed", "1");
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({ name: "GuestZed", level: 3, xp: 40, coins: 25, onboarding: { status: "done", step: 5, subStep: 0, answers: { nickname: "GuestZed", language: "ru" } } })
    );
    const now = "2026-10-01T00:00:00.000Z";
    const trade = (id: string) => ({ id, accountId: "acc_g", instrument: "EURUSD", direction: "long", openedAt: now, pnlMoney: 10, status: "closed", createdAt: now, updatedAt: now, deletedAt: null, schemaVersion: 6 });
    localStorage.setItem(
      "ayra_journal_v1",
      JSON.stringify({
        schemaVersion: 6,
        accounts: [{ id: "acc_g", name: "Guest acc", type: "personal", currency: "USD", platform: "manual", createdAt: now, updatedAt: now, deletedAt: null }],
        trades: [trade("tg1"), trade("tg2")],
      })
    );
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { ctx, page };
}

const q = (email: string) => encodeURIComponent(email);
const cloudLiveTrades = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${q(email)}`)).json()) as { table: string; data: { deletedAt?: string | null } }[]).filter(
    (r) => r.table === "journal_trades" && !r.data.deletedAt
  ).length;
const accountGame = (page: Page, userId: string) => page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`) || "{}"), userId);

test.describe("Guest journal into the account (variant A)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("after onboarding: «Move the guest journal» → trades in the cloud, badge «saved»; level, XP and Coins stay with the guest", async ({ browser, request }) => {
    const { ctx, page } = await guestDevice(browser);
    const email = `GMove_${Date.now()}@example.com`;
    await signIn(page, email);
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
    await completeOnboarding(page, `GMv${Date.now() % 100000}`);
    await page.waitForURL("**/profile-select**", { timeout: 10000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Перенести журнал гостя?");
    await expect(page.locator("main")).toContainText("Уровень, XP и монеты гостя не переносятся");
    await page.click("button:has-text('Перенести журнал гостя')");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });

    await expect.poll(() => cloudLiveTrades(request, email), { timeout: 20000 }).toBe(2);
    await page.goto("/journal");
    await expect(page.getByTestId("trades-table")).toContainText("EURUSD");
    await expect(page.getByTestId("sync-badge")).toHaveAttribute("data-state", "synced", { timeout: 15000 });

    const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${q(email)}`)).json()).id) as string;
    const game = await accountGame(page, userId);
    expect(game.level ?? 1).toBe(1);
    expect(game.xp ?? 0).toBe(0);
    expect(game.coins ?? 0).not.toBe(25);
    // the guest copy stays on the device
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1")!).level)).toBe(3);
    await ctx.close();
  });

  test("from Settings → Cloud and data: «Copy to account» → the journal goes to the cloud", async ({ browser, request }) => {
    const { ctx, page } = await guestDevice(browser);
    const email = `GCopy_${Date.now()}@example.com`;
    await signIn(page, email);
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
    await completeOnboarding(page, `GCp${Date.now() % 100000}`);
    await page.waitForURL("**/profile-select**", { timeout: 10000 });
    await page.click("button:has-text('Решить позже')");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await expect(page.getByTestId("sync-badge")).toHaveAttribute("data-state", "synced", { timeout: 15000 });
    expect(await cloudLiveTrades(request, email)).toBe(0);

    await page.goto("/settings/cloud");
    await expect(page.getByTestId("guest-block")).toContainText("уровень, XP и монеты гостя не переносятся");
    await page.getByRole("button", { name: "Скопировать в аккаунт" }).click();
    await expect(page.locator("main")).toContainText("Журнал гостя скопирован в аккаунт.");
    await expect.poll(() => cloudLiveTrades(request, email), { timeout: 20000 }).toBe(2);
    await expect(page.getByTestId("sync-badge")).toHaveAttribute("data-state", "synced", { timeout: 15000 });
    await ctx.close();
  });

  test("manual mode: the copied journal waits — the badge and Settings say so — and goes up on «Synchronise»", async ({ browser, request }) => {
    const { ctx, page } = await guestDevice(browser);
    const email = `GMan_${Date.now()}@example.com`;
    await signIn(page, email);
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
    await completeOnboarding(page, `GMn${Date.now() % 100000}`);
    await page.waitForURL("**/profile-select**", { timeout: 10000 });
    await page.click("button:has-text('Решить позже')");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await page.goto("/settings/cloud");
    await expect(page.getByTestId("cloud-sync-mode")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("cloud-sync-mode").getByRole("radio", { name: "Вручную" }).click();

    await page.getByRole("button", { name: "Скопировать в аккаунт" }).click();
    await expect(page.locator("main")).toContainText("Журнал гостя скопирован в аккаунт.");
    await page.waitForTimeout(4000);
    expect(await cloudLiveTrades(request, email)).toBe(0);
    // honest: not «saved», the changes wait
    await expect(page.getByTestId("sync-badge")).toHaveAttribute("data-state", "manual", { timeout: 15000 });
    await expect(page.getByTestId("cloud-sync-pending")).toContainText("Ждёт отправки");
    await page.getByTestId("cloud-sync-now").click();
    await expect.poll(() => cloudLiveTrades(request, email), { timeout: 20000 }).toBe(2);
    await expect(page.getByTestId("cloud-sync-pending")).toContainText("Неотправленных изменений нет.");
    await ctx.close();
  });
});
