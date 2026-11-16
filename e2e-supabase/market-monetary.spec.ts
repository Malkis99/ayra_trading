import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import type { MonetarySeries, MonetarySnapshot } from "../lib/market/economy/monetary-data";

const data: Record<MonetarySeries, MonetarySnapshot> = {
  policy: { status: "ready", points: [{ date: "2026-09-17", values: [3.75, 4] }], effectiveRate: { date: "2026-11-13", values: [3.88] } },
  yields: { status: "ready", points: [
    { date: "2026-11-12", values: [4.32, 4.86, 4.95, 5.10, 5.43, 24, 78] },
    { date: "2026-11-13", values: [4.32, 4.88, 4.98, 5.15, 5.47, 27, 83] },
  ] },
  dollar: { status: "ready", points: [{ date: "2026-11-06", values: [121.8803] }], releasedOn: "2026-11-09",
    dollarChanges: [0.8128366485356198, 1.9822393363640112, 0.1524305064801501] },
};

for (const [width, lang] of [[390, "ru"], [1440, "en"]] as const) {
  test("Monetary indicators load independently at " + width + "px in " + lang, async ({ browser }) => {
    const { page } = await marketGuest(browser, width);
    await page.addInitScript(language => {
      localStorage.setItem("ayra_guest_dismissed", "1");
      localStorage.setItem("ayra_lang", language);
    }, lang);
    const requests: string[] = [];
    let resume!: () => void;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    let first = true;
    await page.route("**/api/market-economy/monetary?*", async route => {
      const query = new URL(route.request().url()).searchParams;
      const series = query.get("series") as MonetarySeries;
      const history = query.get("range") === "history";
      requests.push(series + ":" + query.get("range"));
      if (series === "policy" && first) {
        first = false;
        await blocked;
        return route.fulfill({ status: 503, json: { status: "error", points: [] } });
      }
      return route.fulfill({ json: series === "dollar" && history ? {
        ...data.dollar, points: [{ date: "2026-11-04", values: [121.3983] }, { date: "2026-11-05", values: [121.5061] }, ...data.dollar.points],
      } : data[series] });
    });
    try {
      await page.goto("/market?tab=economy");
      const policy = page.getByTestId("monetary-policy");
      const yields = page.getByTestId("monetary-yields");
      const dollar = page.getByTestId("monetary-dollar");
      await expect(yields.getByRole("button", { name: /10Y − 2Y.*27/ })).toBeVisible();
      await expect(dollar.getByText(lang === "ru" ? "121,8803" : "121.8803", { exact: true })).toBeVisible();
      await expect(policy.getByRole("status")).toHaveText(lang === "ru" ? "Загружаем данные…" : "Loading data…");
      expect(requests.filter(request => request.endsWith(":history"))).toEqual([]);
      resume();
      await policy.getByRole("button", { name: /Повторить|Retry/ }).click();
      await expect(policy.getByText(lang === "ru" ? "3,88%" : "3.88%", { exact: true })).toBeVisible();
      await dollar.getByRole("button", { name: /Загрузить историю|Load history/ }).click();
      await expect(dollar.locator("svg")).toBeVisible();
      expect(requests.filter(request => request.endsWith(":history"))).toEqual(["dollar:history"]);
      await expect(page.getByTestId("economy-us_gdp")).toBeAttached();
      await expect(page.getByTestId("market-public-finances")).toBeAttached();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_MONETARY_SCREENSHOT_DIR) {
        const section = page.getByRole("region", { name: /Монетарная политика и рынки|Monetary policy & markets/ });
        await section.evaluate(element => element.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: process.env.AYRA_MONETARY_SCREENSHOT_DIR + "/monetary-" + width + ".png" });
        if (width === 390) {
          await dollar.evaluate(element => element.scrollIntoView({ block: "center" }));
          await page.screenshot({ path: process.env.AYRA_MONETARY_SCREENSHOT_DIR + "/monetary-usd-390.png" });
        }
      }
    } finally {
      resume();
      await page.context().close();
    }
  });
}
