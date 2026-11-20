import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { marketGuest } from "../e2e/helpers/market";

for (const width of [360, 390, 768, 1024, 1440]) for (const lang of ["ru", "en"] as const) {
  test(`economy empty states ${width} ${lang}`, async ({ browser, request }) => {
    const common = { country: "us", kind: "release", status: "released", hidden: false, time_tbd: false };
    await request.post("http://127.0.0.1:54329/__test/market-events", { data: [
      { ...common, id: "bea:us_gdp:2026-10-29", code: "us_gdp", source: "bea", starts_at: "2026-10-29T12:30:00Z", reference_period: "2026-Q3", release_stage: "advance", actual: "+3.4%", previous: "+2.2%",
        result_meta: { period: "2026-Q3", series: "us_gdp", unit: "percent", adjustment: "official-release", source_updated: "2026-10-29T12:30:00Z" } },
      { ...common, id: "bls:us_nfp:2026-11-06", code: "us_nfp", source: "bls", starts_at: "2026-11-06T13:30:00Z", reference_period: "2026-10", release_stage: "regular", actual: "+165K · 4.1%", previous: "+60K",
        result_meta: { period: "2026-10", series: "us_nfp", unit: "thousand-change-and-percent", adjustment: "SA" } },
      { ...common, id: "dol:us_jobless_claims:2026-11-12", code: "us_jobless_claims", source: "dol", starts_at: "2026-11-12T13:30:00Z", reference_period: "2026-11-07", release_stage: "regular", actual: "200K", previous: "191K",
        result_meta: { period: "2026-11-07", series: "initial-claims", unit: "thousand", adjustment: "SA", source_updated: "2026-11-12T13:30:00Z" } },
    ] });
    const { page } = await marketGuest(browser, width);
    try {
      await page.clock.setFixedTime(new Date("2026-11-20T08:00:00Z"));
      await page.addInitScript(language => { localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", language); }, lang);
      await page.route("**/api/market-economy/bea/pce?*", route => route.fulfill({ json: { status: "unavailable", points: [] } }));
      await page.route("**/api/market-economy/treasury?*", route => route.fulfill({ json: { status: "empty", points: [] } }));
      await page.route("**/api/market-economy/monetary?*", route => {
        const series = new URL(route.request().url()).searchParams.get("series");
        return route.fulfill({ json: { status: "ready", points: [{ date: "2026-11-19", values: series === "policy" ? [3.75, 4] : series === "yields" ? [4.34, 4.76, 4.86, 5.04, 5.4, 28, 70] : [122.6503] }],
          effectiveRate: series === "policy" ? { date: "2026-11-18", values: [3.88] } : undefined,
          effectiveRateStale: series === "policy", dollarChanges: [null, null, null] } });
      });
      await page.goto("/market?tab=economy");
      await expect(page.getByTestId("economy-us_nfp").getByText("+165", { exact: true })).toBeVisible();
      for (const code of ["us_gdp", "us_nfp", "us_jobless_claims"]) {
        const card = page.getByTestId("economy-" + code);
        await expect(card.locator("summary").filter({ hasText: /^(История|History)$/ })).toHaveCount(0);
        await expect(card.locator("svg:not(.lucide)")).toHaveCount(0);
      }
      const dollar = page.getByTestId("monetary-dollar");
      await dollar.getByRole("button", { name: /Загрузить историю|Load history/ }).click();
      await expect(dollar.getByRole("listitem")).toHaveText(/2026-11-19.*122[,.]6503/);
      await expect(dollar.locator("svg[data-economy-chart]")).toHaveCount(0);
      const baseline = process.env.AYRA_ECO_EMPTY_BASELINE === "1";
      if (!baseline) {
        for (const code of ["us_cpi", "us_cpi_yoy", "us_core_cpi", "us_core_cpi_yoy"]) {
          const card = page.getByTestId("economy-" + code);
          await expect(card.getByText(/Нет подтверждённых данных|No verified data/)).toBeVisible();
          expect((await card.boundingBox())!.height).toBeLessThanOrEqual(100);
        }
        const debt = page.getByTestId("economy-debt-gdp");
        expect((await debt.boundingBox())!.height).toBeLessThanOrEqual(80);
        const disclosure = debt.locator("summary");
        await disclosure.focus(); await page.keyboard.press("Enter");
        await expect(debt.getByText(/Для расчёта нужны|The calculation requires/)).toBeVisible();
        await page.keyboard.press("Space");
        await expect(debt.getByText(/Для расчёта нужны|The calculation requires/)).toBeHidden();
        for (const empty of await page.locator("[data-economy-empty]").all()) {
          if (await empty.isVisible()) expect((await empty.boundingBox())!.height).toBeLessThanOrEqual(48);
        }
        if (width >= 768) {
          const policy = (await page.getByTestId("monetary-policy").boundingBox())!;
          const usd = (await dollar.boundingBox())!;
          expect(usd.y - (policy.y + policy.height)).toBeLessThanOrEqual(16);
          expect(usd.y).toBeGreaterThanOrEqual(policy.y + policy.height);
        } else {
          const policy = (await page.getByTestId("monetary-policy").boundingBox())!;
          const yields = (await page.getByTestId("monetary-yields").boundingBox())!;
          const usd = (await dollar.boundingBox())!;
          expect(usd.y).toBeGreaterThanOrEqual(policy.y + policy.height);
          expect(yields.y).toBeGreaterThanOrEqual(usd.y + usd.height);
        }
        await expect(page.getByTestId("monetary-policy").getByText(/Данные EFFR могут быть устаревшими|EFFR data may be outdated/)).toBeVisible();
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_ECO_EMPTY_SCREENSHOTS && [390, 1440].includes(width)) {
        const dir = process.env.AYRA_ECO_EMPTY_SCREENSHOTS;
        const prefix = `${dir}/${baseline ? "before" : "after"}-${width}-${lang}`;
        const metrics = await page.getByTestId("market-economy").evaluate(node => {
          const pick = (id: string) => { const r = node.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect(); return r ? { height: r.height, y: r.y } : null; };
          return { cpi: pick("economy-us_cpi"), policy: pick("monetary-policy"), yields: pick("monetary-yields"), dollar: pick("monetary-dollar") };
        });
        for (const [part, locator] of [["growth", page.getByRole("region", { name: lang === "ru" ? "Экономический рост" : "Economic growth", exact: true })],
          ["labor", page.getByRole("region", { name: lang === "ru" ? "Рынок труда" : "Labor market", exact: true })],
          ["inflation", page.getByRole("region", { name: lang === "ru" ? "Инфляция" : "Inflation", exact: true })],
          ["monetary", page.getByRole("region", { name: /Монетарная политика и рынки|Monetary policy & markets/ })]] as const) {
          await locator.evaluate(node => { for (let p = node.parentElement; p; p = p.parentElement) p.style.overflow = "visible"; });
          await page.evaluate(() => document.querySelectorAll("header,nav").forEach(n => { if (n instanceof HTMLElement && !n.closest('[data-testid="market-economy"]')) n.style.visibility = "hidden"; }));
          await locator.screenshot({ path: `${prefix}-${part}.png` });
        }
        writeFileSync(prefix + ".json", JSON.stringify(metrics, null, 2));
      }
    } finally { await page.context().close(); }
  });
}

test("a failed history read does not substitute a chart of latest observations", async ({ browser }) => {
  const { page } = await marketGuest(browser, 390);
  try {
    await page.addInitScript(() => { localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", "en"); });
    await page.route("**/api/market-economy/treasury?*", route => route.fulfill({ json: { status: "empty", points: [] } }));
    await page.route("**/api/market-economy/bea/pce?*", route => route.fulfill({ json: { status: "unavailable", points: [] } }));
    await page.route("**/api/market-economy/monetary?*", route => {
      const q = new URL(route.request().url()).searchParams;
      return q.get("series") === "yields" && q.get("range") === "latest"
        ? route.fulfill({ json: { status: "ready", points: [
          { date: "2026-11-18", values: [4.3, 4.8, 4.9, 5.1, 5.4, 30, 80] },
          { date: "2026-11-19", values: [4.34, 4.76, 4.86, 5.04, 5.4, 28, 70] },
        ] } }) : route.fulfill({ status: 503, json: { status: "error", points: [] } });
    });
    await page.goto("/market?tab=economy");
    const card = page.getByTestId("monetary-yields");
    await card.getByRole("button", { name: "Load history", exact: true }).click();
    await expect(card.getByRole("status")).toHaveText("Could not refresh data");
    await expect(card.locator("svg[data-economy-chart]")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /10Y.*5.04%/ }).first()).toBeVisible();
  } finally { await page.context().close(); }
});
