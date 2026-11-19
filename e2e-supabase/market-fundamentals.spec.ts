import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import { fundamentalDefinitions, type FundamentalSeries } from "../lib/market/economy/fundamentals-data";

for (const [width, lang] of [[360, "ru"], [390, "ru"], [1440, "en"]] as const) {
  test("US fundamentals: independent cards, real zero, on-demand history and recovery at " + width, async ({ browser }) => {
    const { page } = await marketGuest(browser, width);
    let releaseEarnings = () => {};
    const gate = new Promise<void>(resolve => { releaseEarnings = resolve; });
    try {
      await page.addInitScript(language => {
        localStorage.setItem("ayra_guest_dismissed", "1");
        localStorage.setItem("ayra_lang", language);
      }, lang);
      const calls: string[] = [];
      let retailFailed = true;
      await page.route("**/api/market-economy/fundamentals?*", async route => {
        const params = new URL(route.request().url()).searchParams;
        const series = params.get("series")!;
        const range = params.get("range")!;
        calls.push(series + ":" + range);
        if (series === "earnings") await gate;
        if (series === "retail" && retailFailed) return route.fulfill({ status: 503, json: { status: "error", points: [] } });
        const values: Record<string, [number, number | null]> = {
          earnings: [38, 37.86], unemployment: [4.1, 4.2], continuing: [1717000, null],
          income: [0.2, 0.3], consumption: [0.5, 0.9], production: [-0.4, 0.7], retail: [0, 0.8],
        };
        const bea = series === "income" || series === "consumption";
        const point = { period: series === "continuing" ? "2026-10-24" : bea ? "2026-09" : "2026-10", value: values[series][0],
          previous: values[series][1], sourceUrl: bea ? "https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026" : fundamentalDefinitions[series as FundamentalSeries].url,
          publishedAt: bea ? "2026-10-29T12:30:00Z" : null, vintage: bea ? "BEA 26-46" : "current",
          stage: bea ? "initial" : series === "earnings" ? "preliminary" : "current" };
        return route.fulfill({ json: { status: "ready", points: range === "history" ? [point, { ...point, period: "2026-09", value: 0.7 }] : [point],
          retrievedAt: "2026-11-19T07:00:00Z" } });
      });
      await page.goto("/market?tab=economy");
      const income = page.getByTestId("economy-fundamental-income");
      await expect(income.getByText(lang === "ru" ? "0,2" : "0.2", { exact: true })).toBeVisible();
      const earnings = page.getByTestId("economy-fundamental-earnings");
      await expect(earnings.getByRole("status")).toBeVisible();
      expect(calls.every(call => call.endsWith(":latest"))).toBe(true);
      releaseEarnings();
      await expect(earnings.getByText("38,00", { exact: true }).or(earnings.getByText("38.00", { exact: true }))).toBeVisible();
      await expect(page.getByTestId("economy-fundamental-unemployment")).toHaveCount(1);
      await expect(page.getByTestId("economy-us_nfp")).toBeAttached();
      const claims = page.getByTestId("economy-fundamental-continuing");
      await expect(claims.getByText(lang === "ru" ? "Предыдущее" : "Previous", { exact: true })).toHaveCount(0);
      const production = page.getByTestId("economy-fundamental-production");
      await production.getByRole("button", { name: /Загрузить историю|Load history/ }).click();
      await expect(production.getByRole("listitem")).toHaveCount(2);
      expect(calls.filter(call => call.endsWith(":history"))).toEqual(["production:history"]);
      const retail = page.getByTestId("economy-fundamental-retail");
      retailFailed = false;
      await retail.getByRole("button", { name: /Повторить|Retry/ }).click();
      await expect(retail.getByText("0", { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await earnings.scrollIntoViewIfNeeded();
      if (process.env.AYRA_FUNDAMENTALS_SCREENSHOT_DIR && width !== 360) {
        await page.screenshot({ path: process.env.AYRA_FUNDAMENTALS_SCREENSHOT_DIR + "/fundamentals-" + width + "-" + lang + ".png" });
      }
      await page.reload();
      await expect(earnings.getByText("38,00", { exact: true }).or(earnings.getByText("38.00", { exact: true }))).toBeVisible();
      await page.getByRole("tab", { name: lang === "ru" ? "Календарь" : "Calendar", exact: true }).click();
      await expect(page.getByTestId("market-calendar")).toBeVisible();
    } finally {
      releaseEarnings();
      await page.context().close();
    }
  });
}
