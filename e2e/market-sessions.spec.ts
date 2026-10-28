import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";

// PR 1.1 (docs/market-plan.md section 9): Market shell with seven sections and the sessions / killzones clock.
// No market data: only clocks. The clock is frozen; the user's zone is Tbilisi (UTC+4, no summer time).

const ZONE = "Asia/Tbilisi";

async function guestPage(browser: Browser, width: number, now: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: ZONE, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript((zone) => {
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
        profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: false, timezone: zone },
      })
    );
  }, ZONE);
  return page;
}

const status = (page: Page, id: string) => page.getByTestId(`market-window-${id}-status`);
const hours = (page: Page, id: string) => page.getByTestId(`market-window-${id}-hours`);

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — sections and sessions`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    for (const width of [1440, 360]) {
      test(`${width}: a weekday — open sessions and killzones, hours on the user's clock`, async () => {
        // Monday 6 April 2026, 08:30 UTC = 12:30 in Tbilisi; Europe and the USA in summer time
        const page = await guestPage(browser, width, "2026-04-06T08:30:00Z");
        await page.goto("/market");
        await expect(page.getByTestId("market-disclaimer")).toContainText("Не является финансовой рекомендацией");
        await expect(page.getByTestId("market-sessions-now")).toContainText("12:30");

        await expect(hours(page, "asia")).toHaveText("04:00–13:00");
        await expect(status(page, "asia")).toHaveText("Открыта · закроется через 30 мин");
        await expect(hours(page, "london")).toHaveText("11:00–20:00");
        await expect(status(page, "london")).toHaveText("Открыта · закроется через 7 ч 30 мин");
        // across the user's midnight: one interval
        await expect(hours(page, "newyork")).toHaveText("16:00–01:00 (+1)");
        await expect(status(page, "newyork")).toHaveText("Откроется через 3 ч 30 мин");
        // killzones in New York time: London 02:00–05:00 EDT = 10:00–13:00 here
        await expect(hours(page, "londonKz")).toHaveText("10:00–13:00");
        await expect(status(page, "londonKz")).toHaveText("Открыта · закроется через 30 мин");
        await expect(hours(page, "newyorkKz")).toHaveText("15:00–18:00");
        await expect(status(page, "newyorkKz")).toHaveText("Откроется через 2 ч 30 мин");
        await expect(page.getByTestId("market-weekend")).toHaveCount(0);

        // London + New York overlap: 12:00–16:00 UTC = 16:00–20:00 here
        await expect(hours(page, "overlap")).toHaveText("16:00–20:00");
        await expect(status(page, "overlap")).toHaveText("Откроется через 3 ч 30 мин");
        await expect(page.getByTestId("market-active-now")).toHaveText("Сейчас активно: Азия (Токио), Лондон, Killzone Лондона");
        await expect(page.getByTestId("market-now-mark")).toHaveText("сейчас 12:30");
        // usual 5 hours between London and New York: no hint
        await expect(page.getByTestId("market-gap")).toHaveCount(0);
        // the «now» line runs through every row, from the first track to the last
        const line = (await page.getByTestId("market-now-line").boundingBox())!;
        const first = (await page.getByTestId("market-window-asia").boundingBox())!;
        const last = (await page.getByTestId("market-window-newyorkKz").boundingBox())!;
        expect(line.y).toBeLessThanOrEqual(first.y);
        expect(line.y + line.height).toBeGreaterThanOrEqual(last.y + last.height - 1);
        expect(line.height).toBeGreaterThan(0);

        // no horizontal scroll of the page
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: `test-results/market-sessions-${engine}-${width}.png`, fullPage: true });
      });
    }

    test("winter in both: New York and its killzone an hour later on the user's clock", async () => {
      // Monday 2 March 2026, 10:00 UTC = 14:00 in Tbilisi
      const page = await guestPage(browser, 1440, "2026-03-02T10:00:00Z");
      await page.goto("/market");
      await expect(hours(page, "london")).toHaveText("12:00–21:00");
      await expect(hours(page, "newyork")).toHaveText("17:00–02:00 (+1)");
      await expect(hours(page, "londonKz")).toHaveText("11:00–14:00");
    });

    test("the weekend: the forex market is closed, the next openings are on Monday", async () => {
      // Saturday 7 March 2026, 12:00 UTC
      const page = await guestPage(browser, 1440, "2026-03-07T12:00:00Z");
      await page.goto("/market");
      await expect(page.getByTestId("market-weekend")).toContainText("валютный рынок закрыт");
      for (const id of ["asia", "london", "newyork", "londonKz", "newyorkKz"]) {
        await expect(page.getByTestId(`market-window-${id}`)).toHaveAttribute("data-state", "closed");
      }
      // Monday 08:00 GMT is 1 day 20 hours away
      await expect(status(page, "london")).toHaveText("Откроется через 1 д 20 ч");
      await expect(hours(page, "london")).toHaveText("Сегодня нет");
      await expect(page.getByTestId("market-active-now")).toHaveText("Сейчас ничего не открыто: выходные");
    });

    for (const width of [1440, 360]) {
      test(`${width}: the week when Europe is already on winter time and the USA not yet — 4 hours, a «?» hint`, async () => {
        // Wednesday 28 October 2026, 08:00 UTC = 12:00 in Tbilisi
        const page = await guestPage(browser, width, "2026-10-28T08:00:00Z");
        await page.goto("/market");
        await expect(hours(page, "london")).toHaveText("12:00–21:00");
        await expect(hours(page, "newyork")).toHaveText("16:00–01:00 (+1)");
        await expect(hours(page, "overlap")).toHaveText("16:00–21:00");
        // whole hours without «0 min»
        await expect(status(page, "asia")).toHaveText("Открыта · закроется через 1 ч");
        const gap = page.getByTestId("market-gap");
        await expect(gap).toContainText("Между открытием Лондона и Нью-Йорка сейчас 4 ч");
        await page.getByTestId("market-gap-hint").click();
        await expect(gap).toContainText("Обычно разница 5 часов");
        await expect(gap).toContainText("до 1 ноября");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.getByTestId("market-sessions").screenshot({ path: `test-results/market-sessions-gap-${engine}-${width}.png` });
      });
    }

    test("killzone hours can be changed, are kept after a reload, wrong hours are not saved", async () => {
      const page = await guestPage(browser, 1440, "2026-04-06T08:30:00Z");
      await page.goto("/market");
      await page.getByTestId("market-killzones-edit").click();
      await page.getByTestId("market-londonKz-start").fill("03:00");
      await page.getByTestId("market-londonKz-end").fill("06:00");
      await expect(page.getByTestId("market-londonKz-local")).toHaveText("У тебя: 11:00–14:00");
      await expect(hours(page, "londonKz")).toHaveText("11:00–14:00");
      await page.getByTestId("market-sessions").screenshot({ path: `test-results/market-killzones-${engine}-1440.png` });

      // end before start: an error, the saved hours stay
      await page.getByTestId("market-newyorkKz-end").fill("06:00");
      await expect(page.getByTestId("market-newyorkKz-local")).toHaveText("Начало должно быть раньше конца, в пределах одних суток.");
      await expect(hours(page, "newyorkKz")).toHaveText("15:00–18:00");

      await page.reload();
      await expect(hours(page, "londonKz")).toHaveText("11:00–14:00");
      await expect(hours(page, "newyorkKz")).toHaveText("15:00–18:00");

      await page.getByTestId("market-killzones-edit").click();
      await page.getByTestId("market-killzones-reset").click();
      await expect(hours(page, "londonKz")).toHaveText("10:00–13:00");
    });

    test("seven sections, «Soon» where nothing is there yet, the section is kept in the address", async () => {
      const page = await guestPage(browser, 360, "2026-04-06T08:30:00Z");
      await page.goto("/market");
      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveText(["Обзор", "График", "Календарь", "Новости", "Экономика", "Бэктест", "Список наблюдения"]);
      await page.getByRole("tab", { name: "Бэктест" }).click();
      await expect(page).toHaveURL(/tab=backtest/);
      await expect(page.getByTestId("market-panel-backtest")).toContainText("Скоро");
      await expect(page.getByTestId("market-panel-backtest")).toContainText("не дают монет и XP");
      await page.reload();
      await expect(page.getByRole("tab", { name: "Бэктест" })).toHaveAttribute("aria-selected", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/market-tabs-${engine}-360.png`, fullPage: true });
    });
  });
}
