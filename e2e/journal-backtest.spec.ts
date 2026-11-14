import { test, expect, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame, totalXp, utcDay } from "./helpers/quests";

// QH-6.1 (docs/quest-hub-qh6-spec.md, 4): the backtest result in the journal — a form that checks the numbers, the
// period and the conclusion, a card with the summary, edit and delete. Nothing is given for it (no XP, no Coins).

const today = utcDay();
const journal = JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans: [], weekPlans: [], noTrades: [], notes: [], strategies: [] });
const CONCLUSION = "Retest of the level works in London and fails in Asia: from now on I trade it only in London.";
const savedJournal = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1") || "{}"));

async function fill(page: Page, v: Record<string, string>) {
  for (const [id, value] of Object.entries(v)) {
    const el = page.getByTestId(id);
    if ((await el.evaluate((e) => e.tagName)) === "SELECT") await el.selectOption(value);
    else await el.fill(value);
  }
}

test.describe("Journal: backtest result (QH-6.1)", () => {
  test.use({ reducedMotion: "reduce" });

  test("the form checks the numbers, the period and the conclusion; a valid result is saved, shown, edited and deleted — with no reward", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, coins: 25, xp: 30 }), { ayra_journal_v1: journal });
    await page.goto("/journal?tab=notes");
    const before = await readGame(page);

    await page.getByTestId("backtest-add").click();
    const modal = page.getByTestId("backtest-modal");
    await expect(modal).toBeVisible();
    // 9 setups that do not add up, a period ending in the future, a short conclusion
    await fill(page, { "bt-instrument": "eurusd", "bt-timeframe": "H1", "bt-from": "2026-01-01", "bt-to": "2099-01-01", "bt-setup": "Retest", "bt-setups": "9", "bt-wins": "5", "bt-losses": "5", "bt-breakeven": "0", "bt-conclusion": "too short" });
    await page.getByTestId("backtest-save").click();
    await expect(page.getByTestId("backtest-errors")).toBeVisible();
    for (const e of ["setupsMin", "sum", "periodFuture", "conclusion"]) await expect(page.getByTestId(`backtest-error-${e}`)).toBeVisible();
    await expect(page.getByTestId("bt-setups")).toHaveAttribute("aria-invalid", "true");
    expect((await savedJournal(page)).notes || []).toHaveLength(0); // nothing saved

    await fill(page, { "bt-to": "2026-06-30", "bt-setups": "20", "bt-wins": "11", "bt-losses": "7", "bt-breakeven": "2", "bt-avgWinR": "1.8", "bt-avgLossR": "-1", "bt-conclusion": CONCLUSION });
    await expect(page.getByTestId("bt-sum")).toContainText("20 из 20");
    await page.getByTestId("backtest-save").click();
    await expect(modal).toBeHidden();

    const card = page.getByTestId("backtest-card");
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("backtest-summary")).toContainText("20 сетапов");
    await expect(card.getByTestId("backtest-summary")).toContainText("55% прибыльных");
    const stored = (await savedJournal(page)).notes[0];
    expect(stored).toMatchObject({ templateKey: "backtest", title: "EURUSD H1", body: CONCLUSION, backtest: { instrument: "EURUSD", setups: 20, wins: 11, losses: 7, breakeven: 2, avgWinR: 1.8, avgLossR: -1 } });

    // no XP, no Coins, no one-time first-note reward for a backtest result
    let g = await readGame(page);
    expect(totalXp(g)).toBe(totalXp(before));
    expect(g.coins).toBe(before.coins);

    // reload: still there; open it: the form shows the saved numbers; edit them
    await page.reload();
    await page.getByTestId("backtest-card").click();
    await expect(page.getByTestId("bt-wins")).toHaveValue("11");
    await fill(page, { "bt-wins": "12", "bt-losses": "6" });
    await page.getByTestId("backtest-save").click();
    await expect(page.getByTestId("backtest-card").getByTestId("backtest-summary")).toContainText("60% прибыльных");
    expect((await savedJournal(page)).notes).toHaveLength(1);

    // delete after a confirmation
    await page.getByTestId("backtest-card").click();
    await page.getByTestId("backtest-delete").click();
    await page.getByTestId("backtest-delete-yes").click();
    await expect(page.getByTestId("backtest-card")).toHaveCount(0);
    g = await readGame(page);
    expect(totalXp(g)).toBe(totalXp(before));
    expect(g.coins).toBe(before.coins);
  });

  test("an old or damaged result does not break the journal: it says so and can be fixed", async ({ context, page }) => {
    const broken = { id: "bt_old", title: "?", body: "An older result saved in a shape this version does not read.", tags: [], pinned: false, templateKey: "backtest", backtest: { instrument: "EURUSD", timeframe: "W9" }, createdAt: `${today}T08:00:00.000Z`, updatedAt: `${today}T08:00:00.000Z`, archivedAt: null };
    const plain = { id: "n_old", body: "A plain note from before QH-6.1 stays as it was.", tags: [], pinned: false, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", archivedAt: null };
    await seedGame(context, baseGame({ lastQuestDate: today }), { ayra_journal_v1: JSON.stringify({ ...JSON.parse(journal), notes: [broken, plain] }) });
    await page.goto("/journal?tab=notes");
    await expect(page.getByTestId("backtest-broken")).toBeVisible();
    await expect(page.getByTestId("note-card")).toHaveCount(1);
    await page.getByTestId("backtest-card").click();
    await expect(page.getByTestId("bt-conclusion")).toHaveValue(broken.body);
    await fill(page, { "bt-instrument": "EURUSD", "bt-timeframe": "H4", "bt-from": "2026-01-01", "bt-to": "2026-03-31", "bt-setup": "Breakout", "bt-setups": "10", "bt-wins": "4", "bt-losses": "6", "bt-breakeven": "0", "bt-conclusion": CONCLUSION });
    await page.getByTestId("backtest-save").click();
    await expect(page.getByTestId("backtest-broken")).toHaveCount(0);
    await expect(page.getByTestId("backtest-summary")).toContainText("40% прибыльных");
  });

  for (const width of [360, 1440]) {
    test(`${width}px: the form and the card fit without sideways scroll; controls are big enough`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await seedGame(context, baseGame({ lastQuestDate: today }), { ayra_journal_v1: journal });
      await page.goto("/journal?tab=notes");
      await page.getByTestId("backtest-add").click();
      await expect(page.getByTestId("backtest-modal")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      for (const id of ["bt-instrument", "bt-timeframe", "bt-setups", "backtest-save"]) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(36);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
    });
  }
});
