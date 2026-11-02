import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { marketGuest } from "./helpers/market";

// «Chart type», «Indicators» (our list, no «Technical ratings») and keys 1–6 for the first six timeframes.
// TradingView is a stub (no real network): the chart's settings are read from the widget's config.

const el = (page: Page, id: string) => page.getByTestId(id);
const chartConfig = (page: Page) => el(page, "market-chart-widget").locator("script").evaluate((s) => JSON.parse(s.textContent || "{}"));
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — chart type, indicators, keys 1–6`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    test("chart type: ten kinds; the choice goes to the chart and stays after a reload", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      expect((await chartConfig(page)).style).toBe("1");
      await el(page, "market-chart-type").click();
      await expect(el(page, "market-chart-types").getByRole("radio")).toHaveText([
        "Свечи",
        "Полые свечи",
        "Бары",
        "Хейкен Аши",
        "Линия",
        "Область",
        "Базовая линия",
        "Колонки",
        "Максимум–минимум",
        "Область HLC",
      ]);
      await el(page, "market-chart-type-2").click();
      await expect(el(page, "market-chart-types")).toHaveCount(0);
      await expect(el(page, "market-chart-type")).toContainText("Линия");
      expect((await chartConfig(page)).style).toBe("2");
      await page.reload();
      expect((await chartConfig(page)).style).toBe("2");
    });

    test("indicators: our list without «Technical ratings», at most six, «Remove all»; kept after a reload", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      await el(page, "market-chart-indicators").click();
      const list = el(page, "market-chart-indicators-list");
      await expect(list).toContainText("Оценок «покупать / продавать» в списке нет");
      await expect(list).not.toContainText(/Technical|Технический рейтинг/i);
      await expect(list.getByRole("checkbox")).toHaveCount(16);
      await el(page, "market-chart-indicator-rsi").click();
      await el(page, "market-chart-indicator-bb").click();
      await expect(el(page, "market-chart-indicators-count")).toHaveText("2");
      expect((await chartConfig(page)).studies).toEqual(["STD;RSI", "STD;Bollinger_Bands"]);
      for (const id of ["sma", "ema", "vwap", "macd"]) await el(page, `market-chart-indicator-${id}`).click();
      await expect(el(page, "market-chart-indicators-count")).toHaveText("6");
      await expect(el(page, "market-chart-indicator-atr")).toBeDisabled();
      await page.keyboard.press("Escape");
      await page.mouse.click(700, 20);
      await page.reload();
      expect((await chartConfig(page)).studies).toHaveLength(6);
      await el(page, "market-chart-indicators").click();
      await el(page, "market-chart-indicators-clear").click();
      await expect(el(page, "market-chart-indicators-count")).toHaveCount(0);
      expect((await chartConfig(page)).studies).toEqual([]);
    });

    test("keys 1–6 switch the first six timeframes; not while typing a note", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      await expect(el(page, "market-chart-interval-1")).toHaveAttribute("title", "Клавиша 1");
      await expect(el(page, "market-chart-interval-D")).toHaveAttribute("title", "Клавиша 6");
      await page.locator("body").click({ position: { x: 5, y: 300 } });
      await page.keyboard.press("2");
      await expect(el(page, "market-chart-interval-5")).toHaveAttribute("aria-checked", "true");
      expect((await chartConfig(page)).interval).toBe("5");
      await page.keyboard.press("6");
      await expect(el(page, "market-chart-interval-D")).toHaveAttribute("aria-checked", "true");
      // typing «3» in the note changes nothing
      await el(page, "market-chart-note").fill("");
      await el(page, "market-chart-note").press("3");
      await expect(el(page, "market-chart-note")).toHaveValue("3");
      await expect(el(page, "market-chart-interval-D")).toHaveAttribute("aria-checked", "true");
      // the hint is in the «+» window
      await el(page, "market-chart-intervals-more").click();
      await expect(el(page, "market-chart-hotkeys-hint")).toContainText("Клавиши 1–6");
    });

    test("360: the buttons fit, the menus open, nothing off the screen", async () => {
      const { page } = await marketGuest(browser, 360);
      await page.goto("/market?tab=chart");
      await el(page, "market-chart-type").click();
      await expect(el(page, "market-chart-types")).toBeVisible();
      await el(page, "market-chart-type-8").click();
      await el(page, "market-chart-indicators").click();
      await expect(el(page, "market-chart-indicators-list")).toBeVisible();
      const box = (await el(page, "market-chart-indicators-list").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: `test-results/market-chart-indicators-${engine}-360.png` });
    });
  });
}
