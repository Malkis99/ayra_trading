import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// "TradeTrack (CSV)" preset: detected by its header, columns mapped by the preset, a clear hint about PnL;
// a platform picked by hand that does not fit the file explains why.
const FILE = fs.readFileSync(path.join(process.cwd(), "lib/journal/import/__fixtures__/tradetrack.csv"));

async function seed(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    localStorage.clear();
    localStorage.setItem("ayra_guest_dismissed", "1");
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({ name: "TraderOne", onboarding: { status: "done", step: 5, answers: { nickname: "TraderOne" } }, profile: { timezone: "UTC" } })
    );
    localStorage.setItem(
      "ayra_journal_v1",
      JSON.stringify({
        schemaVersion: 6,
        accounts: [{ id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00.000Z" }],
        trades: [],
      })
    );
  });
}

const liveTrades = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem("ayra_journal_v1")!).trades as Array<Record<string, unknown>>).filter((t) => !t.deletedAt));

async function chooseFile(page: Page, platform?: RegExp) {
  await page.getByTestId("journal-import").click();
  const wizard = page.getByTestId("import-wizard");
  if (platform) await wizard.getByRole("radio", { name: platform }).click();
  await wizard.getByTestId("import-next").click();
  await wizard.getByTestId("import-file-input").setInputFiles({ name: "tradetrack.csv", mimeType: "text/csv", buffer: FILE });
  await expect(wizard.getByTestId("import-file-summary")).toBeVisible();
  return wizard;
}

test.describe("Import: TradeTrack (CSV) preset", () => {
  test.use({ reducedMotion: "reduce" });

  // The fixture trades are dated 2026-09/10 and analytics opens on «30 days»: pin «today» so the numbers do not
  // drift as the calendar moves on (on 2026-10-21 two trades fell out of the window).
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-17T12:00:00Z"));
  });

  test("detected automatically; columns by the preset; 29 trades (1 open); re-import = 29 duplicates", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal");
    let wizard = await chooseFile(page);
    await expect(wizard.getByTestId("import-file-summary")).toContainText("Формат: TradeTrack");
    await expect(wizard.getByTestId("import-file-summary")).not.toContainText("бета");
    await wizard.getByTestId("import-next").click(); // -> columns
    await expect(wizard).toContainText("Колонки TradeTrack сопоставлены автоматически.");
    await expect(wizard.getByTestId("import-preset-hint")).toContainText("PnL — итоговый результат сделки: комиссия хранится отдельным полем и второй раз не вычитается");
    await expect(wizard.getByTestId("map-pnl")).toHaveCount(0); // nothing to map by hand
    await wizard.getByTestId("import-next").click(); // -> settings
    await expect(wizard.getByTestId("import-r-from-file")).toContainText("RR");
    await expect(wizard.getByTestId("import-strategies")).toContainText("Создать стратегию «HTF FVG + CISD»");
    await wizard.getByTestId("import-next").click(); // -> preview
    const counters = wizard.getByTestId("import-counters");
    await expect(counters.locator('[data-counter="new"]')).toContainText("29");
    await expect(counters.locator('[data-counter="dup"]')).toContainText("0");
    await expect(counters.locator('[data-counter="err"]')).toContainText("0");
    await expect(wizard.getByTestId("import-open-count")).toContainText("1");
    await wizard.getByTestId("import-confirm").click();
    await expect(wizard).toContainText("Добавлено сделок: 29");
    await wizard.getByRole("button", { name: "Готово" }).click();

    const trades = await liveTrades(page);
    expect(trades).toHaveLength(29);
    expect(trades.filter((t) => t.status === "closed")).toHaveLength(28);
    expect(Math.round(trades.reduce((s, t) => s + ((t.pnlMoney as number) ?? 0), 0) * 100) / 100).toBe(10.54);
    const batches = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_import_batches") || "[]"));
    expect(batches.at(-1)).toMatchObject({ formatId: "tradetrack", tradeCount: 29 });

    await page.getByRole("tab", { name: "Аналитика", exact: true }).first().click();
    await expect(page.locator("main")).toContainText("46.4%");
    await expect(page.locator("main")).toContainText("R известен: 28 из 28");

    await page.getByRole("tab", { name: "Сделки", exact: true }).first().click();
    wizard = await chooseFile(page);
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-next").click();
    await expect(wizard.getByTestId("import-counters").locator('[data-counter="new"]')).toContainText("0");
    await expect(wizard.getByTestId("import-counters").locator('[data-counter="dup"]')).toContainText("29");
    await expect(wizard.getByTestId("import-confirm")).toBeDisabled();
  });

  test("Match-Trader picked by hand: explains which columns are missing, cannot continue, offers TradeTrack", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal");
    const wizard = await chooseFile(page, /^Match-Trader/);
    const alert = wizard.getByTestId("import-format-mismatch");
    await expect(alert).toContainText("Файл не похож на выгрузку Match-Trader");
    await expect(alert).toContainText("«Open Time»");
    await expect(alert).toContainText("«Profit»");
    await expect(wizard.getByTestId("import-next")).toBeDisabled();
    await expect(wizard).toContainText("Похоже, это файл TradeTrack.");
    await wizard.getByRole("button", { name: "Использовать TradeTrack" }).click();
    await expect(wizard.getByTestId("import-format-mismatch")).toHaveCount(0);
    await expect(wizard.getByTestId("import-next")).toBeEnabled();
  });

  test("360px: the preset hint and the mismatch explanation fit the bottom sheet", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed(page);
    await page.goto("/journal");
    const wizard = await chooseFile(page, /^Match-Trader/);
    await expect(wizard.getByTestId("import-format-mismatch")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
