import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { marketGuest } from "./helpers/market";

// Market 1.3b: the Chart as a workspace — as tall as the window, the Watchlist panel beside it (a click switches the
// chart, it folds), favourite timeframes with «+», the site's background and grid, the drawing toolbar with a line
// saying drawings are not kept, notes per instrument, «Set up the view». TradingView is a stub (no real network).

const el = (page: Page, id: string) => page.getByTestId(id);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const chartConfig = (page: Page) => el(page, "market-chart-widget").locator("script").evaluate((s) => JSON.parse(s.textContent || "{}"));
const box = async (page: Page, id: string) => (await el(page, id).boundingBox())!;

async function addToList(page: Page, ids: string[]) {
  await page.goto("/market?tab=watchlist");
  await el(page, "market-watchlist-add").click();
  for (const id of ids) {
    const tab = { eurusd: "forex", gbpusd: "forex", btc: "crypto", gold: "commodities" }[id]!;
    await page.locator(`#market-watchlist-cat-tab-${tab}`).click();
    await el(page, `market-watchlist-pick-${id}`).click();
  }
  await el(page, "market-watchlist-add").click();
}

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — the Chart workspace (1.3b)`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    for (const width of [1440, 360]) {
      test(`${width}: as tall as the window; the list ${width === 1440 ? "beside" : "under"} the chart switches it; nothing off the screen`, async () => {
        const { page } = await marketGuest(browser, width);
        await addToList(page, ["eurusd", "btc", "gold"]);
        await page.getByRole("tab", { name: "График" }).click();
        await expect(el(page, "market-chart-widget")).toHaveAttribute("data-status", "ready");

        // the chart row fills the page's scroll area (its height minus padding and the toolbar)
        // the height follows a ResizeObserver: poll until it settles
        const gap = () => page.evaluate(() => {
          const main = document.querySelector("main")!;
          const s = getComputedStyle(main);
          const toolbar = (document.querySelector("[data-testid=market-chart-row]")!.previousElementSibling as HTMLElement).offsetHeight;
          const free = main.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) - toolbar - 12;
          return Math.abs(document.querySelector("[data-testid=market-chart-row]")!.getBoundingClientRect().height - Math.max(380, free));
        });
        await expect.poll(gap).toBeLessThanOrEqual(2);

        const chart = await box(page, "market-chart-widget");
        const panel = await box(page, "market-chart-panel");
        if (width === 1440) {
          expect(panel.x).toBeGreaterThan(chart.x + chart.width - 1);
          // the right column starts level with the chart (the time card on top, then the list)
          expect(Math.abs((await box(page, "market-chart-side")).y - chart.y)).toBeLessThan(4);
        } else {
          expect(panel.y).toBeGreaterThan(chart.y + chart.height - 1);
        }
        await el(page, "market-chart-panel-btc").click();
        await expect(el(page, "market-chart-name")).toHaveText("Биткоин (BTC)");
        await expect(el(page, "market-chart-panel-btc")).toHaveAttribute("aria-current", "true");
        await expect(page).toHaveURL(/symbol=BITSTAMP%3ABTCUSD/);
        expect((await chartConfig(page)).symbol).toBe("BITSTAMP:BTCUSD");
        expect(await noSideScroll(page)).toBe(true);

        // fold: kept after a reload
        await el(page, "market-chart-panel-fold").click();
        await expect(el(page, "market-chart-panel")).toHaveAttribute("data-folded", "true");
        await expect(el(page, "market-chart-panel-btc")).toHaveCount(0);
        await page.reload();
        await expect(el(page, "market-chart-panel")).toHaveAttribute("data-folded", "true");
        await el(page, "market-chart-panel-fold").click();
        await expect(el(page, "market-chart-panel-eurusd")).toBeVisible();

        await el(page, "market-chart-note").fill("Жду реакцию от уровня 76 000.");
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 1500 });
        await el(page, "market-chart").evaluate((e) => e.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: `test-results/market-chart-workspace-${engine}-${width}.png` });
      });
    }

    test("timeframes: 1m 5m 15m 1h 4h 1D by default; «+» adds and removes favourites; kept after a reload", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      const bar = el(page, "market-chart-intervals").getByRole("radio");
      await expect(bar).toHaveText(["1м", "5м", "15м", "1ч", "4ч", "1Д"]);
      await el(page, "market-chart-intervals-more").click();
      await expect(el(page, "market-chart-favorite-30")).toHaveAttribute("aria-checked", "false");
      await el(page, "market-chart-favorite-30").click();
      await el(page, "market-chart-favorite-1").click();
      await expect(bar).toHaveText(["5м", "15м", "30м", "1ч", "4ч", "1Д"]);
      await page.keyboard.press("Escape");
      await page.mouse.click(5, 5);
      await el(page, "market-chart-interval-30").click();
      expect((await chartConfig(page)).interval).toBe("30");
      await page.reload();
      await expect(bar).toHaveText(["5м", "15м", "30м", "1ч", "4ч", "1Д"]);
      await expect(el(page, "market-chart-interval-30")).toHaveAttribute("aria-checked", "true");
    });

    test("the picker opens on the category of the shown instrument", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart&symbol=OANDA%3AXAUUSD");
      await expect(el(page, "market-chart-name")).toHaveText("Золото");
      await el(page, "market-chart-change").click();
      await expect(page.locator("#market-chart-cat-tab-commodities")).toHaveAttribute("aria-selected", "true");
      await expect(el(page, "market-chart-pick-gold")).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(el(page, "market-chart-picker")).toHaveCount(0);
    });

    test("the site's background and grid; the drawing toolbar on with a line that drawings are not kept", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      await expect(el(page, "market-chart-widget")).toHaveAttribute("data-status", "ready");
      expect(await chartConfig(page)).toMatchObject({ backgroundColor: "#18171f", gridColor: "rgba(163, 138, 209, 0.07)", hide_side_toolbar: false, hide_top_toolbar: true });
      await expect(el(page, "market-chart-drawing-note")).toHaveText("Рисунки на графике TradingView не сохраняются: после перезагрузки или смены инструмента их не будет.");
    });

    test("notes: one per instrument, saved on the device, cleared", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart&symbol=BITSTAMP%3ABTCUSD");
      await expect(el(page, "market-chart-notes")).toHaveAttribute("aria-label", "Заметка: Биткоин (BTC)");
      await el(page, "market-chart-note").fill("Уровень 76 000");
      await expect(el(page, "market-chart-note-saved")).toContainText("Сохранено на этом устройстве");
      await page.goto("/market?tab=chart&symbol=OANDA%3AXAUUSD");
      await expect(el(page, "market-chart-note")).toHaveValue("");
      await page.goto("/market?tab=chart&symbol=BITSTAMP%3ABTCUSD");
      await expect(el(page, "market-chart-note")).toHaveValue("Уровень 76 000");
      await el(page, "market-chart-note-clear").click();
      await expect(el(page, "market-chart-note")).toHaveValue("");
      await page.reload();
      await expect(el(page, "market-chart-note")).toHaveValue("");
    });

    test("«Set up the view»: the list off or on the left, notes beside, no drawing toolbar; kept after a reload", async () => {
      const { page } = await marketGuest(browser, 1440);
      await addToList(page, ["eurusd"]);
      await page.getByRole("tab", { name: "График" }).click();
      await el(page, "market-chart-view-open").click();
      await expect(el(page, "market-chart-view")).toBeVisible();

      await el(page, "market-chart-view-side").getByRole("radio", { name: "Слева" }).click();
      await el(page, "market-chart-view-notes-place").getByRole("radio", { name: "Сбоку, под списком" }).click();
      await el(page, "market-chart-view-drawing").getByRole("switch").click();
      await el(page, "market-chart-view-close").click();
      const chart = await box(page, "market-chart-widget");
      const panel = await box(page, "market-chart-panel");
      expect(panel.x + panel.width).toBeLessThan(chart.x + 1);
      await expect(el(page, "market-chart-side").getByTestId("market-chart-notes")).toBeVisible();
      expect((await chartConfig(page)).hide_side_toolbar).toBe(true);
      await expect(el(page, "market-chart-drawing-note")).toHaveCount(0);

      await page.reload();
      await expect(el(page, "market-chart-side").getByTestId("market-chart-notes")).toBeVisible();
      expect((await chartConfig(page)).hide_side_toolbar).toBe(true);

      await el(page, "market-chart-view-open").click();
      await el(page, "market-chart-view-watchlist").getByRole("switch").click();
      await el(page, "market-chart-view-notes").getByRole("switch").click();
      await el(page, "market-chart-view-close").click();
      await expect(el(page, "market-chart-panel")).toHaveCount(0);
      await expect(el(page, "market-chart-notes")).toHaveCount(0);

      await el(page, "market-chart-view-open").click();
      await el(page, "market-chart-view-reset").click();
      await el(page, "market-chart-view-close").click();
      await expect(el(page, "market-chart-panel")).toBeVisible();
      await expect(el(page, "market-chart-notes")).toBeVisible();
      expect((await chartConfig(page)).hide_side_toolbar).toBe(false);
    });
  });
}
