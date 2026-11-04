import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { marketGuest } from "./helpers/market";

// Market 1.4: «Calendar» (TradingView's economic calendar with our filters by importance and country; times by the
// device's clock, with a warning when the profile's zone differs) and «News» (top stories or one catalog
// instrument's). Both say «Not financial advice». TradingView is stubbed: the tests read the config the app passed.

const el = (page: Page, id: string) => page.getByTestId(id);
/**
 * The config the app passed to the widget. A widget loads only near the screen (on phones it is below «Today
 * important» and the filters), so look at it the way a person would: scroll to it first.
 */
const config = async (page: Page, widget: string) => {
  await page.getByTestId(widget).scrollIntoViewIfNeeded();
  return JSON.parse((await page.locator(`[data-testid="${widget}"] script`).textContent({ timeout: 5000 })) || "{}") as Record<string, unknown>;
};

/** The profile's zone in the guest's saved state (the browser itself stays in Tbilisi). */
async function profileZone(page: Page, zone: string) {
  await page.addInitScript((z) => {
    const raw = localStorage.getItem("ayra_demo_v1");
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.profile?.timezone === z) return;
    s.profile = { ...s.profile, timezone: z };
    localStorage.setItem("ayra_demo_v1", JSON.stringify(s));
  }, zone);
}

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — Calendar and News`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    for (const width of [1440, 360]) {
      test(`${width}: calendar filters drive the widget, the last option stays, kept after a reload; nothing wider than the screen`, async () => {
        const { page } = await marketGuest(browser, width);
        await page.goto("/market?tab=calendar&view=world");
        await expect(el(page, "market-calendar-widget")).toHaveAttribute("data-status", "ready");
        expect(await config(page, "market-calendar-widget")).toMatchObject({ importanceFilter: "1,0", countryFilter: "us,eu,gb,jp", colorTheme: "dark" });
        await expect(el(page, "market-calendar-importance-high")).toHaveAttribute("aria-pressed", "true");
        await expect(el(page, "market-calendar-importance-low")).toHaveAttribute("aria-pressed", "false");

        await el(page, "market-calendar-importance-low").click();
        // phones: the countries are folded into one line until «Change»
        if (width === 360) {
          await expect(el(page, "market-calendar-country-list")).toBeHidden();
          await el(page, "market-calendar-countries-toggle").click();
        }
        await expect(el(page, "market-calendar-country-list")).toBeVisible();
        await el(page, "market-calendar-country-cn").click();
        await el(page, "market-calendar-country-eu").click();
        await expect.poll(async () => (await config(page, "market-calendar-widget")).countryFilter).toBe("us,gb,jp,cn");
        expect((await config(page, "market-calendar-widget")).importanceFilter).toBe("1,0,-1");

        // the last importance cannot be turned off
        await el(page, "market-calendar-importance-high").click();
        await el(page, "market-calendar-importance-medium").click();
        await el(page, "market-calendar-importance-low").click();
        await expect(el(page, "market-calendar-importance-low")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await config(page, "market-calendar-widget")).importanceFilter).toBe("-1");

        await expect(el(page, "market-calendar-disclaimer")).toHaveText("Не является финансовой рекомендацией.");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const filters = (await el(page, "market-calendar-filters").boundingBox())!;
        expect(filters.x + filters.width).toBeLessThanOrEqual(width);
        await expect(el(page, "market-calendar-countries-count")).toHaveText("4 из 10");
        await expect(el(page, "market-calendar-summary")).toHaveText("Выбрано: Низкая · США, Великобритания, Япония, Китай");

        await page.reload();
        await expect(el(page, "market-calendar-widget")).toHaveAttribute("data-status", "ready");
        expect(await config(page, "market-calendar-widget")).toMatchObject({ importanceFilter: "-1", countryFilter: "us,gb,jp,cn" });
      });
    }

    for (const width of [1440, 360]) {
      test(`${width}: filters — importance in its own colours, «Select all» and «Reset» for countries, what is chosen; small on a phone`, async () => {
        const { page } = await marketGuest(browser, width);
        await page.goto("/market?tab=calendar&view=world");
        await expect(el(page, "market-calendar-widget")).toHaveAttribute("data-status", "ready");
        // three different colours for the three levels
        const tones = await Promise.all(
          (["high", "medium", "low"] as const).map((i) => el(page, `market-calendar-importance-${i}`).locator("span").first().evaluate((d) => getComputedStyle(d).backgroundColor))
        );
        expect(new Set(tones).size).toBe(3);
        await expect(el(page, "market-calendar-summary")).toHaveText("Выбрано: Высокая, Средняя · США, Еврозона, Великобритания, Япония");
        await expect(el(page, "market-calendar-countries-reset")).toBeDisabled();
        if (width === 360) {
          // folded: the block is about two thirds of the old one (263 px before 1.4b)
          expect((await el(page, "market-calendar-filters").boundingBox())!.height).toBeLessThan(180);
          await el(page, "market-calendar-countries-toggle").click();
        }
        await el(page, "market-calendar-countries-all").click();
        await expect(el(page, "market-calendar-countries-count")).toHaveText("10 из 10");
        await expect(el(page, "market-calendar-countries-all")).toBeDisabled();
        await expect.poll(async () => (await config(page, "market-calendar-widget")).countryFilter).toBe("us,eu,gb,jp,cn,de,ca,au,nz,ch");
        await el(page, "market-calendar-countries-reset").click();
        await expect(el(page, "market-calendar-countries-count")).toHaveText("4 из 10");
        await expect.poll(async () => (await config(page, "market-calendar-widget")).countryFilter).toBe("us,eu,gb,jp");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }

    test("calendar time: by the device's clock; a warning when the profile has another zone", async () => {
      const same = await marketGuest(browser, 1440);
      await same.page.goto("/market?tab=calendar&view=world");
      await expect(el(same.page, "market-calendar-zone")).toContainText("Время событий — по часам этого устройства: Грузия");
      await expect(el(same.page, "market-calendar-zone")).toHaveAttribute("data-differs", "false");
      await expect(el(same.page, "market-calendar-zone")).not.toContainText("В профиле выбран другой пояс");

      const other = await marketGuest(browser, 1440);
      await profileZone(other.page, "America/New_York");
      await other.page.goto("/market?tab=calendar&view=world");
      await expect(el(other.page, "market-calendar-zone")).toHaveAttribute("data-differs", "true");
      await expect(el(other.page, "market-calendar-zone")).toContainText("В профиле выбран другой пояс");
    });

    for (const width of [1440, 360]) {
      test(`${width}: news — all, then one instrument from the catalog, then all again; kept after a reload`, async () => {
        const { page } = await marketGuest(browser, width, { minor: true });
        await page.goto("/market?tab=news&view=market");
        await expect(el(page, "market-news-widget")).toHaveAttribute("data-status", "ready");
        const all = await config(page, "market-news-widget");
        expect(all).toMatchObject({ feedMode: "all_symbols" });
        expect(all).not.toHaveProperty("symbol");
        await expect(el(page, "market-news-all")).toHaveAttribute("aria-pressed", "true");
        await expect(el(page, "market-news-disclaimer")).toHaveText("Не является финансовой рекомендацией.");

        await el(page, "market-news-instrument").click();
        await page.locator("#market-news-cat-tab-commodities").click();
        await el(page, "market-news-pick-gold").click();
        await expect(el(page, "market-news-instrument")).toContainText("Инструмент: Золото");
        await expect.poll(async () => (await config(page, "market-news-widget")).symbol).toBe("OANDA:XAUUSD");
        expect(await config(page, "market-news-widget")).toMatchObject({ feedMode: "symbol", displayMode: width === 360 ? "compact" : "regular" });
        // no partner or referral parameters (16–17 mode)
        expect(JSON.stringify(await config(page, "market-news-widget"))).not.toMatch(/ref|partner|utm|aff/i);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        await page.reload();
        await expect(el(page, "market-news-widget")).toHaveAttribute("data-status", "ready");
        expect((await config(page, "market-news-widget")).symbol).toBe("OANDA:XAUUSD");
        await el(page, "market-news-clear").click();
        await expect(el(page, "market-news-all")).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await config(page, "market-news-widget")).feedMode).toBe("all_symbols");
      });
    }

    test("the Calendar opens on the world calendar (first tab); the official events without the cloud say so plainly", async () => {
      const { page } = await marketGuest(browser, 1440);
      await page.goto("/market?tab=calendar");
      await expect(el(page, "market-calendar")).toHaveAttribute("data-view", "world");
      await expect(el(page, "market-calendar-views").getByRole("button").first()).toHaveText("Мировой календарь");
      await expect(el(page, "market-calendar-widget")).toHaveAttribute("data-status", "ready");
      // «Today important» is on the Overview only
      await expect(el(page, "today-important")).toHaveCount(0);
      await el(page, "market-calendar-view-own").click();
      await expect(el(page, "own-calendar-unavailable")).toContainText("Календарь официальных событий сейчас недоступен");
      await expect(el(page, "market-calendar-disclaimer")).toHaveText("Не является финансовой рекомендацией.");
    });

    test("News opens on the official feed; without the cloud it says so; «Market · TradingView» keeps the widget", async () => {
      const { page } = await marketGuest(browser, 360);
      await page.goto("/market?tab=news");
      await expect(el(page, "market-news-tab")).toHaveAttribute("data-view", "official");
      await expect(el(page, "official-news-unavailable")).toBeVisible();
      await expect(el(page, "official-news-disclaimer")).toHaveText("Не является финансовой рекомендацией.");
      await el(page, "market-news-view-market").click();
      await expect(el(page, "market-news-widget")).toHaveAttribute("data-status", "ready");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test("TradingView not answering: a plain message with «Try again» on both tabs", async () => {
      const { page } = await marketGuest(browser, 1440, { tradingView: "unavailable" });
      for (const tab of ["calendar", "news"]) {
        await page.goto(tab === "calendar" ? "/market?tab=calendar&view=world" : "/market?tab=news&view=market");
        await expect(el(page, `market-${tab}-widget-error`)).toBeVisible({ timeout: 20000 });
        await expect(el(page, `market-${tab}-disclaimer`)).toBeVisible();
      }
    });
  });
}
