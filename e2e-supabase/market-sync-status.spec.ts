import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// The Market sync must never fail silently (owner 2026-11-02): the cloud switch off, the 0008 table missing — each
// is said on the page; «Sync now» tries again; a change still waiting is sent when the Market is left at once.

type Row = { table: string; id: string; data: Record<string, unknown> };
const marketRows = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[]).filter((r) => r.table === "market_user_data");
const setFlag = (request: APIRequestContext, email: string, on: boolean) => request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=${on ? 1 : 0}`);
const setTable = (request: APIRequestContext, present: boolean) => request.get(`${FAKE_SUPABASE}/__test/market-table?present=${present ? 1 : 0}`);

async function openDevice(browser: { newContext: () => Promise<BrowserContext> }) {
  const context = await browser.newContext();
  await context.route("https://s3.tradingview.com/**", (r) => r.abort());
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { context, page };
}

test.describe("Market sync: what is wrong is said on the page", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => {
    await setTable(request, true);
  });

  test("switch off → «The cloud is off»; table missing → «migration 0008»; both fixed → «In your account» after «Sync now»", async ({ browser, request }) => {
    const email = `MarketStatus_${Date.now()}@example.com`;
    const A = await openDevice(browser);
    await signIn(A.page, email);
    await completeOnboarding(A.page, `Sts${Date.now() % 100000}`);
    await A.page.goto("/market?tab=watchlist");
    const line = A.page.getByTestId("market-sync");
    await expect(line).toHaveAttribute("data-kind", "flagOff");
    await expect(A.page.getByTestId("market-sync-text")).toContainText("Облако выключено для этого аккаунта");

    await setFlag(request, email, true);
    await setTable(request, false);
    await A.page.getByTestId("market-sync-now").click();
    await expect(line).toHaveAttribute("data-kind", "noTable");
    await expect(A.page.getByTestId("market-sync-text")).toContainText("миграция 0008 не применена");
    await expect(A.page.getByTestId("market-watchlist-count")).toContainText("Список хранится на этом устройстве");

    await setTable(request, true);
    await A.page.getByTestId("market-sync-now").click();
    await expect(line).toHaveAttribute("data-kind", "on");
    await expect(A.page.getByTestId("market-sync-text")).toContainText("В аккаунте · обновлено в");
    await expect(A.page.getByTestId("market-watchlist-count")).toContainText("Список сохраняется в аккаунте");
    // the line is under the chart too
    await A.page.goto("/market?tab=chart");
    await expect(A.page.getByTestId("market-sync")).toHaveAttribute("data-kind", "on");
    await A.context.close();
  });

  test("a change made just before leaving the Market is sent at once (not left waiting on the device)", async ({ browser, request }) => {
    const email = `MarketFlush_${Date.now()}@example.com`;
    const A = await openDevice(browser);
    await signIn(A.page, email);
    await completeOnboarding(A.page, `Fls${Date.now() % 100000}`);
    await setFlag(request, email, true);
    await A.page.goto("/market?tab=chart&symbol=BITSTAMP%3ABTCUSD");
    await expect(A.page.getByTestId("market-sync")).toHaveAttribute("data-kind", "on");
    await A.page.getByTestId("market-chart-note").fill("Уровень 76 000");
    // leave at once, well within the 1.5 s pause
    await A.page.getByRole("link", { name: "Главная" }).first().click();
    await expect
      .poll(async () => (await marketRows(request, email)).find((r) => r.id === "note:btc")?.data.text, { timeout: 10000 })
      .toBe("Уровень 76 000");
    await A.context.close();
  });
});
