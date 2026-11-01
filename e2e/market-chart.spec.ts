import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { stubTradingView } from "./helpers/tradingview";

// Market 1.3: the Chart (TradingView's chart of a catalog instrument, our timeframe buttons, remembered) and the
// Watchlist (on the device, add / remove / up / down, «Chart»). «Chart» buttons in the Overview open the Chart of that
// instrument in this browser tab. TradingView is a stub here (no real network): see e2e/helpers/tradingview.ts.

async function guestPage(browser: Browser, width: number, opts: { minor?: boolean; tradingView?: "ok" | "unavailable" } = {}): Promise<{ page: Page; scripts: string[] }> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Tbilisi", reducedMotion: "reduce" });
  await stubTradingView(context, opts.tradingView ?? "ok");
  const page = await context.newPage();
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("tradingview")) scripts.push(r.url());
  });
  await page.addInitScript(
    ({ minor }) => {
      if (sessionStorage.getItem("e2e_seeded")) return;
      sessionStorage.setItem("e2e_seeded", "1");
      localStorage.clear();
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "MarketTrader",
          level: 1,
          xp: 0,
          coins: 0,
          createdAt: "2026-10-08",
          completedQuestsToday: {},
          lastQuestDate: "2026-10-08",
          onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
          profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: minor, timezone: "Asia/Tbilisi" },
        })
      );
    },
    { minor: !!opts.minor }
  );
  return { page, scripts };
}

const el = (page: Page, id: string) => page.getByTestId(id);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const chartConfig = (page: Page) => el(page, "market-chart-widget").locator("script").evaluate((s) => JSON.parse(s.textContent || "{}"));
const stubText = (page: Page, id: string) => el(page, id).frameLocator("iframe").locator("body");

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — Chart and Watchlist`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    for (const width of [1440, 360]) {
      test(`${width}: the Chart — DXY and 1 h by default, a catalog instrument and a timeframe, both kept after a reload`, async () => {
        const { page } = await guestPage(browser, width);
        await page.goto("/market?tab=chart");
        await expect(el(page, "market-chart-name")).toHaveText("Индекс доллара (DXY)");
        await expect(el(page, "market-chart-interval-60")).toHaveAttribute("aria-checked", "true");
        await expect(el(page, "market-chart-widget")).toHaveAttribute("data-status", "ready");
        await expect(stubText(page, "market-chart-widget")).toContainText("CAPITALCOM:DXY");
        await expect(page).toHaveURL(/symbol=CAPITALCOM%3ADXY/);
        await expect(el(page, "market-chart-source")).toHaveText("Источник: TradingView · возможна задержка");
        const config = await chartConfig(page);
        expect(config).toMatchObject({
          symbol: "CAPITALCOM:DXY",
          interval: "60",
          theme: "dark",
          locale: "ru",
          timezone: "America/New_York",
          hide_top_toolbar: true,
          allow_symbol_change: false,
        });

        // the picker opens on the category of the shown instrument (DXY: indices)
        await expect(page.locator("#market-chart-cat-tab-indices")).toHaveAttribute("aria-selected", "true");
        await page.locator("#market-chart-cat-tab-forex").click();
        await el(page, "market-chart-pick-eurusd").click();
        await expect(el(page, "market-chart-name")).toHaveText("EUR/USD");
        await expect(el(page, "market-chart-pick-eurusd")).toHaveAttribute("aria-pressed", "true");
        await expect(page).toHaveURL(/symbol=FX%3AEURUSD/);
        await expect(stubText(page, "market-chart-widget")).toContainText("FX:EURUSD");
        await expect(el(page, "market-chart-source")).toHaveText("Источник: TradingView · в реальном времени");
        await el(page, "market-chart-interval-240").click();
        await expect(el(page, "market-chart-interval-240")).toHaveAttribute("aria-checked", "true");
        expect((await chartConfig(page)).interval).toBe("240");
        expect(await noSideScroll(page)).toBe(true);
        // the page scrolls inside its own container: a tall window shows the whole section
        await page.setViewportSize({ width, height: 1600 });
        await el(page, "market-chart").screenshot({ path: `test-results/market-chart-${engine}-${width}.png` });

        // the tab without ?symbol= takes the last instrument on this device
        await page.goto("/market?tab=chart");
        await expect(el(page, "market-chart-name")).toHaveText("EUR/USD");
        await expect(el(page, "market-chart-interval-240")).toHaveAttribute("aria-checked", "true");
      });
    }

    test("the catalog search: by name or ticker; nothing found says so", async () => {
      const { page } = await guestPage(browser, 360);
      await page.goto("/market?tab=chart");
      await el(page, "market-chart-search").fill("золото");
      await expect(el(page, "market-chart-picker").getByRole("button")).toHaveCount(1);
      await el(page, "market-chart-pick-gold").click();
      await expect(el(page, "market-chart-name")).toHaveText("Золото");
      await el(page, "market-chart-search").fill("btc");
      await expect(el(page, "market-chart-pick-btc")).toBeVisible();
      await el(page, "market-chart-search").fill("aapl");
      await expect(el(page, "market-chart-empty")).toHaveText("В каталоге нет такого инструмента.");
    });

    test("«Chart» in the Overview opens the Chart of that instrument in this browser tab", async () => {
      const { page } = await guestPage(browser, 1440);
      await page.goto("/market");
      await el(page, "market-core-gold-chart").click();
      await expect(page.getByRole("tab", { name: "График" })).toHaveAttribute("aria-selected", "true");
      await expect(el(page, "market-chart-name")).toHaveText("Золото");
      await expect(page).toHaveURL(/tab=chart.*symbol=OANDA%3AXAUUSD/);
      expect(page.context().pages()).toHaveLength(1);

      await page.getByRole("tab", { name: "Обзор" }).click();
      await expect(page).not.toHaveURL(/symbol=/);
      await page.getByRole("tab", { name: "Облигации и доходности" }).click();
      await el(page, "market-category-chart-us10y").click();
      await expect(el(page, "market-chart-name")).toHaveText("Облигации США, 10 лет");
    });

    test("a click inside a widget (?tvwidgetsymbol=): the Chart of it, or a plain notice when it is not in the catalog", async () => {
      const { page } = await guestPage(browser, 1440);
      await page.goto("/market?tvwidgetsymbol=FX%3AGBPUSD");
      await expect(el(page, "market-chart-name")).toHaveText("GBP/USD");
      await expect(el(page, "market-chart-notice")).toHaveCount(0);
      await page.goto("/market?tab=chart&symbol=NASDAQ%3AAAPL");
      await expect(el(page, "market-chart-notice")).toHaveText("Инструмента «NASDAQ:AAPL» нет в каталоге Рынка, поэтому показан GBP/USD.");
      await expect(page).toHaveURL(/symbol=FX%3AGBPUSD/);
    });

    for (const width of [1440, 360]) {
      test(`${width}: the Watchlist — add from the catalog and from the Chart, up / down, remove, kept after a reload`, async () => {
        const { page } = await guestPage(browser, width);
        await page.goto("/market?tab=watchlist");
        await expect(el(page, "market-watchlist")).toContainText("Список пуст");
        await expect(el(page, "market-watchlist-count")).toHaveText("0 из 30 · Список хранится на этом устройстве.");

        await el(page, "market-watchlist-add").click();
        for (const id of ["eurusd", "gbpusd"]) await el(page, `market-watchlist-pick-${id}`).click();
        await page.locator("#market-watchlist-cat-tab-crypto").click();
        await el(page, "market-watchlist-pick-btc").click();
        await expect(el(page, "market-watchlist-pick-btc")).toHaveAttribute("aria-pressed", "true");
        await el(page, "market-watchlist-add").click(); // «Done»
        await expect(el(page, "market-watchlist-count")).toHaveText("3 из 30 · Список хранится на этом устройстве.");
        const rows = el(page, "market-watchlist-rows").getByRole("listitem");
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText("EUR/USD");
        await expect(el(page, "market-watchlist-widget")).toHaveAttribute("data-status", "ready");
        await expect(stubText(page, "market-watchlist-widget")).toContainText("FX:EURUSD · FX:GBPUSD · BITSTAMP:BTCUSD");
        await expect(el(page, "market-watchlist-source")).toHaveText("Источник: TradingView · в реальном времени");

        // order: BTC up to the top, EUR/USD down
        await el(page, "market-watchlist-up-btc").click();
        await el(page, "market-watchlist-up-btc").click();
        await expect(el(page, "market-watchlist-up-btc")).toBeDisabled();
        await el(page, "market-watchlist-down-eurusd").click();
        await expect(rows).toContainText(["Биткоин (BTC)", "GBP/USD", "EUR/USD"]);
        await el(page, "market-watchlist-remove-gbpusd").click();
        await expect(rows).toContainText(["Биткоин (BTC)", "EUR/USD"]);
        expect(await noSideScroll(page)).toBe(true);
        await page.setViewportSize({ width, height: 1400 });
        await el(page, "market-watchlist").screenshot({ path: `test-results/market-watchlist-${engine}-${width}.png` });

        await page.reload();
        await expect(rows).toContainText(["Биткоин (BTC)", "EUR/USD"]);

        // «Chart» from the list; «Add to list» on the Chart
        await el(page, "market-watchlist-chart-eurusd").click();
        await expect(el(page, "market-chart-name")).toHaveText("EUR/USD");
        await expect(el(page, "market-chart-watch")).toHaveAttribute("aria-pressed", "true");
        await expect(el(page, "market-chart-watch")).toHaveText("В списке");
        await page.locator("#market-chart-cat-tab-commodities").click();
        await el(page, "market-chart-pick-oil").click();
        await expect(el(page, "market-chart-watch")).toHaveText("В список");
        await el(page, "market-chart-watch").click();
        await expect(el(page, "market-chart-watch")).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("tab", { name: "Список наблюдения" }).click();
        await expect(rows).toContainText(["Биткоин (BTC)", "EUR/USD", "Нефть WTI"]);
        // oil may be delayed: the list says so
        await expect(el(page, "market-watchlist-source")).toHaveText("Источник: TradingView · возможна задержка");
      });
    }

    test("TradingView does not answer — the Chart says so and «Try again» loads it", async () => {
      const { page } = await guestPage(browser, 360, { tradingView: "unavailable" });
      await page.goto("/market?tab=chart");
      await expect(el(page, "market-chart-widget-error")).toContainText("TradingView сейчас не отвечает");
      await stubTradingView(page.context(), "ok");
      await el(page, "market-chart-widget-retry").click();
      await expect(el(page, "market-chart-widget")).toHaveAttribute("data-status", "ready");
    });

    test("16–17 mode: the Chart and the Watchlist — no links but TradingView's and the app's, no partner parameters, no «Technical analysis»", async () => {
      const { page, scripts } = await guestPage(browser, 1440, { minor: true });
      await page.goto("/market?tab=chart");
      await expect(el(page, "market-chart-widget")).toHaveAttribute("data-status", "ready");
      await el(page, "market-chart-watch").click();
      await page.getByRole("tab", { name: "Список наблюдения" }).click();
      await expect(el(page, "market-watchlist-widget")).toHaveAttribute("data-status", "ready");
      const origin = new URL(page.url()).origin;
      for (const section of ["market-watchlist"]) {
        const links = await el(page, section).locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
        for (const href of links) expect(href === "https://www.tradingview.com/" || href.startsWith(origin)).toBe(true);
      }
      await page.getByRole("tab", { name: "График" }).click();
      const config = await chartConfig(page);
      expect(Object.keys(config).filter((k) => /refer|affil|partner|utm|campaign/i.test(k))).toEqual([]);
      expect(config.hide_top_toolbar).toBe(true);
      expect(scripts.every((u) => /embed-widget-(mini-symbol-overview|market-quotes|advanced-chart)\.js$/.test(u))).toBe(true);
      expect(scripts.some((u) => u.includes("technical-analysis"))).toBe(false);
    });
  });
}
