import { test, expect } from "@playwright/test";
import { seedJournalV2 } from "./helpers/journal-v2";
import fs from "node:fs";
import path from "node:path";
import { ru } from "../lib/i18n/dictionaries/ru";

test.use({ reducedMotion: "reduce" });

test("J2.1: seven tabs, canonical/legacy URLs, reload, Back/Forward and keyboard", async ({ page }) => {
  await seedJournalV2(page); await page.goto("/journal");
  const tabs = page.locator('[role="tablist"][aria-label="Журнал"]');
  await expect(tabs.getByRole("tab")).toHaveText(["Дешборд", "Сделки", "План", "Заметки", "Отчёты", "Стратегии", "Счета"]);
  await expect(tabs.getByRole("tab", { name: "Дешборд" })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: "Сделки" }).click(); await tabs.getByRole("tab", { name: "Заметки" }).click();
  await page.goBack(); await expect(tabs.getByRole("tab", { name: "Сделки" })).toHaveAttribute("aria-selected", "true");
  await page.goForward(); await expect(tabs.getByRole("tab", { name: "Заметки" })).toHaveAttribute("aria-selected", "true");
  await page.reload(); await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "journal-tab-notes");
  await page.goto("/journal?tab=analytics&keep=1#anchor"); await expect(page).toHaveURL(/tab=dashboard&keep=1#anchor$/);
  const first = tabs.getByRole("tab", { name: "Дешборд" }); await first.focus(); await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Сделки" })).toBeFocused(); await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "Счета" })).toBeFocused(); await page.keyboard.press("Home"); await expect(first).toBeFocused();
});

test("J2.1: filters, account and source records survive real view changes; days expand by keyboard", async ({ page }) => {
  await seedJournalV2(page); await page.goto("/journal?tab=trades");
  const table = page.getByTestId("trades-table"); await expect(table).toContainText("GBPUSD");
  const before = await page.evaluate(() => localStorage.getItem("ayra_journal_v1"));
  await page.getByTestId("filter-account").click(); await page.getByRole("option", { name: "Main USD" }).click();
  await table.getByRole("textbox").fill("EUR"); await table.getByRole("radio", { name: "По дням" }).click();
  await expect(page.getByTestId("trade-day")).toHaveCount(1);
  const summary = page.getByTestId("trade-day").locator("summary"); await expect(summary).toContainText("Сделок: 1");
  await expect(table.getByText("EURUSD", { exact: true })).toHaveCount(0);
  await summary.focus(); await page.keyboard.press("Enter"); await expect(table).toContainText("EURUSD");
  await expect(table).not.toContainText("GBPUSD"); await expect(table).not.toContainText("XAUUSD");
  await table.locator("tbody tr").getByText("EURUSD", { exact: true }).click(); await expect(page.getByTestId("trade-quick-view")).toBeVisible();
  await page.keyboard.press("Escape"); await table.getByRole("radio", { name: "Список" }).click();
  await expect(table.getByRole("textbox")).toHaveValue("EUR"); await expect(page.getByTestId("filter-account")).toContainText("Main USD");
  expect(await page.evaluate(() => localStorage.getItem("ayra_journal_v1"))).toBe(before);
  await table.getByRole("radio", { name: "По дням" }).click(); await page.reload();
  await expect(table.getByRole("radio", { name: "По дням" })).toHaveAttribute("aria-checked", "true");
});

test("J2.1: all eight filters use the same selection in list and days", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-12-10T12:00:00Z"));
  await seedJournalV2(page); await page.goto("/journal?tab=trades");
  const table = page.getByTestId("trades-table"), f = ru.journal.overview.filters, t = ru.journal.tradesTab;
  const filterBar = table.getByRole("group", { name: f.result, exact: true });
  await expect(table).toContainText("EURUSD");
  const before = await page.evaluate(() => localStorage.getItem("ayra_journal_v1"));
  const cases = [
    { name: f.account, option: "Main USD", rows: 3, days: 2 },
    { name: f.instrument, option: "EURUSD", rows: 1, days: 1 },
    { name: f.strategy, option: "Test Strategy", rows: 1, days: 1 },
    { name: f.result, option: t.resultLoss, rows: 1, days: 1 },
    { name: f.mistakes, option: f.withMistakes, rows: 1, days: 1 },
    { name: f.period, option: t.period7d, rows: 0, days: 0 },
    { name: f.direction, option: ru.journal.addTradeModal.directionShort, rows: 1, days: 1 },
    { name: f.screenshots, option: ru.journal.attachments.filterWithScreenshots, rows: 0, days: 0 },
  ];
  for (const c of cases) {
    await filterBar.getByRole("button", { name: c.name, exact: true }).click();
    await page.getByRole("listbox").getByRole("option", { name: c.option, exact: true }).click();
    await expect(table.locator("tbody tr:not(:has(th))")).toHaveCount(c.rows);
    await table.getByRole("radio", { name: "По дням", exact: true }).click();
    await expect(table.getByTestId("trade-day")).toHaveCount(c.days);
    if (!c.rows) await expect(table.getByText(ru.journal.overview.emptyFiltered, { exact: true })).toBeVisible();
    await table.getByRole("radio", { name: "Список", exact: true }).click();
    await filterBar.getByRole("button", { name: f.clearAll, exact: true }).click();
  }
  expect(await page.evaluate(() => localStorage.getItem("ayra_journal_v1"))).toBe(before);
});

for (const lang of ["ru", "en"]) for (const width of [360, 390, 768, 1024, 1440]) {
  test(`J2.1: ${lang} ${width}, responsive layouts and accessible summaries`, async ({ page }) => {
    await seedJournalV2(page, lang); await page.setViewportSize({ width, height: 1000 }); await page.goto("/journal?tab=trades");
    const table = page.getByTestId("trades-table"); await expect(table).toContainText("EURUSD");
    const folder = process.env.AYRA_J21_SCREENS;
    if (folder && [360, 1440].includes(width)) { fs.mkdirSync(folder, { recursive: true }); await page.screenshot({ path: path.join(folder, `${lang}-${width}-list.png`), fullPage: true, animations: "disabled" }); }
    await table.getByRole("radio", { name: lang === "ru" ? "По дням" : "By day", exact: true }).click();
    await expect(table.getByRole("radio", { name: lang === "ru" ? "По дням" : "By day", exact: true })).toHaveAttribute("aria-checked", "true");
    const summary = page.getByTestId("trade-day").first().locator("summary"); await summary.focus(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("trade-day").first()).toContainText("EURUSD");
    if (folder && [360, 1440].includes(width)) await page.screenshot({ path: path.join(folder, `${lang}-${width}-days.png`), fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.keyboard.press("Enter"); await expect(page.getByTestId("trade-day").first()).not.toHaveAttribute("open", "");
  });
}
