import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const FIX = path.join(process.cwd(), "lib/journal/import/__fixtures__");

async function seed(page: Page, trades: unknown[] = []) {
  await page.addInitScript((list) => {
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
        schemaVersion: 5,
        accounts: [{ id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00.000Z" }],
        trades: list,
      })
    );
  }, trades);
}

const journalTrades = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1")!).trades as Array<Record<string, unknown>>);

async function importFile(page: Page, file: string) {
  await page.getByTestId("journal-import").click();
  const wizard = page.getByTestId("import-wizard");
  await expect(wizard).toBeVisible();
  await wizard.getByTestId("import-next").click(); // source: auto
  await wizard.getByTestId("import-file-input").setInputFiles(path.join(FIX, file));
  await expect(wizard.getByTestId("import-file-summary")).toBeVisible();
  return wizard;
}

test.describe("Journal tabs", () => {
  test.use({ reducedMotion: "reduce" });

  test("desktop: all tabs in one row, no 'More' menu", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal");
    const tabs = page.getByRole("tablist", { name: "Журнал" }).getByRole("tab");
    await expect(tabs).toHaveText(["Сделки", "Аналитика", "План", "Отчёты", "Стратегии", "Счета", "Заметки"]);
    const boxes = await tabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
    await expect(page.getByRole("tab", { name: /Ещё/ })).toHaveCount(0);
  });

  test("360px: the row scrolls, the active tab is scrolled into view, edge hint shown", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed(page);
    await page.goto("/journal?tab=notes");
    const list = page.getByRole("tablist", { name: "Журнал" });
    const active = list.getByRole("tab", { name: "Заметки" });
    await expect(active).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => {
        const [l, a] = await Promise.all([list.boundingBox(), active.boundingBox()]);
        return a!.x >= l!.x - 1 && a!.x + a!.width <= l!.x + l!.width + 1;
      })
      .toBe(true);
    const sizes = await list.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(sizes.sw).toBeGreaterThan(sizes.cw);
    await expect(page.locator('[data-edge="left"]').first()).toHaveClass(/opacity-100/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("Import", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

  test("universal CSV: manual mapping, row errors, import, idempotent re-import, undo", async ({ page }) => {
    await seed(page);
    await page.goto("/journal");
    let wizard = await importFile(page, "universal.csv");
    await expect(wizard).toContainText("Формат не узнан");
    await wizard.getByTestId("import-next").click(); // → mapping
    await expect(wizard.getByTestId("map-instrument")).toContainText("Инструмент");
    await expect(wizard.getByTestId("map-openedAt")).toContainText("Время открытия");
    await wizard.getByTestId("import-next").click(); // → settings
    await wizard.getByTestId("import-next").click(); // → preview
    const counters = wizard.getByTestId("import-counters");
    await expect(counters.locator('[data-counter="new"]')).toContainText("1");
    await expect(counters.locator('[data-counter="err"]')).toContainText("2");
    await expect(wizard.getByTestId("import-errors")).toContainText("Строка 3: нет инструмента");
    await expect(wizard.getByTestId("import-errors")).toContainText("Строка 4: не удалось прочитать дату");
    await wizard.getByTestId("import-confirm").click();
    await expect(wizard).toContainText("Добавлено сделок: 1");
    await wizard.getByRole("button", { name: "Готово" }).click();

    let saved = await journalTrades(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ instrument: "EURUSD", direction: "long", pnlMoney: 18.5, rMultiple: 2, source: "import", verification: "imported" });
    await expect(page.getByTestId("trades-table")).toContainText("EURUSD");

    // Same file again: nothing new (idempotent); mapping is remembered
    wizard = await importFile(page, "universal.csv");
    await wizard.getByTestId("import-next").click();
    await expect(wizard).toContainText("Сопоставление для такого файла запомнено");
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-next").click();
    await expect(wizard.getByTestId("import-counters").locator('[data-counter="dup"]')).toContainText("1");
    await expect(wizard.getByTestId("import-confirm")).toBeDisabled();
    await wizard.getByRole("button", { name: "Назад" }).click();
    await wizard.getByRole("button", { name: "Назад" }).click();
    await wizard.getByRole("button", { name: "Назад" }).click();
    await wizard.getByRole("button", { name: "Назад" }).click();

    // Undo from the history list
    await wizard.getByRole("button", { name: "Отменить импорт" }).click();
    await page.getByRole("dialog", { name: /Отменить импорт/ }).getByRole("button", { name: "Удалить сделки импорта" }).click();
    saved = await journalTrades(page);
    expect(saved).toHaveLength(0);
  });

  test("documented-only platforms are marked beta; import says it gives no XP and really gives none", async ({ page }) => {
    await seed(page);
    await page.goto("/journal");
    const xpBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}").xp ?? 0);
    await page.getByTestId("journal-import").click();
    const wizard = page.getByTestId("import-wizard");
    await expect(wizard.getByTestId("import-no-xp")).toContainText("Импортированные сделки не дают XP и монет");
    const card = (name: string) => wizard.getByRole("radio", { name: new RegExp(`^${name}`) });
    await expect(card("MetaTrader 4").getByTestId("import-beta")).toHaveText(/бета/);
    await expect(card("Binance").getByTestId("import-beta")).toBeVisible();
    await expect(card("CSV / XLSX").getByTestId("import-beta")).toHaveCount(0);
    await expect(card("AYRA JSON").getByTestId("import-beta")).toHaveCount(0);
    await page.keyboard.press("Escape");

    const w = await importFile(page, "mt4.html");
    await expect(w).toContainText("Формат: MetaTrader 4 (бета)");
    await w.getByTestId("import-next").click();
    await w.getByTestId("import-next").click();
    await w.getByTestId("import-next").click();
    await expect(w).toContainText("Импортированные сделки не дают XP и монет");
    await w.getByTestId("import-confirm").click();
    await expect(w).toContainText("Добавлено сделок: 2");
    const xpAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}").xp ?? 0);
    expect(xpAfter).toBe(xpBefore);
  });

  test("MetaTrader 4 HTML report is detected automatically; undo right after import", async ({ page }) => {
    await seed(page);
    await page.goto("/journal");
    const wizard = await importFile(page, "mt4.html");
    await expect(wizard).toContainText("Формат: MetaTrader 4");
    await wizard.getByTestId("import-next").click();
    await expect(wizard).toContainText("Колонки MetaTrader 4 сопоставлены автоматически");
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-next").click();
    await expect(wizard.getByTestId("import-counters").locator('[data-counter="new"]')).toContainText("2");
    await wizard.getByTestId("import-confirm").click();
    await expect(wizard).toContainText("Добавлено сделок: 2");
    expect((await journalTrades(page)).map((t) => t.pnlMoney)).toEqual([291.5, -253.5]);
    await wizard.getByRole("button", { name: "Отменить импорт" }).click();
    await page.getByRole("button", { name: "Удалить сделки импорта" }).click();
    await expect(wizard).toBeHidden();
    expect(await journalTrades(page)).toHaveLength(0);
  });

  test("too large / empty files show a clear error", async ({ page }) => {
    await seed(page);
    await page.goto("/journal");
    await page.getByTestId("journal-import").click();
    const wizard = page.getByTestId("import-wizard");
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-file-input").setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("") });
    await expect(wizard.getByRole("alert")).toContainText("Файл пустой");
    await expect(wizard.getByTestId("import-next")).toBeDisabled();
  });
});

test.describe("Export", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

  const trade = (id: string, instrument: string, pnl: number, day: number) => ({
    id,
    accountId: "acc_main",
    instrument,
    direction: "long",
    status: "closed",
    openedAt: `2026-03-0${day}T10:00:00.000Z`,
    closedAt: `2026-03-0${day}T11:00:00.000Z`,
    entryPrice: 1.1,
    exitPrice: 1.2,
    pnlMoney: pnl,
    rMultiple: pnl / 100,
    result: pnl > 0 ? "win" : "loss",
    emotions: [],
    mistakes: [],
    verification: "unverified",
    source: "manual",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    schemaVersion: 3,
    notes: "=cmd",
  });

  test("CSV with BOM, injection guard and the table filter scope", async ({ page }) => {
    await seed(page, [trade("t1", "EURUSD", 120, 2), trade("t2", "XAUUSD", -50, 3)]);
    await page.goto("/journal");
    await page.getByTestId("filter-result").click();
    await page.getByRole("listbox").getByRole("option", { name: "Победа" }).click();
    await page.getByTestId("journal-export").click();
    const dialog = page.getByTestId("export-dialog");
    await dialog.getByRole("radio", { name: "Как в таблице" }).click();
    await expect(dialog.getByTestId("export-count")).toContainText("1");
    await dialog.getByRole("checkbox", { name: "Включить заметки и чек-лист правил" }).check();
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("export-download").click()]);
    expect(download.suggestedFilename()).toMatch(/^ayra-trades-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = fs.readFileSync((await download.path())!, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Дата входа,Дата выхода,Счёт,Инструмент");
    expect(text).toContain("EURUSD");
    expect(text).not.toContain("XAUUSD");
    expect(text).toContain("'=cmd");
  });

  test("JSON round trip: exported file imported back is recognised as duplicates", async ({ page }) => {
    await seed(page, [trade("t1", "EURUSD", 120, 2), trade("t2", "XAUUSD", -50, 3)]);
    await page.goto("/journal");
    await page.getByTestId("journal-export").click();
    const dialog = page.getByTestId("export-dialog");
    await dialog.getByRole("radio", { name: "JSON AYRA" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("export-download").click()]);
    const file = (await download.path())!;
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ app: "ayra", kind: "trades", exportVersion: "1.2" });

    await page.getByTestId("journal-import").click();
    const wizard = page.getByTestId("import-wizard");
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-file-input").setInputFiles({ name: "back.json", mimeType: "application/json", buffer: fs.readFileSync(file) });
    await expect(wizard).toContainText("Формат: AYRA JSON");
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-next").click();
    await wizard.getByTestId("import-next").click();
    await expect(wizard.getByTestId("import-counters").locator('[data-counter="dup"]')).toContainText("2");
    await expect(wizard.getByTestId("import-confirm")).toBeDisabled();
  });

  test("360px: wizard is a bottom sheet", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed(page);
    await page.goto("/journal");
    await page.getByTestId("journal-import").click();
    const box = (await page.getByTestId("import-wizard").boundingBox())!;
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(360);
    expect(Math.round(box.y + box.height)).toBe(740);
  });
});
