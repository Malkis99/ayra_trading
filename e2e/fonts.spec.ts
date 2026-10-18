import { test, expect } from "@playwright/test";

// Fonts are self-hosted (app/fonts.css, public/fonts/manrope): the app never calls Google Fonts,
// Latin and Cyrillic glyphs come from our files.
test("Manrope is served from /fonts, Cyrillic included, no request to Google", async ({ page }) => {
  const fontRequests: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font" || /fonts\.(googleapis|gstatic)\.com/.test(r.url())) fontRequests.push(r.url());
  });
  await page.addInitScript(() => localStorage.setItem("ayra_guest_dismissed", "1"));
  await page.goto("/login");
  await page.evaluate(() => document.fonts.ready);

  expect(fontRequests.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toBe(false);
  expect(fontRequests.some((u) => u.endsWith("/fonts/manrope/manrope-latin.woff2"))).toBe(true);
  expect(fontRequests.some((u) => u.endsWith("/fonts/manrope/manrope-cyrillic.woff2"))).toBe(true);

  const loaded = await page.evaluate(async () => {
    await document.fonts.load('600 16px "Manrope"', "Вход AYRA");
    return document.fonts.check('600 16px "Manrope"', "Вход AYRA");
  });
  expect(loaded).toBe(true);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toContain("Manrope");
});
