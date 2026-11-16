import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import { normalizeTreasury } from "../lib/market/economy/treasury";
import type { FiscalSeries } from "../lib/market/economy/fiscal-data";

const data = (series: FiscalSeries) => ({
  status: "ready",
  checkedAt: "2026-11-16T10:00:00Z",
  points: normalizeTreasury(series, JSON.parse(readFileSync(`lib/market/economy/fixtures/treasury-${series}.json`, "utf8")).data),
});

for (const [width, lang] of [[390, "ru"], [1440, "en"]] as const) {
  test(`U.S. public finances at ${width}px in ${lang}`, async ({ browser }) => {
    const { page } = await marketGuest(browser, width);
    await page.addInitScript(language => {
      localStorage.setItem("ayra_guest_dismissed", "1");
      localStorage.setItem("ayra_lang", language);
    }, lang);
    let requests = 0;
    await page.route("**/api/market-economy/treasury", route => {
      requests++;
      return requests === 1
        ? route.fulfill({ status: 503 })
        : route.fulfill({ json: { debt: data("debt"), budget: data("budget"), interest: data("interest") } });
    });
    try {
      await page.goto("/market?tab=economy");
      const finances = page.getByTestId("market-public-finances");
      await expect(finances).toBeVisible();
      expect(requests).toBe(0);
      await finances.locator("summary").first().click();
      await finances.getByRole("button", { name: lang === "ru" ? "Повторить" : "Retry" }).click();
      await expect(finances.getByTestId("fiscal-debt").locator("dd").filter({ hasText: lang === "ru" ? "40,61 трлн USD" : "40.61 T USD" })).toBeVisible();
      await expect(finances.getByText(/FY 2027/)).toHaveCount(2);
      await expect(finances.getByTestId("fiscal-budget").getByText(lang === "ru" ? "−404,06 млрд USD" : "−404.06 B USD", { exact: true }).first()).toBeVisible();
      await finances.getByRole("button", { name: lang === "ru" ? "Максимум" : "Maximum" }).click();
      expect(requests).toBe(2);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_ECO_SCREENSHOT_DIR) {
        await finances.screenshot({ path: `${process.env.AYRA_ECO_SCREENSHOT_DIR}/public-finances-${width}.png` });
      }
    } finally { await page.context().close(); }
  });
}
