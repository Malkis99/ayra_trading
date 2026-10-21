import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";
import { pickOption } from "../e2e/helpers/forms";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Setup plan PR 1 (docs/journal-setup-plan.md): «Settings → Journal» with «?» hints — default unit, main account,
// default session, time zone — applied to the Journal and the new-trade form, synced through the cloud settings row;
// and the «Guest on this device» block. The flag is on only for test users of the fake server.

async function completeOnboarding(page: Page, nickname: string) {
  await page.waitForURL("**/awakening**", { timeout: 10000 });
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill(nickname);
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
  await page.click('button:has-text("Начать")');
  await page.waitForURL((url) => url.pathname !== "/awakening", { timeout: 10000 });
}

const q = (email: string) => encodeURIComponent(email);
const settingsRow = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${q(email)}`)).json()) as { table: string; data: Record<string, unknown> }[]).find(
    (r) => r.table === "journal_settings"
  )?.data;

const shotDir = process.env.SHOT_DIR;
const shot = async (page: Page, name: string, testId?: string) => {
  if (!shotDir) return;
  if (testId) await page.getByTestId(testId).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotDir}/${name}.png` });
};

async function openDevice(context: BrowserContext, width = 1440, height = 900) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  return page;
}

test.describe("Settings → Journal", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("unit, main account, session and time zone with hints; applied to the Journal and new trades; synced to the second device", async ({ browser, request }) => {
    const email = `JSet_${Date.now()}@example.com`;
    const ctxA = await browser.newContext();
    const A = await openDevice(ctxA);
    await signIn(A, email);
    await completeOnboarding(A, `JSet${Date.now() % 100000}`);
    const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${q(email)}`)).json()).id) as string;

    // two trading accounts on this device, then cloud on and the usual first upload (so the second device gets them)
    await A.evaluate((id) => {
      const now = "2026-10-01T00:00:00.000Z";
      localStorage.setItem(
        `ayra:${id}:ayra_journal_v1`,
        JSON.stringify({
          schemaVersion: 6,
          accounts: [
            { id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: now, updatedAt: now, deletedAt: null },
            { id: "acc_prop", name: "Prop", type: "personal", currency: "USD", platform: "manual", createdAt: now, updatedAt: now, deletedAt: null },
          ],
          trades: [],
        })
      );
    }, userId);
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
    await A.goto("/journal");
    await A.getByTestId("initial-sync-button").click();
    await A.getByTestId("initial-sync-start").click();
    await expect(A.getByTestId("initial-sync-done")).toBeVisible({ timeout: 15000 });
    await A.getByTestId("initial-sync-close").click();

    await A.goto("/settings");
    const card = A.getByTestId("journal-settings");
    await expect(card).toContainText("Журнал");
    await expect(card).toContainText("Часовой пояс пока хранится на этом устройстве и с облаком не синхронизируется.");
    // the time zone moved here: one picker on the page
    await expect(A.getByText("Часовой пояс", { exact: true })).toHaveCount(1);

    // «?»: hover opens, Esc closes
    const unitHintBtn = A.getByRole("button", { name: "Подсказка: Показатель результата по умолчанию" });
    await unitHintBtn.hover();
    await expect(card.getByText("R — результат в рисках сделки")).toBeVisible();
    await shot(A, "settings-journal-hint-1440", "journal-settings");
    await A.keyboard.press("Escape");
    await expect(card.getByText("R — результат в рисках сделки")).toBeHidden();

    await A.getByTestId("journal-settings-unit").getByRole("radio", { name: "$" }).click();
    await pickOption(A, "journal-settings-account-select", "Prop");
    await pickOption(A, "journal-settings-session-select", "Лондон");
    await expect.poll(() => settingsRow(request, email), { timeout: 15000 }).toMatchObject({
      preferences: { defaultUnit: "money", mainAccountId: "acc_prop", defaultSession: "london" },
    });
    await shot(A, "settings-journal-1440", "journal-settings");

    // the Journal opens in $; a new trade gets Prop and London
    await A.goto("/journal");
    await expect(A.getByRole("radiogroup", { name: "Единицы" }).getByRole("radio", { name: "$" })).toHaveAttribute("aria-checked", "true");
    await A.getByRole("button", { name: "Добавить сделку" }).first().click();
    const drawer = A.getByTestId("add-trade-drawer");
    await expect(drawer.getByTestId("account-select")).toContainText("Prop");
    await A.getByTestId("instrument-input").fill("nas100");
    await A.fill("input[placeholder='150 / -50']", "40");
    await A.getByTestId("instrument-input").press("Control+Enter");
    await expect(drawer).toBeHidden();
    const saved = await A.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_journal_v1`)!).trades[0], userId);
    expect(saved).toMatchObject({ accountId: "acc_prop", session: "london", instrument: "NAS100" });

    // second device: the settings come from the cloud
    const ctxB = await browser.newContext();
    const B = await openDevice(ctxB, 360, 740);
    await signIn(B, email);
    await B.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await B.goto("/settings");
    const cardB = B.getByTestId("journal-settings");
    await expect(cardB.getByTestId("journal-settings-unit").getByRole("radio", { name: "$" })).toHaveAttribute("aria-checked", "true", { timeout: 15000 });
    await expect(B.getByTestId("journal-settings-account-select")).toContainText("Prop");
    await expect(B.getByTestId("journal-settings-session-select")).toContainText("Лондон");

    // 360px: a tap opens the hint under the question, inside the screen; a second tap closes it
    const hintBtnB = B.getByRole("button", { name: "Подсказка: Главный счёт по умолчанию" });
    await hintBtnB.click();
    const hintText = cardB.getByText("Этот счёт выбирается сам");
    await expect(hintText).toBeVisible();
    const box = (await hintText.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(await B.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await shot(B, "settings-journal-hint-360", "journal-settings");
    await hintBtnB.click();
    await expect(hintText).toBeHidden();

    await ctxA.close();
    await ctxB.close();
  });

  test("guest data on the device: a separate «Guest on this device» block with the guest's real numbers", async ({ browser, request }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      if (localStorage.getItem("e2e_seeded_guest")) return;
      localStorage.setItem("e2e_seeded_guest", "1");
      localStorage.setItem("ayra_guest_dismissed", "1");
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({ name: "GuestZed", level: 3, xp: 40, onboarding: { status: "done", step: 5, subStep: 0, answers: { nickname: "GuestZed", language: "ru" } } })
      );
      const now = "2026-10-01T00:00:00.000Z";
      const trade = (id: string) => ({ id, accountId: "acc_g", instrument: "EURUSD", direction: "long", openedAt: now, pnlMoney: 10, status: "closed", createdAt: now, updatedAt: now, deletedAt: null });
      localStorage.setItem(
        "ayra_journal_v1",
        JSON.stringify({
          schemaVersion: 6,
          accounts: [{ id: "acc_g", name: "Guest", type: "personal", currency: "USD", platform: "manual", createdAt: now, updatedAt: now, deletedAt: null }],
          trades: [trade("tg1"), trade("tg2")],
        })
      );
    });
    const page = await openDevice(ctx);

    // signed out: the guest's own profile
    await page.goto("/settings");
    await expect(page.locator("main")).toContainText("Твой гостевой профиль");
    await expect(page.getByTestId("guest-block")).toHaveCount(0);

    const email = `JGuest_${Date.now()}@example.com`;
    await signIn(page, email);
    await completeOnboarding(page, `JGst${Date.now() % 100000}`);
    if (new URL(page.url()).pathname.startsWith("/profile-select")) {
      await page.click("button:has-text('Не переносить')");
      await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    }

    await page.goto("/settings");
    const block = page.getByTestId("guest-block");
    await expect(block).toContainText("Гость на этом устройстве");
    await expect(block).toContainText("Не связан с аккаунтом");
    await expect(block).toContainText("Уровень, XP и сделки гостя не входят в твой аккаунт.");
    await expect(page.getByTestId("guest-line")).toHaveText("Гость «GuestZed» · уровень 3 · сделок 2");
    await expect(page.locator("main")).toContainText("В этом браузере хранятся журнал твоего аккаунта и, отдельно, данные гостя.");
    // the account's journal comes first, the guest block after it
    const order = await page.evaluate(() => {
      const counts = document.querySelector("[data-testid='device-journal-counts']")!;
      const guest = document.querySelector("[data-testid='guest-block']")!;
      return Boolean(counts.compareDocumentPosition(guest) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    // no new buttons: export and delete as before; «Copy to account» only on its old condition
    await expect(block.getByRole("button", { name: "Экспортировать" })).toBeVisible();
    await expect(block.getByRole("button", { name: "Удалить данные гостя" })).toBeVisible();
    await shot(page, "settings-guest-1440", "guest-block");
    await page.setViewportSize({ width: 360, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await shot(page, "settings-guest-360", "guest-block");
    expect(request).toBeTruthy();
    await ctx.close();
  });
});
