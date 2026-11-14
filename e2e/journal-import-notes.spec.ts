import { test, expect, type Page } from "@playwright/test";

// Notes and backtest results from an AYRA JSON file (import wizard): no reward, no duplicates on a second import, a
// note already in the journal is never replaced, «undo» removes exactly the imported notes.

const NOTE_MINE = { id: "n_mine", body: "My newer text of this note, edited on this device.", tags: [], pinned: false, createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-10T10:00:00.000Z", archivedAt: null };
const file = {
  app: "ayra",
  kind: "journalBackup",
  exportVersion: "1.3",
  exportedAt: "2026-11-05T10:00:00.000Z",
  journal: {
    accounts: [],
    trades: [],
    notes: [
      { ...NOTE_MINE, body: "An older copy of my note from a backup file.", updatedAt: "2026-11-02T10:00:00.000Z" },
      { id: "n_lesson", body: "Lesson: do not enter before the candle closes at the level.", tags: ["lesson"], pinned: false, templateKey: "lesson", createdAt: "2026-11-03T09:00:00.000Z", updatedAt: "2026-11-03T09:00:00.000Z", archivedAt: null },
      {
        id: "n_bt",
        title: "EURUSD H1",
        body: "Retest works in London and fails in Asia: I keep it for London only from now on.",
        tags: [],
        pinned: false,
        templateKey: "backtest",
        backtest: { instrument: "EURUSD", timeframe: "H1", periodFrom: "2026-01-01", periodTo: "2026-06-30", setup: "Retest", strategyId: null, setups: 20, wins: 11, losses: 7, breakeven: 2, avgWinR: 1.8, avgLossR: -1 },
        createdAt: "2026-11-04T09:00:00.000Z",
        updatedAt: "2026-11-04T09:00:00.000Z",
        archivedAt: null,
      },
    ],
  },
};

async function seed(page: Page) {
  await page.addInitScript((mine) => {
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    localStorage.clear();
    localStorage.setItem("ayra_guest_dismissed", "1");
    localStorage.setItem("ayra_lang", "ru");
    localStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "TraderOne", xp: 40, coins: 70, level: 2, onboarding: { status: "done", step: 5, answers: { nickname: "TraderOne" } }, profile: { timezone: "UTC" } }));
    localStorage.setItem(
      "ayra_journal_v1",
      JSON.stringify({ schemaVersion: 6, accounts: [{ id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00.000Z" }], trades: [], notes: [mine] })
    );
  }, NOTE_MINE);
}

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1") || "{}"));
const game = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}"));

async function toPreview(page: Page) {
  await page.getByTestId("journal-import").click();
  const wizard = page.getByTestId("import-wizard");
  await wizard.getByTestId("import-next").click();
  await wizard.getByTestId("import-file-input").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(wizard).toContainText("Формат: AYRA JSON");
  await wizard.getByTestId("import-next").click();
  await wizard.getByTestId("import-next").click();
  await wizard.getByTestId("import-next").click();
  return wizard;
}

test.describe("Journal: notes from AYRA JSON", () => {
  test.use({ reducedMotion: "reduce" });

  test("notes and a backtest result come in with no reward; a newer local note is kept; a second import adds nothing; undo removes them", async ({ page }) => {
    await seed(page);
    await page.goto("/journal");
    const before = await game(page);

    let wizard = await toPreview(page);
    const summary = wizard.getByTestId("import-notes-summary");
    await expect(summary).toContainText("В файле заметок: 3, из них результатов бэктеста: 1");
    await expect(summary).toContainText("Будет добавлено: 2; уже есть в Журнале: 1");
    await expect(wizard.getByTestId("import-notes")).toContainText("не засчитываются в миссии");
    await expect(wizard.getByTestId("import-confirm")).toHaveText("Импортировать заметки: 2");
    await wizard.getByTestId("import-confirm").click();

    let j = await stored(page);
    const live = j.notes.filter((n: { deletedAt?: string }) => !n.deletedAt);
    expect(live.map((n: { id: string }) => n.id).sort()).toEqual(["n_bt", "n_lesson", "n_mine"]);
    expect(live.find((n: { id: string }) => n.id === "n_mine").body).toBe(NOTE_MINE.body);
    const btNote = live.find((n: { id: string }) => n.id === "n_bt");
    expect(btNote.backtest).toMatchObject({ setups: 20, wins: 11 });
    expect(btNote.importBatchId).toBeTruthy();
    expect(btNote.updatedAt).toBe("2026-11-04T09:00:00.000Z"); // the file's date, not «now»
    let g = await game(page);
    expect({ xp: g.xp, coins: g.coins, level: g.level }).toEqual({ xp: before.xp, coins: before.coins, level: before.level });
    expect(g.firstActions?.note).toBeUndefined();

    // the result shows in Notes as a backtest card
    await page.keyboard.press("Escape");
    await page.goto("/journal?tab=notes");
    await expect(page.getByTestId("backtest-card")).toHaveCount(1);

    // the same file again: nothing to add
    wizard = await toPreview(page);
    await expect(wizard.getByTestId("import-notes-summary")).toContainText("Будет добавлено: 0; уже есть в Журнале: 3");
    await expect(wizard.getByTestId("import-confirm")).toBeDisabled();
    await page.keyboard.press("Escape");

    // undo the first import (from the import history): exactly the two imported notes go
    await page.getByTestId("journal-import").click();
    const history = page.getByTestId("import-wizard");
    await expect(history).toContainText("заметок: 2");
    await history.getByRole("button", { name: "Отменить импорт" }).first().click();
    await page.getByRole("button", { name: "Удалить записи импорта" }).click();
    await expect.poll(async () => (await stored(page)).notes.filter((n: { deletedAt?: string }) => !n.deletedAt).map((n: { id: string }) => n.id)).toEqual(["n_mine"]);
    g = await game(page);
    expect({ xp: g.xp, coins: g.coins }).toEqual({ xp: before.xp, coins: before.coins });
    j = await stored(page);
    expect(j.notes.find((n: { id: string }) => n.id === "n_mine").body).toBe(NOTE_MINE.body);
  });
});
