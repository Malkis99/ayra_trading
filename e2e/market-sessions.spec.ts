import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";

// Market sessions (PR 1.1, the live cards, 1.1b): seven sections; Asia (Tokyo), London and New York cards with live
// countdowns and their killzones, the overlap, the sub-sessions, «What is next», the 24-hour bar, «Set up». Shown in
// New York time by default. No market data: only clocks. The browser clock is controlled (clock.install + pauseAt);
// the profile's zone is Tbilisi (UTC+4, no summer time).

const ZONE = "Asia/Tbilisi";

async function guestPage(browser: Browser, width: number, now: string, settings?: object): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: ZONE, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(now) });
  // time moves only by clock.runFor (no real seconds slipping in between the checks)
  await page.clock.pauseAt(new Date(now));
  await page.addInitScript(
    ({ zone, settings }) => {
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
      if (settings) localStorage.setItem("ayra_market_sessions", JSON.stringify(settings));
    },
    { zone: ZONE, settings: settings ?? null }
  );
  return page;
}

const el = (page: Page, id: string) => page.getByTestId(id);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// Monday 6 April 2026, 08:30 UTC = 04:30 in New York, 12:30 in Tbilisi
const MONDAY = "2026-04-06T08:30:00Z";

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
      test(`${width}: a weekday in New York time — cards, killzones, the overlap, sub-sessions, what is next`, async () => {
        const page = await guestPage(browser, width, MONDAY);
        await page.goto("/market");
        await expect(el(page, "market-disclaimer")).toContainText("Не является финансовой рекомендацией");
        await expect(el(page, "market-sessions-now")).toContainText("04:30");
        await expect(el(page, "market-display-newyork")).toHaveAttribute("aria-checked", "true");

        await expect(el(page, "market-asia-status")).toHaveText("Закрыта");
        await expect(el(page, "market-asia-hours")).toHaveText("Сегодня · 19:00–04:00 (+1)");
        await expect(el(page, "market-asia-timer")).toHaveText("14:30:00");
        await expect(el(page, "market-london-status")).toHaveText("Открыта");
        await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 03:00–12:00");
        await expect(el(page, "market-london-timer")).toHaveText("07:30:00");
        await expect(el(page, "market-london-mine")).toHaveText("У тебя: 11:00–20:00");
        await expect(el(page, "market-newyork-status")).toHaveText("Закрыта");
        await expect(el(page, "market-newyork-hours")).toHaveText("Сегодня · 09:30–18:00");
        await expect(el(page, "market-newyork-timer")).toHaveText("05:00:00");
        await expect(el(page, "market-card-london").getByTestId("market-londonKz-status")).toHaveText("Открыта");
        await expect(el(page, "market-londonKz-hours")).toHaveText("Сегодня · 02:00–05:00");
        await expect(el(page, "market-londonKz-timer")).toHaveText("00:30:00");
        await expect(el(page, "market-newyorkKz-hours")).toHaveText("Сегодня · 07:00–10:00");
        await expect(el(page, "market-overlap-hours")).toHaveText("Сегодня · 09:30–12:00");
        await expect(el(page, "market-overlap-timer")).toHaveText("05:00:00");
        // sub-sessions
        await expect(el(page, "market-subsessions").getByRole("listitem")).toHaveCount(5);
        await expect(el(page, "market-frankfurt-status")).toHaveText("Открыта");
        await expect(el(page, "market-frankfurt-hours")).toHaveText("Сегодня · 02:00–11:00");
        await expect(el(page, "market-chicago-hours")).toHaveText("Сегодня · 10:00–19:00");
        await expect(el(page, "market-sydney-status")).toHaveText("Закрыта");
        await expect(el(page, "market-about-note")).toHaveText("Общее описание, не является финансовой рекомендацией.");
        await expect(el(page, "market-active-now")).toHaveText("Сейчас активно: Лондон, Гонконг, Франкфурт, Killzone Лондона");
        // what is next: 5 events in order
        const next = page.getByTestId("market-next-item");
        await expect(next).toHaveCount(5);
        await expect(next.nth(0)).toContainText("Закрывается Гонконг");
        await expect(next.nth(1)).toContainText("Заканчивается Killzone Лондона");
        await expect(next.nth(2)).toContainText("Начинается Killzone Нью-Йорка");
        await expect(next.nth(3)).toContainText("Открывается Нью-Йорк");
        // the seconds tick
        await page.clock.runFor(2000);
        await expect(el(page, "market-london-timer")).toHaveText("07:29:58");
        expect(await noSideScroll(page)).toBe(true);
        await page.screenshot({ path: `test-results/market-sessions-${engine}-${width}.png`, fullPage: true });
      });
    }

    test("«?» on a session: a short description on tap, with the general note", async () => {
      const page = await guestPage(browser, 360, MONDAY);
      await page.goto("/market");
      await expect(el(page, "market-london-about")).toBeHidden();
      await el(page, "market-london-hint").click();
      await expect(el(page, "market-london-about")).toContainText("Европейская сессия");
      await el(page, "market-wellington-hint").click();
      await expect(el(page, "market-wellington-about")).toContainText("Тихоокеанская сессия");
      await el(page, "market-overlap-hint").click();
      await expect(el(page, "market-overlap-about")).toContainText("самой высокой ликвидности");
      await el(page, "market-london-hint").click();
      await expect(el(page, "market-london-about")).toBeHidden();
    });

    test("the display time: my zone or UTC — everything follows and is kept after a reload", async () => {
      const page = await guestPage(browser, 1440, MONDAY);
      await page.goto("/market");
      await el(page, "market-display-profile").click();
      await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 11:00–20:00");
      await expect(el(page, "market-newyork-hours")).toHaveText("Сегодня · 17:30–02:00 (+1)");
      await expect(el(page, "market-london-mine")).toHaveCount(0);
      await el(page, "market-display-utc").click();
      await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 07:00–16:00");
      await expect(el(page, "market-london-mine")).toHaveText("У тебя: 11:00–20:00");
      await page.reload();
      await expect(el(page, "market-display-utc")).toHaveAttribute("aria-checked", "true");
      await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 07:00–16:00");
      await el(page, "market-display-zone").click();
      await expect(page.locator("#market-display-zone")).toBeVisible();
    });

    test("«Set up»: session hours typed in New York time, kept in the city's time; wrong ones not saved; reset", async () => {
      const page = await guestPage(browser, 1440, MONDAY);
      await page.goto("/market");
      await el(page, "market-settings-open").click();
      await page.getByRole("tab", { name: "Сессии" }).click();
      await expect(el(page, "market-hours-london-start")).toHaveValue("03:00");
      await expect(el(page, "market-hours-london-local")).toHaveText("= 08:00–17:00 по местному времени Лондона");
      await el(page, "market-hours-london-start").fill("02:00");
      await expect(el(page, "market-hours-london-local")).toHaveText("= 07:00–17:00 по местному времени Лондона");
      await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 02:00–12:00");
      await el(page, "market-settings").screenshot({ path: `test-results/market-settings-${engine}-1440.png` });
      // start = end: an error, the saved hours stay
      await el(page, "market-hours-london-end").fill("02:00");
      await expect(el(page, "market-hours-london-local")).toHaveText("Нужен формат ЧЧ:ММ, начало и конец не должны совпадать.");
      await el(page, "market-settings-done").click();
      await page.reload();
      await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 02:00–12:00");
      // killzones
      await el(page, "market-settings-open").click();
      await page.getByRole("tab", { name: "Killzones" }).click();
      await el(page, "market-hours-londonKz-start").fill("01:30");
      await expect(el(page, "market-londonKz-hours")).toHaveText("Сегодня · 01:30–05:00");
      // reset
      await page.getByRole("tab", { name: "Сессии" }).click();
      await el(page, "market-hours-london-reset").click();
      await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 03:00–12:00");
      await page.getByRole("tab", { name: "Killzones" }).click();
      await el(page, "market-settings-reset-all").click();
      await expect(el(page, "market-londonKz-hours")).toHaveText("Сегодня · 02:00–05:00");
    });

    test("killzones saved before this change are kept", async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: ZONE });
      const page = await context.newPage();
      await page.clock.install({ time: new Date(MONDAY) });
      await page.clock.pauseAt(new Date(MONDAY));
      await page.addInitScript(() => {
        if (sessionStorage.getItem("e2e_seeded")) return;
        sessionStorage.setItem("e2e_seeded", "1");
        localStorage.clear();
        localStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "MarketTrader", onboarding: { status: "done", step: 5, subStep: 0, answers: {} }, profile: { minorMode: false, timezone: "Asia/Tbilisi" } }));
        localStorage.setItem("ayra_market_killzones", JSON.stringify({ londonKz: { start: "03:00", end: "06:00" }, newyorkKz: { start: "08:30", end: "11:00" } }));
      });
      await page.goto("/market");
      await expect(el(page, "market-londonKz-hours")).toHaveText("Сегодня · 03:00–06:00");
      await expect(el(page, "market-newyorkKz-hours")).toHaveText("Сегодня · 08:30–11:00");
    });

    test("«Show 24 h» unfolds the day bar", async () => {
      const page = await guestPage(browser, 1440, MONDAY);
      await page.goto("/market");
      await el(page, "market-day-toggle").click();
      await expect(el(page, "market-timeline")).toBeVisible();
      await expect(el(page, "market-window-newyork-hours")).toHaveText("09:30–18:00");
      await expect(el(page, "market-now-mark")).toHaveText("сейчас 04:30");
    });

    test("a background tab: the countdown pauses and is right at once on return", async () => {
      const page = await guestPage(browser, 1440, MONDAY);
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

    test("across midnight of the display time Tokyo stays one session", async () => {
      // 23:59:58 in New York
      const page = await guestPage(browser, 1440, "2026-04-07T03:59:58Z");
      await page.goto("/market");
      await expect(el(page, "market-asia-hours")).toHaveText("Сегодня · 19:00–04:00 (+1)");
      await page.clock.runFor(3000);
      await expect(el(page, "market-asia-status")).toHaveText("Открыта");
      await expect(el(page, "market-asia-hours")).toHaveText("Вчера · 19:00–04:00 (+1)");
      await expect(el(page, "market-asia-timer")).toHaveText("03:59:59");
    });

    test("winter in my zone: New York an hour later than in summer", async () => {
      // Monday 2 March 2026, 10:00 UTC = 14:00 in Tbilisi
      const page = await guestPage(browser, 1440, "2026-03-02T10:00:00Z", { display: { kind: "profile" } });
      await page.goto("/market");
      await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 12:00–21:00");
      await expect(el(page, "market-newyork-hours")).toHaveText("Сегодня · 18:30–03:00 (+1)");
    });

    test("the weekend: closed, opens on Sunday evening, Sydney first", async () => {
      // Saturday 7 March 2026, 12:00 UTC
      const page = await guestPage(browser, 1440, "2026-03-07T12:00:00Z");
      await page.goto("/market");
      for (const id of ["asia", "london", "newyork"]) {
        await expect(el(page, `market-${id}-status`)).toHaveText("Выходные");
        await expect(el(page, `market-card-${id}`)).toHaveAttribute("data-state", "weekend");
      }
      await expect(el(page, "market-sub-sydney")).toHaveAttribute("data-state", "weekend");
      await expect(el(page, "market-weekend")).toContainText("Рынок закрыт, откроется");
      await expect(el(page, "market-active-now")).toHaveText("Сейчас ничего не открыто: выходные");
      await expect(page.getByTestId("market-next-item").nth(0)).toContainText("Открывается Сидней");
      // Monday 08:00 GMT is 1 day 20 hours away
      await expect(el(page, "market-london-timer")).toHaveText("1 д 20:00:00");
    });

    for (const width of [1440, 360]) {
      test(`${width}: the week when Europe is already on winter time and the USA not yet — 4 hours, a «?» hint`, async () => {
        // Wednesday 28 October 2026, 08:00 UTC = 04:00 in New York
        const page = await guestPage(browser, width, "2026-10-28T08:00:00Z");
        await page.goto("/market");
        await expect(el(page, "market-london-hours")).toHaveText("Сегодня · 04:00–13:00");
        await expect(el(page, "market-newyork-hours")).toHaveText("Сегодня · 09:30–18:00");
        await expect(el(page, "market-overlap-hours")).toHaveText("Сегодня · 09:30–13:00");
        const gap = el(page, "market-gap");
        await expect(gap).toContainText("Между открытием Лондона и Нью-Йорка сейчас 4 ч");
        await el(page, "market-gap-hint").click();
        await expect(gap).toContainText("до 1 ноября");
        await el(page, "market-london-hint").click();
        expect(await noSideScroll(page)).toBe(true);
        await el(page, "market-sessions").screenshot({ path: `test-results/market-sessions-gap-${engine}-${width}.png` });
      });
    }

    test("seven sections, «Soon» where nothing is there yet, the section is kept in the address", async () => {
      const page = await guestPage(browser, 360, MONDAY);
      await page.goto("/market");
      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveText(["Обзор", "График", "Календарь", "Новости", "Экономика", "Бэктест", "Список наблюдения"]);
      await page.getByRole("tab", { name: "Бэктест" }).click();
      await expect(page).toHaveURL(/tab=backtest/);
      await expect(page.getByTestId("market-panel-backtest")).toContainText("Скоро");
      await expect(page.getByTestId("market-panel-backtest")).toContainText("не дают монет и XP");
      await page.reload();
      await expect(page.getByRole("tab", { name: "Бэктест" })).toHaveAttribute("aria-selected", "true");
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
