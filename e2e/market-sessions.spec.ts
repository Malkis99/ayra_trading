import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { stubTradingView } from "./helpers/tradingview";

// Market sessions (PR 1.1, the live cards, 1.1b): seven sections; Asia (Tokyo), London and New York cards with live
// countdowns and their killzones, the overlap, the sub-sessions, «What is next», the 24-hour bar, «Set up». Shown in
// New York time by default. No market data: only clocks. The browser clock is controlled (clock.install + pauseAt);
// the profile's zone is Tbilisi (UTC+4, no summer time).

const ZONE = "Asia/Tbilisi";

async function guestPage(browser: Browser, width: number, now: string, settings?: object): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: ZONE, reducedMotion: "reduce" });
  await stubTradingView(context);
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
        await expect(el(page, "market-asia-hours")).toHaveText("19:00–04:00 (+1)");
        await expect(el(page, "market-asia-timer")).toHaveText("14:30:00");
        await expect(el(page, "market-london-status")).toHaveText("Открыта");
        await expect(el(page, "market-london-hours")).toHaveText("03:00–12:00");
        await expect(el(page, "market-london-timer")).toHaveText("07:30:00");
        await expect(el(page, "market-london-mine")).toHaveText("У тебя: 11:00–20:00");
        await expect(el(page, "market-newyork-status")).toHaveText("Закрыта");
        await expect(el(page, "market-newyork-hours")).toHaveText("09:30–18:00");
        await expect(el(page, "market-newyork-timer")).toHaveText("05:00:00");
        await expect(el(page, "market-card-london").getByTestId("market-londonKz-status")).toHaveText("Открыта");
        await expect(el(page, "market-londonKz-hours")).toHaveText("02:00–05:00");
        await expect(el(page, "market-londonKz-timer")).toHaveText("30 мин");
        await expect(el(page, "market-newyorkKz-hours")).toHaveText("07:00–10:00");
        await expect(el(page, "market-overlap-hours")).toHaveText("09:30–12:00");
        await expect(el(page, "market-overlap-timer")).toHaveText("5 ч 0 мин");
        // sub-sessions
        await expect(el(page, "market-subsessions").getByRole("listitem")).toHaveCount(6);
        await expect(el(page, "market-frankfurt-status")).toHaveText("Открыта");
        await expect(el(page, "market-frankfurt-hours")).toHaveText("02:00–11:00");
        await expect(el(page, "market-chicago-hours")).toHaveText("10:00–19:00");
        await expect(el(page, "market-sydney-status")).toHaveText("Закрыта");
        await expect(el(page, "market-active-now")).toHaveText("Сейчас активно: Лондон, Гонконг, Франкфурт, Killzone Лондона");
        // what is next: 5 events in order
        const next = page.getByTestId("market-next-item");
        await expect(next).toHaveCount(3);
        await expect(next.nth(0)).toContainText("Закрывается Гонконг");
        await expect(next.nth(1)).toContainText("Заканчивается Killzone Лондона");
        await expect(next.nth(2)).toContainText("Начинается Killzone Нью-Йорка");
        // the seconds tick
        await page.clock.runFor(2000);
        await expect(el(page, "market-london-timer")).toHaveText("07:29:58");
        expect(await noSideScroll(page)).toBe(true);
        await page.screenshot({ path: `test-results/market-sessions-${engine}-${width}.png`, fullPage: true });
      });
    }

    for (const width of [1440, 360]) {
      test(`${width}: «?» opens over the page — nothing moves; one at a time; a tap outside or Esc closes it`, async () => {
        const page = await guestPage(browser, width, "2026-11-04T12:00:00Z", { display: { kind: "profile" } });
        await page.goto("/market");
        const watched = ["market-card-newyork", "market-subsessions", "market-sub-sydney", "market-next", "market-day-toggle"];
        // positions inside the sessions block (a tap may scroll the page on a phone), after the fonts are in
        await expect(el(page, "market-card-newyork")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const boxes = () =>
          page.evaluate((ids) => {
            const base = document.querySelector('[data-testid="market-sessions"]')!.getBoundingClientRect();
            return ids.map((id) => {
              const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
              return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
            });
          }, watched);
        const before = await boxes();

        await el(page, "market-london-hint").click();
        await expect(el(page, "market-london-about")).toBeVisible();
        await expect(el(page, "market-london-about")).toContainText("Европейская сессия");
        await expect(el(page, "market-london-season")).toHaveText(
          "Местные часы: 08:00–17:00 (UTC+0). Сейчас в Лондоне зимнее время, поэтому по твоему времени сессия на 1 ч позже, чем летом."
        );
        await expect(el(page, "market-london-about")).toContainText("Общее описание, не является финансовой рекомендацией.");
        expect(await boxes()).toEqual(before);
        await page.screenshot({ path: `test-results/market-hint-${engine}-${width}.png` });

        // another hint: the first one closes
        await el(page, "market-sydney-hint").click();
        await expect(el(page, "market-sydney-about")).toContainText("Тихоокеанская сессия");
        await expect(el(page, "market-london-about")).toHaveCount(0);
        expect(await boxes()).toEqual(before);

        // a tap outside
        await page.mouse.click(5, 5);
        await expect(el(page, "market-sydney-about")).toHaveCount(0);
        // Esc
        await el(page, "market-overlap-hint").click();
        await expect(el(page, "market-overlap-about")).toContainText("самой высокой ликвидности");
        await page.keyboard.press("Escape");
        await expect(el(page, "market-overlap-about")).toHaveCount(0);
        expect(await boxes()).toEqual(before);
      });
    }

    test("the display time: New York and my zone in the block, UTC or any zone in the settings; kept after a reload", async () => {
      const page = await guestPage(browser, 1440, MONDAY);
      await page.goto("/market");
      await expect(el(page, "market-display-utc")).toHaveCount(0);
      await expect(el(page, "market-display-profile")).toHaveText("Мой пояс · UTC+4");
      await el(page, "market-display-profile").click();
      await expect(el(page, "market-london-hours")).toHaveText("11:00–20:00");
      await expect(el(page, "market-newyork-hours")).toHaveText("17:30–02:00 (+1)");
      await expect(el(page, "market-london-mine")).toHaveCount(0);
      // UTC from «Set up» → General
      await el(page, "market-settings-open").click();
      await el(page, "market-settings-display-utc").click();
      await el(page, "market-settings-done").click();
      await expect(el(page, "market-london-hours")).toHaveText("07:00–16:00");
      await expect(el(page, "market-london-mine")).toHaveText("У тебя: 11:00–20:00");
      await expect(el(page, "market-display-newyork")).toHaveAttribute("aria-checked", "false");
      await expect(el(page, "market-display-profile")).toHaveAttribute("aria-checked", "false");
      await expect(el(page, "market-display-elsewhere")).toHaveText("Время показа: UTC, меняется в настройках");
      await page.reload();
      await expect(el(page, "market-london-hours")).toHaveText("07:00–16:00");
      await expect(el(page, "market-display-elsewhere")).toBeVisible();
      // any zone from the list (search by city) is in the settings
      await el(page, "market-settings-open").click();
      await el(page, "market-settings-display-zone").click();
      await expect(page.locator("#market-settings-display-zone")).toBeVisible();
    });

    for (const width of [1440, 360]) {
      test(`${width}: three main cards — one row of equal columns on a wide screen, one under another on a phone; «What is next» under the table`, async () => {
        const page = await guestPage(browser, width, MONDAY);
        await page.goto("/market");
        const box = async (id: string) => (await el(page, id).boundingBox())!;
        const [a, l, n] = [await box("market-card-asia"), await box("market-card-london"), await box("market-card-newyork")];
        const block = await box("market-sessions");
        if (width === 1440) {
          expect(Math.abs(a.y - l.y)).toBeLessThan(1);
          expect(Math.abs(l.y - n.y)).toBeLessThan(1);
          expect(Math.abs(a.width - l.width)).toBeLessThan(1);
          expect(Math.abs(l.width - n.width)).toBeLessThan(1);
          // together they span the block
          expect(n.x + n.width - a.x).toBeGreaterThan(block.width - 60);
        } else {
          expect(l.y).toBeGreaterThan(a.y + a.height - 1);
          expect(n.y).toBeGreaterThan(l.y + l.height - 1);
          expect(a.width).toBeGreaterThan(block.width - 60);
        }
        const table = await box("market-subsessions");
        const next = await box("market-next");
        expect(table.y).toBeGreaterThan(Math.max(a.y + a.height, n.y + n.height) - 1);
        expect(next.y).toBeGreaterThan(table.y + table.height - 1);
        expect(next.width).toBeGreaterThan(block.width - 60);
        // the ring is large and the countdown sits inside it
        const ring = await box("market-london-ring");
        const timer = await box("market-london-timer");
        expect(ring.width).toBeGreaterThan(140);
        expect(timer.x).toBeGreaterThan(ring.x);
        expect(timer.x + timer.width).toBeLessThan(ring.x + ring.width);
      });
    }

    test("«Set up»: session hours typed in New York time, kept in the city's time; wrong ones not saved; reset", async () => {
      const page = await guestPage(browser, 1440, MONDAY);
      await page.goto("/market");
      await el(page, "market-settings-open").click();
      await page.getByRole("tab", { name: "Сессии" }).click();
      await expect(el(page, "market-hours-london-start")).toHaveValue("03:00");
      await expect(el(page, "market-hours-london-local")).toHaveText("= 08:00–17:00 по местному времени Лондона");
      await el(page, "market-hours-london-start").fill("02:00");
      await expect(el(page, "market-hours-london-local")).toHaveText("= 07:00–17:00 по местному времени Лондона");
      await expect(el(page, "market-london-hours")).toHaveText("02:00–12:00");
      await el(page, "market-settings").screenshot({ path: `test-results/market-settings-${engine}-1440.png` });
      // start = end: an error, the saved hours stay
      await el(page, "market-hours-london-end").fill("02:00");
      await expect(el(page, "market-hours-london-local")).toHaveText("Нужен формат ЧЧ:ММ, начало и конец не должны совпадать.");
      await el(page, "market-settings-done").click();
      await page.reload();
      await expect(el(page, "market-london-hours")).toHaveText("02:00–12:00");
      // killzones
      await el(page, "market-settings-open").click();
      await page.getByRole("tab", { name: "Killzones" }).click();
      await el(page, "market-hours-londonKz-start").fill("01:30");
      await expect(el(page, "market-londonKz-hours")).toHaveText("01:30–05:00");
      // reset
      await page.getByRole("tab", { name: "Сессии" }).click();
      await el(page, "market-hours-london-reset").click();
      await expect(el(page, "market-london-hours")).toHaveText("03:00–12:00");
      await page.getByRole("tab", { name: "Killzones" }).click();
      await el(page, "market-settings-reset-all").click();
      await expect(el(page, "market-londonKz-hours")).toHaveText("02:00–05:00");
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
      await expect(el(page, "market-londonKz-hours")).toHaveText("03:00–06:00");
      await expect(el(page, "market-newyorkKz-hours")).toHaveText("08:30–11:00");
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
      await expect(el(page, "market-asia-hours")).toHaveText("19:00–04:00 (+1)");
      await page.clock.runFor(3000);
      await expect(el(page, "market-asia-status")).toHaveText("Открыта");
      await expect(el(page, "market-asia-hours")).toHaveText("Вчера · 19:00–04:00 (+1)");
      await expect(el(page, "market-asia-timer")).toHaveText("03:59:59");
    });

    test("winter in my zone: New York an hour later than in summer", async () => {
      // Monday 2 March 2026, 10:00 UTC = 14:00 in Tbilisi
      const page = await guestPage(browser, 1440, "2026-03-02T10:00:00Z", { display: { kind: "profile" } });
      await page.goto("/market");
      await expect(el(page, "market-london-hours")).toHaveText("12:00–21:00");
      await expect(el(page, "market-newyork-hours")).toHaveText("18:30–03:00 (+1)");
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
      await expect(el(page, "market-weekend")).toHaveText("Выходные: рынок закрыт, откроется в воскресенье 17:00");
      await expect(el(page, "market-active-now")).toHaveCount(0);
      await expect(page.getByTestId("market-next-item").nth(0)).toContainText("Открывается Сидней");
      // Monday 08:00 GMT is 1 day 20 hours away: days, hours and minutes, no seconds
      await expect(el(page, "market-london-timer")).toHaveText("1 д 20 ч 0 мин");
    });

    for (const width of [1440, 360]) {
      test(`${width}: the week when Europe is already on winter time and the USA not yet — 4 hours, a «?» hint`, async () => {
        // Wednesday 28 October 2026, 08:00 UTC = 04:00 in New York
        const page = await guestPage(browser, width, "2026-10-28T08:00:00Z");
        await page.goto("/market");
        await expect(el(page, "market-london-hours")).toHaveText("04:00–13:00");
        await expect(el(page, "market-newyork-hours")).toHaveText("09:30–18:00");
        await expect(el(page, "market-overlap-hours")).toHaveText("09:30–13:00");
        await el(page, "market-block-hint").click();
        const gap = el(page, "market-gap");
        await expect(gap).toContainText("Между открытием Лондона и Нью-Йорка сейчас 4 ч");
        await expect(gap).toContainText("до 1 ноября");
        expect(await noSideScroll(page)).toBe(true);
        await el(page, "market-sessions").screenshot({ path: `test-results/market-sessions-gap-${engine}-${width}.png` });
      });
    }

    test("seven sections, «Soon» where nothing is there yet, the section is kept in the address", async () => {
      const page = await guestPage(browser, 360, MONDAY);
      await page.goto("/market");
      const tabs = page.getByRole("tablist", { name: "Разделы рынка" }).getByRole("tab");
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

// PR 1.1d: a tidy block on phones. Timers and captions never wrap (checked by the element's height against its line
// height), the ring's timer stays inside the ring, the killzone timer stays on its row on the right, the table's timers
// line up on the right, «Weekend» is said once. Screenshots of a weekday, the weekend and «more than a day to the
// opening» at 1440, 390 and 360.
const SCENARIOS = [
  { name: "weekday", now: MONDAY },
  // Sunday 5 April 2026, 10:00 UTC: the weekend, Sydney opens in the evening
  { name: "weekend", now: "2026-04-05T10:00:00Z" },
  // Saturday 4 April 2026, 12:00 UTC: more than a day to every opening
  { name: "day-plus", now: "2026-04-04T12:00:00Z" },
] as const;

/** Elements that must stay on one line: every countdown, «in …» and the time in «What is next», the killzone hours. */
const oneLiners = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("[data-testid=market-sessions]")!;
    const els = [
      ...root.querySelectorAll<HTMLElement>("[role=timer], [data-testid=market-next-left], [data-testid=market-next-time], [data-testid$=Kz-hours]"),
    ];
    return els.map((el) => {
      const style = getComputedStyle(el);
      const line = style.lineHeight === "normal" ? parseFloat(style.fontSize) * 1.3 : parseFloat(style.lineHeight);
      return { id: el.dataset.testid ?? el.textContent ?? "", text: el.textContent ?? "", height: el.getBoundingClientRect().height, line };
    });
  });

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — the sessions block on phones (1.1d)`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    for (const scenario of SCENARIOS) {
      for (const width of [1440, 390, 360]) {
        test(`${width}, ${scenario.name}: nothing wraps, the timers keep their places`, async () => {
          const page = await guestPage(browser, width, scenario.now);
          await page.goto("/market");
          await expect(el(page, "market-london-timer")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);

          const lines = await oneLiners(page);
          expect(lines.length).toBeGreaterThan(10);
          for (const l of lines) expect({ id: l.id, text: l.text, wraps: l.height > l.line * 1.5 }).toEqual({ id: l.id, text: l.text, wraps: false });

          for (const id of ["asia", "london", "newyork"]) {
            // the ring's timer is inside the ring
            const ring = (await el(page, `market-${id}-ring`).boundingBox())!;
            const timer = (await el(page, `market-${id}-timer`).boundingBox())!;
            expect(timer.x >= ring.x && timer.x + timer.width <= ring.x + ring.width).toBe(true);
          }
          for (const kz of ["londonKz", "newyorkKz"]) {
            // the killzone timer: on the same row as «Killzone · hours», at the right edge
            const row = (await el(page, `market-card-${kz}`).boundingBox())!;
            const hours = (await el(page, `market-${kz}-hours`).boundingBox())!;
            const timer = (await el(page, `market-${kz}-timer`).boundingBox())!;
            expect(timer.x).toBeGreaterThan(hours.x);
            expect(Math.abs(row.x + row.width - (timer.x + timer.width))).toBeLessThan(16);
            expect(timer.y >= row.y && timer.y + timer.height <= row.y + row.height).toBe(true);
          }
          // the table (owner 2026-11-02): every row says «Open · closes in …» or «Closed · opens in …» in one or two
          // lines, inside its row, the dot green when open
          const rows = await el(page, "market-subsessions").locator("[data-testid$=-row-status]").evaluateAll((els) =>
            els.map((e) => {
              const r = e.getBoundingClientRect();
              const row = e.closest("li")!.getBoundingClientRect();
              const line = parseFloat(getComputedStyle(e).lineHeight) || 16;
              const dot = e.querySelector("[aria-hidden]")!.className;
              return { text: e.textContent ?? "", lines: Math.round(r.height / line), inside: r.left >= row.left && r.right <= row.right + 0.5, green: dot.includes("bg-long") };
            })
          );
          expect(rows).toHaveLength(6);
          for (const r of rows) {
            expect(r.text).toMatch(/^(Открыта · закроется через|Закрыта · откроется через) \d/);
            expect(r.lines).toBeLessThanOrEqual(2);
            expect(r.inside).toBe(true);
            expect(r.green).toBe(r.text.startsWith("Открыта"));
          }

          if (scenario.name === "weekday") {
            await expect(el(page, "market-weekend")).toHaveCount(0);
          } else {
            // «Weekend» once, at the top; grey dots in the rows
            await expect(el(page, "market-weekend")).toHaveText(/^Выходные: рынок закрыт, откроется в (понедельник|воскресенье) \d\d:\d\d$/);
            const visibleWeekend = await el(page, "market-sessions").evaluate((root) => {
              const copy = root.cloneNode(true) as HTMLElement;
              copy.querySelectorAll(".sr-only").forEach((n) => n.remove());
              return (copy.textContent ?? "").split("Выходные").length - 1;
            });
            expect(visibleWeekend).toBe(1);
          }
          if (scenario.name === "day-plus") {
            for (const id of ["asia", "london", "newyork"]) await expect(el(page, `market-${id}-timer`)).toHaveText(/^\d+ д \d+ ч \d+ мин$/);
          }
          expect(await noSideScroll(page)).toBe(true);
          // the page scrolls inside its own container: a tall window shows the whole block
          await page.setViewportSize({ width, height: 3600 });
          await el(page, "market-sessions").screenshot({ path: `test-results/market-phone-${scenario.name}-${engine}-${width}.png` });
        });
      }
    }
  });
}
