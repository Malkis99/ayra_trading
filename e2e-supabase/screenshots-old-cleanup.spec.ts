import { test, expect, webkit, chromium, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { solidPng } from "../e2e/helpers/png";

const FAKE_SUPABASE = "http://127.0.0.1:54329";
const DAY = 24 * 3600 * 1000;

// 0005-C (plan #90): screenshots kept only in this browser from before 0005 go up to the cloud in the background with
// a progress «In the cloud: X of Y» and «Stop» / «Continue»; once a day the account's folder in the cloud is cleaned
// (screenshots deleted 30+ days ago, files without a row older than 24 hours) — the server decides again by its own
// clock. Chromium and WebKit, against the fake Supabase with the same rules as migration 0005.

type Row = { table: string; id: string; data: Record<string, unknown> };
const q = (email: string) => `email=${encodeURIComponent(email)}`;
const cloudRows = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?${q(email)}`)).json()) as Row[];
/** File names (without the folder) of this user in the bucket, and the calls made. */
async function bucket(request: APIRequestContext, email: string) {
  const s = (await (await request.get(`${FAKE_SUPABASE}/__test/storage?${q(email)}`)).json()) as { files: { path: string }[]; log: string[] };
  return { names: s.files.map((f) => f.path.split("/")[1]).sort(), log: s.log };
}
const markFirstSyncDone = (page: Page, userId: string) =>
  page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);

async function gotoPath(page: Page, path: string) {
  await page.goto(path).catch((e: unknown) => {
    if (!/interrupted by another navigation/.test(String(e))) throw e;
  });
  await page.waitForURL((url) => url.pathname === path, { timeout: 15000 });
}

/** A new account with the cloud on, signed in on a laptop; nothing in its journal yet. */
async function newAccount(browser: Browser, request: APIRequestContext, baseURL: string | undefined, viewport = { width: 1440, height: 900 }) {
  const email = `Old_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com`;
  const page = await (await browser.newContext({ baseURL, viewport })).newPage();
  await signIn(page, email);
  await completeOnboarding(page, `Old${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?${q(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?${q(email)}&on=1`);
  await markFirstSyncDone(page, userId);
  const put = (table: string, data: Record<string, unknown>) => request.post(`${FAKE_SUPABASE}/__test/cloud-put?${q(email)}&table=${table}`, { data });
  return { page, email, userId, put };
}

const tradeRow = (id: string, attachmentIds: string[], now: string) => ({
  id, accountId: "acc_old", instrument: "US30", direction: "long", status: "closed", openedAt: now, result: "win", pnlMoney: 40,
  emotions: [], mistakes: [], verification: "unverified", source: "manual", createdAt: now, updatedAt: now, schemaVersion: 6, attachmentIds,
});
const accountRow = (now: string) => ({ id: "acc_old", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: now, updatedAt: now });

/**
 * Screenshots kept in this browser the way the app keeps them (bytes and type, see lib/storage/indexeddb-repository),
 * as they were before 0005: no journal row describes them.
 */
async function seedLocalScreenshots(page: Page, userId: string, tradeId: string, ids: string[]) {
  const items = ids.map((id, i) => ({ id, png: [...solidPng(160, 100, [40 + i * 30, 52, 143])] }));
  await page.evaluate(
    async ({ dbName, tradeId, items }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(dbName, 1);
        r.onupgradeneeded = () => {
          if (r.result.objectStoreNames.contains("attachments")) return;
          const s = r.result.createObjectStore("attachments", { keyPath: "id" });
          s.createIndex("tradeId", "tradeId", { unique: false });
          s.createIndex("createdAt", "createdAt", { unique: false });
          s.createIndex("hash", "hash", { unique: false });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const tx = db.transaction("attachments", "readwrite");
      for (const it of items) {
        const bytes = new Uint8Array(it.png).buffer;
        tx.objectStore("attachments").put({
          id: it.id, tradeId, kind: "before", width: 160, height: 100, bytes: it.png.length, mime: "image/png", hash: `h_${it.id}`,
          createdAt: "2026-09-01T10:00:00.000Z", originalBlob: { bytes, type: "image/png" }, previewBlob: { bytes, type: "image/png" },
        });
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { dbName: `ayra:${userId}:ayra_attachments_v1`, tradeId, items }
  );
}

const inCloud = async (page: Page) => Number(/(\d+) из/.exec((await page.getByTestId("screenshots-cloud-count").textContent()) || "")?.[1] ?? -1);

test.describe("0005-C: old screenshots go up; the cloud folder is cleaned once a day", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/storage-delay?ms=0`);
  });

  for (const engine of ["chromium", "webkit"] as const) {
    test(`${engine}: old screenshots upload with progress, «Stop» holds, «Continue» finishes`, async ({ request, baseURL }) => {
      const browser = await (engine === "webkit" ? webkit : chromium).launch();
      try {
        const { page, email, userId, put } = await newAccount(browser, request, baseURL);
        const now = new Date().toISOString();
        const ids = Array.from({ length: 6 }, (_, i) => `att_old_${i + 1}`);
        await put("journal_accounts", accountRow(now));
        await put("journal_trades", tradeRow("tr_old", ids, now));
        await seedLocalScreenshots(page, userId, "tr_old", ids);
        await request.get(`${FAKE_SUPABASE}/__test/storage-delay?ms=1500`);

        await gotoPath(page, "/settings/cloud");
        const card = page.getByTestId("screenshots-cloud");
        await expect(card).toBeVisible({ timeout: 20000 });
        await expect(page.getByTestId("screenshots-cloud-count")).toContainText("из 6");
        await expect(page.getByTestId("screenshots-cloud-state")).toHaveText("Загружаются в фоне, по одному. Можно работать дальше.");
        // the progress moves by itself
        await expect.poll(() => inCloud(page), { timeout: 20000 }).toBeGreaterThanOrEqual(1);

        await page.getByTestId("screenshots-cloud-stop").click();
        await expect(page.getByTestId("screenshots-cloud-state")).toHaveText("Загрузка остановлена. Уже загруженные остаются в облаке.");
        await expect(page.getByTestId("screenshots-cloud-continue")).toBeVisible();
        // the file being uploaded when «Stop» was pressed may still finish; after that nothing more goes up
        await page.waitForTimeout(2500);
        const held = (await bucket(request, email)).names.length;
        expect(held).toBeLessThan(6);
        await page.waitForTimeout(5000);
        expect((await bucket(request, email)).names.length).toBe(held);
        await expect(page.getByTestId("screenshots-cloud-count")).toHaveText(`В облаке: ${held} из 6`, { timeout: 5000 });
        // «Stop» is kept after a reload
        await page.reload();
        await expect(page.getByTestId("screenshots-cloud-continue")).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(3000);
        expect((await bucket(request, email)).names.length).toBe(held);

        await page.getByTestId("screenshots-cloud-continue").click();
        await expect(page.getByTestId("screenshots-cloud-count")).toHaveText("В облаке: 6 из 6", { timeout: 40000 });
        await expect(page.getByTestId("screenshots-cloud-state")).toHaveText("Все скриншоты в облаке.");
        await expect(page.getByTestId("screenshots-cloud-stop")).toHaveCount(0);
        expect((await bucket(request, email)).names).toEqual(ids.map((id) => `${id}.png`).sort());
        // each screenshot got its row (no rewards for them: they are not new)
        const rows = (await cloudRows(request, email)).filter((r) => r.table === "journal_attachments" && !r.data.deletedAt);
        expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
      } finally {
        await browser.close();
      }
    });

    test(`${engine}: daily cleanup removes only what the rules allow`, async ({ request, baseURL }) => {
      const browser = await (engine === "webkit" ? webkit : chromium).launch();
      try {
        const { page, email, userId, put } = await newAccount(browser, request, baseURL);
        const now = new Date().toISOString();
        const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
        const file = (name: string, i: number) =>
          request.post(`${FAKE_SUPABASE}/__test/storage-put?${q(email)}&name=${name}`, { headers: { "Content-Type": "image/png" }, data: solidPng(60, 40, [90 + i * 20, 52, 143]) });
        const shot = (id: string, extra: Record<string, unknown> = {}) =>
          put("journal_attachments", { id, tradeId: "tr_clean", kind: "before", width: 60, height: 40, bytes: 100, mime: "image/png", hash: `h_${id}`, createdAt: now, updatedAt: now, ...extra });
        await put("journal_accounts", accountRow(now));
        await put("journal_trades", tradeRow("tr_clean", ["att_live"], now));
        // live: stays
        await file("att_live.png", 0);
        await shot("att_live");
        // deleted 31 days ago: removed
        await file("att_del31.png", 1);
        await shot("att_del31", { deletedAt: daysAgo(31), updatedAt: daysAgo(31) });
        await request.get(`${FAKE_SUPABASE}/__test/attachment-deleted-days?${q(email)}&id=att_del31&days=31`);
        // deleted 10 days ago: stays
        await file("att_del10.png", 2);
        await shot("att_del10", { deletedAt: daysAgo(10), updatedAt: daysAgo(10) });
        await request.get(`${FAKE_SUPABASE}/__test/attachment-deleted-days?${q(email)}&id=att_del10&days=10`);
        // this device's clock says 31 days, the server knows it was 10: the server's clock decides, it stays
        await file("att_clock.png", 3);
        await shot("att_clock", { deletedAt: daysAgo(31), updatedAt: daysAgo(31) });
        await request.get(`${FAKE_SUPABASE}/__test/attachment-deleted-days?${q(email)}&id=att_clock&days=10`);
        // no row (an interrupted upload) 25 hours old: removed; a fresh one: stays (its row may still be on the way)
        await file("orphan_old.png", 4);
        await request.get(`${FAKE_SUPABASE}/__test/storage-age?${q(email)}&name=orphan_old.png&hours=25`);
        await file("orphan_new.png", 5);

        await gotoPath(page, "/journal");
        await expect.poll(async () => (await bucket(request, email)).names, { timeout: 20000 }).toEqual(
          ["att_clock.png", "att_del10.png", "att_live.png", "orphan_new.png"]
        );
        const mine = (await bucket(request, email)).log.filter((l) => l.startsWith(`delete:${userId}/`)).map((l) => l.split("/")[1]).sort();
        expect(mine).toEqual(["att_del31.png", "orphan_old.png"]);

        // once a day: another exchange today removes nothing more, even a file that became old meanwhile
        await request.get(`${FAKE_SUPABASE}/__test/storage-age?${q(email)}&name=orphan_new.png&hours=25`);
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await page.waitForTimeout(3000);
        expect((await bucket(request, email)).names).toContain("orphan_new.png");
      } finally {
        await browser.close();
      }
    });
  }
});
