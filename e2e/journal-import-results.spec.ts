import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { pickOption } from "./helpers/forms";

// Universal CSV import (format "CSV / XLSX" chosen by hand) of a real TradeTrack export (29 rows, dates without time):
// no false duplicates, results and R in the journal, analytics calculated.
const FILE = path.join(process.cwd(), "lib/journal/import/__fixtures__/tradetrack.csv");

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
        strategies: [{ id: "str_htf", name: "HTF FVG + CISD", color: "#50348f", rules: [], tags: [], version: 1, createdAt: "2026-01-01T00:00:00.000Z" }],
        trades: [],
      })
    );
  });
}

const journal = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1")!));

async function openWizardWithFile(page: Page, buffer: Buffer) {
  await page.getByTestId("journal-import").click();
  const wizard = page.getByTestId("import-wizard");
  // the generic column mapping, not the TradeTrack preset (that one has its own spec)
  await wizard.getByRole("radio", { name: /^CSV \/ XLSX/ }).click();
  await wizard.getByTestId("import-next").click();
  await wizard.getByTestId("import-file-input").setInputFiles({ name: "tradetrack.csv", mimeType: "text/csv", buffer });
  await expect(wizard.getByTestId("import-file-summary")).toBeVisible();
  await wizard.getByTestId("import-next").click(); // -> columns
  return wizard;
}

test.describe("Import: TradeTrack file through the universal CSV wizard", () => {
  test.use({ reducedMotion: "reduce" });

  test("29 trades, 1 open, 0 duplicates; strategies matched or created; re-import = 29 duplicates with reasons; analytics calculated", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal");
    let wizard = await openWizardWithFile(page, fs.readFileSync(FILE));

    // columns found by name, exit date is used
    await expect(wizard.getByTestId("map-closedAt")).toContainText("Дата выхода");
    await expect(wizard.getByTestId("map-rMultiple")).toContainText("RR");
    await expect(wizard.getByTestId("map-outcome")).toContainText("Результат");
    await expect(wizard.getByTestId("map-commission")).toContainText("Комиссии");
    // choosing the TP/SL column for the amount is flagged right away
    await pickOption(page, "map-pnl", "Результат");
    await expect(wizard).toContainText("В этой колонке нет чисел");
    await pickOption(page, "map-pnl", "PnL");
    await expect(wizard).not.toContainText("В этой колонке нет чисел");
    await wizard.getByTestId("import-next").click(); // -> settings
    await expect(wizard.getByTestId("import-r-from-file")).toContainText("RR");
    const strategies = wizard.getByTestId("import-strategies");
    await expect(strategies).toContainText("HTF FVG + CISD → твоя стратегия «HTF FVG + CISD»");
    await expect(strategies.getByRole("checkbox", { name: "Создать стратегию «MALKIS Trades Model»" })).toBeChecked();
    // the user does not want this one: its trade is imported without a strategy
    await strategies.getByText("Создать стратегию «ORDER BLOCK + MSS»").click();
    await wizard.getByTestId("import-next").click(); // -> preview

    const counters = wizard.getByTestId("import-counters");
    await expect(counters.locator('[data-counter="new"]')).toContainText("29");
    await expect(counters.locator('[data-counter="dup"]')).toContainText("0");
    await expect(counters.locator('[data-counter="err"]')).toContainText("0");
    await expect(wizard.getByTestId("import-open-count")).toContainText("1");
    await expect(wizard).not.toContainText("Повтор в файле");
    await wizard.getByTestId("import-confirm").click();
    await expect(wizard).toContainText("Добавлено сделок: 29");
    await wizard.getByRole("button", { name: "Готово" }).click();

    const data = await journal(page);
    const live = data.trades.filter((t: { deletedAt?: string }) => !t.deletedAt);
    expect(live).toHaveLength(29);
    expect(live.filter((t: { status: string }) => t.status === "closed")).toHaveLength(28);
    const sum = live.reduce((s: number, t: { pnlMoney?: number }) => s + (t.pnlMoney ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(10.54);
    const strategyNames = data.strategies.map((s: { name: string }) => s.name).sort();
    expect(strategyNames).toEqual(["HTF FVG + CISD", "MALKIS Trades Model"]);
    expect(live.filter((t: { strategyId?: string }) => t.strategyId === "str_htf")).toHaveLength(8);
    expect(live.find((t: { pnlMoney?: number }) => t.pnlMoney === 383.92).strategyId).toBeNull();

    // the journal shows R and day totals
    const table = page.getByTestId("trades-table");
    await expect(table).toContainText("+2.01 R");
    await expect(table).toContainText("Итог дня");

    // analytics: Winrate and Profit Factor calculated (all-time key metrics)
    await page.getByRole("tab", { name: "Аналитика", exact: true }).first().click();
    const metrics = page.locator("main");
    await expect(metrics).toContainText("Winrate");
    await expect(metrics).toContainText("46.4%");
    await expect(metrics).toContainText("R известен: 28 из 28");
    await expect(metrics).not.toContainText("Winrate\n0%");

    // same file again: nothing new, every row explains why it is a duplicate
    await page.getByRole("tab", { name: "Сделки", exact: true }).first().click();
    wizard = await openWizardWithFile(page, fs.readFileSync(FILE));
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-next").click();
    await expect(wizard.getByTestId("import-counters").locator('[data-counter="new"]')).toContainText("0");
    await expect(wizard.getByTestId("import-counters").locator('[data-counter="dup"]')).toContainText("29");
    await expect(wizard.getByTestId("import-row-status").first()).toContainText("такая же сделка уже есть в журнале");
    await expect(wizard.getByTestId("import-confirm")).toBeDisabled();
  });

  test("without the RR column the table shows money instead of '—', day totals in money, money metrics calculated", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal");
    // drop the RR column from the file
    const noRR = fs
      .readFileSync(FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/^((?:"[^"]*",){11})"[^"]*",/, "$1"))
      .join("\n");
    const wizard = await openWizardWithFile(page, Buffer.from(noRR));
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-confirm").click();
    await wizard.getByRole("button", { name: "Готово" }).click();

    const table = page.getByTestId("trades-table");
    // the result column shows money (ru-RU format) instead of "—"; day totals in money
    await expect(table).toContainText(/\+1\s002,58\s\$/);
    await expect(table).toContainText(/Итог дня: -491,16\s\$/);

    await page.getByRole("tab", { name: "Аналитика", exact: true }).first().click();
    await expect(page.locator("main")).toContainText("R известен: 0 из 28");
    await expect(page.locator("main")).toContainText("46.4%");
  });
});
