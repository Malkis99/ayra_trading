import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { marketGuest } from "./helpers/market";

// Layouts 1 / 2 / 4 (on phones 1 and 2) and «One instrument in all windows» (off by default). Window 1 follows the
// toolbar; windows 2–4 have their own instrument and timeframe. TradingView is a stub: each chart's config is read.

const el = (page: Page, id: string) => page.getByTestId(id);
const config = (page: Page, testId: string) => el(page, testId).locator("script").evaluate((s) => JSON.parse(s.textContent || "{}"));
const box = async (page: Page, id: string) => (await el(page, id).boundingBox())!;
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function chooseLayout(page: Page, layout: 1 | 2 | 4) {
  await el(page, "market-chart-layout").click();
  await el(page, `market-chart-layout-${layout}`).click();
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 300);
}

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — layouts 1 / 2 / 4`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    test("1440: two side by side, then four 2×2; windows 2–4 with their own instrument and timeframe; kept after a reload", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart&symbol=FX%3AEURUSD");
      await expect(el(page, "market-chart-grid")).toHaveAttribute("data-layout", "1");
      await chooseLayout(page, 2);
      await expect(el(page, "market-chart-grid")).toHaveAttribute("data-layout", "2");
      const [a, b] = [await box(page, "market-chart-pane-1"), await box(page, "market-chart-pane-2")];
      expect(b.x).toBeGreaterThan(a.x + a.width - 1);
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      // window 2: the main instrument on 4 h until another is picked
      await expect(el(page, "market-chart-pane-2-name")).toHaveText("EUR/USD");
      expect(await config(page, "market-chart-widget-2")).toMatchObject({ symbol: "FX:EURUSD", interval: "240" });
      await el(page, "market-chart-pane-2-change").click();
      await page.locator("#market-chart-pane-2-cat-tab-commodities").click();
      await el(page, "market-chart-pane-2-pick-gold").click();
      await el(page, "market-chart-pane-2-interval").click();
      await el(page, "market-chart-pane-2-interval-D").click();
      expect(await config(page, "market-chart-widget-2")).toMatchObject({ symbol: "OANDA:XAUUSD", interval: "D" });
      // the toolbar changes window 1 only
      await el(page, "market-chart-interval-15").click();
      expect((await config(page, "market-chart-widget")).interval).toBe("15");
      expect((await config(page, "market-chart-widget-2")).interval).toBe("D");

      await chooseLayout(page, 4);
      await expect(el(page, "market-chart-grid")).toHaveAttribute("data-layout", "4");
      const [p1, p2, p3, p4] = await Promise.all([1, 2, 3, 4].map((n) => box(page, `market-chart-pane-${n}`)));
      expect(Math.abs(p1.y - p2.y)).toBeLessThan(2);
      expect(Math.abs(p3.y - p4.y)).toBeLessThan(2);
      expect(p3.y).toBeGreaterThan(p1.y + p1.height - 1);
      expect(await config(page, "market-chart-widget-3")).toMatchObject({ symbol: "FX:EURUSD", interval: "D" });
      expect(await config(page, "market-chart-widget-4")).toMatchObject({ symbol: "FX:EURUSD", interval: "15" });
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: `test-results/market-chart-layout4-${engine}-1440.png` });

      await page.reload();
      await expect(el(page, "market-chart-grid")).toHaveAttribute("data-layout", "4");
      expect(await config(page, "market-chart-widget-2")).toMatchObject({ symbol: "OANDA:XAUUSD", interval: "D" });
    });

    test("«One instrument in all windows»: off by default; on — every window shows window 1's instrument, own timeframes", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart&symbol=FX%3AEURUSD");
      await chooseLayout(page, 4);
      await el(page, "market-chart-pane-2-change").click();
      await page.locator("#market-chart-pane-2-cat-tab-crypto").click();
      await el(page, "market-chart-pane-2-pick-btc").click();
      await el(page, "market-chart-layout").click();
      const link = el(page, "market-chart-layout-link").getByRole("switch");
      await expect(link).toHaveAttribute("aria-checked", "false");
      await link.click();
      await page.keyboard.press("Escape");
      await page.mouse.click(5, 300);
      // window 2's own pick is set aside, the instrument cannot be changed there
      await expect(el(page, "market-chart-pane-2-change")).toHaveCount(0);
      for (const id of ["market-chart-widget-2", "market-chart-widget-3", "market-chart-widget-4"]) expect((await config(page, id)).symbol).toBe("FX:EURUSD");
      // a new instrument in window 1 goes everywhere; the timeframes stay
      await el(page, "market-chart-change").click();
      await page.locator("#market-chart-cat-tab-commodities").click();
      await el(page, "market-chart-pick-gold").click();
      for (const [id, interval] of [["market-chart-widget", "60"], ["market-chart-widget-2", "240"], ["market-chart-widget-3", "D"], ["market-chart-widget-4", "15"]]) {
        expect(await config(page, id)).toMatchObject({ symbol: "OANDA:XAUUSD", interval });
      }
      // off again: window 2 is back on its own BTC
      await el(page, "market-chart-layout").click();
      await el(page, "market-chart-layout-link").getByRole("switch").click();
      await page.keyboard.press("Escape");
      await page.mouse.click(5, 300);
      expect((await config(page, "market-chart-widget-2")).symbol).toBe("BITSTAMP:BTCUSD");
    });

    test("chart type and indicators apply to every window", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      await chooseLayout(page, 2);
      await el(page, "market-chart-type").click();
      await el(page, "market-chart-type-2").click();
      await el(page, "market-chart-indicators").click();
      await el(page, "market-chart-indicator-rsi").click();
      await page.keyboard.press("Escape");
      await page.mouse.click(5, 300);
      for (const id of ["market-chart-widget", "market-chart-widget-2"]) expect(await config(page, id)).toMatchObject({ style: "2", studies: ["STD;RSI"] });
    });

    test("360: only 1 and 2 — two windows one under another; a saved «4» shows as two; nothing off the screen", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      await chooseLayout(page, 4);
      await page.setViewportSize({ width: 360, height: 780 });
      await expect(el(page, "market-chart-grid")).toHaveAttribute("data-layout", "2");
      await el(page, "market-chart-layout").click();
      await expect(el(page, "market-chart-layout-4")).toBeDisabled();
      await expect(el(page, "market-chart-layouts")).toContainText("На телефоне — не больше двух графиков.");
      await page.keyboard.press("Escape");
      await page.mouse.click(5, 300);
      const [a, b] = [await box(page, "market-chart-pane-1"), await box(page, "market-chart-pane-2")];
      expect(b.y).toBeGreaterThan(a.y + a.height - 1);
      expect(a.height).toBeGreaterThanOrEqual(300);
      expect(await noSideScroll(page)).toBe(true);
      await page.setViewportSize({ width: 360, height: 1600 });
      await el(page, "market-chart").evaluate((e) => e.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `test-results/market-chart-layout2-${engine}-360.png` });
    });
  });
}
