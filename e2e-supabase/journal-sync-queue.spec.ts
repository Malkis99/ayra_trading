import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// T7b-4a: outbox of the cloud journal against the fake Supabase (journal tables + per-user flag, same rules as 0004).
// The flag is turned on ONLY for test users of the fake server; nothing here touches a real project.

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

async function newAccount(page: Page, request: APIRequestContext, tag: string) {
  const email = `${tag}_${Date.now()}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `${tag}${Date.now() % 100000}`);
  const profile = await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json();
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  return { email, userId: profile.id as string };
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

/** Stands in for the first-upload button of step 4d. */
async function markFirstSyncDone(page: Page, userId: string) {
  await page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);
}

const cloudRows = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as {
    table: string;
    id: string;
    data: Record<string, unknown>;
  }[];

const cloudInstruments = async (request: APIRequestContext, email: string) =>
  (await cloudRows(request, email)).filter((r) => r.table === "journal_trades").map((r) => r.data.instrument).sort();

const outbox = (page: Page, userId: string) =>
  page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_sync_outbox`) || "[]") as { id: string }[], userId);

test.describe("Cloud journal outbox (flag on in the fake server)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(90_000);

  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=0`);
  });

  test("empty account and empty cloud: the first sync is done by itself; changes go out after the pause; the queue survives a reload", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { email, userId } = await newAccount(page, request, "Queue");
    await page.reload(); // the flag was turned on after sign-in: fresh answer
    // nothing on either side: nothing to upload or download (T7b-4d), no button needed
    await expect
      .poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_sync_state`) || "{}").initialSyncAt ?? null, userId), { timeout: 15000 })
      .not.toBeNull();

    await addTrade(page, "nas100", true);
    await expect.poll(() => cloudInstruments(request, email), { timeout: 15000 }).toEqual(["NAS100"]);
    expect((await cloudRows(request, email)).map((r) => r.table)).toContain("journal_accounts");

    // the server is down: the change waits in the queue on the device, also through a reload
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=1000`);
    await addTrade(page, "eurusd");
    await expect.poll(async () => (await outbox(page, userId)).length).toBeGreaterThan(0);
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=0`);
    await page.reload();
    await expect.poll(() => cloudInstruments(request, email), { timeout: 20000 }).toEqual(["EURUSD", "NAS100"]);
    await expect.poll(async () => (await outbox(page, userId)).length).toBe(0);
  });

  test("server failure: the change stays queued and is retried", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { email, userId } = await newAccount(page, request, "Retry");
    await markFirstSyncDone(page, userId);
    await page.reload();
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=1`);

    await addTrade(page, "xauusd", true);
    // first try fails (500), the retry after ~1–5 s succeeds; the journal keeps working meanwhile
    await expect(page.locator("main")).toContainText("XAUUSD");
    await expect.poll(() => cloudInstruments(request, email), { timeout: 20000 }).toEqual(["XAUUSD"]);
    await expect.poll(async () => (await outbox(page, userId)).length).toBe(0);
  });

  test("two accounts on one device: A's queued change never reaches B; it waits for A", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const a = await newAccount(page, request, "AccA");
    await markFirstSyncDone(page, a.userId);
    await page.reload();
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=1000`); // A cannot send anything

    await addTrade(page, "gbpusd", true);
    await expect.poll(async () => (await outbox(page, a.userId)).map((e) => e.id).length).toBeGreaterThan(0);
    await page.goto("/settings/account");
    const signOutStarted = Date.now();
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    // Signed out, the app sends a guest from /settings to /login (Shell rule 2). The guest header with a "Войти" link
    // is only visible for a moment before that redirect, so wait for the final state: the sign-in screen.
    // Sign-out itself may wait up to 3 s for the queue (plan 1.4).
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Войди во вселенную" })).toBeVisible();
    console.log(`[e2e] sign-out took ${Date.now() - signOutStarted} ms`);

    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=0`);
    const b = await newAccount(page, request, "AccB");
    await markFirstSyncDone(page, b.userId);
    await page.reload();
    await addTrade(page, "usdjpy", true);
    await expect.poll(() => cloudInstruments(request, b.email), { timeout: 15000 }).toEqual(["USDJPY"]);

    // nothing of A in B's cloud, nothing in A's cloud while A is signed out; A's queue is still on the device
    const bTrades = (await cloudRows(request, b.email)).filter((r) => r.table === "journal_trades");
    expect(bTrades.map((r) => r.data.instrument)).toEqual(["USDJPY"]);
    expect(await cloudRows(request, a.email)).toEqual([]);
    expect((await outbox(page, a.userId)).length).toBeGreaterThan(0);
    expect(await page.evaluate((id) => localStorage.getItem(`ayra:${id}:ayra_journal_v1`) || "", b.userId)).not.toContain("GBPUSD");
  });
});
