import { test, expect, webkit, devices, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { solidPng } from "../e2e/helpers/png";

const FAKE_SUPABASE = "http://127.0.0.1:54329";
const SCREENSHOT = path.join(process.cwd(), "e2e/fixtures/test-screenshot.png");

// 0005-B on WebKit (iPhone browsers, Chrome on iOS included, are WebKit): a screenshot added on a desktop Chromium
// device is downloaded on a WebKit phone and must be DRAWN there — the preview and the full image, also after a
// reload (read back from IndexedDB). Found by the owner on an iPhone: the file came, the picture showed «?».

type Row = { table: string; id: string; data: Record<string, unknown> };
const cloudRows = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[];
const markFirstSyncDone = (page: Page, userId: string) =>
  page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);


/** The <img> has really been decoded and drawn (a broken picture has naturalWidth 0). */
async function drawn(page: Page, selector: string) {
  await expect
    .poll(async () => page.locator(selector).first().evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), { timeout: 15000 })
    .toBeGreaterThan(0);
}

test.describe("Screenshots in the cloud on WebKit (0005-B)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(180_000);

  test("added on desktop Chromium → on a WebKit phone the preview and the full picture are drawn, also after a reload", async ({ browser, request }) => {
    const email = `ShotsWk_${Date.now()}@example.com`;

    // Device A: desktop Chromium (the project browser)
    const aContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const A = await aContext.newPage();
    await signIn(A, email);
    await completeOnboarding(A, `ShotsWk${Date.now() % 100000}`);
    const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
    await markFirstSyncDone(A, userId);
    await A.goto("/journal");
    await A.getByRole("button", { name: "Добавить сделку" }).first().click();
    const drawer = A.getByTestId("add-trade-drawer");
    await drawer.getByPlaceholder("Название счёта").fill("Main");
    await drawer.getByRole("button", { name: "Создать счёт" }).click();
    await A.getByTestId("instrument-input").fill("nas100");
    await A.fill("input[placeholder='150 / -50']", "40");
    await A.getByTestId("instrument-input").press("Control+Enter");
    await expect(drawer).toBeHidden();
    await A.click("tr:has-text('NAS100')");
    await A.locator("input[type='file'][accept='image/*']").setInputFiles(SCREENSHOT);
    await expect.poll(async () => (await cloudRows(request, email)).filter((r) => r.table === "journal_attachments").length, { timeout: 15000 }).toBe(1);

    // Device B: WebKit phone
    const wk = await webkit.launch();
    try {
      const bContext = await wk.newContext({ ...devices["iPhone 13"] });
      const B = await bContext.newPage();
      // a failed download explains itself in the test output
      B.on("console", (m) => {
        if (m.type() === "warning" || m.type() === "error") console.log("[phone]", m.text().slice(0, 300));
      });
      await signIn(B, email);
      await B.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
      await markFirstSyncDone(B, userId);

      const openTrade = async () => {
        // right after a reload the app may pass through its sign-in check (/auth/continue) and come back by itself
        await B.goto("/journal").catch((e: unknown) => {
          if (!/interrupted by another navigation/.test(String(e))) throw e;
        });
        await B.waitForURL((url) => url.pathname === "/journal", { timeout: 15000 });
        await B.getByText("NAS100").locator("visible=true").first().click();
        await expect(B.getByTestId("trade-quick-view")).toBeVisible();
      };
      await openTrade();
      const thumb = '[data-testid="trade-quick-view"] .aspect-video img';
      await expect(B.locator(thumb)).toHaveCount(1, { timeout: 20000 });
      await drawn(B, thumb); // the preview made on the phone
      await B.locator('[data-testid="trade-quick-view"] .aspect-video').first().click();
      await drawn(B, '[data-testid="lightbox-image"]'); // the full picture

      // read back from the phone's storage after a reload: still drawn, nothing downloaded again
      await B.reload();
      await openTrade();
      await drawn(B, thumb);
      await B.locator('[data-testid="trade-quick-view"] .aspect-video').first().click();
      await drawn(B, '[data-testid="lightbox-image"]');
      const stored = await B.evaluate(async (uid) => {
        // the account's screenshot store (not the guest one)
        const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n && n.includes("attachments") && n.includes(uid));
        return new Promise<{ type: string; previewType: string; size: number } | null>((resolve) => {
          const open = indexedDB.open(name!);
          open.onsuccess = () => {
            const all = open.result.transaction("attachments", "readonly").objectStore("attachments").getAll();
            all.onsuccess = () => {
              const r = all.result[0];
              // kept as bytes + type (not a Blob: WebKit cannot keep Blobs in IndexedDB)
              resolve(r ? { type: r.originalBlob.type, previewType: r.previewBlob.type, size: r.originalBlob.bytes?.byteLength ?? -1 } : null);
            };
          };
        });
      }, userId);
      expect(stored?.type).toBe("image/webp");
      expect(stored?.size).toBeGreaterThan(0);
      expect(stored?.previewType).toMatch(/^image\//);

      // A broken copy on the phone (as seen on an iPhone before the fix: «?» instead of the picture): it is replaced
      // by a fresh one from the cloud by itself; the file in the cloud is not touched
      await B.evaluate(async (uid) => {
        const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n && n.includes("attachments") && n.includes(uid));
        await new Promise<void>((resolve) => {
          const open = indexedDB.open(name!);
          open.onsuccess = () => {
            const store = open.result.transaction("attachments", "readwrite").objectStore("attachments");
            const all = store.getAll();
            all.onsuccess = () => {
              const garbage = { bytes: new Uint8Array([1, 2, 3, 4]).buffer, type: "image/webp" };
              store.put({ ...all.result[0], originalBlob: garbage, previewBlob: garbage });
              store.transaction.oncomplete = () => resolve();
            };
          };
        });
      }, userId);
      const cloudBefore = (await (await request.get(`${FAKE_SUPABASE}/__test/storage?email=${encodeURIComponent(email)}`)).json()).files;
      await B.reload();
      await openTrade();
      await drawn(B, thumb);
      await B.locator('[data-testid="trade-quick-view"] .aspect-video').first().click();
      await drawn(B, '[data-testid="lightbox-image"]');
      await B.keyboard.press("Escape");
      expect((await (await request.get(`${FAKE_SUPABASE}/__test/storage?email=${encodeURIComponent(email)}`)).json()).files).toEqual(cloudBefore);

      // A screenshot added on the phone itself is drawn too (stored as bytes on WebKit)
      await B.locator("input[type='file'][accept='image/*']").setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: solidPng(64, 64, [80, 52, 143]) });
      await expect(B.locator(thumb)).toHaveCount(2, { timeout: 15000 });
      await drawn(B, `${thumb} >> nth=1`);
    } finally {
      await wk.close();
      await aContext.close();
    }
  });
});
