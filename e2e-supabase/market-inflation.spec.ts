import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";

const cpi = {
  id: "bls:us_cpi:2026-11-10", code: "us_cpi", source: "bls", country: "us", status: "released", kind: "release",
  hidden: false, time_tbd: false, starts_at: "2026-11-10T13:30:00Z", reference_period: "2026-10",
  release_stage: "regular", actual: "+0.4%", previous: null,
  result_meta: { period: "2026-10", series: "CUSR0000SA0", unit: "percent-mom", adjustment: "SA", vintage: "release",
    source_updated: "2026-11-10T13:30:00Z", release_url: "https://www.bls.gov/news.release/archives/cpi_11102026.htm" },
};

for (const [width, lang] of [[390, "ru"], [1440, "en"]] as const) {
  test("Official CPI in the US economy profile at " + width + " px", async ({ browser }) => {
    const { page } = await marketGuest(browser, width);
    try {
      await page.clock.setFixedTime(new Date("2026-11-16T16:00:00Z"));
      await page.addInitScript(language => {
        localStorage.setItem("ayra_guest_dismissed", "1");
        localStorage.setItem("ayra_lang", language);
      }, lang);
      await page.route("**/rest/v1/market_events?*", route => route.fulfill({ json: [
        cpi,
        { ...cpi, id: "bls:us_core_cpi:2026-11-10", code: "us_core_cpi", actual: "+0.3%",
          result_meta: { ...cpi.result_meta, series: "CUSR0000SA0L1E" } },
        { ...cpi, id: "bls:us_nfp:2026-11-06", code: "us_nfp", starts_at: "2026-11-06T13:30:00Z", actual: "+165K · 4.1%", previous: "+60K",
          result_meta: { period: "2026-10", series: "us_nfp", unit: "thousand-change-and-percent", adjustment: "SA" } },
      ] }));
      await page.route("**/api/market-economy/monetary?*", route => route.fulfill({ json: { status: "unavailable", points: [] } }));
      await page.route("**/api/market-economy/fundamentals?series=unemployment&range=latest", route => route.fulfill({ json: {
        status: "ready", points: [{ period: "2026-10", value: 4.1, previous: 4.2,
          sourceUrl: "https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000",
          publishedAt: null, vintage: "current", stage: "current" }],
      } }));
      await page.goto("/market?tab=economy");
      const headline = page.getByTestId("economy-us_cpi");
      await expect(headline.getByText(lang === "ru" ? "0,4%" : "0.4%", { exact: true })).toBeVisible();
      await expect(headline.getByRole("link").first()).toHaveAttribute("href", cpi.result_meta.release_url);
      await expect(page.getByTestId("economy-us_core_cpi")).toContainText(lang === "ru" ? "0,3%" : "0.3%");
      await expect(page.getByTestId("economy-us_cpi_yoy")).toContainText(lang === "ru" ? "Нет подтверждённых данных" : "No verified data");
      await expect(page.getByTestId("economy-us_gdp")).toBeAttached();
      await expect(page.getByTestId("economy-us_nfp")).toContainText("+165");
      const unemployment = page.getByTestId("economy-fundamental-unemployment");
      await expect(unemployment.getByText(lang === "ru" ? "4,1" : "4.1", { exact: true })).toBeVisible();
      await expect(unemployment).toContainText(lang === "ru" ? "% рабочей силы" : "% of labor force");
      await expect(page.getByTestId("market-public-finances")).toBeAttached();
      await expect(page.getByTestId("monetary-policy")).toBeAttached();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_INFLATION_SCREENSHOT_DIR) {
        await headline.evaluate(element => element.closest("section")?.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: process.env.AYRA_INFLATION_SCREENSHOT_DIR + "/inflation-" + width + ".png" });
      }
    } finally {
      await page.context().close();
    }
  });
}
