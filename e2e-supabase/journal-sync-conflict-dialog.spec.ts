import { test, expect, type Page, type APIRequestContext, type BrowserContext, type Browser } from "@playwright/test";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// T7b-4c: the conflict dialog, two devices of one account (two browser contexts) against the fake Supabase.
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

async function markFirstSyncDone(page: Page, userId: string) {
  await page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);
}

async function editInstrument(page: Page, from: string, to: string) {
  await page.click(`tr:has-text('${from}')`);
  await page.click("button:has-text('Редактировать')");
  await page.getByTestId("instrument-input").fill(to);
  await page.click("button:has-text('Сохранить сделку')");
  await expect(page.getByTestId("trades-table")).toContainText(to.toUpperCase());
}

type Row = { table: string; id: string; data: Record<string, unknown> };
const cloudTrade = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[]).find((r) => r.table === "journal_trades")!;
const localTrade = (page: Page, userId: string, id: string) =>
  page.evaluate(([u, t]) => (JSON.parse(localStorage.getItem(`ayra:${u}:ayra_journal_v1`) || "{}").trades || []).find((x: { id: string }) => x.id === t), [userId, id]);
const localConflicts = (page: Page, userId: string) =>
  page.evaluate((u) => Object.keys(JSON.parse(localStorage.getItem(`ayra:${u}:ayra_sync_conflicts`) || "{}")), userId);

interface Device {
  context: BrowserContext;
  page: Page;
}

/** Device A creates a trade; device B gets it; B edits offline while A deletes or edits it; B comes back online. */
async function makeConflict(browser: Browser, request: APIRequestContext, kind: "delete" | "edit", viewportB = { width: 1440, height: 900 }) {
  const email = `Dlg_${kind}_${Date.now()}@example.com`;
  const A: Device = { context: await browser.newContext(), page: undefined as never };
  A.page = await A.context.newPage();
  await A.page.setViewportSize({ width: 1440, height: 900 });
  await signIn(A.page, email);
  await completeOnboarding(A.page, `Dlg${Date.now() % 100000}`);
  const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id) as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  await markFirstSyncDone(A.page, userId);
  await A.page.goto("/journal");
  await A.page.getByRole("button", { name: "Добавить сделку" }).first().click();
  const drawer = A.page.getByTestId("add-trade-drawer");
  await drawer.getByPlaceholder("Название счёта").fill("Main");
  await drawer.getByRole("button", { name: "Создать счёт" }).click();
  await A.page.getByTestId("instrument-input").fill("nas100");
  await A.page.fill("input[placeholder='150 / -50']", "40");
  await A.page.getByTestId("instrument-input").press("Control+Enter");
  await expect(drawer).toBeHidden();
  await expect.poll(async () => (await cloudTrade(request, email))?.data.instrument, { timeout: 15000 }).toBe("NAS100");
  const tradeId = (await cloudTrade(request, email)).id;

  const B: Device = { context: await browser.newContext(), page: undefined as never };
  B.page = await B.context.newPage();
  await B.page.setViewportSize({ width: 1440, height: 900 });
  await signIn(B.page, email);
  await B.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  await markFirstSyncDone(B.page, userId);
  await B.page.goto("/journal");
  await expect(B.page.getByTestId("trades-table")).toContainText("NAS100", { timeout: 15000 });

  await B.context.setOffline(true);
  await editInstrument(B.page, "NAS100", "ger40");

  await A.page.goto("/journal");
  if (kind === "delete") {
    await A.page.click("tr:has-text('NAS100')");
    await A.page.click("button:has-text('Удалить')");
    await A.page.locator("button:has-text('Удалить')").first().click();
    await expect.poll(async () => (await cloudTrade(request, email)).data.deletedAt, { timeout: 15000 }).toBeTruthy();
  } else {
    await editInstrument(A.page, "NAS100", "xauusd");
    await expect.poll(async () => (await cloudTrade(request, email)).data.instrument, { timeout: 15000 }).toBe("XAUUSD");
  }

  await B.context.setOffline(false);
  // the dialog is checked at the requested size (trades are edited above on the desktop table)
  await B.page.setViewportSize(viewportB);
  await B.page.reload();
  const dialog = B.page.getByTestId("sync-conflict-dialog");
  await expect(dialog).toBeVisible({ timeout: 15000 });
  return { A, B, email, userId, tradeId, dialog };
}

test.describe("Cloud journal: conflict dialog", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("deleted on A, edited on B: own wording; 'take from cloud' deletes it on B; both devices and the cloud agree", async ({ browser, request }) => {
    const { A, B, email, userId, tradeId, dialog } = await makeConflict(browser, request, "delete");
    await expect(dialog).toContainText("Запись изменена на двух устройствах");
    await expect(dialog).toContainText("На другом устройстве эту сделку удалили, а здесь изменили.");
    await expect(dialog.getByTestId("conflict-device")).toContainText("GER40");
    await expect(dialog.getByTestId("conflict-cloud")).toContainText("Удалено");
    await dialog.getByTestId("conflict-take").click();
    await expect(dialog).toBeHidden();
    // the journal is empty now (no table at all)
    await expect(B.page.locator("main")).not.toContainText("GER40");

    expect((await localTrade(B.page, userId, tradeId)).deletedAt).toBeTruthy();
    expect((await cloudTrade(request, email)).data.deletedAt).toBeTruthy();
    expect((await localTrade(A.page, userId, tradeId)).deletedAt).toBeTruthy();
    expect(await localConflicts(B.page, userId)).toEqual([]);
    await A.context.close();
    await B.context.close();
  });

  test("edited on both: versions side by side; 'keep this device' wins in the cloud and on A", async ({ browser, request }) => {
    const { A, B, email, userId, tradeId, dialog } = await makeConflict(browser, request, "edit");
    await expect(dialog.getByTestId("conflict-device")).toContainText("GER40");
    await expect(dialog.getByTestId("conflict-cloud")).toContainText("XAUUSD");
    await expect(dialog.getByTestId("conflict-device").locator('[data-differs="true"]').first()).toContainText("GER40");
    await dialog.getByTestId("conflict-keep").click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await cloudTrade(request, email)).data.instrument, { timeout: 15000 }).toBe("GER40");

    await A.page.reload();
    await expect(A.page.getByTestId("trades-table")).toContainText("GER40", { timeout: 15000 });
    expect((await localTrade(A.page, userId, tradeId)).instrument).toBe("GER40");
    expect((await localTrade(B.page, userId, tradeId)).instrument).toBe("GER40");
    expect(await localConflicts(A.page, userId)).toEqual([]);
    expect(await localConflicts(B.page, userId)).toEqual([]);
    await A.context.close();
    await B.context.close();
  });

  test("360px: 'decide later' keeps everything as is; the dialog comes back on the next visit; then 'take from cloud' makes both match", async ({ browser, request }) => {
    const { A, B, email, userId, tradeId, dialog } = await makeConflict(browser, request, "edit", { width: 360, height: 740 });
    const overflow = await B.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await dialog.getByTestId("conflict-later").click();
    await expect(dialog).toBeHidden();
    await expect(B.page.locator("main")).toContainText("GER40"); // this device's version stays
    expect(await localConflicts(B.page, userId)).toEqual([`journal_trades:${tradeId}`]);
    expect((await cloudTrade(request, email)).data.instrument).toBe("XAUUSD"); // nothing sent

    await B.page.reload();
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog.getByTestId("conflict-take").click();
    await expect(dialog).toBeHidden();
    await expect(B.page.locator("main")).toContainText("XAUUSD");
    expect((await localTrade(B.page, userId, tradeId)).instrument).toBe("XAUUSD");
    expect((await localTrade(A.page, userId, tradeId)).instrument).toBe("XAUUSD");
    expect((await cloudTrade(request, email)).data.instrument).toBe("XAUUSD");
    await A.context.close();
    await B.context.close();
  });
});
