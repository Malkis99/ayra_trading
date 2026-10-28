import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";

// Market sessions (PR 1.1 and the live cards): seven sections; Tokyo, London and New York cards with live countdowns,
// killzones inside their cards, the overlap, «What is next», the 24-hour bar under «Show 24 h». No market data: only
// clocks. The browser clock is controlled (clock.install); the user's zone is Tbilisi (UTC+4, no summer time).

const ZONE = "Asia/Tbilisi";

async function guestPage(browser: Browser, width: number, now: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: ZONE, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(now) });
  // time moves only by clock.runFor (no real seconds slipping in between the checks)
  await page.clock.pauseAt(new Date(now));
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

const el = (page: Page, id: string) => page.getByTestId(id);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

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
      test(`${width}: a weekday — three session cards with live countdowns, killzones inside, the overlap, what is next`, async () => {
        // Monday 6 April 2026, 08:30 UTC = 12:30 in Tbilisi; Europe and the USA in summer time
        const page = await guestPage(browser, width, "2026-04-06T08:30:00Z");
        await page.goto("/market");
        await expect(el(page, "market-disclaimer")).toContainText("Не является финансовой рекомендацией");
        await expect(el(page, "market-sessions-now")).toContainText("12:30");

        await expect(el(page, "market-asia-status")).toHaveText("Открыта");
        await expect(el(page, "market-asia-hours")).toHaveText("Сегодня · 04:00–13:00");
        await expect(el(page, "market-london-status")).toHaveText("Открыта");
        await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 11:00–20:00");
        await expect(el(page, "market-london-timer")).toHaveText("07:30:00");
        await expect(el(page, "market-newyork-status")).toHaveText("Закрыта");
        await expect(el(page, "market-newyork-hours")).toHaveText("Сегодня · 16:00–01:00 (+1)");
        await expect(el(page, "market-newyork-timer")).toHaveText("03:30:00");
        // killzones inside the London and New York cards (New York time 02:00–05:00 and 07:00–10:00)
        await expect(el(page, "market-card-london").getByTestId("market-londonKz-status")).toHaveText("Открыта");
        await expect(el(page, "market-londonKz-hours")).toHaveText("Сегодня · 10:00–13:00");
        await expect(el(page, "market-londonKz-timer")).toHaveText("00:30:00");
        await expect(el(page, "market-card-newyork").getByTestId("market-newyorkKz-status")).toHaveText("Закрыта");
        await expect(el(page, "market-newyorkKz-hours")).toHaveText("Сегодня · 15:00–18:00");
        // the overlap in one line
        await expect(el(page, "market-overlap-status")).toHaveText("Закрыта");
        await expect(el(page, "market-overlap-hours")).toHaveText("Сегодня · 16:00–20:00");
        await expect(el(page, "market-overlap-timer")).toHaveText("03:30:00");
        // what is next: 5 events in order
        const next = page.getByTestId("market-next-item");
        await expect(next).toHaveCount(5);
        await expect(next.nth(0)).toContainText("Закрывается Токио");
        await expect(next.nth(1)).toContainText("Заканчивается Killzone Лондона");
        await expect(next.nth(2)).toContainText("Начинается Killzone Нью-Йорка");
        await expect(next.nth(3)).toContainText("Открывается Нью-Йорк");
        await expect(el(page, "market-active-now")).toHaveText("Сейчас активно: Токио, Лондон, Killzone Лондона");
        // the 24-hour bar is folded; no «4 hours» hint in a usual week
        await expect(el(page, "market-timeline")).toHaveCount(0);
        await expect(el(page, "market-gap")).toHaveCount(0);

        // the seconds tick
        await page.clock.runFor(2000);
        await expect(el(page, "market-london-timer")).toHaveText("07:29:58");
        await expect(el(page, "market-londonKz-timer")).toHaveText("00:29:58");

        expect(await noSideScroll(page)).toBe(true);
        await page.screenshot({ path: `test-results/market-sessions-${engine}-${width}.png`, fullPage: true });
      });
    }

    test("«Show 24 h» unfolds the day bar of #110", async () => {
      const page = await guestPage(browser, 1440, "2026-04-06T08:30:00Z");
      await page.goto("/market");
      await el(page, "market-day-toggle").click();
      await expect(el(page, "market-day-toggle")).toHaveAttribute("aria-expanded", "true");
      await expect(el(page, "market-timeline")).toBeVisible();
      await expect(el(page, "market-window-newyork-hours")).toHaveText("16:00–01:00 (+1)");
      await expect(el(page, "market-now-mark")).toHaveText("сейчас 12:30");
      await el(page, "market-day-toggle").click();
      await expect(el(page, "market-timeline")).toHaveCount(0);
    });

    test("a background tab: the countdown pauses and is right at once on return", async () => {
      const page = await guestPage(browser, 1440, "2026-04-06T08:30:00Z");
      await page.goto("/market");
      await expect(el(page, "market-london-timer")).toHaveText("07:30:00");
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.clock.runFor(10_000);
      await expect(el(page, "market-london-timer")).toHaveText("07:30:00");
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(el(page, "market-london-timer")).toHaveText("07:29:50");
    });

    test("across the user's midnight New York stays one session", async () => {
      // 23:59:58 in Tbilisi
      const page = await guestPage(browser, 1440, "2026-04-06T19:59:58Z");
      await page.goto("/market");
      await expect(el(page, "market-newyork-hours")).toHaveText("Сегодня · 16:00–01:00 (+1)");
      await page.clock.runFor(3000);
      await expect(el(page, "market-newyork-status")).toHaveText("Открыта");
      await expect(el(page, "market-newyork-hours")).toHaveText("Вчера · 16:00–01:00 (+1)");
      await expect(el(page, "market-newyork-timer")).toHaveText("00:59:59");
    });

    test("winter in both: New York and its killzone an hour later on the user's clock", async () => {
      // Monday 2 March 2026, 10:00 UTC = 14:00 in Tbilisi
      const page = await guestPage(browser, 1440, "2026-03-02T10:00:00Z");
      await page.goto("/market");
      await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 12:00–21:00");
      await expect(el(page, "market-newyork-hours")).toHaveText("Сегодня · 17:00–02:00 (+1)");
      await expect(el(page, "market-londonKz-hours")).toHaveText("Завтра · 11:00–14:00");
    });

    test("the weekend: closed, opens on Sunday evening, the next events are on Monday", async () => {
      // Saturday 7 March 2026, 12:00 UTC
      const page = await guestPage(browser, 1440, "2026-03-07T12:00:00Z");
      await page.goto("/market");
      for (const id of ["asia", "london", "newyork"]) {
        await expect(el(page, `market-${id}-status`)).toHaveText("Выходные");
        await expect(el(page, `market-card-${id}`)).toHaveAttribute("data-state", "weekend");
      }
      await expect(el(page, "market-weekend")).toContainText("Рынок закрыт, откроется");
      await expect(el(page, "market-active-now")).toHaveText("Сейчас ничего не открыто: выходные");
      await expect(page.getByTestId("market-next-item").nth(0)).toContainText("Открывается Токио");
      // Monday 08:00 GMT is 1 day 20 hours away
      await expect(el(page, "market-london-timer")).toHaveText("1 д 20:00:00");
    });

    test("killzone hours can be changed, are kept after a reload, wrong hours are not saved", async () => {
      const page = await guestPage(browser, 1440, "2026-04-06T08:30:00Z");
      await page.goto("/market");
      await el(page, "market-killzones-edit").click();
      await el(page, "market-londonKz-start").fill("03:00");
      await el(page, "market-londonKz-end").fill("06:00");
      await expect(el(page, "market-londonKz-local")).toHaveText("У тебя: 11:00–14:00");
      await expect(el(page, "market-londonKz-hours")).toHaveText("Сегодня · 11:00–14:00");
      await el(page, "market-sessions").screenshot({ path: `test-results/market-killzones-${engine}-1440.png` });

      // end before start: an error, the saved hours stay
      await el(page, "market-newyorkKz-end").fill("06:00");
      await expect(el(page, "market-newyorkKz-local")).toHaveText("Начало должно быть раньше конца, в пределах одних суток.");
      await expect(el(page, "market-newyorkKz-hours")).toHaveText("Сегодня · 15:00–18:00");

      await page.reload();
      await expect(el(page, "market-londonKz-hours")).toHaveText("Сегодня · 11:00–14:00");
      await expect(el(page, "market-newyorkKz-hours")).toHaveText("Сегодня · 15:00–18:00");

      await el(page, "market-killzones-edit").click();
      await el(page, "market-killzones-reset").click();
      await expect(el(page, "market-londonKz-hours")).toHaveText("Сегодня · 10:00–13:00");
    });

    for (const width of [1440, 360]) {
      test(`${width}: the week when Europe is already on winter time and the USA not yet — 4 hours, a «?» hint`, async () => {
        // Wednesday 28 October 2026, 08:00 UTC = 12:00 in Tbilisi
        const page = await guestPage(browser, width, "2026-10-28T08:00:00Z");
        await page.goto("/market");
        await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 12:00–21:00");
        await expect(el(page, "market-newyork-hours")).toHaveText("Сегодня · 16:00–01:00 (+1)");
        await expect(el(page, "market-overlap-hours")).toHaveText("Сегодня · 16:00–21:00");
        const gap = el(page, "market-gap");
        await expect(gap).toContainText("Между открытием Лондона и Нью-Йорка сейчас 4 ч");
        await el(page, "market-gap-hint").click();
        await expect(gap).toContainText("Обычно разница 5 часов");
        await expect(gap).toContainText("до 1 ноября");
        expect(await noSideScroll(page)).toBe(true);
        await el(page, "market-sessions").screenshot({ path: `test-results/market-sessions-gap-${engine}-${width}.png` });
      });
    }

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
