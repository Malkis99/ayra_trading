import { test, expect, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import path from "node:path";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";
const SCREENSHOT = path.join(process.cwd(), "e2e/fixtures/test-screenshot.png");

// 0005-B: screenshots in the cloud, two devices of one account (two browser contexts) against the fake Supabase with
// its Storage stand-in (same rules as migration 0005). The flag is on ONLY for test users of the fake server.

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

async function addTrade(page: Page, instrument: string, firstAccount = false) {
  await page.goto("/journal");
  await page.getByRole("button", { name: "Добавить сделку" }).first().click();
  const drawer = page.getByTestId("add-trade-drawer");
  await expect(drawer).toBeVisible();
  if (firstAccount) {
    await drawer.getByPlaceholder("Название счёта").fill("Main");
    await drawer.getByRole("button", { name: "Создать счёт" }).click();
  }
  await page.getByTestId("instrument-input").fill(instrument);
  await page.fill("input[placeholder='150 / -50']", "40");
  await page.getByTestId("instrument-input").press("Control+Enter");
  await expect(drawer).toBeHidden();
}

async function markFirstSyncDone(page: Page, userId: string) {
  await page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);
}
const setManual = (page: Page, userId: string) => page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_mode`, "manual"), userId);

type Row = { table: string; id: string; data: Record<string, unknown> };
const cloudRows = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[];
const cloudShots = async (request: APIRequestContext, email: string) => (await cloudRows(request, email)).filter((r) => r.table === "journal_attachments");
type Storage = { files: { path: string; size: number; mime: string }[]; log: string[] };
/** Files of this user and the calls made for them (the fake server is shared by all tests). */
const bucket = async (request: APIRequestContext, email: string): Promise<Storage> => {
  const all = (await (await request.get(`${FAKE_SUPABASE}/__test/storage?email=${encodeURIComponent(email)}`)).json()) as Storage;
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json())?.id as string | undefined;
  return { files: all.files, log: userId ? all.log.filter((l) => l.includes(`:${userId}/`)) : [] };
};

async function openDevice(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { context, page };
}

/** Device A with a new account, the flag on and one trade; device B signed in to the same account. */
async function twoDevices(browser: Browser, request: APIRequestContext, opts: { manualA?: boolean; manualB?: boolean } = {}) {
  const email = `Shots_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com`;
  const A = await openDevice(browser);
  await signIn(A.page, email);
  await completeOnboarding(A.page, `Shots${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  await markFirstSyncDone(A.page, userId);
  await A.page.reload();
  await addTrade(A.page, "nas100", true);
  await expect.poll(async () => (await cloudRows(request, email)).some((r) => r.table === "journal_trades"), { timeout: 15000 }).toBe(true);
  if (opts.manualA) {
    await setManual(A.page, userId);
    await A.page.reload();
  }

  const B = await openDevice(browser);
  await signIn(B.page, email);
  await B.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  await markFirstSyncDone(B.page, userId);
  if (opts.manualB) await setManual(B.page, userId);
  await B.page.goto("/journal");
  await expect(B.page.getByTestId("trades-table")).toContainText("NAS100", { timeout: 15000 });
  return { A, B, email, userId };
}

async function openTrade(page: Page) {
  await page.goto("/journal");
  await page.click("tr:has-text('NAS100')");
  await expect(page.getByTestId("trade-quick-view")).toBeVisible();
}

async function addScreenshot(page: Page) {
  await openTrade(page);
  await page.locator("input[type='file'][accept='image/*']").setInputFiles(SCREENSHOT);
  await expect(page.locator(".aspect-video img").first()).toBeVisible();
}

const thumbnails = (page: Page) => page.getByTestId("trade-quick-view").locator(".aspect-video img");

/** Manual mode: «Synchronise» in Settings → Cloud and data. */
async function syncNow(page: Page) {
  await page.goto("/settings/cloud");
  await page.getByTestId("cloud-sync-now").click();
  await expect(page.getByTestId("cloud-sync-pending")).toContainText("Неотправленных изменений нет", { timeout: 15000 });
}

/** Automatic mode: «Retry» in the cloud badge panel (what waits goes up now instead of after the pause). */
async function retryNow(page: Page) {
  // while an attempt is running the badge has no button: try again until it is there
  await expect(async () => {
    if (!(await page.getByTestId("sync-badge-panel").isVisible())) await page.getByTestId("sync-badge").click();
    await page.getByTestId("sync-badge-action").click({ timeout: 2000 });
  }).toPass({ timeout: 45000 });
}

test.describe("Screenshots in the cloud (0005-B)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("automatic: file first, then the row; B downloads by itself with a preview; «Saved in the cloud» only after both", async ({ browser, request }) => {
    const { A, B, email, userId } = await twoDevices(browser, request);
    await addScreenshot(A.page);

    // the file is in the bucket and the row in the cloud; the file went up before the row
    await expect.poll(async () => (await cloudShots(request, email)).length, { timeout: 15000 }).toBe(1);
    const row = (await cloudShots(request, email))[0];
    const files = (await bucket(request, email)).files;
    expect(files).toEqual([{ path: `${userId}/${row.id}.webp`, size: Number(row.data.bytes), mime: "image/webp" }]);
    expect(row.data).not.toHaveProperty("originalBlob");
    await expect(A.page.getByTestId("sync-badge")).toHaveAttribute("data-state", "synced", { timeout: 15000 });

    // B: opening the trade downloads the file; the preview is made on B and shown in the list
    await openTrade(B.page);
    await expect(thumbnails(B.page)).toHaveCount(1, { timeout: 15000 });
    await expect(B.page.getByTestId("screenshots-elsewhere")).toHaveCount(0);
    expect((await bucket(request, email)).log.filter((l) => l.startsWith("sign:"))).toEqual([`sign:${userId}/${row.id}.webp`]);
    const stored = await B.page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      const name = dbs.map((d) => d.name).find((n) => n && n.includes("attachments"));
      return new Promise<{ preview: number; original: number } | null>((resolve) => {
        const open = indexedDB.open(name!);
        open.onsuccess = () => {
          const all = open.result.transaction("attachments", "readonly").objectStore("attachments").getAll();
          all.onsuccess = () => {
            const r = all.result[0];
            resolve(r ? { preview: r.previewBlob.size, original: r.originalBlob.size } : null);
          };
        };
      });
    });
    expect(stored?.preview).toBeGreaterThan(0);
    expect(stored?.original).toBe(Number(row.data.bytes));

    // B keeps the file: after a reload nothing is downloaded again
    const signsBefore = (await bucket(request, email)).log.filter((l) => l.startsWith("sign:")).length;
    await openTrade(B.page);
    await expect(thumbnails(B.page)).toHaveCount(1);
    expect((await bucket(request, email)).log.filter((l) => l.startsWith("sign:")).length).toBe(signsBefore);
    await A.context.close();
    await B.context.close();
  });

  test("manual on both devices: nothing goes up or comes down by itself; «Synchronise» uploads, «Download» downloads", async ({ browser, request }) => {
    const { A, B, email } = await twoDevices(browser, request, { manualA: true, manualB: true });
    await addScreenshot(A.page);
    await A.page.waitForTimeout(4000);
    expect(await cloudShots(request, email)).toEqual([]);
    expect((await bucket(request, email)).files).toEqual([]);
    await syncNow(A.page);
    await expect.poll(async () => (await cloudShots(request, email)).length).toBe(1);
    expect((await bucket(request, email)).files.length).toBe(1);

    // B: «Synchronise» brings the row; the file waits for «Download»
    await syncNow(B.page);
    await openTrade(B.page);
    const inCloud = B.page.getByTestId("screenshots-in-cloud");
    await expect(inCloud).toContainText("Скриншот в облаке", { timeout: 15000 });
    await B.page.waitForTimeout(2000);
    expect((await bucket(request, email)).log.some((l) => l.startsWith("sign:"))).toBe(false);
    await B.page.getByTestId("screenshots-download").click();
    await expect(thumbnails(B.page)).toHaveCount(1, { timeout: 15000 });
    await expect(inCloud).toHaveCount(0);
    await A.context.close();
    await B.context.close();
  });

  test("delete → «Undo»: the screenshot is back, the row is live, the file never left the cloud; delete for real: the file stays 30 days", async ({ browser, request }) => {
    const { A, B, email, userId } = await twoDevices(browser, request);
    await addScreenshot(A.page);
    await expect.poll(async () => (await cloudShots(request, email)).length, { timeout: 15000 }).toBe(1);
    const id = (await cloudShots(request, email))[0].id;

    const remove = async () => {
      await A.page.getByTestId("trade-quick-view").locator(".aspect-video").first().click();
      await A.page.locator("button:has-text('✕ Удалить')").click();
      await A.page.getByTestId("lightbox-confirm-delete").click();
      await expect(thumbnails(A.page)).toHaveCount(0);
    };
    await remove();
    await A.page.locator("button:has-text('Отменить')").click();
    await expect(thumbnails(A.page)).toHaveCount(1);
    await expect.poll(async () => (await cloudShots(request, email))[0].data.deletedAt ?? null, { timeout: 15000 }).toBeNull();
    expect((await bucket(request, email)).files.map((f) => f.path)).toEqual([`${userId}/${id}.webp`]);

    // B has it
    await openTrade(B.page);
    await expect(thumbnails(B.page)).toHaveCount(1, { timeout: 15000 });

    // deleted for real: tombstone in the cloud, the file is not removed (only after 30 days, 0005-C)
    await openTrade(A.page);
    await remove();
    await expect.poll(async () => (await cloudShots(request, email))[0].data.deletedAt, { timeout: 15000 }).toBeTruthy();
    expect((await bucket(request, email)).files.map((f) => f.path)).toEqual([`${userId}/${id}.webp`]);
    expect((await bucket(request, email)).log.some((l) => l.startsWith("delete:"))).toBe(false);
    // B: the screenshot is gone from the trade (no «stored on another device» either)
    await B.page.reload();
    await openTrade(B.page);
    await expect(thumbnails(B.page)).toHaveCount(0, { timeout: 15000 });
    await expect(B.page.getByTestId("screenshots-elsewhere")).toHaveCount(0);
    await A.context.close();
    await B.context.close();
  });

  test("trade deleted on B while edited on A; «Take from cloud» on B: the trade and its screenshot are back, the file is in place", async ({ browser, request }) => {
    const { A, B, email, userId } = await twoDevices(browser, request);
    await addScreenshot(A.page);
    await expect.poll(async () => (await cloudShots(request, email)).length, { timeout: 15000 }).toBe(1);
    const id = (await cloudShots(request, email))[0].id;
    await openTrade(B.page);
    await expect(thumbnails(B.page)).toHaveCount(1, { timeout: 15000 });

    // B offline deletes the trade (its screenshot goes with it); A edits the trade
    await B.page.goto("/journal");
    await B.page.click("tr:has-text('NAS100')");
    await B.context.setOffline(true);
    await B.page.getByTestId("trade-quick-view").locator("button:has-text('Удалить')").click();
    await B.page.locator("button:has-text('Удалить')").first().click();
    await expect(B.page.locator("main")).not.toContainText("NAS100");

    await A.page.goto("/journal");
    await A.page.click("tr:has-text('NAS100')");
    await A.page.click("button:has-text('Редактировать')");
    await expect(A.page.getByTestId("instrument-input")).toHaveValue("NAS100");
    await A.page.getByTestId("instrument-input").fill("ger40");
    await A.page.click("button:has-text('Сохранить сделку')");
    await expect.poll(async () => (await cloudRows(request, email)).find((r) => r.table === "journal_trades")?.data.instrument, { timeout: 15000 }).toBe("GER40");

    await B.context.setOffline(false);
    await B.page.reload();
    const dialog = B.page.getByTestId("sync-conflict-dialog");
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog.getByTestId("conflict-take").first().click();
    await expect(dialog).toBeHidden();
    await expect(B.page.getByTestId("trades-table")).toContainText("GER40");
    await B.page.click("tr:has-text('GER40')");
    await expect(thumbnails(B.page)).toHaveCount(1, { timeout: 15000 });
    await expect.poll(async () => (await cloudShots(request, email))[0].data.deletedAt ?? null, { timeout: 15000 }).toBeNull();
    expect((await bucket(request, email)).files.map((f) => f.path)).toEqual([`${userId}/${id}.webp`]);
    await A.context.close();
    await B.context.close();
  });

  test("no space in the cloud: the screenshot stays on A with a notice, B says it is on another device; space freed → it goes up and comes down", async ({ browser, request }) => {
    const { A, B, email, userId } = await twoDevices(browser, request);
    await request.get(`${FAKE_SUPABASE}/__test/attachment-quota?bytes=10`);
    try {
      await addScreenshot(A.page);
      await expect(A.page.getByTestId("screenshots-no-space")).toContainText("в облаке нет места", { timeout: 15000 });
      expect(await cloudShots(request, email)).toEqual([]);
      expect((await bucket(request, email)).files).toEqual([]);
      // the trade itself went up (with the screenshot's id), the badge does not say «saved»
      await expect
        .poll(async () => ((await cloudRows(request, email)).find((r) => r.table === "journal_trades")?.data.attachmentIds as string[] | undefined)?.length ?? 0, { timeout: 15000 })
        .toBe(1);
      await expect(A.page.getByTestId("sync-badge")).not.toHaveAttribute("data-state", "synced");
      await A.page.goto("/settings/cloud");
      await expect(A.page.getByTestId("cloud-sync-no-space")).toContainText("Место для скриншотов в облаке закончилось (200 МБ)");

      // B has the new version of the trade (with the screenshot id) before its card is opened
      await B.page.goto("/journal");
      await expect
        .poll(async () => (await B.page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_journal_v1`) || "{}").trades?.[0]?.attachmentIds?.length ?? 0, userId)), { timeout: 15000 })
        .toBe(1);
      await openTrade(B.page);
      await expect(B.page.getByTestId("screenshots-elsewhere")).toContainText("Скриншот хранится на другом устройстве", { timeout: 15000 });
    } finally {
      await request.get(`${FAKE_SUPABASE}/__test/attachment-quota`);
    }
    // space back: the next exchange of A sends file and row; on B the caption is replaced by the picture
    await retryNow(A.page);
    await expect.poll(async () => (await cloudShots(request, email)).length, { timeout: 15000 }).toBe(1);
    await openTrade(B.page);
    await expect(thumbnails(B.page)).toHaveCount(1, { timeout: 15000 });
    await expect(B.page.getByTestId("screenshots-elsewhere")).toHaveCount(0);
    await A.context.close();
    await B.context.close();
  });

  test("the bucket refuses other types and other folders (direct requests, as the server's rules)", async ({ request }) => {
    const email = `ShotsRules_${Date.now()}@example.com`;
    // a user of the fake server with the flag on, without the app
    await request.post(`${FAKE_SUPABASE}/auth/v1/signup`, { data: { email, password: "password123" } });
    const code = (await (await request.get(`${FAKE_SUPABASE}/__test/last-code?email=${encodeURIComponent(email)}`)).json()).code;
    const session = await (await request.post(`${FAKE_SUPABASE}/auth/v1/verify`, { data: { email, token: code, type: "signup" } })).json();
    const userId = session.user.id as string;
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
    const put = (p: string, type: string, size = 100) =>
      request.post(`${FAKE_SUPABASE}/storage/v1/object/journal-attachments/${p}`, {
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": type, "x-upsert": "false" },
        data: Buffer.alloc(size, 1),
      });
    expect((await put(`${userId}/ok.webp`, "image/webp")).status()).toBe(200);
    expect((await (await put(`${userId}/g.webp`, "image/gif")).json()).statusCode).toBe("415");
    expect((await (await put(`00000000-0000-0000-0000-000000000000/x.webp`, "image/webp")).json()).statusCode).toBe("403");
    expect((await (await put(`${userId}/big.webp`, "image/webp", 5 * 1024 * 1024 + 1)).json()).statusCode).toBe("413");
    expect((await (await put(`${userId}/ok.webp`, "image/webp")).json()).statusCode).toBe("409"); // never replaced
  });
});
