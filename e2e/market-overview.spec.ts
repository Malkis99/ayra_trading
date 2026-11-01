import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { stubTradingView } from "./helpers/tradingview";

// Market cards (PR 1.2): under the sessions block, the D-14 core (DXY, S&P 500, Nasdaq, gold, oil, BTC) and the five
// categories on TradingView widgets. Each block names the source and the delay; widgets load only once seen; a plain
// message when TradingView does not answer; 16–17 mode: no links but TradingView's and the app's own. TradingView is a
// stub here (no real network): see e2e/helpers/tradingview.ts.

const CORE = ["dxy", "spx", "ndx", "gold", "oil", "btc"];

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
const status = (page: Page, id: string) => el(page, id).getAttribute("data-status");

async function showAll(page: Page) {
  for (const id of CORE) {
    await el(page, `market-core-${id}-widget`).scrollIntoViewIfNeeded();
    await expect(el(page, `market-core-${id}-widget`)).toHaveAttribute("data-status", "ready");
  }
  await el(page, "market-category-forex-widget").scrollIntoViewIfNeeded();
  await expect(el(page, "market-category-forex-widget")).toHaveAttribute("data-status", "ready");
}

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — Overview cards`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    for (const width of [1440, 360]) {
      test(`${width}: under the sessions block — six core cards and five categories, source and delay on each, nothing off the screen`, async () => {
        const { page } = await guestPage(browser, width);
        await page.goto("/market");
        await expect(el(page, "market-overview")).toBeVisible();
        // the sessions block stays first, the cards go under it
        const sessions = await el(page, "market-sessions").boundingBox();
        const overview = await el(page, "market-overview").boundingBox();
        expect(sessions && overview && sessions.y + sessions.height <= overview.y).toBe(true);

        await expect(el(page, "market-core").locator(":scope > li h3")).toHaveText(["Индекс доллара (DXY)", "S&P 500", "Nasdaq 100", "Золото", "Нефть WTI", "Биткоин (BTC)"]);
        await showAll(page);
        await expect(el(page, "market-core-dxy-widget").locator("iframe")).toHaveCount(1);
        for (const id of ["dxy", "spx", "ndx", "oil"]) await expect(el(page, `market-core-${id}-source`)).toHaveText("Источник: TradingView · возможна задержка");
        for (const id of ["gold", "btc"]) await expect(el(page, `market-core-${id}-source`)).toHaveText("Источник: TradingView · в реальном времени");

        // core: 3 in a row on a wide screen, one under another on a phone
        const boxes = await Promise.all(CORE.map((id) => el(page, `market-core-${id}`).boundingBox()));
        const tops = new Set(boxes.slice(0, 3).map((b) => Math.round(b!.y)));
        expect(tops.size).toBe(width === 1440 ? 1 : 3);

        const cats = page.getByRole("tablist", { name: "Категории" }).getByRole("tab");
        await expect(cats).toHaveText(["Валюты", "Индексы", "Крипта", "Сырьё и металлы", "Облигации и доходности"]);
        await expect(el(page, "market-category-forex-source")).toHaveText("Источник: TradingView · в реальном времени");
        await expect(el(page, "market-category-forex-widget").frameLocator("iframe").locator("body")).toContainText("FX:EURUSD");

        await page.getByRole("tab", { name: "Облигации и доходности" }).click();
        await expect(page).toHaveURL(/cat=bonds/);
        await expect(el(page, "market-bonds-note")).toContainText("Доходности облигаций в виджетах TradingView недоступны");
        await expect(el(page, "market-category-bonds-widget")).toHaveAttribute("data-status", "ready");
        await expect(el(page, "market-category-bonds-source")).toHaveText("Источник: TradingView · возможна задержка");
        expect(await noSideScroll(page)).toBe(true);
        for (const id of [...CORE.map((c) => `market-core-${c}`), "market-category-bonds"]) {
          const box = await el(page, id).boundingBox();
          expect(box!.x >= 0 && box!.x + box!.width <= width).toBe(true);
        }

        // the category is kept after a reload
        await page.reload();
        await expect(page.getByRole("tab", { name: "Облигации и доходности" })).toHaveAttribute("aria-selected", "true");
      });
    }

    test("widgets load only once their block is seen", async () => {
      const { page, scripts } = await guestPage(browser, 360);
      await page.goto("/market");
      await expect(el(page, "market-overview")).toBeVisible();
      // on a phone everything is far below the sessions block
      for (const id of CORE) expect(await status(page, `market-core-${id}-widget`)).toBe("idle");
      expect(await status(page, "market-category-forex-widget")).toBe("idle");
      expect(scripts).toEqual([]);

      await el(page, "market-core-dxy-widget").scrollIntoViewIfNeeded();
      await expect(el(page, "market-core-dxy-widget")).toHaveAttribute("data-status", "ready");
      expect(await status(page, "market-category-forex-widget")).toBe("idle");
      expect(scripts.length).toBeLessThan(CORE.length + 1);
    });

    test("TradingView does not answer — a plain message and «Try again»", async () => {
      const { page } = await guestPage(browser, 360, { tradingView: "unavailable" });
      await page.goto("/market");
      await el(page, "market-core-dxy-widget").scrollIntoViewIfNeeded();
      await expect(el(page, "market-core-dxy-widget-error")).toHaveText(/TradingView сейчас не отвечает, котировки не загрузились/);
      // the source line stays
      await expect(el(page, "market-core-dxy-source")).toContainText("Источник: TradingView");
      await el(page, "market-core-dxy").screenshot({ path: `test-results/market-overview-unavailable-${engine}-360.png` });
      expect(await noSideScroll(page)).toBe(true);

      await stubTradingView(page.context(), "ok");
      await el(page, "market-core-dxy-widget-retry").click();
      await expect(el(page, "market-core-dxy-widget")).toHaveAttribute("data-status", "ready");
      await expect(el(page, "market-core-dxy-widget-error")).toHaveCount(0);
    });

    test("16–17 mode: only TradingView's and the app's own links, no partner parameters, no «Technical analysis»", async () => {
      const { page, scripts } = await guestPage(browser, 1440, { minor: true });
      await page.goto("/market");
      await showAll(page);
      for (const name of ["indices", "crypto", "commodities", "bonds"]) {
        await page.locator(`#market-cat-tab-${name}`).click();
        await expect(el(page, `market-category-${name}-widget`)).toHaveAttribute("data-status", "ready");
      }
      const origin = new URL(page.url()).origin;
      const links = await el(page, "market-overview").locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const href of links) expect(href === "https://www.tradingview.com/" || href.startsWith(origin)).toBe(true);
      const configs = await el(page, "market-overview").locator("script").evaluateAll((ss) => ss.map((s) => JSON.parse(s.textContent || "{}")));
      expect(configs.length).toBeGreaterThan(0);
      for (const c of configs) {
        expect(c.largeChartUrl).toBe(`${origin}/market`);
        expect(Object.keys(c).filter((k) => /refer|affil|partner|utm|campaign/i.test(k))).toEqual([]);
      }
      expect(scripts.every((u) => /embed-widget-(mini-symbol-overview|market-quotes)\.js$/.test(u))).toBe(true);
      expect(scripts.some((u) => u.includes("technical-analysis"))).toBe(false);
    });

    test("a click on a symbol in a widget opens the Chart section", async () => {
      const { page } = await guestPage(browser, 1440);
      await page.goto("/market?tvwidgetsymbol=FX%3AEURUSD");
      await expect(page.getByRole("tab", { name: "График" })).toHaveAttribute("aria-selected", "true");
    });
  });
}

