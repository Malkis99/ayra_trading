import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { marketGuest } from "./helpers/market";

// Market: «Full screen» and «time + session» next to the chart. The full screen covers the whole site (Esc or the
// button leaves it); the line shows the user's exact time (Tbilisi, UTC+4), the session going on now and whether the
// instrument's market is open (stocks: NYSE hours without holidays). The browser clock is controlled.

const el = (page: Page, id: string) => page.getByTestId(id);
// Monday 6 April 2026, 08:30 UTC = 04:30 in New York (London open), 12:30 in Tbilisi
const MONDAY = "2026-04-06T08:30:00Z";

async function at(browser: Browser, width: number, now: string, url: string) {
  const { page } = await marketGuest(browser, width);
  await page.clock.install({ time: new Date(now) });
  await page.clock.pauseAt(new Date(now));
  await page.goto(url);
  await expect(el(page, "market-chart-clock")).toBeVisible();
  return page;
}

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — full screen, time and session`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    for (const width of [1440, 360]) {
      test(`${width}: full screen covers the site, the chart takes the window, popovers still open; Esc and the button leave`, async () => {
        const { page } = await marketGuest(browser, width);
        await page.goto("/market?tab=chart");
        await expect(el(page, "market-chart-widget")).toHaveAttribute("data-status", "ready");
        await el(page, "market-chart-fullscreen").click();
        await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "true");
        await expect(el(page, "market-chart-fullscreen")).toHaveAttribute("aria-label", "Выйти из полноэкранного режима");

        // only the workspace is seen: every corner of the window belongs to it (entering the browser's full screen
        // is asynchronous: wait until it settles)
        const corners = () => page.evaluate(() => {
          const section = document.querySelector("[data-testid=market-chart]")!;
          const w = window.innerWidth;
          const h = window.innerHeight;
          return [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => { const e = document.elementFromPoint(x, y); return section.contains(e) || `${x},${y}:${e?.tagName}.${String(e?.className).slice(0, 60)}`; }).filter((v) => v !== true);
        });
        await expect.poll(corners).toEqual([]);
        await expect
          .poll(() =>
            page.evaluate(() => {
              const row = document.querySelector("[data-testid=market-chart-row]")!;
              const toolbar = (row.previousElementSibling as HTMLElement).offsetHeight;
              return Math.abs(row.getBoundingClientRect().height - Math.max(380, window.innerHeight - 24 - toolbar - 12));
            })
          )
          .toBeLessThanOrEqual(2);

        // the favourite timeframes popover shows over the full screen
        await el(page, "market-chart-intervals-more").click();
        await expect(el(page, "market-chart-favorites")).toBeVisible();
        await page.keyboard.press("Escape");
        await page.mouse.click(width / 2, 5);
        await expect(el(page, "market-chart-favorites")).toHaveCount(0);
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: `test-results/market-chart-fullscreen-${engine}-${width}.png` });

        await page.keyboard.press("Escape");
        await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "false");
        await el(page, "market-chart-fullscreen").click();
        await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "true");
        await el(page, "market-chart-fullscreen").click();
        await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "false");
      });
    }

    // Safari and WebKit leave the browser's full screen on the first Esc without passing it to the page: there the
    // first Esc closes everything at once. Chromium passes it, so the picker closes first.
    test("Esc closes the instrument picker first, then the full screen", async () => {
      test.skip(engine === "webkit", "WebKit takes the first Esc to leave its own full screen");
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      await el(page, "market-chart-fullscreen").click();
      await el(page, "market-chart-change").click();
      await expect(el(page, "market-chart-picker")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(el(page, "market-chart-picker")).toHaveCount(0);
      await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "true");
      await page.keyboard.press("Escape");
      await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "false");
    });

    test("time and session: the user's exact time, London now, the market of DXY open; the seconds tick", async () => {
      const page = await at(browser, 1440, MONDAY, "/market?tab=chart&symbol=CAPITALCOM%3ADXY");
      await expect(el(page, "market-chart-clock-time")).toHaveText("12:30:00");
      await expect(el(page, "market-chart-clock-zone")).toContainText("UTC+4");
      await expect(el(page, "market-chart-clock-session")).toHaveText(/^Сессия: Лондон$/);
      await expect(el(page, "market-chart-clock-market")).toContainText("Рынок открыт");
      await expect(el(page, "market-chart-clock-note")).toHaveText("по неделе форекса, без дневных перерывов и праздников");
      await page.clock.runFor(2000);
      await expect(el(page, "market-chart-clock-time")).toHaveText("12:30:02");
      await page.screenshot({ path: `test-results/market-chart-clock-${engine}-1440.png` });
    });

    test("stocks: NYSE hours without holidays; crypto around the clock; forex: no note", async () => {
      const page = await at(browser, 360, MONDAY, "/market?tab=chart&symbol=NASDAQ%3AAAPL");
      // 04:30 New York: NYSE opens at 09:30
      await expect(el(page, "market-chart-clock-market")).toHaveAttribute("data-open", "false");
      await expect(el(page, "market-chart-clock-market")).toContainText("Рынок закрыт · откроется через 5 ч 0 мин");
      await expect(el(page, "market-chart-clock-note")).toHaveText("по расписанию NYSE, без учёта праздников");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/market-chart-clock-stocks-${engine}-360.png` });

      await page.goto("/market?tab=chart&symbol=BITSTAMP%3ABTCUSD");
      await expect(el(page, "market-chart-clock-market")).toHaveText(/^Рынок открыт$/);
      await expect(el(page, "market-chart-clock-note")).toHaveText("Крипта торгуется круглосуточно, без выходных");
      await page.goto("/market?tab=chart&symbol=FX%3AEURUSD");
      await expect(el(page, "market-chart-clock-market")).toContainText("Рынок открыт");
      await expect(el(page, "market-chart-clock-note")).toHaveText("по неделе форекса: вс 17:00 – пт 17:00 по Нью-Йорку");
    });

    test("between sessions and the weekend", async () => {
      // Monday 6 April 2026, 18:30 New York (22:30 UTC): New York closed at 18:00, Asia (Tokyo) opens at 19:00
      const page = await at(browser, 1440, "2026-04-06T22:30:00Z", "/market?tab=chart&symbol=FX%3AEURUSD");
      await expect(el(page, "market-chart-clock-session")).toHaveText("Между сессиями · дальше Азия (Токио) через 30 мин");
      // Saturday 4 April 2026, 12:00 UTC: the weekend, forex opens Sunday 17:00 New York (summer time) = 21:00 UTC
      const weekend = await at(browser, 1440, "2026-04-04T12:00:00Z", "/market?tab=chart&symbol=FX%3AEURUSD");
      await expect(el(weekend, "market-chart-clock-session")).toHaveText("Выходные: сессий нет");
      await expect(el(weekend, "market-chart-clock-market")).toContainText("Рынок закрыт · откроется через 1 д 9 ч 0 мин");
    });
  });
}
