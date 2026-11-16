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
    const requests: string[] = [];
    let finishDebt!: () => void;
    const debtBlocked = new Promise<void>(resolve => { finishDebt = resolve; });
    let debtFirst = true;
    await page.route("**/api/market-economy/treasury?*", async route => {
      const query = new URL(route.request().url()).searchParams;
      const series = query.get("series") as FiscalSeries;
      const range = query.get("range");
      requests.push(`${series}:${range}`);
      if (series === "debt" && range === "latest" && debtFirst) {
        debtFirst = false;
        await debtBlocked;
        return route.fulfill({ status: 503, json: { status: "error", points: [] } });
      }
      return route.fulfill({ json: data(series) });
    });
    try {
      await page.goto("/market?tab=economy");
      const finances = page.getByTestId("market-public-finances");
      await expect(finances).toBeVisible();
      expect(requests).toHaveLength(0);
      const openedAt = Date.now();
      await finances.locator("summary").first().click();
      await expect(finances.getByTestId("fiscal-budget").getByText(lang === "ru" ? "−404,06 млрд USD" : "−404.06 B USD", { exact: true }).first()).toBeVisible();
      await expect(finances.getByTestId("fiscal-interest").getByText(/FY 2027/)).toBeVisible();
      await expect(finances.getByTestId("fiscal-debt").getByText(lang === "ru" ? "Загружаем данные…" : "Loading data…")).toBeVisible();
      console.info(`Budget and interest visible in ${Date.now() - openedAt} ms at ${width}px with debt response still blocked`);
      finishDebt();
      await finances.getByRole("button", { name: lang === "ru" ? "Повторить" : "Retry" }).click();
      await expect(finances.getByTestId("fiscal-debt").locator("dd").filter({ hasText: lang === "ru" ? "40,61 трлн USD" : "40.61 T USD" })).toBeVisible();
      await expect(finances.getByText(/FY 2027/)).toHaveCount(2);
      await expect(finances.getByTestId("fiscal-budget").getByText(lang === "ru" ? "−404,06 млрд USD" : "−404.06 B USD", { exact: true }).first()).toBeVisible();
      await finances.getByRole("button", { name: lang === "ru" ? "Максимум" : "Maximum" }).click();
      expect(requests.every(request => request.endsWith(":latest"))).toBeTruthy();
      await finances.getByTestId("fiscal-debt").getByRole("button", { name: /Загрузить историю|Load history/ }).click();
      await expect.poll(() => requests.filter(request => request.endsWith(":max"))).toEqual(["debt:max"]);
      await expect(finances.getByTestId("fiscal-debt").getByRole("button", { name: /Загрузить историю|Load history/ })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_ECO_SCREENSHOT_DIR) {
        await finances.screenshot({ path: `${process.env.AYRA_ECO_SCREENSHOT_DIR}/public-finances-${width}.png` });
      }
    } finally { finishDebt(); await page.context().close(); }
  });
}
