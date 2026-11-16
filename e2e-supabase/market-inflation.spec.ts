import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";

for (const [width, lang] of [[390, "ru"], [1440, "en"]] as const) {
  test("Official CPI in the US economy profile at " + width + " px", async ({ browser }) => {
    const { page } = await marketGuest(browser, width);
    try {
      await page.clock.setFixedTime(new Date("2026-11-16T16:00:00Z"));
      await page.addInitScript(language => {
        localStorage.setItem("ayra_guest_dismissed", "1");
        localStorage.setItem("ayra_lang", language);
      }, lang);
      await page.route("**/rest/v1/market_events?*", route => route.fulfill({ json: [{
        id: "bls:us_cpi:2026-11-10", code: "us_cpi", source: "bls", country: "us", status: "released", kind: "release",
        hidden: false, time_tbd: false, starts_at: "2026-11-10T13:30:00Z", reference_period: "2026-10",
        release_stage: "regular", actual: "+0.4%", previous: null,
        result_meta: { period: "2026-10", series: "CUSR0000SA0", unit: "percent-mom", adjustment: "SA", vintage: "release",
          source_updated: "2026-11-10T13:30:00Z", release_url: "https://www.bls.gov/news.release/archives/cpi_11102026.htm" },
      }] }));
      await page.route("**/api/market-economy/monetary?*", route => route.fulfill({ json: { status: "unavailable", points: [] } }));
      await page.goto("/market?tab=economy");
      const cpi = page.getByTestId("economy-us_cpi");
      await expect(cpi.getByText(lang === "ru" ? "0,4%" : "0.4%", { exact: true })).toBeVisible();
      await expect(cpi.getByRole("link").first()).toHaveAttribute("href", "https://www.bls.gov/news.release/archives/cpi_11102026.htm");
      await expect(page.getByTestId("economy-us_cpi_yoy")).toContainText(lang === "ru" ? "Нет подтверждённых данных" : "No verified data");
      await expect(page.getByTestId("economy-us_gdp")).toBeAttached();
      await expect(page.getByTestId("economy-us_nfp")).toBeAttached();
      await expect(page.getByTestId("market-public-finances")).toBeAttached();
      await expect(page.getByTestId("monetary-policy")).toBeAttached();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_INFLATION_SCREENSHOT_DIR) {
        await cpi.evaluate(element => element.closest("section")?.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: process.env.AYRA_INFLATION_SCREENSHOT_DIR + "/inflation-" + width + ".png" });
      }
    } finally {
      await page.context().close();
    }
  });
}
