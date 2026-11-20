import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { marketGuest } from "../e2e/helpers/market";
import { normalizeTreasury } from "../lib/market/economy/treasury";
import type { FiscalSeries } from "../lib/market/economy/fiscal-data";
import { fundamentalDefinitions, type FundamentalSeries } from "../lib/market/economy/fundamentals-data";

for (const width of [360, 390, 768, 1024, 1440]) for (const lang of ["ru", "en"] as const) {
  test(`compact economy ${width} ${lang}`, async ({ browser, request }) => {
    const starts = "2026-10-29T12:30:00Z";
    await request.post("http://127.0.0.1:54329/__test/market-events", { data: [{
      id: "bea:us_gdp:2026-10-29", code: "us_gdp", country: "us", source: "bea", kind: "release", status: "released",
      hidden: false, time_tbd: false, starts_at: starts, reference_period: "2026-Q3", release_stage: "advance", actual: "+3.4%", previous: "+2.2%",
      result_meta: { period: "2026-Q3", series: "us_gdp", unit: "percent", adjustment: "official-release", source_updated: starts },
    }] });
    const { page } = await marketGuest(browser, width);
    const calls: string[] = [];
    try {
      await page.addInitScript(language => { localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", language); }, lang);
      await page.clock.setFixedTime(new Date("2026-11-19T14:00:00Z"));
      await page.route("**/api/market-economy/fundamentals?*", route => {
        const query = new URL(route.request().url()).searchParams;
        const series = query.get("series") as FundamentalSeries;
        calls.push(series + ":" + query.get("range"));
        const values = { earnings: [38, 37.86], unemployment: [4.1, 4.2], continuing: [1717000, 1695000], income: [0.2, 0.3], consumption: [0.5, 0.9], retail: [0.2, 0.8], production: [-0.4, 0.7] }[series];
        const point = { period: series === "continuing" ? "2026-10-24" : "2026-10", value: values[0], previous: values[1],
          sourceUrl: fundamentalDefinitions[series].url, publishedAt: null, vintage: "current", stage: "current" };
        return route.fulfill({ json: { status: series === "retail" ? "stale" : "ready", staleReason: series === "retail" ? "source_check_expired" : undefined,
          points: query.get("range") === "history" && series !== "retail" ? [point, { ...point, period: "2026-09", value: values[1] }] : [point], retrievedAt: "2026-11-01T07:00:00Z" } });
      });
      await page.route("**/api/market-economy/bea/pce?*", route => route.fulfill({ json: { status: "ready", points: [{
        period: "2026-09", publishedAt: "2026-10-29T12:30:00Z", values: [0.5, 3.6, 0.3, 3.1], vintageId: "BEA 26-46",
        url: "https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026",
      }] } }));
      await page.route("**/api/market-economy/treasury?*", route => {
        const series = new URL(route.request().url()).searchParams.get("series") as FiscalSeries;
        return route.fulfill({ json: { status: "ready", checkedAt: "2026-11-19T07:00:00Z",
          points: normalizeTreasury(series, JSON.parse(readFileSync(`lib/market/economy/fixtures/treasury-${series}.json`, "utf8")).data) } });
      });
      await page.route("**/api/market-economy/monetary?*", route => {
        const series = new URL(route.request().url()).searchParams.get("series");
        return route.fulfill({ json: { status: "ready", points: [{ date: "2026-11-18", values: series === "policy" ? [3.75, 4] : series === "yields" ? [4.3, 4.8, 4.9, 5.1, 5.4, 30, 80] : [121.8803] }],
          effectiveRate: series === "policy" ? { date: "2026-11-18", values: [3.88] } : undefined, dollarChanges: [0.8, 1.9, 0.1] } });
      });
      await page.goto("/market?tab=economy");
      await expect(page.getByTestId("economy-fundamental-earnings").getByText(/38[,.]00/, { exact: true })).toBeVisible();
      const fiscal = page.getByTestId("market-public-finances");
      const fiscalSummary = fiscal.locator(":scope > summary");
      if (await fiscalSummary.count()) await fiscalSummary.click();
      await expect(page.getByTestId("fiscal-debt").locator("dd").first()).toBeVisible();
      const baseline = process.env.AYRA_ECO_COMPACT_BASELINE === "1";
      if (!baseline) {
        const economy = page.getByTestId("market-economy");
        await expect(economy.locator(":scope > div[role=group]")).toHaveCount(0);
        await expect(economy.getByRole("button", { name: /^(1 год|3 года|5 лет|10 лет|Максимум|1 year|3 years|5 years|10 years|Maximum)$/ })).toHaveCount(0);
        const gdp = page.getByTestId("economy-us_gdp");
        await expect(gdp.getByText(/Недостаточно данных|Not enough data/)).toBeHidden();
        const details = gdp.locator("summary").filter({ hasText: lang === "ru" ? "Подробнее" : "Details" });
        await details.focus(); await page.keyboard.press("Enter");
        await expect(gdp.getByText(/По расписанию релиза|Scheduled release/)).toBeVisible();
        await page.keyboard.press("Space");
        await expect(gdp.getByText(/По расписанию релиза|Scheduled release/)).toBeHidden();
        const retail = page.getByTestId("economy-fundamental-retail");
        await expect(retail.getByRole("status")).toContainText(lang === "ru" ? "повторная проверка" : "checked again");
        expect(calls.every(call => call.endsWith(":latest"))).toBe(true);
        const earnings = page.getByTestId("economy-fundamental-earnings");
        await earnings.getByRole("button", { name: /Загрузить историю|Load history/ }).click();
        await expect(earnings.locator("svg[data-economy-chart]")).toBeVisible();
        await expect(earnings.getByRole("listitem")).toHaveCount(2);
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const overlaps = await page.getByTestId("market-economy").evaluate(node => {
        const cards = [...node.querySelectorAll("article,[data-testid^=fiscal-],[data-testid=economy-bea-pce]")].map(card => card.getBoundingClientRect());
        return cards.some((a, i) => cards.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
      });
      expect(overlaps).toBe(false);
      if (process.env.AYRA_ECO_COMPACT_SCREENSHOTS && [390, 1440].includes(width)) {
        if (!baseline) await page.getByTestId("economy-fundamental-earnings").getByRole("button", { name: /Скрыть историю|Hide history/ }).click();
        await page.evaluate(() => {
          document.querySelectorAll("[data-testid=market-economy] details").forEach(node => {
            if (node instanceof HTMLDetailsElement) node.open = node.dataset.testid === "market-public-finances";
          });
        });
        const panel = page.getByTestId("market-economy");
        const metrics = await panel.evaluate(node => ({ height: node.getBoundingClientRect().height,
          cards: [...node.querySelectorAll("article")].map(card => ({ id: card.dataset.testid, height: card.getBoundingClientRect().height })) }));
        // The app scrolls inside <main>. Unclip ancestors only for a complete, same-width screenshot of the panel.
        await panel.evaluate(node => {
          for (let parent = node.parentElement; parent; parent = parent.parentElement) parent.style.overflow = "visible";
          document.querySelectorAll("header,nav").forEach(header => {
            if (header instanceof HTMLElement && !node.contains(header) && !header.contains(node)) header.style.visibility = "hidden";
          });
        });
        const prefix = `${process.env.AYRA_ECO_COMPACT_SCREENSHOTS}/${baseline ? "before" : "after"}-${width}-${lang}`;
        await panel.screenshot({ path: prefix + ".png" });
        writeFileSync(prefix + ".json", JSON.stringify(metrics, null, 2));
      }
    } finally { await page.context().close(); }
  });
}
