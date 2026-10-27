import { test, expect, webkit, chromium, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";
import { solidPng } from "../e2e/helpers/png";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Owner's report 2026-10-27: a screenshot of the US30 trade deleted on the phone; on the laptop the trade list kept
// «📷 2» until the trade was edited and saved. The number of screenshots shown for a trade (list, dashboard, filter)
// must follow the live screenshots after every exchange, without editing the trade. Chromium and WebKit.

async function completeOnboarding(page: Page, nickname: string) {
  await page.waitForURL("**/awakening**", { timeout: 15000 });
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
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
}

type Row = { table: string; id: string; data: Record<string, unknown> };
const cloudRows = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[];
const liveShots = async (request: APIRequestContext, email: string) =>
  (await cloudRows(request, email)).filter((r) => r.table === "journal_attachments" && !r.data.deletedAt).length;
const markFirstSyncDone = (page: Page, userId: string) =>
  page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);

/** The journal page, also when the app passes through its sign-in check right after a reload. */
async function gotoJournal(page: Page) {
  await page.goto("/journal").catch((e: unknown) => {
    if (!/interrupted by another navigation/.test(String(e))) throw e;
  });
  await page.waitForURL((url) => url.pathname === "/journal", { timeout: 15000 });
}
async function openTrade(page: Page) {
  await gotoJournal(page);
  // a table row on a laptop, a card on a phone
  await page.getByText("US30").locator("visible=true").first().click();
  await expect(page.getByTestId("trade-quick-view")).toBeVisible();
}
const countInList = (page: Page) => page.locator("tr:has-text('US30')").getByTestId("trade-shots-count");

/**
 * Device A of a new account with the cloud on, and the trade US30 with `shots` screenshots already in the cloud — put
 * there directly, as another device would have (rows and files), so the test spends its time only on what it checks.
 */
async function accountWithTrade(browser: Browser, request: APIRequestContext, baseURL: string | undefined, shots: number) {
  const email = `Counts_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com`;
  const A = await (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(A, email);
  await completeOnboarding(A, `Cnt${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  await markFirstSyncDone(A, userId);

  const now = new Date().toISOString();
  const put = (table: string, data: Record<string, unknown>) =>
    request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=${table}`, { data });
  await put("journal_accounts", { id: "acc_counts", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: now, updatedAt: now });
  const ids = Array.from({ length: shots }, (_, i) => `att_counts_${i + 1}`);
  for (const [i, id] of ids.entries()) {
    const png = solidPng(120, 80, [60 + i * 70, 52, 143]);
    await request.post(`${FAKE_SUPABASE}/__test/storage-put?email=${encodeURIComponent(email)}&name=${id}.png`, { headers: { "Content-Type": "image/png" }, data: png });
    await put("journal_attachments", { id, tradeId: "tr_counts", kind: "before", width: 120, height: 80, bytes: png.length, mime: "image/png", hash: `h_${id}`, createdAt: now, updatedAt: now });
  }
  await put("journal_trades", {
    id: "tr_counts", accountId: "acc_counts", instrument: "US30", direction: "long", status: "closed", openedAt: now, result: "win", pnlMoney: 40,
    emotions: [], mistakes: [], verification: "unverified", source: "manual", createdAt: now, updatedAt: now, schemaVersion: 6, attachmentIds: ids,
  });
  await gotoJournal(A);
  await expect(countInList(A)).toHaveText(String(shots), { timeout: 15000 });
  return { A, email, userId };
}

/** Device B (a phone) of the same account, its trade card open with every screenshot downloaded. */
async function phoneWithTrade(browser: Browser, baseURL: string | undefined, email: string, userId: string, shots: number) {
  const B = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await signIn(B, email);
  await B.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
  await markFirstSyncDone(B, userId);
  await openTrade(B);
  await expect(B.getByTestId("trade-quick-view").getByTestId("screenshot-thumb")).toHaveCount(shots, { timeout: 20000 });
  return B;
}

async function deleteInViewer(B: Page) {
  await B.locator("button:has-text('✕ Удалить')").click();
  await B.getByTestId("lightbox-confirm-delete").click();
}

test.describe("Number of screenshots follows deletions on another device", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  for (const engine of ["chromium", "webkit"] as const) {
    test(`${engine}: deleted on the phone in the trade card → the laptop's list shows the live number`, async ({ request, baseURL }) => {
      const browser = await (engine === "webkit" ? webkit : chromium).launch();
      try {
        const { A, email, userId } = await accountWithTrade(browser, request, baseURL, 2);
        const B = await phoneWithTrade(browser, baseURL, email, userId, 2);
        await B.getByTestId("trade-quick-view").locator(".aspect-video").first().click();
        await deleteInViewer(B);
        await expect(B.getByTestId("trade-quick-view").getByTestId("screenshot-thumb")).toHaveCount(1);
        await expect.poll(() => liveShots(request, email), { timeout: 15000 }).toBe(1);
        // the laptop page stays open; returning to the tab exchanges; the trade was not edited there
        await A.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await expect(countInList(A)).toHaveText("1", { timeout: 15000 });
      } finally {
        await browser.close();
      }
    });

    test(`${engine}: deleted on the phone in the edit form, closed WITHOUT saving → the laptop's list shows the live number`, async ({ request, baseURL }) => {
      const browser = await (engine === "webkit" ? webkit : chromium).launch();
      try {
        const { A, email, userId } = await accountWithTrade(browser, request, baseURL, 1);
        const B = await phoneWithTrade(browser, baseURL, email, userId, 1);
        await B.click("button:has-text('Редактировать')");
        const form = B.getByTestId("add-trade-drawer");
        await expect(form).toBeVisible();
        // the «Screenshots» section is open by itself; the form's bottom bar («Save») may cover the tile: its own click
        const thumbInForm = form.getByTestId("screenshot-thumb").first();
        await expect(thumbInForm).toBeVisible({ timeout: 20000 });
        await thumbInForm.evaluate((img) => (img.closest(".aspect-video") as HTMLElement).click());
        await deleteInViewer(B);
        await expect.poll(() => liveShots(request, email), { timeout: 15000 }).toBe(0);
        await B.keyboard.press("Escape");
        await A.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await expect(countInList(A)).toHaveCount(0, { timeout: 15000 });
      } finally {
        await browser.close();
      }
    });

    test(`${engine}: the trade still lists a screenshot deleted elsewhere (its own update waits, e.g. a conflict) → the list counts only live screenshots`, async ({ request, baseURL }) => {
      const browser = await (engine === "webkit" ? webkit : chromium).launch();
      try {
        const { A, email } = await accountWithTrade(browser, request, baseURL, 2);
        // another device deleted one screenshot; its update of the trade has not arrived (the trade still lists 2)
        const shot = (await cloudRows(request, email)).find((r) => r.table === "journal_attachments")!;
        const at = new Date(Date.now() + 1000).toISOString();
        await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_attachments`, { data: { ...shot.data, updatedAt: at, deletedAt: at } });
        await A.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await expect(countInList(A)).toHaveText("1", { timeout: 15000 });
        expect(((await cloudRows(request, email)).find((r) => r.table === "journal_trades")!.data.attachmentIds as string[]).length).toBe(2);
        await openTrade(A);
        await expect(A.getByTestId("trade-quick-view").getByTestId("screenshot-thumb")).toHaveCount(1, { timeout: 15000 });
        await expect(A.getByTestId("screenshots-elsewhere")).toHaveCount(0);
      } finally {
        await browser.close();
      }
    });
  }
});
