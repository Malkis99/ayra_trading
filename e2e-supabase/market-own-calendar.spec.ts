import { test, expect, type Browser, type Page, type APIRequestContext } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Market → Calendar → «Official events» (PR 3, docs/market-feeds-plan.md): the 0009 table read by the site (the
// fake Supabase holds the rows), Monday to Friday tabs of this week or the next, times in the profile's zone, the
// figures from BLS / BEA, the trust mark and source on every row. The TradingView calendar is the «World calendar».
// The browser's clock is Tuesday 3 November 2026, 12:00 UTC (16:00 in Tbilisi).

const NOW = "2026-11-03T12:00:00Z";
const ev = (o: Record<string, unknown>) => ({
  kind: "release",
  code: null,
  country: "us",
  importance: 3,
  time_tbd: false,
  status: "scheduled",
  actual: null,
  previous: null,
  hidden: false,
  updated_at: "2026-11-03T11:50:00Z",
  ...o,
});
const EVENTS = [
  ev({ id: "bls:us_jolts:2026-11-03", source: "bls", code: "us_jolts", title: "Job Openings and Labor Turnover Survey", importance: 2, starts_at: "2026-11-03T15:00:00Z", status: "released", actual: "7.52M", previous: "7.19M", url: "https://www.bls.gov/schedule/news_release/" }),
  ev({ id: "bea:us_trade:2026-11-04", source: "bea", code: "us_trade", title: "U.S. International Trade", importance: 2, starts_at: "2026-11-04T13:30:00Z", url: "https://www.bea.gov/news/schedule" }),
  ev({ id: "bls:us_nfp:2026-11-06", source: "bls", code: "us_nfp", title: "Employment Situation", starts_at: "2026-11-06T13:30:00Z", url: "https://www.bls.gov/schedule/news_release/" }),
  ev({ id: "bea:other:2026-11-06", source: "bea", title: "Outdoor Recreation Economic Statistics", importance: 1, starts_at: "2026-11-06T15:00:00Z" }),
  ev({ id: "ecb:hidden:2026-11-05", source: "ecb", country: "eu", title: "Hidden by the owner", starts_at: "2026-11-05T09:00:00Z", hidden: true }),
  ev({ id: "bls:us_cpi:2026-11-10", source: "bls", code: "us_cpi", title: "Consumer Price Index", starts_at: "2026-11-10T13:30:00Z" }),
  ev({ id: "ecb:mpm:2026-11-12:decision", source: "ecb", kind: "decision", code: "ecb_decision", country: "eu", title: "ECB monetary policy decisions", starts_at: "2026-11-12T13:15:00Z" }),
];

const el = (page: Page, id: string) => page.getByTestId(id);
const seed = (request: APIRequestContext, rows: unknown[] = EVENTS) => request.post(`${FAKE_SUPABASE}/__test/market-events`, { data: rows });

/** A guest who chose «Continue without signing in» (with the cloud on, a visitor is otherwise sent to sign in). */
async function guest(browser: Browser, width: number) {
  const { page } = await marketGuest(browser, width);
  await page.addInitScript(() => localStorage.setItem("ayra_guest_dismissed", "1"));
  return page;
}

async function calendar(browser: Browser, width: number, url = "/market?tab=calendar&view=own") {
  const page = await guest(browser, width);
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.pauseAt(new Date(NOW));
  await page.goto(url);
  await expect(el(page, "own-calendar-list")).toBeVisible();
  return page;
}

test.describe("Market — own calendar of official events", () => {
  test.use({ reducedMotion: "reduce" });
  test.beforeEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/market-events-fail?on=0`);
    await seed(request);
  });

  for (const width of [1440, 360]) {
    test(`${width}: this week's days, today first; times in the profile's zone; the figure, status, trust mark and source`, async ({ browser }) => {
      const page = await calendar(browser, width);
      await expect(el(page, "market-calendar")).toHaveAttribute("data-view", "own");
      await expect(el(page, "own-calendar-zone")).toContainText("Время — в вашем поясе: Грузия");
      // Monday … Friday of 2–6 November, Tuesday (today) open
      await expect(el(page, "own-calendar-days").getByRole("tab")).toHaveCount(5);
      await expect(el(page, "own-calendar-day-2")).toHaveAttribute("aria-selected", "true");
      await expect(el(page, "own-calendar-day-2-count")).toHaveText("сегодня");
      await expect(el(page, "own-calendar-day-5-count")).toHaveText("1 соб."); // the low one is filtered out by default
      const row = el(page, "own-calendar-event");
      await expect(row).toHaveCount(1);
      await expect(row.getByTestId("own-calendar-event-time")).toHaveText("19:00"); // 15:00 UTC in Tbilisi
      await expect(row.getByTestId("own-calendar-event-title")).toHaveText("Вакансии JOLTS");
      await expect(row.getByTestId("own-calendar-event-actual")).toHaveText("7.52M");
      await expect(row.getByTestId("own-calendar-event-previous")).toHaveText("7.19M");
      await expect(row.getByTestId("own-calendar-event-status")).toHaveText("Вышло");
      await expect(row.getByTestId("own-calendar-event-trust")).toHaveText("Официальный");
      await expect(row.getByTestId("own-calendar-event-source")).toHaveAttribute("href", "https://www.bls.gov/schedule/news_release/");
      await expect(el(page, "market-calendar-disclaimer")).toHaveText("Не является финансовой рекомендацией.");
      await expect(el(page, "market-calendar-sources")).toContainText("ФРС, ЕЦБ, BLS, BEA");
      await expect(el(page, "own-calendar-updated")).toContainText("Данные обновлены: 3 нояб. 15:50");

      // Friday: NFP at 17:30 in Tbilisi, still to come
      await el(page, "own-calendar-day-5").click();
      await expect(el(page, "own-calendar-event")).toHaveCount(1);
      await expect(el(page, "own-calendar-event").getByTestId("own-calendar-event-title")).toHaveText("Занятость вне с/х (NFP) и безработица");
      await expect(el(page, "own-calendar-event").getByTestId("own-calendar-event-time")).toHaveText("17:30");
      await expect(el(page, "own-calendar-event").getByTestId("own-calendar-event-status")).toHaveText("Ожидается");
      // the hidden row never shows
      await el(page, "own-calendar-day-4").click();
      await expect(el(page, "own-calendar-empty")).toBeVisible();

      // nothing wider than the screen, the five tabs inside it
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const tabs = (await el(page, "own-calendar-days").boundingBox())!;
      expect(tabs.x + tabs.width).toBeLessThanOrEqual(width);
    });
  }

  test("next week: opens on Monday; the ECB decision at 17:15 in Tbilisi; back to this week", async ({ browser }) => {
    const page = await calendar(browser, 1440);
    await el(page, "own-calendar-next-week").click();
    await expect(el(page, "own-calendar")).toHaveAttribute("data-week", "1");
    await expect(el(page, "own-calendar-range")).toHaveText("9 ноября – 13 ноября");
    await expect(el(page, "own-calendar-day-1")).toHaveAttribute("aria-selected", "true");
    await el(page, "own-calendar-day-2").click();
    await expect(el(page, "own-calendar-event").getByTestId("own-calendar-event-title")).toHaveText("Индекс потребительских цен (CPI)");
    await el(page, "own-calendar-day-4").click();
    await expect(el(page, "own-calendar-event").getByTestId("own-calendar-event-time")).toHaveText("17:15");
    await expect(el(page, "own-calendar-event").getByTestId("own-calendar-event-title")).toHaveText("Решение ЕЦБ по ставке");
    await el(page, "own-calendar-this-week").click();
    await expect(el(page, "own-calendar-day-2")).toHaveAttribute("aria-selected", "true");
  });

  test("filters apply: low importance shown on demand; only countries we do not cover → a clear message", async ({ browser }) => {
    const page = await calendar(browser, 1440);
    await el(page, "own-calendar-day-5").click();
    await el(page, "market-calendar-importance-low").click();
    await expect(el(page, "own-calendar-event")).toHaveCount(2);
    await expect(el(page, "own-calendar-event").nth(1)).toHaveAttribute("data-level", "low");
    // countries: only Japan and the UK
    for (const c of ["us", "eu", "gb"]) await el(page, `market-calendar-country-${c}`).click();
    await expect(el(page, "own-calendar-no-country")).toContainText("Официальные события есть только для США и еврозоны");
  });

  test("the profile's zone moves the times (New York: NFP at 08:30)", async ({ browser }) => {
    const page = await guest(browser, 1440);
    await page.addInitScript(() => {
      const raw = localStorage.getItem("ayra_demo_v1");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.profile?.timezone === "America/New_York") return;
      s.profile = { ...s.profile, timezone: "America/New_York" };
      localStorage.setItem("ayra_demo_v1", JSON.stringify(s));
    });
    await page.clock.install({ time: new Date(NOW) });
    await page.clock.pauseAt(new Date(NOW));
    await page.goto("/market?tab=calendar&view=own");
    await el(page, "own-calendar-day-5").click();
    await expect(el(page, "own-calendar-event").getByTestId("own-calendar-event-time")).toHaveText("08:30");
    await expect(el(page, "own-calendar-zone")).toContainText("Восточная Америка");
  });

  for (const width of [1440, 360]) {
    test(`${width}: EIA, Census and DOL (PR 1 of section 9): names, the source, the week's figure; nothing wider than the screen`, async ({ browser, request }) => {
      await seed(request, [
        ...EVENTS,
        ev({ id: "eia:us_eia_crude:2026-11-04", source: "eia", code: "us_eia_crude", title: "Weekly Petroleum Status Report", starts_at: "2026-11-04T15:30:00Z", status: "released", actual: "−1.9M", previous: "−3.1M", url: "https://www.eia.gov/petroleum/supply/weekly/" }),
        ev({ id: "eia:us_eia_gas:2026-11-05", source: "eia", code: "us_eia_gas", title: "Weekly Natural Gas Storage Report", importance: 2, starts_at: "2026-11-05T15:30:00Z", url: "https://ir.eia.gov/ngs/ngs.html" }),
        ev({ id: "dol:us_jobless_claims:2026-11-05", source: "dol", code: "us_jobless_claims", title: "Unemployment Insurance Weekly Claims", starts_at: "2026-11-05T13:30:00Z", url: "https://www.dol.gov/ui/data.pdf" }),
        // a Census row on this week's Friday (the real retail release is 17 November, two weeks ahead)
        ev({ id: "census:us_retail_sales:2026-11-06", source: "census", code: "us_retail_sales", title: "Advance Monthly Sales for Retail and Food Services", starts_at: "2026-11-06T15:00:00Z", url: "https://www.census.gov/economic-indicators/" }),
      ]);
      const page = await calendar(browser, width);
      await el(page, "own-calendar-day-3").click();
      const crude = el(page, "own-calendar-event").filter({ hasText: "Запасы нефти" });
      await expect(crude.getByTestId("own-calendar-event-title")).toHaveText("Запасы нефти в США (EIA)");
      await expect(crude.getByTestId("own-calendar-event-time")).toHaveText("19:30"); // 10:30 ET = 15:30 UTC
      await expect(crude.getByTestId("own-calendar-event-actual")).toHaveText("−1.9M");
      await expect(crude.getByTestId("own-calendar-event-previous")).toHaveText("−3.1M");
      await expect(crude.getByTestId("own-calendar-event-source")).toHaveText(/EIA/);
      await expect(crude.getByTestId("own-calendar-event-source")).toHaveAttribute("href", "https://www.eia.gov/petroleum/supply/weekly/");
      await el(page, "own-calendar-day-4").click();
      const titles = el(page, "own-calendar-event").getByTestId("own-calendar-event-title");
      await expect(titles).toHaveText(["Первичные заявки на пособие по безработице", "Запасы газа в хранилищах США (EIA)"]);
      await expect(el(page, "own-calendar-event").first().getByTestId("own-calendar-event-source")).toHaveText(/Минтруд США/);
      await expect(el(page, "market-calendar-sources")).toContainText("EIA, Census, Минтруд США (DOL)");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await el(page, "own-calendar-day-5").click();
      await expect(el(page, "own-calendar-event").filter({ hasText: "Розничные продажи США" }).getByTestId("own-calendar-event-source")).toHaveText(/Census/);
    });
  }

  for (const width of [1440, 360]) {
    test(`${width}: Eurostat (PR 2 of section 9): the euro area's releases at 11:00 Luxembourg time, the trust mark, Eurostat with its link, the credit`, async ({ browser, request }) => {
      await seed(request, [
        ...EVENTS,
        ev({ id: "eurostat:eu_hicp_flash:2026-11-04", source: "eurostat", code: "eu_hicp_flash", country: "eu", title: "Flash estimate inflation euro area", starts_at: "2026-11-04T10:00:00Z", url: "https://ec.europa.eu/eurostat/news/euro-indicators" }),
        ev({ id: "eurostat:eu_retail_sales:2026-11-06", source: "eurostat", code: "eu_retail_sales", country: "eu", title: "Retail trade", importance: 2, starts_at: "2026-11-06T10:00:00Z", url: "https://ec.europa.eu/eurostat/news/euro-indicators" }),
        ev({ id: "eurostat:eu_unemployment:2026-10-30", source: "eurostat", code: "eu_unemployment", country: "eu", title: "Unemployment", importance: 2, starts_at: "2026-11-02T10:00:00Z", status: "released", actual: "6.5%", previous: "6.5%", url: "https://ec.europa.eu/eurostat/news/euro-indicators" }),
      ]);
      const page = await calendar(browser, width);
      await el(page, "own-calendar-day-3").click();
      const flash = el(page, "own-calendar-event").filter({ hasText: "Инфляция в еврозоне" });
      await expect(flash.getByTestId("own-calendar-event-title")).toHaveText("Инфляция в еврозоне (экспресс-оценка)");
      await expect(flash.getByTestId("own-calendar-event-time")).toHaveText("14:00"); // 11:00 CET = 10:00 UTC
      await expect(flash.getByTestId("own-calendar-event-trust")).toHaveText("Официальный");
      await expect(flash.getByTestId("own-calendar-event-source")).toHaveText(/Eurostat/);
      await expect(flash.getByTestId("own-calendar-event-source")).toHaveAttribute("href", "https://ec.europa.eu/eurostat/news/euro-indicators");
      await expect(flash.getByTestId("own-calendar-event-status")).toHaveText("Ожидается");
      await el(page, "own-calendar-day-1").click();
      const jobless = el(page, "own-calendar-event").filter({ hasText: "Безработица в еврозоне" });
      await expect(jobless.getByTestId("own-calendar-event-actual")).toHaveText("6.5%");
      await expect(jobless.getByTestId("own-calendar-event-status")).toHaveText("Вышло");
      await expect(el(page, "market-calendar-sources")).toContainText("Данные еврозоны: источник — Eurostat.");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  for (const width of [1440, 360]) {
    test(`${width}: figures — «previous» shown before the release; no figure after three hours says so with the source's link; a decision has no figures, it is «held»`, async ({ browser, request }) => {
      await seed(request, [
        ...EVENTS.filter((e) => (e as { id?: string }).id !== "bls:us_nfp:2026-11-06"),
        ev({ id: "bls:us_nfp:2026-11-06", source: "bls", code: "us_nfp", title: "Employment Situation", starts_at: "2026-11-06T13:30:00Z", previous: "+29K · 4.2%", url: "https://www.bls.gov/schedule/news_release/" }),
        ev({ id: "bea:us_construction:2026-11-02", source: "bea", title: "Construction Spending", importance: 2, starts_at: "2026-11-02T15:00:00Z", url: "https://www.bea.gov/news/schedule" }),
        ev({ id: "ecb:mpm:2026-11-02:decision", source: "ecb", kind: "decision", code: "ecb_decision", country: "eu", title: "ECB monetary policy decisions", starts_at: "2026-11-02T13:15:00Z", url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html" }),
      ]);
      const page = await calendar(browser, width);
      // Friday's NFP: «previous» before it is out
      await el(page, "own-calendar-day-5").click();
      const nfp = el(page, "own-calendar-event").filter({ hasText: "NFP" });
      await expect(nfp.getByTestId("own-calendar-event-actual")).toHaveText("—");
      await expect(nfp.getByTestId("own-calendar-event-previous")).toHaveText("+29K · 4.2%");
      await expect(nfp.getByTestId("own-calendar-event-status")).toHaveText("Ожидается");
      // Monday: a release without a figure for a day — said plainly, with the link; the ECB decision is «held»
      await el(page, "own-calendar-day-1").click();
      const missing = el(page, "own-calendar-event").filter({ hasText: "Construction Spending" });
      await expect(missing.getByTestId("own-calendar-event-status")).toHaveText("Нет данных");
      await expect(missing.getByTestId("own-calendar-event-missing")).toHaveText("Данные недоступны от источника, смотрите по ссылке");
      await expect(missing.getByTestId("own-calendar-event-missing")).toHaveAttribute("href", "https://www.bea.gov/news/schedule");
      const decision = el(page, "own-calendar-event").filter({ hasText: "Решение ЕЦБ" });
      await expect(decision.getByTestId("own-calendar-event-status")).toHaveText("Состоялось");
      await expect(decision.getByTestId("own-calendar-event-actual")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("data not reachable: a plain message and «Try again» that works", async ({ browser, request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/market-events-fail?on=1`);
    const page = await calendar(browser, 1440);
    await expect(el(page, "own-calendar-error")).toBeVisible();
    await request.get(`${FAKE_SUPABASE}/__test/market-events-fail?on=0`);
    await el(page, "own-calendar-error").getByRole("button").click();
    await expect(el(page, "own-calendar-event")).toHaveCount(1);
  });

  test("«World calendar» is TradingView's widget and opens by default; the official events are kept in the address", async ({ browser }) => {
    const page = await calendar(browser, 1440);
    await el(page, "market-calendar-view-world").click();
    await expect(el(page, "market-calendar")).toHaveAttribute("data-view", "world");
    await expect(el(page, "market-calendar-widget")).toHaveAttribute("data-status", "ready");
    await expect(el(page, "market-calendar-world-note")).toBeVisible();
    // the world calendar is the default: the address keeps no view for it
    expect(page.url()).not.toContain("view=");
    await page.reload();
    await expect(el(page, "market-calendar")).toHaveAttribute("data-view", "world");
    await el(page, "market-calendar-view-own").click();
    await expect(el(page, "own-calendar-list")).toBeVisible();
    expect(page.url()).toContain("view=own");
  });
});
