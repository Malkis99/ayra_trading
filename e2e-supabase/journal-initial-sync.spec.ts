import { test, expect, type Page, type APIRequestContext, type BrowserContext, type Browser } from "@playwright/test";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// T7b-4d: the first upload (button) and the automatic download on an empty device, against the fake Supabase.
// The flag is on ONLY for test users of the fake server; nothing here touches a real project.

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email-input", email);
  await page.click("input[type='checkbox']");
  await page.click("button[type='submit']");
  await expect(page.locator("#otp-input")).toBeVisible();
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`);
  await page.goto((await res.json()).link);
}

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
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
}

type Row = { table: string; id: string; data: Record<string, unknown> };
const cloudRows = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[];
const cloudTrades = async (request: APIRequestContext, email: string) => (await cloudRows(request, email)).filter((r) => r.table === "journal_trades");

const trade = (id: string, instrument: string) => ({
  id,
  accountId: "acc_main",
  instrument,
  direction: "long",
  status: "closed",
  openedAt: "2026-10-15T09:00:00.000Z",
  closedAt: "2026-10-15T10:00:00.000Z",
  pnlMoney: 40,
  result: "win",
  emotions: [],
  mistakes: [],
  verification: "unverified",
  source: "manual",
  createdAt: "2026-10-15T09:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
  schemaVersion: 6,
});

/** This device's journal of the account, written before the app starts (data made before cloud sync existed). */
async function seedDeviceJournal(context: BrowserContext, userId: string, trades: unknown[]) {
  await context.addInitScript(
    ([id, list]) => {
      if (sessionStorage.getItem("seeded_journal")) return;
      sessionStorage.setItem("seeded_journal", "1");
      localStorage.setItem(
        `ayra:${id}:ayra_journal_v1`,
        JSON.stringify({
          schemaVersion: 6,
          accounts: [{ id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
          trades: list,
        })
      );
    },
    [userId, trades] as const
  );
}

/** A new account (flag on in the fake server) whose device A already has journal data. */
async function accountWithLocalData(browser: Browser, request: APIRequestContext, tag: string, trades: unknown[]) {
  const email = `${tag}_${Date.now()}@example.com`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, email);
  await completeOnboarding(page, `${tag}${Date.now() % 100000}`);
  const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id) as string;
  await page.evaluate(([id, list]) => {
    const key = `ayra:${id}:ayra_journal_v1`;
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 6,
        accounts: [{ id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
        trades: list,
      })
    );
  }, [userId, trades] as const);
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  await page.goto("/journal");
  return { email, userId, context, page };
}

test.describe("Cloud journal: first upload and empty device", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/journal-write-delay?ms=0`);
  });

  test("local data waits for the button; preview with counts and a backup; the upload sends it; the button is gone", async ({ browser, request }) => {
    const A = await accountWithLocalData(browser, request, "First", [trade("t1", "NAS100"), trade("t2", "EURUSD")]);
    const button = A.page.getByTestId("initial-sync-button");
    await expect(button).toContainText("Загрузить в облако", { timeout: 15000 });
    await A.page.waitForTimeout(2000);
    expect(await cloudRows(request, A.email)).toEqual([]); // nothing went up by itself

    await button.click();
    const dialog = A.page.getByTestId("initial-sync-dialog");
    const counts = dialog.getByTestId("initial-sync-counts");
    await expect(counts.locator('[data-kind="journal_accounts"]')).toContainText("1");
    await expect(counts.locator('[data-kind="journal_trades"]')).toContainText("2");
    await expect(dialog).toContainText("XP, монеты, достижения и квесты в облако не отправляются");
    const [backup] = await Promise.all([A.page.waitForEvent("download"), dialog.getByTestId("initial-sync-backup").click()]);
    expect(backup.suggestedFilename()).toMatch(/^ayra-journal-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = JSON.parse(await (await import("node:fs/promises")).readFile((await backup.path())!, "utf8"));
    expect(saved).toMatchObject({ app: "ayra", kind: "journalBackup" });
    expect(saved.journal.trades.map((t: { id: string }) => t.id).sort()).toEqual(["t1", "t2"]);

    await dialog.getByTestId("initial-sync-start").click();
    await expect(dialog.getByTestId("initial-sync-done")).toContainText("Готово: журнал в облаке", { timeout: 15000 });
    expect((await cloudTrades(request, A.email)).map((r) => r.id).sort()).toEqual(["t1", "t2"]);
    await dialog.getByTestId("initial-sync-close").click();
    await expect(button).toHaveCount(0);
    await A.context.close();
  });

  test("cancel in the middle, then 'Continue upload': everything arrives once, no copies", async ({ browser, request }) => {
    const many = Array.from({ length: 250 }, (_, i) => trade(`t${String(i).padStart(3, "0")}`, "XAUUSD"));
    const A = await accountWithLocalData(browser, request, "Cancel", many);
    await request.get(`${FAKE_SUPABASE}/__test/journal-write-delay?ms=1500`);
    await A.page.getByTestId("initial-sync-button").click();
    const dialog = A.page.getByTestId("initial-sync-dialog");
    await expect(dialog.getByTestId("initial-sync-counts").locator('[data-kind="journal_trades"]')).toContainText("250");
    await dialog.getByTestId("initial-sync-start").click();
    await expect(dialog.getByTestId("initial-sync-progress")).toContainText(/Загружено ([1-9]\d*) из 251/, { timeout: 20000 });
    await dialog.getByTestId("initial-sync-cancel").click();
    await expect(dialog.getByTestId("initial-sync-cancelled")).toContainText("Загрузка остановлена", { timeout: 20000 });
    const partial = (await cloudTrades(request, A.email)).length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(250);

    // closed and opened again: the button offers to continue
    await A.page.keyboard.press("Escape");
    await expect(A.page.getByTestId("initial-sync-button")).toContainText("Продолжить загрузку");
    await request.get(`${FAKE_SUPABASE}/__test/journal-write-delay?ms=0`);
    await A.page.getByTestId("initial-sync-button").click();
    await expect(dialog.getByTestId("initial-sync-counts").locator('[data-kind="journal_trades"]')).toContainText(String(250 - partial));
    await dialog.getByTestId("initial-sync-start").click();
    await expect(dialog.getByTestId("initial-sync-done")).toBeVisible({ timeout: 20000 });
    const ids = (await cloudTrades(request, A.email)).map((r) => r.id);
    expect(ids).toHaveLength(250);
    expect(new Set(ids).size).toBe(250);
    await A.context.close();
  });

  test("empty device downloads by itself with one notice; a device with its own data waits and then shows only here / only in cloud", async ({ browser, request }) => {
    const A = await accountWithLocalData(browser, request, "Devices", [trade("t1", "NAS100"), trade("t2", "EURUSD")]);
    await A.page.getByTestId("initial-sync-button").click();
    await A.page.getByTestId("initial-sync-start").click();
    await expect(A.page.getByTestId("initial-sync-done")).toBeVisible({ timeout: 15000 });

    // Device B: empty — downloads by itself, one notice, no button
    const B = await browser.newContext();
    const bPage = await B.newPage();
    await bPage.setViewportSize({ width: 1440, height: 900 });
    await signIn(bPage, A.email);
    await bPage.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await expect(bPage.getByText("Журнал загружен из облака")).toBeVisible({ timeout: 15000 });
    await bPage.goto("/journal");
    await expect(bPage.getByTestId("trades-table")).toContainText("NAS100");
    await expect(bPage.getByTestId("initial-sync-button")).toHaveCount(0);

    // Device C: has its own trade before the first sync — nothing is downloaded without the button
    const C = await browser.newContext();
    await seedDeviceJournal(C, A.userId, [trade("tc", "USDJPY")]);
    const cPage = await C.newPage();
    await cPage.setViewportSize({ width: 1440, height: 900 });
    await signIn(cPage, A.email);
    await cPage.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await cPage.goto("/journal");
    await expect(cPage.getByTestId("initial-sync-button")).toBeVisible({ timeout: 15000 });
    await expect(cPage.getByTestId("trades-table")).toContainText("USDJPY");
    await expect(cPage.getByTestId("trades-table")).not.toContainText("NAS100");
    await expect(cPage.getByText("Журнал загружен из облака")).toHaveCount(0);

    await cPage.getByTestId("initial-sync-button").click();
    const both = cPage.getByTestId("initial-sync-both");
    await expect(both).toContainText("Только здесь: 1 · Только в облаке: 2 · Отличаются: 0");
    await expect(both).toContainText("могут повториться");
    await cPage.getByTestId("initial-sync-start").click();
    await expect(cPage.getByTestId("initial-sync-done")).toContainText("Получено из облака: 2", { timeout: 15000 });
    await cPage.getByTestId("initial-sync-close").click();
    await expect(cPage.getByTestId("trades-table")).toContainText("NAS100");
    expect((await cloudTrades(request, A.email)).map((r) => r.id).sort()).toEqual(["t1", "t2", "tc"]);

    await A.context.close();
    await B.close();
    await C.close();
  });
});
