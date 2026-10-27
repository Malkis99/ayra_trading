import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// «First action» rewards are once per account: a journal downloaded on another device is not a new first trade
// (docs/economy-coins-plan.md). Progress itself stays on each device until the server economy (0007).

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

const cloudTrades = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as { table: string }[]).filter((r) => r.table === "journal_trades");
const game = (page: Page, userId: string) =>
  page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`) || "{}"), userId) as Promise<{ coins: number; firstActions?: Record<string, string> }>;
const markFirstSyncDone = (page: Page, userId: string) =>
  page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);

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

test("first trade on A is rewarded once; on B, after the journal came from the cloud, a new trade is not «the first»", async ({ browser, request }) => {
  test.setTimeout(150_000);
  const email = `Firsts_${Date.now()}@example.com`;
  const A = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(A, email);
  await completeOnboarding(A, `Firsts${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  await markFirstSyncDone(A, userId);
  await A.reload();
  await addTrade(A, "us30", true);
  await expect.poll(async () => (await cloudTrades(request, email)).length, { timeout: 15000 }).toBe(1);
  const a = await game(A, userId);
  expect(a.firstActions?.trade).toBeTruthy();
  expect(a.firstActions?.account).toBeTruthy();

  // B: an empty device downloads the journal by itself, then a new trade is added there
  const B = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(B, email);
  await B.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
  await B.goto("/journal");
  await expect(B.getByTestId("trades-table")).toContainText("US30", { timeout: 15000 });
  const before = await game(B, userId);
  await addTrade(B, "ger40");
  await expect.poll(async () => (await cloudTrades(request, email)).length, { timeout: 15000 }).toBe(2);
  const b = await game(B, userId);
  expect(b.firstActions?.trade).toBeFalsy();
  // only the daily quest «Trade log» (10), no one-time reward
  expect(b.coins - (before.coins || 0)).toBe(10);
  await B.context().close();
  await A.context().close();
});
