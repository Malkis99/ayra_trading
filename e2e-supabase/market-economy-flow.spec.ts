import { expect, test, type Locator } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { marketGuest } from "../e2e/helpers/market";
import { normalizeTreasury } from "../lib/market/economy/treasury";
import type { FiscalSeries } from "../lib/market/economy/fiscal-data";

// Focus scrolls <main>; responsive shell changes can also shift preceding sections.
// Compare coordinates inside this column pair, not viewport or whole-panel coordinates.
const rect = (locator: Locator) => locator.evaluate(node => {
  const r = node.getBoundingClientRect();
  return { y: r.y - node.closest('[data-economy-columns]')!.getBoundingClientRect().y, height: r.height };
});

for (const width of [360, 390, 768, 1024, 1440]) for (const lang of ["ru", "en"] as const) {
  test(`independent economy columns ${width} ${lang}`, async ({ browser, request }) => {
    await request.post("http://127.0.0.1:54329/__test/market-events", { data: [{
      id: "bea:us_gdp:2026-10-29", code: "us_gdp", country: "us", source: "bea", kind: "release", status: "released",
      hidden: false, time_tbd: false, starts_at: "2026-10-29T12:30:00Z", reference_period: "2026-Q3", release_stage: "advance", actual: "+3.4%", previous: "+2.2%",
      result_meta: { period: "2026-Q3", series: "us_gdp", unit: "percent", adjustment: "official-release", source_updated: "2026-10-29T12:30:00Z" },
    }] });
    const { page } = await marketGuest(browser, width);
    try {
      await page.addInitScript(language => { localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", language); }, lang);
      await page.route("**/api/market-economy/treasury?*", route => {
        const series = new URL(route.request().url()).searchParams.get("series") as FiscalSeries;
        return route.fulfill({ json: { status: "ready", points: normalizeTreasury(series, JSON.parse(readFileSync(`lib/market/economy/fixtures/treasury-${series}.json`, "utf8")).data) } });
      });
      await page.route("**/api/market-economy/monetary?*", route => {
        const series = new URL(route.request().url()).searchParams.get("series");
        return route.fulfill({ json: { status: "ready", points: ["2026-11-18", "2026-11-19"].map(date => ({ date,
          values: series === "policy" ? [3.75, 4] : series === "yields" ? [4.3, 4.8, 4.9, 5.1, 5.4, 30, 80] : [121.8803] })) } });
      });
      await page.route("**/api/market-economy/bea/pce?*", route => route.fulfill({ json: { status: "unavailable", points: [] } }));
      await page.goto("/market?tab=economy");
      const gdp = page.getByTestId("economy-us_gdp");
      await expect(gdp.getByText(/3[,.]4%/, { exact: true })).toBeVisible();
      await expect(page.getByTestId("fiscal-debt").locator("dd").first()).toBeVisible();
      await expect(page.getByTestId("monetary-policy").locator("dd").first()).toBeVisible();
      const baseline = process.env.AYRA_ECO_FLOW_BASELINE === "1";
      const details = /^(Подробнее|Details)$/;
      if (!baseline) {
        await expect(gdp.locator("summary").filter({ hasText: /^(История|History)$/ })).toHaveCount(0);
        // Resizing does not remount or reorder card DOM nodes.
        const before = await page.locator("[data-testid=market-economy] article").evaluateAll(nodes => nodes.map(n => n.getAttribute("data-testid")));
        await page.setViewportSize({ width: width < 768 ? 1440 : 390, height: 900 });
        expect(await page.locator("[data-testid=market-economy] article").evaluateAll(nodes => nodes.map(n => n.getAttribute("data-testid")))).toEqual(before);
        await page.setViewportSize({ width, height: 900 });
        if (width >= 768) {
          for (const [firstId, neighbourId, followingId] of [
            ["economy-us_gdp", "economy-fundamental-production", "economy-debt-gdp"],
            ["fiscal-debt", "fiscal-budget", "fiscal-interest"],
            ["monetary-policy", "monetary-yields", "monetary-dollar"],
          ]) {
            const first = page.getByTestId(firstId), neighbour = page.getByTestId(neighbourId), next = page.getByTestId(followingId);
            const oldNeighbour = await rect(neighbour);
            const summary = first.locator("summary").filter({ hasText: details }).first();
            await summary.focus(); await page.keyboard.press("Enter");
            expect((await rect(neighbour)).height).toBeCloseTo(oldNeighbour.height, 0);
            expect((await rect(neighbour)).y).toBeCloseTo(oldNeighbour.y, 0);
            const a = await rect(first), b = await rect(next);
            expect(b.y - a.y - a.height).toBeCloseTo(12, 0);
            await page.keyboard.press("Space");
            expect(await summary.evaluate(n => (n.parentElement as HTMLDetailsElement).open)).toBe(false);
          }
          // Expanding the other column must not push the following card down.
          for (const [expandingId, stableId] of [["economy-fundamental-production", "economy-debt-gdp"], ["fiscal-budget", "fiscal-interest"], ["monetary-yields", "monetary-dollar"]]) {
            const stable = page.getByTestId(stableId), y = (await rect(stable)).y;
            const summary = page.getByTestId(expandingId).locator("summary").filter({ hasText: details }).first();
            await summary.click(); expect((await rect(stable)).y).toBeCloseTo(y, 0); await summary.click();
          }
        }
      }
      // Keep real on-demand history and test expansion together with Details.
      for (const id of ["fiscal-debt", "fiscal-budget", "fiscal-interest"]) {
        const card = page.getByTestId(id);
        await card.locator("summary").filter({ hasText: /^(История|History)$/ }).click();
        await card.getByRole("button", { name: /Загрузить|Load/ }).click();
        await expect(card.locator("svg").first()).toBeVisible();
      }
      for (const id of ["monetary-policy", "monetary-yields", "monetary-dollar"]) {
        const card = page.getByTestId(id);
        await card.getByRole("button", { name: /Загрузить историю|Load history/ }).click();
        await expect(card.getByRole("button", { name: /^(Максимум|Maximum)$/ })).toBeVisible();
      }
      await page.locator('[data-testid="market-economy"] summary').filter({ hasText: details }).evaluateAll(nodes => nodes.forEach(n => { (n.parentElement as HTMLDetailsElement).open = true; }));
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_ECO_FLOW_SCREENSHOTS && [390, 1440].includes(width)) {
        const prefix = `${process.env.AYRA_ECO_FLOW_SCREENSHOTS}/${baseline ? "before" : "after"}-${width}-${lang}`;
        const metrics = await page.getByTestId("market-economy").evaluate(node => Object.fromEntries(["economy-us_gdp", "economy-debt-gdp", "fiscal-debt", "fiscal-budget", "fiscal-interest", "monetary-policy", "monetary-yields", "monetary-dollar"].map(id => {
          const r = node.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect(); return [id, { y: r.y, height: r.height }];
        })));
        for (const [part, region] of [["growth", /^(Экономический рост|Economic growth)$/], ["public-finances", /^(Государственные финансы США|U.S. public finances)$/], ["monetary", /Монетарная политика и рынки|Monetary policy & markets/]] as const) {
          const target = part === "public-finances" ? page.getByTestId("market-public-finances") : page.getByRole("region", { name: region });
          await target.evaluate(node => { for (let p = node.parentElement; p; p = p.parentElement) p.style.overflow = "visible"; });
          await page.evaluate(() => document.querySelectorAll("header,nav").forEach(n => { if (n instanceof HTMLElement && !n.closest('[data-testid="market-economy"]')) n.style.visibility = "hidden"; }));
          await target.screenshot({ path: `${prefix}-${part}.png` });
        }
        writeFileSync(prefix + ".json", JSON.stringify(metrics, null, 2));
      }
    } finally { await page.context().close(); }
  });
}

test("calendar history is retained for comparable periods, not different GDP stages", async ({ browser, request }) => {
  const common = { country: "us", kind: "release", status: "released", hidden: false, time_tbd: false };
  const gdp = (period: string, stage: string, starts: string) => ({ ...common, id: "bea:gdp:" + period + ":" + stage,
    code: "us_gdp", source: "bea", starts_at: starts, reference_period: period, release_stage: stage, actual: "+3.4%", previous: "+2.2%",
    result_meta: { period, series: "us_gdp", unit: "percent", adjustment: "official-release", source_updated: starts } });
  const one = gdp("2026-Q3", "advance", "2026-10-29T12:30:00Z");
  const differentStage = gdp("2026-Q2", "third", "2026-09-29T12:30:00Z");
  await request.post("http://127.0.0.1:54329/__test/market-events", { data: [one, differentStage] });
  const { page } = await marketGuest(browser, 1440);
  try {
    await page.clock.setFixedTime(new Date("2026-11-20T08:00:00Z"));
    await page.addInitScript(() => { localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", "en"); });
    await page.goto("/market?tab=economy");
    let card = page.getByTestId("economy-us_gdp");
    await expect(card.getByText("+3.4%", { exact: true })).toBeVisible();
    await expect(card.locator("summary").filter({ hasText: /^History$/ })).toHaveCount(0);
    // Monthly payrolls have two comparable observations inside the unchanged 90-day read window.
    const nfp = (period: string, starts: string) => ({ ...common, id: "bls:us_nfp:" + period, code: "us_nfp", source: "bls",
      reference_period: period, release_stage: "regular", starts_at: starts, actual: "+165K", previous: "+60K",
      result_meta: { period, series: "us_nfp", unit: "thousand-change-and-percent", adjustment: "SA" } });
    await request.post("http://127.0.0.1:54329/__test/market-events", { data: [one, differentStage,
      nfp("2026-10", "2026-11-06T13:30:00Z"), nfp("2026-09", "2026-10-02T12:30:00Z")] });
    await page.reload();
    card = page.getByTestId("economy-us_nfp");
    const summary = card.locator("summary").filter({ hasText: /^History$/ });
    await summary.focus(); await page.keyboard.press("Enter");
    await expect(card.locator("svg:not(.lucide)")).toBeVisible();
    // The data list remains accessible alongside the chart. Another GDP stage stays excluded.
    await card.locator("details details summary").click();
    await expect(card.getByRole("listitem")).toHaveCount(2);
    await expect(card.getByRole("listitem").first()).toContainText("2026-09");
    await expect(card.getByRole("listitem").last()).toContainText("2026-10");
    await expect(page.getByTestId("economy-us_gdp").locator("summary").filter({ hasText: /^History$/ })).toHaveCount(0);
  } finally { await page.context().close(); }
});
