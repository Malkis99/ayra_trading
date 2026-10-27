import { test, expect, type Page } from "@playwright/test";

// Owner's report 2026-10-27: saving an edited trade gave +10 coins. Rules now: an edit, a save, «Undo» give nothing;
// the first action of a kind on the account gives a one-time reward; self-reported quests give XP only; coins from
// quests and the daily reward have a daily cap; putting the device clock back gives nothing.

type Game = { lastSeenAt?: number; coins: number; xp: number; level: number; firstActions?: Record<string, string>; completedQuestsToday: Record<string, boolean> };
const game = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}")) as Promise<Game>;

const TODAY = new Date().toISOString().slice(0, 10);

async function seed(page: Page, opts: { trades?: unknown[]; lastSeenAt?: number } = {}) {
  await page.goto("/");
  await page.evaluate(
    ({ trades, lastSeenAt, today }) => {
      localStorage.clear();
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "EconomyTrader",
          level: 1,
          xp: 0,
          coins: 0,
          createdAt: "2026-10-08",
          completedQuestsToday: {},
          lastQuestDate: today,
          onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
          profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: false, timezone: "UTC" },
          ...(lastSeenAt ? { lastSeenAt } : {}),
        })
      );
      localStorage.setItem(
        "ayra_journal_v1",
        JSON.stringify({
          schemaVersion: 6,
          accounts: [{ id: "acc_1", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-10-08T00:00:00.000Z" }],
          trades,
        })
      );
    },
    { trades: opts.trades ?? [], lastSeenAt: opts.lastSeenAt, today: TODAY }
  );
}

const oldTrade = {
  id: "tr_old",
  accountId: "acc_1",
  instrument: "US30",
  direction: "long",
  status: "closed",
  openedAt: "2026-10-20T09:00:00.000Z",
  result: "win",
  pnlMoney: 40,
  emotions: [],
  mistakes: [],
  verification: "unverified",
  source: "manual",
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-20T09:00:00.000Z",
  attachmentIds: [],
};

async function addTrade(page: Page, instrument: string) {
  await page.goto("/journal");
  await page.getByRole("button", { name: "Добавить сделку" }).first().click();
  const drawer = page.getByTestId("add-trade-drawer");
  await expect(drawer).toBeVisible();
  await page.getByTestId("instrument-input").fill(instrument);
  await page.fill("input[placeholder='150 / -50']", "40");
  await page.getByTestId("instrument-input").press("Control+Enter");
  await expect(drawer).toBeHidden();
}

test.describe("Rewards: only new actions, once per account", () => {
  test.use({ reducedMotion: "reduce" });

  test("editing and saving an existing trade gives no coins, no XP and closes no quest", async ({ page }) => {
    await seed(page, { trades: [oldTrade] });
    await page.goto("/journal");
    await page.click("tr:has-text('US30')");
    await page.click("button:has-text('Редактировать')");
    await expect(page.getByTestId("instrument-input")).toHaveValue("US30");
    await page.getByTestId("instrument-input").fill("nas100");
    await page.click("button:has-text('Сохранить сделку')");
    await expect(page.getByTestId("trades-table")).toContainText("NAS100");
    const g = await game(page);
    expect(g.coins).toBe(0);
    expect(g.xp).toBe(0);
    expect(g.completedQuestsToday.q_tradelog).toBeFalsy();
  });

  test("the first trade of the account gives its one-time reward once; deleted and added again — no second time", async ({ page }) => {
    await seed(page);
    await addTrade(page, "us30");
    const first = await game(page);
    // first trade 20 + the quest «Trade log» 10 (placeholders and quest values of game-config)
    expect(first.firstActions?.trade).toBeTruthy();
    expect(first.coins).toBe(30);
    await expect(page.getByText(/Впервые: сделка/)).toBeVisible();

    // delete it and add another one: not the first any more (the deleted one is still in the journal)
    await page.click("tr:has-text('US30')");
    await page.click("button:has-text('Удалить')");
    await page.locator("button:has-text('Удалить')").first().click();
    await addTrade(page, "ger40");
    const again = await game(page);
    expect(again.coins).toBe(first.coins);
  });

  test("a self-reported quest gives XP, no coins; the quests the app checks have no «Complete» button", async ({ page }) => {
    await seed(page);
    await page.goto("/quests");
    const before = await game(page);
    const buttons = page.getByRole("button", { name: "Выполнить" });
    await expect(buttons.first()).toBeVisible();
    await buttons.first().click();
    await expect.poll(async () => (await game(page)).xp).toBeGreaterThan(before.xp);
    expect((await game(page)).coins).toBe(before.coins);
    // a quest the app closes by itself shows that instead of a button
    for (const hint of await page.getByTestId("quest-auto-closes").all()) await expect(hint).toHaveText("Закроется само по журналу");
  });

  test("clock put back: the daily reward gives nothing until real time catches up", async ({ page }) => {
    await seed(page);
    // before the app starts (a page that unloads writes its own state back): this device has seen a time 2 days ahead
    await page.addInitScript((at) => {
      if (sessionStorage.getItem("seeded_clock")) return;
      sessionStorage.setItem("seeded_clock", "1");
      const s = JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}");
      localStorage.setItem("ayra_demo_v1", JSON.stringify({ ...s, lastSeenAt: at, coins: 0 }));
    }, Date.now() + 2 * 24 * 3600 * 1000);
    await page.goto("/");
    expect((await game(page)).lastSeenAt).toBeGreaterThan(Date.now());
    const claim = page.getByRole("button", { name: "Забрать награду" });
    await expect(claim).toBeVisible();
    await claim.click();
    await page.waitForTimeout(500);
    expect((await game(page)).coins).toBe(0);
  });
});
