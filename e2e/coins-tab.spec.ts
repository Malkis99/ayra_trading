import { test, expect, type Page } from "@playwright/test";
import { GAME_CONFIG } from "../lib/game-config";

// «Coins» tab in the profile (docs/economy-coins-plan.md, section 3): balance, how to earn, history since it is kept,
// filter by type. 1440 and 360 wide.

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
  test(`${size.name}: balance, how to earn, history of credits with a filter and the «kept since» note`, async ({ page }) => {
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

    // how to earn: the real amounts; first actions: trade received, account existed before
    const how = page.getByTestId("coins-how");
    await expect(how).toContainText(GAME_CONFIG.DAILY_REWARD_VALUES.map((v) => `+${v}`).join(" · "));
    await expect(how).toContainText(`Не больше ${GAME_CONFIG.DAILY_COIN_CAP} монет в день`);
    await expect(page.locator('[data-kind="trade"]')).toHaveAttribute("data-status", "got");
    await expect(page.locator('[data-kind="account"]')).toHaveAttribute("data-status", "past");
    await expect(page.locator('[data-kind="note"]')).toContainText(`+${GAME_CONFIG.FIRST_ACTION_REWARDS.note.coins}`);

    // history: two credits, newest first; the 40 coins from before are not listed (the note says so)
    const items = page.getByTestId("coins-history-item");
    await expect(items).toHaveCount(2);
    await expect(page.getByTestId("coins-history-since")).toContainText("Более ранние начисления в ней не показаны");
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
