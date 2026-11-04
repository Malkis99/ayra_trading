import { test, expect, type Browser, type Page, type APIRequestContext } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Market: «Today important» (Overview and Calendar) and the official news feed with the news window (PR 4–5,
// docs/market-feeds-plan.md). The fake Supabase holds the 0009 rows. The browser's clock: Tuesday 3 November 2026,
// 12:00 UTC = 16:00 in Tbilisi (the profile's zone).

const NOW = "2026-11-03T12:00:00Z";
const ev = (o: Record<string, unknown>) => ({ kind: "release", code: null, country: "us", importance: 3, time_tbd: false, status: "scheduled", actual: null, previous: null, hidden: false, updated_at: "2026-11-03T11:50:00Z", url: "https://www.bls.gov/schedule/news_release/", ...o });
const nw = (o: Record<string, unknown>) => ({ trust: "official", country: "us", summary: null, importance: 3, hidden: false, ...o });

const TODAY_EVENTS = [
  ev({ id: "bls:us_jolts:2026-11-03", source: "bls", code: "us_jolts", title: "JOLTS", importance: 2, starts_at: "2026-11-03T15:00:00Z" }),
  ev({ id: "bls:us_cpi:2026-11-03", source: "bls", code: "us_cpi", title: "Consumer Price Index", starts_at: "2026-11-03T17:00:00Z", previous: "+0.6%" }),
  ev({ id: "bls:us_nfp:2026-11-06", source: "bls", code: "us_nfp", title: "Employment Situation", starts_at: "2026-11-06T13:30:00Z" }),
];
const NEWS = [
  nw({ id: "whitehouse:1", source: "whitehouse", kind: "presidential_action", title: "Adjusting imports of steel into the United States", summary: "BY THE PRESIDENT A PROCLAMATION 1. Imports of steel …", url: "https://www.whitehouse.gov/presidential-actions/2026/11/steel/", published_at: "2026-11-03T10:00:00Z", dedupe_key: "wh-steel" }),
  nw({ id: "fed:speech:1", source: "fed", kind: "speech", importance: 2, title: "Jefferson, The U.S. Economy and Monetary Policy", summary: "Speech At the Darden School of Business", url: "https://www.federalreserve.gov/newsevents/speech/jefferson20261103a.htm", published_at: "2026-11-03T09:00:00Z", dedupe_key: "fed-jefferson" }),
  nw({ id: "fed:speech:2", source: "fed", kind: "speech", importance: 1, title: "Bowman, Opening Remarks", url: "https://www.federalreserve.gov/b.htm", published_at: "2026-11-03T08:00:00Z", dedupe_key: "fed-bowman" }),
  nw({ id: "fed:dup", source: "fed", kind: "presidential_action", title: "Adjusting imports of steel (repeat)", url: "https://www.whitehouse.gov/dup/", published_at: "2026-11-03T10:00:00Z", dedupe_key: "wh-steel" }),
  nw({ id: "whitehouse:hidden", source: "whitehouse", kind: "statement", title: "Columbus Day, 2026", url: "https://www.whitehouse.gov/h/", published_at: "2026-11-03T07:00:00Z", dedupe_key: "hidden", hidden: true }),
  nw({ id: "ecb:old", source: "ecb", country: "eu", kind: "decision", title: "Monetary policy decisions", url: "https://www.ecb.europa.eu/press/pr/x.html", published_at: "2026-10-29T13:15:00Z", dedupe_key: "ecb-dec" }),
];

const el = (page: Page, id: string) => page.getByTestId(id);
const seed = async (request: APIRequestContext, events: unknown[], news: unknown[]) => {
  await request.post(`${FAKE_SUPABASE}/__test/market-events`, { data: events });
  await request.post(`${FAKE_SUPABASE}/__test/market-news`, { data: news });
};

async function open(browser: Browser, width: number, url: string) {
  const { page } = await marketGuest(browser, width);
  await page.addInitScript(() => localStorage.setItem("ayra_guest_dismissed", "1"));
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.pauseAt(new Date(NOW));
  await page.goto(url);
  return page;
}

test.describe("Market — «Today important» and official news", () => {
  test.use({ reducedMotion: "reduce" });
  test.beforeEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/market-events-fail?on=0`);
    await seed(request, TODAY_EVENTS, NEWS);
  });

  for (const width of [1440, 360]) {
    test(`${width}: Overview — the nearest event with a countdown; today's important items by time; trust mark, source, status`, async ({ browser }) => {
      const page = await open(browser, width, "/market");
      const block = el(page, "today-important");
      await expect(block.getByTestId("today-next-title")).toHaveText("Индекс потребительских цен (CPI)");
      await expect(block.getByTestId("today-next-time")).toHaveText("21:00"); // 17:00 UTC in Tbilisi
      await expect(block.getByTestId("today-next-countdown")).toContainText("через 5 ч");
      await expect(block.getByTestId("today-zone")).toContainText("Грузия");
      // the policy speech, the White House on steel (once), CPI; not the medium JOLTS, the low speech, the hidden row
      const titles = block.getByTestId("today-item-title");
      await expect(titles).toHaveCount(3);
      await expect(titles.nth(0)).toHaveText("Jefferson, The U.S. Economy and Monetary Policy");
      await expect(titles.nth(1)).toHaveText("Adjusting imports of steel into the United States");
      await expect(titles.nth(2)).toContainText("Индекс потребительских цен (CPI)");
      await expect(block.getByTestId("today-item-time").nth(1)).toHaveText("14:00");
      await expect(block.getByTestId("today-trust").first()).toHaveText("Официальный");
      await expect(block.getByTestId("today-item-status").nth(2)).toHaveText("Ожидается");
      // «previous» before the release (from the last one of the same indicator)
      await expect(block.getByTestId("today-item").nth(2).getByTestId("today-item-figures")).toHaveText("Пред. +0.6%");
      await expect(block.getByTestId("today-item-source").nth(2)).toHaveAttribute("href", "https://www.bls.gov/schedule/news_release/");
      await expect(block.getByTestId("today-disclaimer")).toHaveText("Не является финансовой рекомендацией.");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // the trust mark sits under the title, never over it (phones too)
      for (let i = 0; i < 3; i++) {
        const row = block.getByTestId("today-item").nth(i);
        const title = (await row.getByTestId("today-item-title").boundingBox())!;
        const trust = (await row.getByTestId("today-trust").boundingBox())!;
        expect(trust.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
      }
    });

    test(`${width}: a news item opens on our site — title, source, time, the source's description, «Open the original»; Esc and the cross close it`, async ({ browser }) => {
      const page = await open(browser, width, "/market");
      await el(page, "today-important").getByTestId("today-item-open").nth(1).click();
      const modal = el(page, "news-modal");
      await expect(modal).toBeVisible();
      await expect(modal.getByTestId("news-modal-title")).toHaveText("Adjusting imports of steel into the United States");
      await expect(modal.getByTestId("news-modal-source")).toHaveText("Белый дом");
      await expect(modal.getByTestId("news-modal-trust")).toHaveText("Официальный");
      await expect(modal.getByTestId("news-modal-time")).toHaveText("3 нояб., 14:00");
      await expect(modal.getByTestId("news-modal-summary")).toHaveText("BY THE PRESIDENT A PROCLAMATION 1. Imports of steel …");
      await expect(page.getByTestId("news-modal-original")).toHaveAttribute("href", "https://www.whitehouse.gov/presidential-actions/2026/11/steel/");
      await expect(page.getByTestId("news-modal-original")).toHaveAttribute("target", "_blank");
      await expect(modal.getByTestId("news-modal-disclaimer")).toHaveText("Не является финансовой рекомендацией.");
      if (width === 360) {
        // the whole screen on a phone
        const box = (await modal.boundingBox())!;
        expect(Math.round(box.width)).toBe(360);
        expect(box.height).toBeGreaterThan(700);
      }
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await el(page, "today-important").getByTestId("today-item-open").nth(0).click();
      await expect(el(page, "news-modal")).toBeVisible();
      await page.getByRole("button", { name: "Закрыть" }).click();
      await expect(el(page, "news-modal")).toHaveCount(0);
    });
  }

  test("nothing important today: says so and names the nearest important event (NFP on Friday)", async ({ browser, request }) => {
    await seed(request, [TODAY_EVENTS[0], TODAY_EVENTS[2]], [NEWS[2]]);
    const page = await open(browser, 1440, "/market");
    const block = el(page, "today-important");
    await expect(block.getByTestId("today-empty")).toHaveText("Сегодня важных официальных событий нет.");
    await expect(block.getByTestId("today-next")).toContainText("Ближайшее важное");
    await expect(block.getByTestId("today-next-title")).toHaveText("Занятость вне с/х (NFP) и безработица");
    await expect(block.getByTestId("today-next-time")).toHaveText("6 нояб., 17:30");
    await expect(block.getByTestId("today-next-countdown")).toContainText("через 3 д");
  });

  test("«Today important» is on the Overview only (owner 2026-11-04): the Calendar opens on the world calendar without it", async ({ browser }) => {
    const page = await open(browser, 1440, "/market?tab=calendar");
    await expect(el(page, "market-calendar")).toHaveAttribute("data-view", "world");
    await expect(el(page, "today-important")).toHaveCount(0);
    await page.goto("/market");
    await expect(el(page, "today-important").getByTestId("today-next-title")).toHaveText("Индекс потребительских цен (CPI)");
  });

  for (const width of [1440, 360]) {
    test(`${width}: News — the official feed: high importance by default, repeats once, hidden never; medium on demand; a click opens the window`, async ({ browser }) => {
      const page = await open(browser, width, "/market?tab=news");
      await expect(el(page, "market-news-tab")).toHaveAttribute("data-view", "official");
      const items = el(page, "official-news-item");
      await expect(items).toHaveCount(2); // steel (once) and the ECB decision
      await expect(items.nth(0).getByTestId("official-news-title")).toHaveText("Adjusting imports of steel into the United States");
      await expect(items.nth(1).getByTestId("official-news-title")).toHaveText("Monetary policy decisions");
      await expect(items.nth(0).getByTestId("official-news-time")).toHaveText("3 нояб., 14:00");
      await el(page, "official-news-level-medium").click();
      await expect(items).toHaveCount(3);
      await items.nth(1).click();
      await expect(el(page, "news-modal").getByTestId("news-modal-title")).toHaveText("Jefferson, The U.S. Economy and Monetary Policy");
      await page.keyboard.press("Escape");
      await expect(el(page, "official-news-disclaimer")).toHaveText("Не является финансовой рекомендацией.");
      await expect(el(page, "official-news-sources")).toContainText("Белый дом");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("News: the data not reachable — a plain message and «Try again»", async ({ browser, request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/market-events-fail?on=1`);
    const page = await open(browser, 1440, "/market?tab=news");
    await expect(el(page, "official-news-error")).toBeVisible();
    await request.get(`${FAKE_SUPABASE}/__test/market-events-fail?on=0`);
    await el(page, "official-news-error").getByRole("button").click();
    await expect(el(page, "official-news-item")).toHaveCount(2);
  });
});
