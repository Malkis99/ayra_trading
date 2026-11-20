import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { marketGuest } from "../e2e/helpers/market";
import { stubTradingView, TRADINGVIEW_SCRIPTS } from "../e2e/helpers/tradingview";
import { INSTRUMENT_IDS, INSTRUMENTS, PICKER_CATEGORIES, type InstrumentId } from "../lib/market/instruments";

const initial: InstrumentId[] = ["eurusd", "btc", "gbpusd", "gold", "us10y", "aapl", "dxy"];
async function seed(page: import("@playwright/test").Page, ids: InstrumentId[], lang: "ru" | "en") {
  await page.addInitScript(({ ids, lang }) => {
    localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", lang);
    if (sessionStorage.getItem("watch1_seeded")) return;
    sessionStorage.setItem("watch1_seeded", "1");
    localStorage.setItem("ayra_market_watchlist", JSON.stringify({ version: 1, ids, updatedAt: "2026-11-20T12:00:00Z" }));
    localStorage.setItem("ayra_market_notes", JSON.stringify({ gold: { text: "Existing chart note", updatedAt: "2026-11-20T12:00:00Z" } }));
    localStorage.setItem("ayra_market_chart", JSON.stringify({ instrument: "gold", interval: "240" }));
  }, { ids, lang });
}
const stored = (page: import("@playwright/test").Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_market_watchlist")!));
const rowIds = (page: import("@playwright/test").Page) => page.getByTestId("market-watchlist-rows").getByRole("listitem").evaluateAll(nodes => nodes.map(n => n.getAttribute("data-testid")!.replace("market-watchlist-row-", "")));

for (const mode of ["unavailable", "delayed"] as const) test(`quotes ${mode} do not block the list`, async ({ browser }) => {
  const { page } = await marketGuest(browser, 390, { tradingView: "unavailable" });
  try {
    await seed(page, initial, "en"); await page.goto("/market?tab=watchlist");
    await expect(page.getByTestId("market-watchlist-rows").getByRole("listitem")).toHaveCount(7);
    if (mode === "delayed") {
      await page.clock.install();
      await page.context().unroute(TRADINGVIEW_SCRIPTS);
      await page.context().route(TRADINGVIEW_SCRIPTS, route => route.fulfill({ contentType: "text/javascript", body: "/* no iframe: delayed provider */" }));
    }
    await page.getByTestId("market-watchlist-quotes-summary").click();
    if (mode === "delayed") {
      await expect(page.getByTestId("market-watchlist-widget")).toHaveAttribute("data-status", "loading");
      await page.clock.fastForward(15_001);
    }
    await expect(page.getByTestId("market-watchlist-widget-error")).toBeVisible();
    await page.getByTestId("market-watchlist-query").fill("eurusd");
    expect(await rowIds(page)).toEqual(["eurusd"]);
    expect((await stored(page)).ids).toEqual(initial);
    await stubTradingView(page.context(), "ok");
    await page.getByTestId("market-watchlist-widget-retry").click();
    await expect(page.getByTestId("market-watchlist-widget")).toHaveAttribute("data-status", "ready");
  } finally { await page.context().close(); }
});

test("removing the last item returns focus to Add and preserves chart data", async ({ browser }) => {
  const { page } = await marketGuest(browser, 360);
  try {
    await seed(page, ["gold"], "en"); await page.goto("/market?tab=watchlist");
    await page.getByTestId("market-watchlist-remove-gold").focus(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("market-watchlist-add")).toBeFocused();
    expect((await stored(page)).ids).toEqual([]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_market_notes")!).gold.text)).toBe("Existing chart note");
    await expect(page.getByTestId("market-watchlist-quotes")).toHaveCount(0);
  } finally { await page.context().close(); }
});

for (const width of [360, 390, 768, 1024, 1440]) for (const lang of ["ru", "en"] as const) {
  test(`compact Watchlist ${width} ${lang}`, async ({ browser }) => {
    const { page, scripts } = await marketGuest(browser, width);
    try {
      await seed(page, initial, lang);
      await page.goto("/market?tab=watchlist");
      await expect(page.getByTestId("market-watchlist-rows").getByRole("listitem")).toHaveCount(7);
      const baseline = process.env.AYRA_WATCH1_BASELINE === "1";
      if (process.env.AYRA_WATCH1_SCREENSHOTS && [390, 1440].includes(width)) {
        const panel = page.getByTestId("market-watchlist");
        await panel.evaluate(node => { for (let p = node.parentElement; p; p = p.parentElement) p.style.overflow = "visible"; });
        await page.evaluate(() => document.querySelectorAll("header,nav").forEach(n => { if (n instanceof HTMLElement) n.style.visibility = "hidden"; }));
        const prefix = `${process.env.AYRA_WATCH1_SCREENSHOTS}/${baseline ? "before" : "after"}-${width}-${lang}`;
        await panel.screenshot({ path: prefix + ".png" });
        writeFileSync(prefix + ".json", JSON.stringify({ height: (await panel.boundingBox())!.height, rows: await rowIds(page) }, null, 2));
      }
      if (!baseline) {
        expect(scripts.some(s => s.includes("embed-widget-market-quotes"))).toBe(false);
        await expect(page.getByTestId("market-watchlist-widget")).toHaveCount(0);
        const snapshot = await stored(page);
        const query = page.getByTestId("market-watchlist-query"), category = page.getByTestId("market-watchlist-category");
        await query.fill("msft"); await expect(page.getByTestId("market-watchlist-no-results")).toBeVisible();
        expect(await stored(page)).toEqual(snapshot);
        await page.getByTestId("market-watchlist-clear-filters").click();
        for (const c of PICKER_CATEGORIES) {
          await category.click(); await page.getByRole("option", { name: lang === "ru"
            ? { forex: "Валюты", indices: "Индексы", crypto: "Крипта", commodities: "Сырьё и металлы", bonds: "Облигации и доходности", stocks: "Акции США" }[c.id]
            : { forex: "Forex", indices: "Indices", crypto: "Crypto", commodities: "Commodities and metals", bonds: "Bonds and yields", stocks: "US stocks" }[c.id], exact: true }).click();
          expect(await rowIds(page)).toEqual(initial.filter(id => c.ids.includes(id)));
          expect(await stored(page)).toEqual(snapshot);
        }
        await category.click(); await page.getByRole("option", { name: lang === "ru" ? "Валюты" : "Forex", exact: true }).click();
        const up = page.getByTestId("market-watchlist-up-gbpusd");
        await up.focus(); await page.keyboard.press("Enter");
        await expect.poll(() => rowIds(page)).toEqual(["gbpusd", "eurusd"]);
        expect((await stored(page)).ids).toEqual(["gbpusd", "btc", "eurusd", "gold", "us10y", "aapl", "dxy"]);
        await expect(page.getByTestId("market-watchlist-chart-gbpusd")).toBeFocused();
        await page.getByTestId("market-watchlist-clear-filters").click();
        await query.fill(lang === "ru" ? "золото" : "gold");
        await expect(page.getByTestId("market-watchlist-rows").getByRole("listitem")).toHaveCount(1);
        await page.getByTestId("market-watchlist-remove-gold").click();
        await expect(query).toBeFocused();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_market_notes")!).gold.text)).toBe("Existing chart note");
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_market_chart")!).interval)).toBe("240");
        await page.getByTestId("market-watchlist-clear-filters").click();
        await page.getByTestId("market-watchlist-add").click();
        await page.getByTestId("market-watchlist-search").fill("XAUUSD");
        await page.getByTestId("market-watchlist-pick-gold").click();
        await page.getByTestId("market-watchlist-search").press("Escape");
        await expect(page.getByTestId("market-watchlist-add")).toBeFocused();
        const ids = (await stored(page)).ids;
        await page.reload(); await expect.poll(() => rowIds(page)).toEqual(ids);
        // The real graph is reused, with the user's existing timeframe and notes.
        await page.getByTestId("market-watchlist-chart-gold").click();
        await expect(page).toHaveURL(/tab=chart.*symbol=OANDA%3AXAUUSD/);
        await expect(page.getByTestId("market-chart-note")).toHaveValue("Existing chart note");
        await expect(page.getByTestId("market-chart-interval-240")).toHaveAttribute("aria-checked", "true");
        await page.goto("/market?tab=watchlist"); await expect.poll(() => rowIds(page)).toEqual(ids);
        await page.getByTestId("market-watchlist-quotes-summary").focus(); await page.keyboard.press("Enter");
        await expect(page.getByTestId("market-watchlist-widget")).toHaveAttribute("data-status", "ready");
        const scroll = page.getByTestId("market-watchlist-quotes-scroll");
        expect((await scroll.boundingBox())!.height).toBeLessThanOrEqual(322);
        const count = scripts.filter(s => s.includes("embed-widget-market-quotes")).length;
        await page.getByTestId("market-watchlist-query").fill("eurusd");
        expect(scripts.filter(s => s.includes("embed-widget-market-quotes")).length).toBe(count);
        await page.getByTestId("market-watchlist-clear-filters").click();
        await page.getByTestId("market-watchlist-quotes-summary").focus(); await page.keyboard.press("Space");
        await expect(page.getByTestId("market-watchlist-widget")).toHaveCount(0);
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    } finally { await page.context().close(); }
  });
}

for (const width of [360, 1440]) test(`full 30-instrument Watchlist ${width}`, async ({ browser }) => {
  const { page } = await marketGuest(browser, width);
  const ids = [...initial, ...INSTRUMENT_IDS.filter(id => !initial.includes(id))].slice(0, 30);
  try {
    await seed(page, ids, "en"); await page.goto("/market?tab=watchlist");
    await expect(page.getByTestId("market-watchlist-rows").getByRole("listitem")).toHaveCount(30);
    await expect(page.getByTestId("market-watchlist-full")).toBeVisible();
    await page.getByTestId("market-watchlist-query").fill("no-result");
    await page.getByTestId("market-watchlist-add").click();
    await page.getByTestId("market-watchlist-search").fill("msft");
    await expect(page.getByTestId("market-watchlist-pick-msft")).toBeDisabled();
    expect((await stored(page)).ids).toEqual(ids);
    await page.getByTestId("market-watchlist-add").click();
    await page.getByTestId("market-watchlist-clear-filters").click();
    await page.getByTestId("market-watchlist-quotes-summary").click();
    await expect(page.getByTestId("market-watchlist-widget")).toHaveAttribute("data-status", "ready");
    const scroll = page.getByTestId("market-watchlist-quotes-scroll");
    expect(await scroll.evaluate(n => n.scrollHeight > n.clientHeight)).toBe(true);
    await scroll.evaluate(n => { n.scrollTop = n.scrollHeight; });
    expect(await scroll.evaluate(n => n.scrollTop)).toBeGreaterThan(0);
    const config = await page.getByTestId("market-watchlist-widget").locator("script").evaluate(n => JSON.parse(n.textContent!));
    expect(config.symbolsGroups[0].symbols.map((s: { name: string }) => s.name)).toEqual(ids.map(id => INSTRUMENTS[id].symbol));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  } finally { await page.context().close(); }
});

