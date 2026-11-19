import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";

const mock = "http://127.0.0.1:54329";
const starts = "2026-10-29T12:30:00Z";
const verified = {
  id: "bea:us_gdp:2026-10-29", code: "us_gdp", country: "us", source: "bea", kind: "release",
  status: "released", hidden: false, time_tbd: false, starts_at: starts, reference_period: "2026-Q3",
  release_stage: "advance", actual: "+3.4%", previous: "+2.2%",
  result_meta: { period: "2026-Q3", series: "us_gdp", unit: "percent", adjustment: "official-release", source_updated: starts },
};
const payrolls = {
  ...verified, id: "bls:us_nfp:2026-11-06", code: "us_nfp", source: "bls",
  starts_at: "2026-11-06T13:30:00Z", reference_period: "2026-10", release_stage: "regular",
  actual: "+165K · 4.1%", previous: "+60K",
  result_meta: { period: "2026-10", series: "us_nfp", unit: "thousand-change-and-percent", adjustment: "SA" },
};
const claims = {
  ...verified, id: "dol:us_jobless_claims:2026-11-12", code: "us_jobless_claims", source: "dol",
  starts_at: "2026-11-12T13:30:00Z", reference_period: "2026-11-07", release_stage: "regular",
  actual: "200K", previous: "191K",
  result_meta: { period: "2026-11-07", series: "initial-claims", unit: "thousand", adjustment: "SA", source_updated: "2026-11-12T13:30:00Z" },
};

for (const width of [390, 1440]) {
  test(`economy reads released facts and keeps partial data at ${width}px`, async ({ browser, request }) => {
    const seed = await request.post(mock + "/__test/market-events", { data: [verified] });
    expect(seed.ok()).toBeTruthy();
    await request.get(mock + "/__test/market-events-fail?on=0");
    const { page } = await marketGuest(browser, width);
    const locale = width === 390 ? "ru" : "en";
    await page.addInitScript(lang => {
      localStorage.setItem("ayra_guest_dismissed", "1");
      localStorage.setItem("ayra_lang", lang);
    }, locale);
    await page.clock.setFixedTime(new Date("2026-11-16T10:00:00Z"));
    try {
      await page.goto("/market?tab=economy");
      const gdp = page.getByTestId("economy-us_gdp");
      const fact = gdp.getByText(locale === "ru" ? "+3,4%" : "+3.4%", { exact: true });
      await expect(fact).toBeVisible();
      await expect(gdp.getByText(locale === "ru" ? "+2,2%" : "+2.2%", { exact: true })).toBeVisible();
      await expect(gdp.getByText(/Forecast|Прогноз/)).toHaveCount(0);
      await expect(gdp.getByText(/Not enough data to chart|Недостаточно данных для графика/)).toBeHidden();
      await gdp.locator("summary").filter({ hasText: /История|History/ }).click();
      await expect(gdp.getByText(/Not enough data to chart|Недостаточно данных для графика/)).toBeVisible();
      await expect(page.getByTestId("economy-us_nfp").getByText(/No verified data|Нет подтверждённых данных/)).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.locator("#market-tab-calendar").click();
      await expect(page.getByTestId("market-panel-calendar")).toBeVisible();
      await page.locator("#market-tab-economy").click();
      await expect(fact).toBeVisible();
      await page.reload();
      await expect(fact).toBeVisible();
      await request.post(mock + "/__test/market-events", { data: [verified, payrolls, claims] });
      await page.reload();
      await expect(page.getByTestId("economy-us_nfp").getByText("+165", { exact: true })).toBeVisible();
      await expect(page.getByTestId("economy-us_jobless_claims").getByText("200", { exact: true })).toBeVisible();
      if (process.env.AYRA_ECO_SCREENSHOT_DIR) {
        await page.screenshot({ path: `${process.env.AYRA_ECO_SCREENSHOT_DIR}/economy-${width}.png`, fullPage: true });
      }
      if (width === 390) {
        await request.get(mock + "/__test/market-events-fail?on=1");
        await page.reload();
        await expect(page.getByText("Не удалось обновить данные")).toBeVisible();
        await request.get(mock + "/__test/market-events-fail?on=0");
        await page.getByRole("button", { name: "Повторить" }).click();
        await expect(fact).toBeVisible();
      }
    } finally {
      await request.get(mock + "/__test/market-events-fail?on=0");
      await page.context().close();
    }
  });
}
