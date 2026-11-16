import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";

const september = {
  period: "2026-09", publishedAt: "2026-10-29T12:30:00.000Z", values: [0.5, 3.6, 0.3, 3.1],
  url: "https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026",
};

for (const [width, lang] of [[390, "ru"], [1440, "en"]] as const) {
  test("BEA inflation is independent and history is on demand at " + width + " px", async ({ browser }) => {
    const { page } = await marketGuest(browser, width);
    try {
      await page.addInitScript(language => {
        localStorage.setItem("ayra_guest_dismissed", "1");
        localStorage.setItem("ayra_lang", language);
      }, lang);
      const calls: string[] = [];
      await page.route("**/api/market-economy/bea/pce?*", route => {
        calls.push(new URL(route.request().url()).searchParams.get("range")!);
        return route.fulfill({ json: { status: "ready", points: [september] } });
      });
      await page.route("**/api/market-economy/monetary?*", route => route.fulfill({ status: 503, json: { status: "error", points: [] } }));
      await page.goto("/market?tab=economy");
      const pce = page.getByTestId("economy-bea-pce");
      await expect(pce.getByText(lang === "ru" ? "+3,6%" : "+3.6%")).toBeVisible();
      await expect(pce.getByText(lang === "ru" ? "+3,1%" : "+3.1%")).toBeVisible();
      await expect(pce.getByRole("link").first()).toHaveAttribute("href", september.url);
      expect(calls).toEqual(["latest"]);
      await pce.getByRole("button", { name: /Загрузить историю PCE|Load PCE history/ }).click();
      await expect(pce.getByRole("listitem")).toHaveCount(1);
      expect(calls).toEqual(["latest", "history"]);
      await expect(page.getByTestId("economy-us_gdp")).toBeAttached();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_BEA_SCREENSHOT_DIR) {
        await pce.evaluate(node => node.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: process.env.AYRA_BEA_SCREENSHOT_DIR + "/bea-pce-" + width + ".png" });
      }
    } finally {
      await page.context().close();
    }
  });
}
