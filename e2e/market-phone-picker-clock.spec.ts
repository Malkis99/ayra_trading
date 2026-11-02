import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { marketGuest } from "./helpers/market";

// Owner's fixes 2026-11-02: the instrument picker on phones (360–430): names wrap inside their cards, one column,
// the category tabs snap so no cut piece shows on the left and the active one is whole; the «time + session + market»
// card next to the Watchlist (right on top by default; right under the note; a strip over the chart; hidden),
// kept after a reload and in full screen; on phones the card under the chart, before the Watchlist.

const el = (page: Page, id: string) => page.getByTestId(id);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = async (page: Page, id: string) => (await el(page, id).boundingBox())!;
const CATEGORIES = ["forex", "indices", "crypto", "commodities", "bonds", "stocks"];

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — phones: the picker and the time card`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    for (const width of [360, 390, 430]) {
      test(`${width}: every category — names whole, one column, the active tab whole, no cut tab on the left, nothing off the screen`, async () => {
        const { page } = await marketGuest(browser, width);
        await page.goto("/market?tab=chart");
        await el(page, "market-chart-change").click();
        const list = el(page, "market-chart-list");
        for (const category of CATEGORIES) {
          await page.locator(`#market-chart-cat-tab-${category}`).click();
          // the tabs scroll smoothly: wait for the end state — the active tab whole, and the left edge starts with a whole
          // tab (snap), no cut piece of the previous one
          await expect
            .poll(() =>
              page.evaluate((cat) => {
                const list = document.querySelector('[role=tablist][aria-label="Инструмент"]')!;
                const row = list.getBoundingClientRect();
                const tab = document.getElementById(`market-chart-cat-tab-${cat}`)!.getBoundingClientRect();
                if (tab.left < row.left - 1 || tab.right > row.right + 1) return `${cat}: tab ${tab.left}-${tab.right}, row ${row.left}-${row.right}`;
                const cut = [...list.querySelectorAll("[role=tab]")].find((t) => {
                  const b = t.getBoundingClientRect();
                  return b.left < row.left - 1 && b.right > row.left + 1;
                });
                return cut ? `${cat}: ${cut.id} cut on the left` : "ok";
              }, category)
            )
            .toBe("ok");
          // names wrap inside the cards, nothing spills out, one column
          const cards = await list.getByRole("button").evaluateAll((bs) =>
            bs.map((b) => {
              const r = b.getBoundingClientRect();
              const name = b.querySelector("span")!;
              return { x: Math.round(r.left), spills: b.scrollWidth > b.clientWidth + 1 || name.scrollWidth > name.clientWidth + 1, right: r.right };
            })
          );
          expect(cards.length).toBeGreaterThan(0);
          expect(new Set(cards.map((c) => c.x)).size).toBe(1);
          for (const c of cards) {
            expect(c.spills).toBe(false);
            expect(c.right).toBeLessThanOrEqual(width);
          }
          expect(await noSideScroll(page)).toBe(true);
        }
        await page.locator("#market-chart-cat-tab-bonds").click();
        await page.setViewportSize({ width, height: 1400 });
        await page.waitForTimeout(400);
        await el(page, "market-chart-picker").screenshot({ path: `test-results/market-picker-bonds-${engine}-${width}.png` });
      });
    }

    test("1440: the time card on top of the right column, then the list; under the note; a strip; hidden — kept after a reload and in full screen", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=chart");
      await expect(el(page, "market-chart-clock")).toHaveAttribute("data-variant", "card");
      const side = el(page, "market-chart-side");
      await expect(side.getByTestId("market-chart-clock")).toBeVisible();
      expect((await box(page, "market-chart-clock")).y).toBeLessThan((await box(page, "market-chart-panel")).y);
      await expect(el(page, "market-chart-clock")).toContainText("Время и сессия");
      await expect(el(page, "market-chart-clock-time")).toHaveText(/^\d\d:\d\d:\d\d$/);
      // the line over the chart is gone
      await expect(page.locator("[data-testid=market-chart-clock][data-variant=strip]")).toHaveCount(0);

      // under the note, in the right column
      await el(page, "market-chart-view-open").click();
      await el(page, "market-chart-view-notes-place").getByRole("radio", { name: "Сбоку, под списком" }).click();
      await el(page, "market-chart-view-clock-bottom").click();
      await expect(el(page, "market-chart-view-clock-bottom")).toHaveAttribute("aria-checked", "true");
      await el(page, "market-chart-view-close").click();
      expect((await box(page, "market-chart-clock")).y).toBeGreaterThan((await box(page, "market-chart-notes")).y);
      await page.reload();
      expect((await box(page, "market-chart-clock")).y).toBeGreaterThan((await box(page, "market-chart-notes")).y);

      // full screen keeps it
      await el(page, "market-chart-fullscreen").click();
      await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "true");
      await expect(side.getByTestId("market-chart-clock")).toBeVisible();
      await el(page, "market-chart-fullscreen").click();

      // a thin strip over the chart
      await el(page, "market-chart-view-open").click();
      await el(page, "market-chart-view-clock-strip").click();
      await el(page, "market-chart-view-close").click();
      await expect(el(page, "market-chart-clock")).toHaveAttribute("data-variant", "strip");
      expect((await box(page, "market-chart-clock")).y).toBeLessThan((await box(page, "market-chart-row")).y);

      // hidden
      await el(page, "market-chart-view-open").click();
      await el(page, "market-chart-view-clock-hidden").click();
      await el(page, "market-chart-view-close").click();
      await expect(el(page, "market-chart-clock")).toHaveCount(0);
      await page.reload();
      await expect(el(page, "market-chart-row")).toBeVisible();
      await expect(el(page, "market-chart-clock")).toHaveCount(0);
    });

    for (const width of [360, 430]) {
      test(`${width}: the time card under the chart, before the Watchlist, nothing cut`, async () => {
        const { page } = await marketGuest(browser, width);
        await page.goto("/market?tab=chart&symbol=NASDAQ%3AAAPL");
        await expect(el(page, "market-chart-clock")).toHaveAttribute("data-variant", "card");
        const chart = await box(page, "market-chart-row");
        const card = await box(page, "market-chart-clock");
        const panel = await box(page, "market-chart-panel");
        expect(card.y).toBeGreaterThan(chart.y + chart.height - 1);
        expect(card.y).toBeLessThan(panel.y);
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width).toBeLessThanOrEqual(width);
        await expect(el(page, "market-chart-clock-note")).toHaveText("по расписанию NYSE, без учёта праздников");
        // the status dots are round dots, not thin bars
        const dots = await el(page, "market-chart-clock").locator("[aria-hidden=true].rounded-full").evaluateAll((ds) => ds.map((d) => d.getBoundingClientRect()).map((r) => [Math.round(r.width), Math.round(r.height)]));
        expect(dots).toEqual([
          [8, 8],
          [8, 8],
        ]);
        const cut = await el(page, "market-chart-clock").evaluate((c) => [...c.querySelectorAll("p, span")].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible"));
        expect(cut).toBe(false);
        expect(await noSideScroll(page)).toBe(true);
        await page.setViewportSize({ width, height: 2200 });
        await el(page, "market-chart").evaluate((e) => e.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: `test-results/market-clock-card-${engine}-${width}.png` });
      });
    }
  });
}
