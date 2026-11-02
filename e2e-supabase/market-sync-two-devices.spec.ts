import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Market data in the account (migration 0008, owner 2026-11-02): the Watchlist, notes per instrument and the chart
// view follow the account to any device. The newest change wins; the first time a device syncs, its own Watchlist
// is joined with the account's without duplicates. Two browser contexts = two devices, against the fake Supabase.
// TradingView scripts are aborted (no network): the widgets say «not responding», the rest of the page works.

type Row = { table: string; id: string; data: Record<string, unknown> };
const marketRows = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[]).filter((r) => r.table === "market_user_data");
const setFlag = (request: APIRequestContext, email: string, on: boolean) => request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=${on ? 1 : 0}`);

async function openDevice(browser: { newContext: () => Promise<BrowserContext> }) {
  const context = await browser.newContext();
  await context.route("https://s3.tradingview.com/**", (r) => r.abort());
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { context, page };
}

async function addToWatchlist(page: Page, picks: [string, string][]) {
  await page.goto("/market?tab=watchlist");
  await page.getByTestId("market-watchlist-add").click();
  for (const [tab, id] of picks) {
    await page.locator(`#market-watchlist-cat-tab-${tab}`).click();
    await page.getByTestId(`market-watchlist-pick-${id}`).click();
  }
  await page.getByTestId("market-watchlist-add").click();
}

const rowsOf = (page: Page) => page.getByTestId("market-watchlist-rows").getByRole("listitem");

test.describe("Market data in the account: two devices", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);

  test("the laptop's list, note and view reach the phone; the phone's own list is joined, not lost; a cleared note clears everywhere", async ({ browser, request }) => {
    const email = `MarketSync_${Date.now()}@example.com`;

    // Laptop: new account, sync switch on (fake server only)
    const A = await openDevice(browser);
    await signIn(A.page, email);
    await completeOnboarding(A.page, `Mkt${Date.now() % 100000}`);
    await setFlag(request, email, true);
    await addToWatchlist(A.page, [
      ["crypto", "btc"],
      ["commodities", "gold"],
    ]);
    await expect(A.page.getByTestId("market-watchlist-count")).toContainText("Список сохраняется в аккаунте");
    // a note on BTC and the time card under the note
    await A.page.goto("/market?tab=chart&symbol=BITSTAMP%3ABTCUSD");
    await A.page.getByTestId("market-chart-note").fill("Уровень 76 000");
    await A.page.getByTestId("market-chart-view-open").click();
    await A.page.getByTestId("market-chart-view-clock-bottom").click();
    await A.page.getByTestId("market-chart-view-close").click();
    await expect
      .poll(async () => (await marketRows(request, email)).map((r) => r.id).sort(), { timeout: 15000 })
      .toEqual(["chart_view", "note:btc", "watchlist"]);
    expect((await marketRows(request, email)).find((r) => r.id === "watchlist")?.data.ids).toEqual(["btc", "gold"]);

    // Phone: the same account; first it has its own list while the switch is off (kept only on the phone)
    await setFlag(request, email, false);
    const B = await openDevice(browser);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await addToWatchlist(B.page, [["forex", "eurusd"]]);
    await expect(B.page.getByTestId("market-watchlist-count")).toContainText("Список хранится на этом устройстве");
    expect((await marketRows(request, email)).find((r) => r.id === "watchlist")?.data.ids).toEqual(["btc", "gold"]);

    // the switch on: the phone joins its list with the account's — nothing is lost, no duplicates
    await setFlag(request, email, true);
    await B.page.reload();
    await expect(rowsOf(B.page)).toHaveCount(3);
    await expect(rowsOf(B.page)).toContainText(["Биткоин (BTC)", "Золото", "EUR/USD"]);
    await expect.poll(async () => (await marketRows(request, email)).find((r) => r.id === "watchlist")?.data.ids, { timeout: 15000 }).toEqual(["btc", "gold", "eurusd"]);

    // the note and the view came to the phone
    await B.page.goto("/market?tab=chart&symbol=BITSTAMP%3ABTCUSD");
    await expect(B.page.getByTestId("market-chart-note")).toHaveValue("Уровень 76 000");
    await expect(B.page.getByTestId("market-chart-note-saved")).toContainText("Сохранено в аккаунте");
    await B.page.getByTestId("market-chart-view-open").click();
    await expect(B.page.getByTestId("market-chart-view-clock-bottom")).toHaveAttribute("aria-checked", "true");
    await B.page.getByTestId("market-chart-view-close").click();

    // the phone clears the note and removes gold: the newest change wins on the laptop
    await B.page.getByTestId("market-chart-note-clear").click();
    await B.page.goto("/market?tab=watchlist");
    await B.page.getByTestId("market-watchlist-remove-gold").click();
    await expect.poll(async () => (await marketRows(request, email)).find((r) => r.id === "watchlist")?.data.ids, { timeout: 15000 }).toEqual(["btc", "eurusd"]);
    await expect.poll(async () => (await marketRows(request, email)).find((r) => r.id === "note:btc")?.data.deletedAt, { timeout: 15000 }).toBeTruthy();

    await A.page.goto("/market?tab=watchlist");
    await expect(rowsOf(A.page)).toHaveCount(2);
    await expect(rowsOf(A.page)).toContainText(["Биткоин (BTC)", "EUR/USD"]);
    await A.page.goto("/market?tab=chart&symbol=BITSTAMP%3ABTCUSD");
    await expect(A.page.getByTestId("market-chart-note")).toHaveValue("");

    await A.context.close();
    await B.context.close();
  });

  test("chart settings follow the account: favourites, chart type, indicators, layout; each device keeps its own instrument", async ({ browser, request }) => {
    const email = `MarketPrefs_${Date.now()}@example.com`;
    const A = await openDevice(browser);
    await signIn(A.page, email);
    await completeOnboarding(A.page, `Prf${Date.now() % 100000}`);
    await setFlag(request, email, true);
    await A.page.goto("/market?tab=chart&symbol=FX%3AEURUSD");
    // chart type, two indicators, four windows, a favourite timeframe more
    await A.page.getByTestId("market-chart-type").click();
    await A.page.getByTestId("market-chart-type-8").click();
    await A.page.getByTestId("market-chart-indicators").click();
    await A.page.getByTestId("market-chart-indicator-rsi").click();
    await A.page.getByTestId("market-chart-indicator-macd").click();
    await A.page.keyboard.press("Escape");
    await A.page.mouse.click(5, 300);
    await A.page.getByTestId("market-chart-layout").click();
    await A.page.getByTestId("market-chart-layout-4").click();
    await A.page.keyboard.press("Escape");
    await A.page.mouse.click(5, 300);
    await A.page.getByTestId("market-chart-intervals-more").click();
    await A.page.getByTestId("market-chart-favorite-30").click();
    await A.page.keyboard.press("Escape");
    await A.page.mouse.click(5, 300);
    await expect
      .poll(async () => (await marketRows(request, email)).find((r) => r.id === "chart_view")?.data.chart, { timeout: 15000 })
      .toMatchObject({ style: "8", indicators: ["rsi", "macd"], layout: 4, favorites: ["1", "5", "15", "30", "60", "240", "D"] });

    // the phone: its own instrument stays, the settings come in
    const B = await openDevice(browser);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await B.page.goto("/market?tab=chart&symbol=BITSTAMP%3ABTCUSD");
    await expect(B.page.getByTestId("market-chart-grid")).toHaveAttribute("data-layout", "4");
    await expect(B.page.getByTestId("market-chart-name")).toHaveText("Биткоин (BTC)");
    await expect(B.page.getByTestId("market-chart-indicators-count")).toHaveText("2");
    await expect(B.page.getByTestId("market-chart-type")).toContainText("Хейкен Аши");
    await expect(B.page.getByTestId("market-chart-interval-30")).toBeVisible();

    // the phone switches back to one chart: the laptop follows; its own instrument stays EUR/USD
    await B.page.getByTestId("market-chart-layout").click();
    await B.page.getByTestId("market-chart-layout-1").click();
    await expect.poll(async () => ((await marketRows(request, email)).find((r) => r.id === "chart_view")?.data.chart as { layout?: number })?.layout, { timeout: 15000 }).toBe(1);
    await A.page.reload();
    await expect(A.page.getByTestId("market-chart-grid")).toHaveAttribute("data-layout", "1");
    await expect(A.page.getByTestId("market-chart-name")).toHaveText("EUR/USD");
    await A.context.close();
    await B.context.close();
  });

  test("the switch off: the Market stays on the device, nothing goes to the cloud", async ({ browser, request }) => {
    const email = `MarketOff_${Date.now()}@example.com`;
    const A = await openDevice(browser);
    await signIn(A.page, email);
    await completeOnboarding(A.page, `Off${Date.now() % 100000}`);
    await addToWatchlist(A.page, [["crypto", "btc"]]);
    await expect(A.page.getByTestId("market-watchlist-count")).toContainText("Список хранится на этом устройстве");
    await A.page.waitForTimeout(2500);
    expect(await marketRows(request, email)).toEqual([]);
    await A.context.close();
  });
});
