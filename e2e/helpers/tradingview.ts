import type { BrowserContext } from "@playwright/test";

// TradingView widgets in e2e (PR 1.2): no real network. The embed script is replaced by a stub that reads the config
// the app passed and draws a frame with the symbols, as TradingView's script does (the calendar: its filters; the
// news without a symbol: «news all»); `unavailable` aborts it instead.
const STUB = `(function () {
  var s = document.currentScript;
  var c = JSON.parse(s.textContent);
  var names = c.symbol ? [c.symbol] : c.symbolsGroups ? c.symbolsGroups[0].symbols.map(function (x) { return x.name; }) : c.countryFilter ? ["events " + c.importanceFilter + " " + c.countryFilter] : ["news all"];
  var f = document.createElement("iframe");
  f.title = "tradingview-stub";
  f.style.cssText = "width:100%;height:100%;border:0;background:transparent";
  f.srcdoc = '<body style="margin:0;padding:8px;color:#b9b2cc;font:12px sans-serif">' + names.join(" · ") + "</body>";
  s.parentNode.appendChild(f);
})();`;

export const TRADINGVIEW_SCRIPTS = "https://s3.tradingview.com/external-embedding/**";

export async function stubTradingView(context: BrowserContext, mode: "ok" | "unavailable" = "ok"): Promise<void> {
  await context.unroute(TRADINGVIEW_SCRIPTS);
  await context.route(TRADINGVIEW_SCRIPTS, (route) =>
    mode === "ok" ? route.fulfill({ status: 200, contentType: "text/javascript", body: STUB }) : route.abort("internetdisconnected")
  );
}
