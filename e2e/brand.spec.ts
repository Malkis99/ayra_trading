import { test, expect, type Page } from "@playwright/test";

// The AYRA Trading logo, kit v2 (vector files in public/brand): the sign with the word AYRA in the sidebar on wide
// screens (large enough to read), the flat «A» sign in the top bar on phones, the vertical logo on sign-in, a small
// sign and the name in the footer; title, description, icons (maskable too), install card and link preview.

const loaded = (page: Page, id: string) =>
  page.getByTestId(id).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

async function guest(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __AYRA_E2E_AUTH_MOCK__: boolean }).__AYRA_E2E_AUTH_MOCK__ = true;
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    localStorage.clear();
    localStorage.setItem("ayra_guest_dismissed", "1");
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({ name: "BrandTrader", level: 1, xp: 0, coins: 0, createdAt: "2026-10-08", completedQuestsToday: {}, lastQuestDate: "2026-10-08", onboarding: { status: "done", step: 5, subStep: 0, answers: {} } })
    );
  });
}

test("1440: the sign with AYRA in the sidebar (vector, own proportions, fits, readable), the small sign and «AYRA Trading» in the footer", async ({ page }) => {
  await guest(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/journal");
  const side = page.locator("aside").getByTestId("brand-logo-lockup");
  await expect(side).toBeVisible();
  for (const [id, w, h] of [["brand-logo-lockup-mark", 1156, 856], ["brand-logo-lockup-word", 1593, 262]] as const) {
    const img = page.locator("aside").getByTestId(id);
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0 && i.currentSrc.endsWith(".svg"))).toBe(true);
    // never stretched
    const box = (await img.boundingBox())!;
    expect(Math.abs(box.width / box.height - w / h)).toBeLessThan(0.03);
  }
  // the word is large enough to read (at least 20 px tall), the whole sign fits the sidebar
  expect((await page.locator("aside").getByTestId("brand-logo-lockup-word").boundingBox())!.height).toBeGreaterThanOrEqual(20);
  const lock = (await side.boundingBox())!;
  // the sidebar that holds it (the Journal page has another aside of its own)
  const asideRight = await side.evaluate((el) => el.closest("aside")!.getBoundingClientRect().right);
  expect(lock.x + lock.width).toBeLessThanOrEqual(asideRight - 8);
  await expect(page.locator("header").getByTestId("brand-logo-mark")).toBeHidden();
  const footer = page.getByTestId("site-footer");
  await expect(footer).toContainText("AYRA Trading");
  await expect(footer).toContainText("Trade · Train · Evolve");
  await expect(footer.getByTestId("brand-logo-mark")).toBeVisible();
});

test("360: the «A» sign in the top bar, nothing wider than the screen", async ({ page }) => {
  await guest(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await expect(page.locator("header").getByTestId("brand-logo-mark")).toBeVisible();
  expect(await loaded(page, "brand-logo-mark")).toBe(true);
  // the flat sign (no halo), vector
  expect(await page.locator("header").getByTestId("brand-logo-mark").getAttribute("src")).toBe("/brand/mark-flat.svg");
  await expect(page.locator("aside")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator("header").first().evaluate((h) => h.scrollWidth <= h.clientWidth + 1)).toBe(true);
});

test("sign-in: the full logo", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __AYRA_E2E_AUTH_MOCK__: boolean }).__AYRA_E2E_AUTH_MOCK__ = true;
  });
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/login");
    await expect(page.getByTestId("brand-logo-full").locator("visible=true")).toHaveCount(1);
    await expect(page.getByRole("img", { name: "AYRA Trading" }).locator("visible=true")).toHaveCount(1);
  }
});

for (const [lang, description] of [
  ["ru", "Журнал сделок"],
  ["en", "A trading journal"],
] as const) {
  test(`${lang}: title, description, icons, install card and link preview`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: lang, url: baseURL! }]);
    await page.goto("/login");
    await expect(page).toHaveTitle("AYRA Trading · Trade · Train · Evolve");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", new RegExp(`^AYRA Trading — Trade · Train · Evolve\\. ${description}`));
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/brand\/og-1200x630\.png$/);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", /\/brand\/twitter-1200x600\.png$/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/brand/apple-touch-icon.png");
    const icons = await page.locator('link[rel="icon"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(icons).toEqual(["/favicon.ico", "/brand/icon.svg", "/brand/icon-16.png", "/brand/icon-32.png", "/brand/icon-48.png", "/brand/icon-192.png", "/brand/icon-512.png"]);
    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({
      name: "AYRA Trading",
      icons: [
        { src: "/brand/icon-192.png", purpose: "any" },
        { src: "/brand/icon-512.png", purpose: "any" },
        { src: "/brand/maskable-192.png", purpose: "maskable" },
        { src: "/brand/maskable-512.png", purpose: "maskable" },
      ],
    });
    for (const href of [...icons, "/brand/apple-touch-icon.png", "/brand/og-1200x630.png", "/brand/twitter-1200x600.png", ...manifest.icons.map((i: { src: string }) => i.src)]) {
      const res = await page.request.get(href!);
      expect(res.status(), href!).toBe(200);
    }
  });
}
