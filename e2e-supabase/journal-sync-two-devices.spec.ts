import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// T7b-4b: two devices of one account (two browser contexts = two separate browsers) against the fake Supabase.
// The flag is on ONLY for test users of the fake server; nothing here touches a real project.

async function addTrade(page: Page, instrument: string, firstAccount = false, navigate = true) {
  // offline a page cannot be loaded: then the trade is added on the already open journal
  if (navigate) await page.goto("/journal");
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

/** Stands in for the first-upload step of 4d. */
async function markFirstSyncDone(page: Page, userId: string) {
  await page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);
}

type Row = { table: string; id: string; data: Record<string, unknown> };
const cloudRows = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[];
const cloudTrades = async (request: APIRequestContext, email: string) => (await cloudRows(request, email)).filter((r) => r.table === "journal_trades");

const local = (page: Page, userId: string, key: string) =>
  page.evaluate(([id, k]) => JSON.parse(localStorage.getItem(`ayra:${id}:${k}`) || "null"), [userId, key]);

async function openDevice(browser: { newContext: () => Promise<BrowserContext> }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { context, page };
}

test.describe("Cloud journal: two devices of one account", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);

  test("an edit on A reaches B; deleted on A while B edits offline -> conflict on B, both versions kept", async ({ browser, request }) => {
    const email = `TwoDev_${Date.now()}@example.com`;

    // Device A: new account, flag on (fake server only), first sync done
    const A = await openDevice(browser);
    await signIn(A.page, email);
    await completeOnboarding(A.page, `TwoDev${Date.now() % 100000}`);
    const profile = await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json();
    const userId = profile.id as string;
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
    await markFirstSyncDone(A.page, userId);
    await A.page.reload();
    await addTrade(A.page, "nas100", true);
    await expect.poll(async () => (await cloudTrades(request, email)).map((r) => r.data.instrument), { timeout: 15000 }).toEqual(["NAS100"]);
    const tradeId = (await cloudTrades(request, email))[0].id;

    // Device B: same account, signs in; pulls A's trade and account
    const B = await openDevice(browser);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await markFirstSyncDone(B.page, userId);
    await B.page.goto("/journal");
    await expect(B.page.getByTestId("trades-table")).toContainText("NAS100", { timeout: 15000 });

    // B goes offline and edits the trade; meanwhile A deletes it
    await B.context.setOffline(true);
    await B.page.click("tr:has-text('NAS100')");
    await B.page.click("button:has-text('Редактировать')");
    // the edit form fills in the current value right after it opens: wait for it, or typing may be appended to it
    await expect(B.page.getByTestId("instrument-input")).toHaveValue("NAS100");
    await B.page.getByTestId("instrument-input").fill("ger40");
    await B.page.click("button:has-text('Сохранить сделку')");
    await expect(B.page.getByTestId("trades-table")).toContainText("GER40");
    await expect.poll(async () => ((await local(B.page, userId, "ayra_sync_outbox")) || []).length).toBeGreaterThan(0);

    await A.page.goto("/journal");
    await A.page.click("tr:has-text('NAS100')");
    await A.page.click("button:has-text('Удалить')");
    await expect(A.page.locator("text=Удалить сделку?")).toBeVisible();
    await A.page.locator("button:has-text('Удалить')").first().click();
    await expect.poll(async () => (await cloudTrades(request, email))[0].data.deletedAt, { timeout: 15000 }).toBeTruthy();

    // B is back online: the pull finds both changes -> a conflict; nothing is overwritten on either side
    await B.context.setOffline(false);
    await B.page.reload();
    await expect.poll(async () => Object.keys((await local(B.page, userId, "ayra_sync_conflicts")) || {}), { timeout: 15000 }).toEqual([
      `journal_trades:${tradeId}`,
    ]);
    const conflict = (await local(B.page, userId, "ayra_sync_conflicts"))[`journal_trades:${tradeId}`];
    expect(conflict.cloud.deletedAt).toBeTruthy(); // the deletion from A is kept aside
    await expect(B.page.getByTestId("trades-table")).toContainText("GER40"); // B's version still shown
    const cloudNow = (await cloudTrades(request, email))[0];
    expect(cloudNow.data.deletedAt).toBeTruthy(); // B's edit did not overwrite A's deletion
    expect(cloudNow.data.instrument).toBe("NAS100");
    // the trade itself is never erased on A: a tombstone with deletedAt
    const aJournal = await local(A.page, userId, "ayra_journal_v1");
    expect(aJournal.trades.find((t: { id: string }) => t.id === tradeId).deletedAt).toBeTruthy();

    await A.context.close();
    await B.context.close();
  });

  test("offline device: its edits wait, the other device's edits arrive when it is back", async ({ browser, request }) => {
    const email = `Offline_${Date.now()}@example.com`;
    const A = await openDevice(browser);
    await signIn(A.page, email);
    await completeOnboarding(A.page, `Offl${Date.now() % 100000}`);
    const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id) as string;
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
    await markFirstSyncDone(A.page, userId);
    await A.page.reload();
    await addTrade(A.page, "eurusd", true);
    await expect.poll(async () => (await cloudTrades(request, email)).length, { timeout: 15000 }).toBe(1);

    const B = await openDevice(browser);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await markFirstSyncDone(B.page, userId);
    await B.page.goto("/journal");
    await expect(B.page.getByTestId("trades-table")).toContainText("EURUSD", { timeout: 15000 });

    await B.context.setOffline(true);
    await addTrade(B.page, "xauusd", false, false);
    await addTrade(A.page, "gbpusd");
    await expect.poll(async () => (await cloudTrades(request, email)).map((r) => r.data.instrument).sort(), { timeout: 15000 }).toEqual(["EURUSD", "GBPUSD"]);

    await B.context.setOffline(false);
    await B.page.reload();
    await expect(B.page.getByTestId("trades-table")).toContainText("GBPUSD", { timeout: 15000 });
    await expect.poll(async () => (await cloudTrades(request, email)).map((r) => r.data.instrument).sort(), { timeout: 15000 }).toEqual([
      "EURUSD",
      "GBPUSD",
      "XAUUSD",
    ]);
    await A.page.reload();
    await expect(A.page.getByTestId("trades-table")).toContainText("XAUUSD", { timeout: 15000 });
    expect(Object.keys((await local(B.page, userId, "ayra_sync_conflicts")) || {})).toEqual([]);

    await A.context.close();
    await B.context.close();
  });
});
