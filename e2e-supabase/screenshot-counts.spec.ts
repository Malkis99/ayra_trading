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

test.describe("Number of screenshots follows deletions on another device", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(180_000);

  for (const engine of ["chromium", "webkit"] as const) {
    test(`${engine}: deleted on B (in the card, then in the edit form without saving) → A's list shows the live number`, async ({ request, baseURL }) => {
      const browser: Browser = await (engine === "webkit" ? webkit : chromium).launch();
      try {
        const email = `Counts_${engine}_${Date.now()}@example.com`;
        const device = async (viewport = { width: 1440, height: 900 }) => (await browser.newContext({ baseURL, viewport })).newPage();

        // A: account with the flag on, trade US30 with two screenshots
        const A = await device();
        await signIn(A, email);
        await completeOnboarding(A, `Counts${Date.now() % 100000}`);
        const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
        await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
        await markFirstSyncDone(A, userId);
        await gotoJournal(A);
        await A.getByRole("button", { name: "Добавить сделку" }).first().click();
        const drawer = A.getByTestId("add-trade-drawer");
        await drawer.getByPlaceholder("Название счёта").fill("Main");
        await drawer.getByRole("button", { name: "Создать счёт" }).click();
        await A.getByTestId("instrument-input").fill("us30");
        await A.fill("input[placeholder='150 / -50']", "40");
        await A.getByTestId("instrument-input").press("Control+Enter");
        await expect(drawer).toBeHidden();
        await openTrade(A);
        const input = A.getByTestId("trade-quick-view").locator("input[type='file'][accept='image/*']");
        await input.setInputFiles({ name: "a.png", mimeType: "image/png", buffer: solidPng(120, 80, [80, 52, 143]) });
        await expect(A.getByTestId("trade-quick-view").getByTestId("screenshot-thumb")).toHaveCount(1, { timeout: 15000 });
        await input.setInputFiles({ name: "b.png", mimeType: "image/png", buffer: solidPng(120, 80, [214, 169, 74]) });
        await expect(A.getByTestId("trade-quick-view").getByTestId("screenshot-thumb")).toHaveCount(2, { timeout: 15000 });
        await expect.poll(() => liveShots(request, email), { timeout: 15000 }).toBe(2);
        await gotoJournal(A);
        await expect(countInList(A)).toHaveText("2", { timeout: 15000 });

        // B: same account; deletes one screenshot in the trade card
        const B = await device({ width: 390, height: 844 }); // the phone
        await signIn(B, email);
        await B.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
        await markFirstSyncDone(B, userId);
        await openTrade(B);
        const thumbsB = B.getByTestId("trade-quick-view").getByTestId("screenshot-thumb");
        await expect(thumbsB).toHaveCount(2, { timeout: 20000 });
        await B.getByTestId("trade-quick-view").locator(".aspect-video").first().click();
        await B.locator("button:has-text('✕ Удалить')").click();
        await B.getByTestId("lightbox-confirm-delete").click();
        await expect(thumbsB).toHaveCount(1);
        await expect.poll(() => liveShots(request, email), { timeout: 15000 }).toBe(1);

        // A: the list shows 1 after the exchange, the trade was not edited here
        await gotoJournal(A);
        await expect(countInList(A)).toHaveText("1", { timeout: 15000 });

        // B: deletes the other one in the edit form and closes it WITHOUT saving the trade
        await gotoJournal(B);
        await B.getByText("US30").locator("visible=true").first().click();
        await B.click("button:has-text('Редактировать')");
        const form = B.getByTestId("add-trade-drawer");
        await expect(form).toBeVisible();
        // the «Screenshots» section is open by itself when the trade has screenshots
        // below the fold of the form: to the middle, so the bar with «Save» does not cover it
        const thumbInForm = form.getByTestId("screenshot-thumb").first();
        await expect(thumbInForm).toBeVisible({ timeout: 20000 });
        // the bottom bar of the form («Save») may cover it: open the viewer with the tile's own click
        await thumbInForm.evaluate((img) => (img.closest(".aspect-video") as HTMLElement).click());
        await B.locator("button:has-text('✕ Удалить')").click();
        await B.getByTestId("lightbox-confirm-delete").click();
        await expect.poll(() => liveShots(request, email), { timeout: 15000 }).toBe(0);
        await B.keyboard.press("Escape");

        // A: no screenshot badge any more
        await gotoJournal(A);
        await expect(countInList(A)).toHaveCount(0, { timeout: 15000 });
      } finally {
        await browser.close();
      }
    });

    test(`${engine}: the trade still lists a screenshot deleted elsewhere (its own update waits, e.g. a conflict) → the list counts only live screenshots`, async ({ request, baseURL }) => {
      const browser: Browser = await (engine === "webkit" ? webkit : chromium).launch();
      try {
        const email = `Counts2_${engine}_${Date.now()}@example.com`;
        const A = await (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage();
        await signIn(A, email);
        await completeOnboarding(A, `Cnt${Date.now() % 100000}`);
        const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
        await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
        await markFirstSyncDone(A, userId);
        await gotoJournal(A);
        await A.getByRole("button", { name: "Добавить сделку" }).first().click();
        const drawer = A.getByTestId("add-trade-drawer");
        await drawer.getByPlaceholder("Название счёта").fill("Main");
        await drawer.getByRole("button", { name: "Создать счёт" }).click();
        await A.getByTestId("instrument-input").fill("us30");
        await A.fill("input[placeholder='150 / -50']", "40");
        await A.getByTestId("instrument-input").press("Control+Enter");
        await expect(drawer).toBeHidden();
        await openTrade(A);
        const input = A.getByTestId("trade-quick-view").locator("input[type='file'][accept='image/*']");
        await input.setInputFiles({ name: "a.png", mimeType: "image/png", buffer: solidPng(120, 80, [80, 52, 143]) });
        await expect(A.getByTestId("trade-quick-view").getByTestId("screenshot-thumb")).toHaveCount(1, { timeout: 15000 });
        await input.setInputFiles({ name: "b.png", mimeType: "image/png", buffer: solidPng(120, 80, [214, 169, 74]) });
        await expect.poll(() => liveShots(request, email), { timeout: 15000 }).toBe(2);
        await gotoJournal(A);
        await expect(countInList(A)).toHaveText("2", { timeout: 15000 });

        // another device deleted one screenshot; its update of the trade has not arrived (the trade still lists 2)
        const shot = (await cloudRows(request, email)).find((r) => r.table === "journal_attachments")!;
        const at = new Date(Date.now() + 1000).toISOString();
        await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_attachments`, { data: { ...shot.data, updatedAt: at, deletedAt: at } });
        // the page stays open; returning to the tab exchanges (as on the laptop)
        await A.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await expect(countInList(A)).toHaveText("1", { timeout: 15000 });
        // the trade card and the «with screenshots» dashboard figure agree; the trade itself was not edited
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
