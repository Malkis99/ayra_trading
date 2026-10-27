import { test, expect, type Page } from "@playwright/test";
import { GAME_CONFIG } from "../lib/game-config";

// «Coins» tab in the profile: only the balance (with a «?» hint) and the history of credits with a filter by type and
// a one-line «kept since» (owner decision 2026-10-27). 1440 and 360 wide.

const TODAY = new Date().toISOString().slice(0, 10);

// Seeded before the app starts (a page that unloads writes its own state back over a seed made afterwards)
async function seed(page: Page) {
  await page.addInitScript((today) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({
        name: "CoinsTrader",
        level: 1,
        xp: 0,
        coins: 40, // earned before the history was kept
        createdAt: "2026-10-08",
        completedQuestsToday: {},
        lastQuestDate: today,
        onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
        profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: false, timezone: "UTC" },
      })
    );
    localStorage.setItem(
      "ayra_journal_v1",
      JSON.stringify({
        schemaVersion: 6,
        accounts: [{ id: "acc_1", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-10-08T00:00:00.000Z" }],
        trades: [],
      })
    );
  }, TODAY);
}

for (const size of [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "360", viewport: { width: 360, height: 800 } },
]) {
  test(`${size.name}: balance with a «?» hint, history of credits with a filter and a one-line «kept since»`, async ({ page }) => {
    await page.setViewportSize(size.viewport);
    await seed(page);

    // the first trade: one-time reward + the daily quest «Trade log» (closed by the app)
    await page.goto("/journal");
    await page.getByRole("button", { name: "Добавить сделку" }).first().click();
    const drawer = page.getByTestId("add-trade-drawer");
    await page.getByTestId("instrument-input").fill("us30");
    await page.fill("input[placeholder='150 / -50']", "40");
    await page.getByTestId("instrument-input").press("Control+Enter");
    await expect(drawer).toBeHidden();

    await page.goto("/profile?tab=coins");
    const firstTrade = GAME_CONFIG.FIRST_ACTION_REWARDS.trade.coins;
    await expect(page.getByTestId("coins-balance-value")).toHaveText(String(40 + firstTrade + GAME_CONFIG.QUEST_COINS));

    // only the balance and the history: no «how to earn» and no notes (they wait in docs/faq-coins-draft.md)
    await expect(page.getByText("Как получить")).toHaveCount(0);
    await expect(page.getByText(/монет в день/)).toHaveCount(0);
    // the «?» next to the balance tells where coins are kept
    const hint = page.getByTestId("coins-balance-hint");
    await expect(page.getByText("Монеты пока хранятся на этом устройстве")).toBeHidden();
    await hint.click();
    await expect(page.getByText("Монеты пока хранятся на этом устройстве")).toBeVisible();
    await hint.click();

    // history: two credits, newest first; the 40 coins from before are not listed (the note says so)
    const items = page.getByTestId("coins-history-item");
    await expect(items).toHaveCount(2);
    await expect(page.getByTestId("coins-history-since")).toHaveText(/^История ведётся с \d{1,2} \S+ \d{4}/);
    await expect(items.filter({ hasText: "Впервые: сделка" })).toContainText(`+${firstTrade}`);
    await expect(items.filter({ hasText: "Задание:" })).toContainText(`+${GAME_CONFIG.QUEST_COINS}`);

    // filter by type
    await page.getByRole("radio", { name: "Первые действия" }).click();
    await expect(items).toHaveCount(1);
    await page.getByRole("radio", { name: "Ежедневная" }).click();
    await expect(items).toHaveCount(0);
    await expect(page.getByText("Начислений пока нет")).toBeVisible();

    // no horizontal scroll on the page
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
