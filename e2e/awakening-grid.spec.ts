import { test, expect, type Page } from "@playwright/test";

// Onboarding: header, question and footer sit on one grid; time zone picker is never empty.

async function fresh(page: Page) {
  await page.goto("/awakening");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/awakening");
  await expect(page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]')).toBeVisible();
}

const box = async (page: Page, selector: ReturnType<Page["locator"]>) => (await selector.boundingBox())!;

for (const [w, h] of [
  [1440, 900],
  [1920, 1080],
  [360, 740],
] as const) {
  test(`grid alignment at ${w}px: Back / title, Continue / field, account block / field (±1px)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await fresh(page);
    const title = await box(page, page.getByRole("heading", { level: 1 }));
    const field = await box(page, page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]'));
    const back = await box(page, page.getByRole("button", { name: "Назад" }));
    const next = await box(page, page.getByRole("button", { name: "Продолжить" }));
    const account = await box(page, page.getByTestId("awakening-account"));

    expect(Math.abs(back.x - title.x), "Back left = title left").toBeLessThanOrEqual(1);
    expect(Math.abs(back.x - field.x), "Back left = field left").toBeLessThanOrEqual(1);
    expect(Math.abs(next.x + next.width - (field.x + field.width)), "Continue right = field right").toBeLessThanOrEqual(1);
    expect(Math.abs(account.x + account.width - (field.x + field.width)), "account right = field right").toBeLessThanOrEqual(1);
    expect(Math.abs(back.height - next.height), "same height").toBeLessThanOrEqual(1);
    expect(Math.abs(back.y - next.y), "same line").toBeLessThanOrEqual(1);

    // The logo sits on the same left padding as the content on phones and as the page padding on desktop
    const logo = await box(page, page.getByRole("link", { name: "AYRA" }));
    if (w === 360) expect(Math.abs(logo.x - field.x)).toBeLessThanOrEqual(1);

    // Progress is centred between the logo and the account block
    const progress = await box(page, page.locator("header nav ol"));
    if (w > 360) {
      const gapLeft = progress.x - (logo.x + logo.width);
      const gapRight = account.x - (progress.x + progress.width);
      expect(Math.abs(gapLeft - gapRight), "progress centred").toBeLessThanOrEqual(2);
    }
  });
}

test("step 2 time zone: a dropdown with the browser zone preselected, groups and search", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fresh(page);
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill("Tz_Tester");
  await page.click('button:has-text("Продолжить")');
  await expect(page.getByRole("heading", { name: "Язык и часовой пояс" })).toBeVisible();

  const picker = page.getByTestId("timezone-select");
  await expect(picker).toContainText("UTC");
  const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await picker.click();
  const list = page.getByRole("listbox");
  await expect(list.getByText("Европа", { exact: true })).toBeVisible();
  await page.getByRole("searchbox").or(page.getByPlaceholder(/Поиск/)).first().fill("Tbilisi");
  await list.getByRole("option", { name: /Грузия/ }).click();
  await expect(picker).toContainText("UTC+4");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}").profile?.timezone);
  expect(stored).toBe("Asia/Tbilisi");
  expect(browserZone).toBeTruthy();
});
