import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";

// Same detached-parent assumption as TradingView _replaceScript. A script-tag removal alone fails this test.
const script = `(()=>{const s=document.currentScript;const parent=s.parentNode;parent.querySelector('.tradingview-widget-container__widget');const f=document.createElement('iframe');f.title='quotes-lifecycle-stub';f.srcdoc='<body>quotes</body>';parent.append(f);})();`;

test("controlled delayed fixture exposes the legacy detached-script failure", async ({ page }) => {
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), requested = new Promise<void>(resolve => arrived = resolve);
  await page.route("https://lifecycle.test/embed.js", async route => { arrived(); await gate; await route.fulfill({ contentType: "text/javascript", body: script }); });
  await page.setContent('<div id="legacy-host"><div class="tradingview-widget-container__widget"></div></div>');
  await page.evaluate(() => { const s = document.createElement("script"); s.src = "https://lifecycle.test/embed.js"; document.getElementById("legacy-host")!.append(s); });
  await requested;
  await page.evaluate(() => document.getElementById("legacy-host")!.replaceChildren());
  const error = page.waitForEvent("pageerror"); release();
  expect((await error).message).toContain("Cannot read properties of null (reading 'querySelector')");
});

for (const scenario of ["close", "language", "list", "chart"] as const) {
  test(`pending quotes: ${scenario} destroys the context, reopening has exactly one frame`, async ({ browser }) => {
    const { page } = await marketGuest(browser, 390);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    let release!: () => void, arrived!: () => void, delivered!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const requested = new Promise<void>(resolve => arrived = resolve);
    const delivery = new Promise<void>(resolve => delivered = resolve);
    let requests = 0;
    try {
      await page.addInitScript(() => {
        if (window.top !== window) return;
        localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", "en");
        localStorage.setItem("ayra_market_watchlist", JSON.stringify({ version: 1, ids: ["eurusd", "btc", "gbpusd"] }));
      });
      await page.context().route("**/embed-widget-market-quotes.js", async route => {
        const first = ++requests === 1;
        if (first) { arrived(); await gate; }
        try { await route.fulfill({ contentType: "text/javascript", body: script }); }
        finally { if (first) delivered(); }
      });
      await page.goto("/market?tab=watchlist");
      const summary = page.getByTestId("market-watchlist-quotes-summary");
      await summary.click(); await requested;
      await expect(page.getByTestId("market-watchlist-widget")).toHaveAttribute("data-status", "loading");
      if (scenario === "close") await summary.click();
      if (scenario === "language") await page.getByRole("button", { name: "RU", exact: true }).click();
      if (scenario === "list") await page.getByTestId("market-watchlist-up-btc").click();
      if (scenario === "chart") await page.getByTestId("market-watchlist-chart-eurusd").click();
      release(); await delivery;
      if (scenario === "chart") await page.getByRole("tab", { name: "Watchlist", exact: true }).click();
      if (scenario === "close" || scenario === "chart") await summary.click();
      const widget = page.getByTestId("market-watchlist-widget");
      await expect(widget).toHaveAttribute("data-status", "ready");
      await expect(widget.locator("iframe[data-tradingview-quotes-frame]")).toHaveCount(1);
      const frame = widget.frameLocator("iframe[data-tradingview-quotes-frame]");
      await expect(frame.locator("script[src]")).toHaveCount(1);
      await expect(frame.getByTitle("quotes-lifecycle-stub")).toHaveCount(1);
      expect(requests).toBe(2);
      // Filters must not remount an active frame or issue another embed request.
      await page.getByTestId("market-watchlist-query").fill("eurusd");
      await page.getByTestId("market-watchlist-clear-filters").click();
      expect(requests).toBe(2);
      await summary.click(); await expect(widget).toHaveCount(0);
      expect(await page.locator("iframe[data-tradingview-quotes-frame]").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { release(); await page.context().close(); }
  });
}
