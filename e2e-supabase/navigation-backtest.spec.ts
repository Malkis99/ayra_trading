import { expect, test } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";

for (const width of [360, 390, 1440]) for (const lang of ["ru", "en"] as const) {
  test(`Backtest has one home in Academy ${width} ${lang}`, async ({ browser }) => {
    const { page } = await marketGuest(browser, width);
    const labels = lang === "ru" ? ["Курсы", "Бэктесты", "Прогресс"] : ["Courses", "Backtests", "Progress"];
    try {
      await page.addInitScript(language => { localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", language); }, lang);
      await page.goto("/market");
      await expect(page.getByRole("tab")).toHaveText(lang === "ru"
        ? ["Обзор", "График", "Календарь", "Новости", "Экономика", "Список наблюдения"]
        : ["Overview", "Chart", "Calendar", "News", "Economy", "Watchlist"]);
      await expect(page.getByRole("tab", { name: /Бэктест|Backtest/ })).toHaveCount(0);
      if (process.env.AYRA_BACKTEST_SCREENSHOTS && width !== 390)
        await page.screenshot({ path: `${process.env.AYRA_BACKTEST_SCREENSHOTS}/market-${width}-${lang}.png` });
      await page.goto("/market?tab=backtest");
      await expect(page).toHaveURL(/\/academy\?tab=backtests$/);
      const backtests = page.getByRole("tab", { name: labels[1], exact: true });
      await expect(backtests).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab")).toHaveText(labels);
      await expect(page.getByRole("tabpanel")).toContainText(labels[1]);
      await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "academy-tab-backtests");
      await page.reload();
      await expect(backtests).toHaveAttribute("aria-selected", "true");
      await page.goBack();
      await expect(page).toHaveURL(/\/market$/);
      await page.goForward();
      await expect(backtests).toHaveAttribute("aria-selected", "true");
      // A real Next Link to the same pathname clears the query-selected tab; Back restores it.
      await page.getByRole("link", { name: lang === "ru" ? "Академия" : "Academy", exact: true }).first().click();
      await expect(page).toHaveURL(/\/academy$/);
      await expect(page.getByRole("tab", { name: labels[0], exact: true })).toHaveAttribute("aria-selected", "true");
      await page.goBack(); await expect(backtests).toHaveAttribute("aria-selected", "true");

      await page.getByRole("tab", { name: labels[0], exact: true }).click();
      await expect(page).toHaveURL(/tab=courses$/);
      await expect(page.getByRole("tabpanel")).toContainText(labels[0]);
      await page.getByRole("tab", { name: labels[2], exact: true }).click();
      await expect(page).toHaveURL(/tab=progress$/);
      await expect(page.getByRole("tabpanel")).toContainText(labels[2]);
      await page.goBack(); await expect(page.getByRole("tab", { name: labels[0], exact: true })).toHaveAttribute("aria-selected", "true");
      await page.goBack(); await expect(backtests).toHaveAttribute("aria-selected", "true");
      await page.goForward(); await expect(page.getByRole("tab", { name: labels[0], exact: true })).toHaveAttribute("aria-selected", "true");

      await backtests.focus(); await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: labels[2], exact: true })).toBeFocused();
      await expect(page).toHaveURL(/tab=progress$/);
      await page.keyboard.press("Home"); await expect(page).toHaveURL(/tab=courses$/);
      await page.keyboard.press("End"); await expect(page).toHaveURL(/tab=progress$/);
      await page.keyboard.press("ArrowLeft"); await expect(backtests).toBeFocused();
      await expect(page).toHaveURL(/tab=backtests$/);
      await page.keyboard.press("Tab"); await expect(page.getByRole("tabpanel")).toBeFocused();
      // Locale is independent of the URL-selected Academy section.
      await page.getByRole("button", { name: lang === "ru" ? "EN" : "RU", exact: true }).click();
      await expect(page.locator("#academy-tab-backtests")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toContainText(lang === "ru" ? "Backtests" : "Бэктесты");
      await page.getByRole("button", { name: lang.toUpperCase(), exact: true }).click();
      await expect(page.getByRole("tabpanel")).toContainText(labels[1]);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (process.env.AYRA_BACKTEST_SCREENSHOTS && width !== 390)
        await page.screenshot({ path: `${process.env.AYRA_BACKTEST_SCREENSHOTS}/academy-${width}-${lang}.png` });
    } finally { await page.context().close(); }
  });
}

test("legacy Backtest URL redirects on the server without JavaScript and keeps a fixed destination", async ({ request }) => {
  const response = await request.get("/market?tab=backtest", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location, "http://localhost:3001").pathname).toBe("/academy");
  expect(new URL(response.headers().location, "http://localhost:3001").searchParams.get("tab")).toBe("backtests");
  const extra = await request.get("/market?tab=backtest&returnTo=https%3A%2F%2Fexample.org", { maxRedirects: 0 });
  const destination = new URL(extra.headers().location, "http://localhost:3001");
  expect(extra.status()).toBe(308);
  expect(destination.origin).toBe("http://localhost:3001");
  expect(destination.pathname).toBe("/academy");
  expect(destination.searchParams.get("tab")).toBe("backtests");
  expect((await request.get("/market?tab=chart", { maxRedirects: 0 })).status()).toBe(200);
});

test("Academy direct links retain existing courses/progress and safely default unknown tabs", async ({ browser }) => {
  const { page } = await marketGuest(browser, 390);
  try {
    await page.addInitScript(() => { localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", "en"); });
    for (const tab of ["courses", "progress", "backtests"]) {
      await page.goto(`/academy?tab=${tab}`);
      await expect(page.locator(`#academy-tab-${tab}`)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toContainText("Section under development (T13).");
    }
    for (const url of ["/academy", "/academy?tab=unknown"]) {
      await page.goto(url);
      await expect(page.locator("#academy-tab-courses")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tab")).toHaveCount(3);
    }
  } finally { await page.context().close(); }
});
