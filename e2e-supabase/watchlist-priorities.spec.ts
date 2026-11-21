import { test, expect, type Browser, type Page, type APIRequestContext } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { stubTradingView } from "../e2e/helpers/tradingview";

const fake = "http://127.0.0.1:54329";
type Row = { table: string; id: string; data: { revision: number; entries: Record<string, { priority: boolean; revision: number }> } };
const metadata = async (request: APIRequestContext, email: string) => ((await (await request.get(`${fake}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[]).find(r => r.table === "market_user_data" && r.id === "watchlist_meta")?.data;
async function device(browser: Browser, email: string, first = false) {
  const context = await browser.newContext({ reducedMotion: "reduce" });await stubTradingView(context, "ok");const page = await context.newPage();
  await signIn(page, email);if (first) await completeOnboarding(page, `Pin${Date.now() % 10000000}`);
  await page.request.get(`${fake}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  await page.goto("/market?tab=watchlist");
  await expect(page.getByTestId("market-sync")).toHaveAttribute("data-kind", "on");
  if (!await page.getByTestId("market-watchlist-row-eurusd").count()) {
    await page.getByTestId("market-watchlist-add").click();
    for (const id of ["eurusd", "gbpusd"]) await page.getByTestId(`market-watchlist-pick-${id}`).click();
    await page.getByTestId("market-watchlist-add").click();
  }
  await expect(page.getByTestId("watchlist-pin-eurusd")).toBeEnabled();return { context, page };
}
const saved = (page: Page, id = "eurusd") => expect(page.getByTestId(`watchlist-pin-status-${id}`)).toHaveAttribute("data-kind", "saved");
test.describe("cloud priority pins", () => {
  test.setTimeout(120_000);
  test("pins, combined filtering, canonical order, remove/re-add, reload and offline recovery", async ({ browser, request }, info) => {
    const email = `Pins_${Date.now()}@example.com`, a = await device(browser, email, true);
    const network: { method: string; path: string; status?: number; error?: string }[] = [];
    a.page.on("response", response => { if (response.url().includes("/rest/v1/market_user_data") || response.url().includes("/rest/v1/user_features")) network.push({ method: response.request().method(), path: new URL(response.url()).pathname + new URL(response.url()).search, status: response.status() }); });
    a.page.on("requestfailed", req => network.push({ method: req.method(), path: new URL(req.url()).pathname, error: req.failure()?.errorText }));
    try {
      const pin = a.page.getByTestId("watchlist-pin-eurusd");await pin.focus();await a.page.keyboard.press("Enter");await saved(a.page);
      expect((await metadata(request, email))?.entries.eurusd.priority).toBe(true);
      await a.page.getByTestId("watchlist-pinned-filter").click();await expect(a.page.getByTestId("market-watchlist-row-gbpusd")).toHaveCount(0);
      await a.page.getByTestId("market-watchlist-category").click();await a.page.getByRole("option", { name: "Акции США", exact: true }).click();
      await expect(a.page.getByTestId("market-watchlist-no-results")).toBeVisible();
      await a.page.getByTestId("market-watchlist-category").click();await a.page.getByRole("option", { name: "Все категории", exact: true }).click();
      await pin.focus();await a.page.keyboard.press("Space");
      await expect(a.page.getByTestId("market-watchlist-row-eurusd")).toHaveCount(0);await expect(a.page.getByTestId("market-watchlist-query")).toBeFocused();
      await a.page.getByTestId("market-watchlist-clear-filters").click();await pin.click();await saved(a.page);
      await a.page.getByTestId("watchlist-pinned-filter").click();
      await a.page.getByTestId("market-watchlist-query").fill("gbpusd");await expect(a.page.getByTestId("market-watchlist-no-results")).toBeVisible();
      await a.page.getByTestId("market-watchlist-clear-filters").click();
      await expect(a.page.getByTestId("market-watchlist-rows").getByRole("listitem")).toHaveText([/EUR\/USD/, /GBP\/USD/]);
      await a.page.getByTestId("market-watchlist-remove-eurusd").click();
      expect((await metadata(request, email))?.entries.eurusd.priority).toBe(true);
      await a.page.getByTestId("market-watchlist-add").click();await a.page.getByTestId("market-watchlist-pick-eurusd").click();await a.page.getByTestId("market-watchlist-add").click();
      await expect(pin).toHaveAttribute("aria-pressed", "true");
      await a.page.reload();await expect(pin).toHaveAttribute("aria-pressed", "true");await saved(a.page);
      await a.context.setOffline(true);await a.page.getByTestId("watchlist-pin-gbpusd").click();
      await expect(a.page.getByTestId("watchlist-pin-status-gbpusd")).toHaveAttribute("data-kind", "pending");
      await a.page.getByTestId("market-watchlist-chart-gbpusd").click();await a.context.setOffline(false);
      await expect.poll(async () => (await metadata(request, email))?.entries.gbpusd?.priority).toBe(true);
      await a.page.getByRole("tab", { name: "Список наблюдения", exact: true }).click();
      await a.context.setOffline(true);await pin.click();await expect(pin).toHaveAttribute("aria-pressed", "false");
      await expect(a.page.getByTestId("watchlist-pin-status-eurusd")).toHaveAttribute("data-kind", "pending");
      await a.page.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); // offline navigation cannot fetch the page; outbox must survive
      await a.context.setOffline(false);await a.page.goto("/market?tab=watchlist");await saved(a.page);
      await expect(pin).toHaveAttribute("aria-pressed", "false");expect((await metadata(request, email))?.entries.eurusd.priority).toBe(false);
    } finally {
      const help = a.page.getByTestId("watchlist-priority-help");
      await info.attach("priority-network", { body: JSON.stringify({ network, server: await metadata(request, email), help: await help.count() ? await help.textContent() : null }), contentType: "application/json" });
      await a.context.close();
    }
  });
  test("two devices: independent pins merge, same-instrument conflict needs an explicit choice", async ({ browser, request }) => {
    const email = `PinDevices_${Date.now()}@example.com`, a = await device(browser, email, true), b = await device(browser, email);
    try {
      await b.context.setOffline(true);await b.page.getByTestId("watchlist-pin-eurusd").click();
      await expect(b.page.getByTestId("watchlist-pin-eurusd")).toHaveAttribute("aria-pressed", "true");
      await a.page.getByTestId("watchlist-pin-eurusd").click();await saved(a.page);
      await a.page.getByTestId("watchlist-pin-gbpusd").click();await saved(a.page, "gbpusd");
      await b.context.setOffline(false);await expect(b.page.getByTestId("watchlist-pin-status-eurusd")).toHaveAttribute("data-kind", "conflict");
      await b.page.getByTestId("watchlist-pin-cloud-eurusd").click();await saved(b.page);
      expect(Object.keys((await metadata(request, email))!.entries).sort()).toEqual(["eurusd", "gbpusd"]);
      await b.page.getByTestId("watchlist-pin-eurusd").click();await saved(b.page);await a.page.reload();
      await expect(a.page.getByTestId("watchlist-pin-eurusd")).toHaveAttribute("aria-pressed", "false");
    } finally { await a.context.close();await b.context.close(); }
  });
  test("cloud disabled sends no metadata; newer contract stays read-only", async ({ browser, request }) => {
    const email = `PinDisabled_${Date.now()}@example.com`, a = await device(browser, email, true);
    try {
      await request.get(`${fake}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=0`);await a.page.reload();
      await expect(a.page.getByTestId("watchlist-pin-eurusd")).toBeDisabled();await expect(a.page.getByTestId("watchlist-priority-help")).toContainText("Включите облачную");expect(await metadata(request, email)).toBeUndefined();
      await request.get(`${fake}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
      await request.post(`${fake}/__test/cloud-put?email=${encodeURIComponent(email)}&table=market_user_data`, { data: { id: "watchlist_meta", version: 2, future: { opaque: true } } });
      await a.page.reload();await expect(a.page.getByTestId("watchlist-priority-help")).toContainText("Обновите AYRA");await expect(a.page.getByTestId("watchlist-pin-eurusd")).toBeDisabled();
      expect(await metadata(request, email)).toMatchObject({ version: 2, future: { opaque: true } });
    } finally { await a.context.close(); }
  });
  for (const width of [360, 390, 768, 1024, 1440]) for (const lang of ["ru", "en"] as const) test(`priority layout ${width} ${lang}`, async ({ browser }) => {
    const email = `PinLayout_${width}_${lang}_${Date.now()}@example.com`, a = await device(browser, email, true);
    try {
      await a.page.setViewportSize({ width, height: 960 });
      if (lang === "en") {
        // Signed-in accounts change language in Settings; the Topbar EN button is guest-only.
        await a.page.goto("/settings/interface");await a.page.getByRole("button", { name: "English", exact: true }).click();
        await expect(a.page.locator("html")).toHaveAttribute("lang", "en");
        await expect.poll(async () => (await (await a.page.request.get(`${fake}/__test/profile?email=${encodeURIComponent(email)}`)).json()).locale).toBe("en");
        await a.page.goto("/market?tab=watchlist");
      }
      await a.page.getByTestId("watchlist-pin-eurusd").click();await saved(a.page);
      await a.page.getByTestId("watchlist-pin-gbpusd").focus();await a.page.keyboard.press("Space");await saved(a.page, "gbpusd");
      expect(await a.page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expect(a.page.getByTestId("watchlist-pinned-filter")).toHaveText(lang === "ru" ? "Закреплённые" : "Pinned");
      if (process.env.AYRA_PIN_SCREENSHOTS && [390, 1440].includes(width)) {
        const panel = a.page.getByTestId("market-watchlist");await panel.screenshot({ path: `${process.env.AYRA_PIN_SCREENSHOTS}/after-${width}-${lang}.png` });
      }
    } finally { await a.context.close(); }
  });
});
