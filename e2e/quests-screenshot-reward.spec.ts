import { test, expect, type Page } from "@playwright/test";
import { openTradeSection } from "./helpers/forms";
import { solidPng } from "./helpers/png";
import { baseGame, readGame, seedGame, totalXp, utcDay } from "./helpers/quests";

// Screenshot XP goes through the shared locked game change (docs/quests-2.0-plan.md, 4.1, owner decision 0.13): same
// rate and limits, the same picture never twice, no double reward from two tabs, the journal data is not touched.

const today = utcDay();
const journal = JSON.stringify({
  schemaVersion: 6,
  accounts: [{ id: "acc_1", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-10-08T00:00:00.000Z" }],
  trades: [],
});

async function openDrawerWithShot(page: Page, png: Buffer, name: string) {
  await page.goto("/journal");
  await page.getByRole("button", { name: "Добавить сделку" }).first().click();
  await expect(page.getByTestId("add-trade-drawer")).toBeVisible();
  await page.getByTestId("instrument-input").fill("EURUSD");
  await page.fill("input[placeholder='150 / -50']", "40");
  await openTradeSection(page, "Скриншоты");
  await page.locator("input[type='file'][accept='image/*']").setInputFiles({ name, mimeType: "image/png", buffer: png });
  await expect(page.locator(".aspect-video").first()).toBeVisible();
}

test.describe("Screenshot XP (shared protected change)", () => {
  test.use({ reducedMotion: "reduce" });

  test("one screenshot gives XP once; the same picture again gives nothing; the trade is saved as usual", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }), { ayra_journal_v1: journal });
    const png = solidPng(640, 400, [20, 120, 200]);
    await page.goto("/quests");
    const before = totalXp(await readGame(page));
    await openDrawerWithShot(page, png, "shot.png");
    // screenshot XP 10 + the existing one-time «first screenshot» reward 10 (GAME_CONFIG.FIRST_ACTION_REWARDS), once
    await expect.poll(async () => totalXp(await readGame(page)) - before).toBe(20);
    const hashes = (await readGame(page)).rewardedScreenshotHashes || [];
    expect(hashes).toHaveLength(1);
    await page.getByTestId("instrument-input").press("Control+Enter");
    await expect(page.getByTestId("add-trade-drawer")).toBeHidden();
    // the trade and its screenshot are in the journal
    const trades = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1") || "{}").trades || []);
    expect(trades).toHaveLength(1);
    expect((trades[0].attachmentIds || []).length).toBe(1);

    const afterFirst = totalXp(await readGame(page));
    await openDrawerWithShot(page, png, "same.png");
    await page.waitForTimeout(500);
    expect((await readGame(page)).rewardedScreenshotHashes).toEqual(hashes);
    // no screenshot XP again (the trade itself may still give its own journal XP after saving)
    expect(totalXp(await readGame(page))).toBe(afterFirst);
  });

  test("two tabs adding screenshots stay within the daily limit, and neither loses the other's change", async ({ context }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }), { ayra_journal_v1: journal });
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto("/quests");
    await b.goto("/quests");
    const before = totalXp(await readGame(a));
    await Promise.all([
      openDrawerWithShot(a, solidPng(640, 400, [200, 40, 40]), "a.png"),
      openDrawerWithShot(b, solidPng(640, 400, [40, 200, 40]), "b.png"),
    ]);
    await a.waitForTimeout(800);
    const g = await readGame(a);
    // SCREENSHOT_DAILY_XP_CAP is 1: one screenshot XP (10) for the day in total, plus the one-time first-screenshot reward (10)
    expect(totalXp(g) - before).toBe(20);
    expect((g.rewardedScreenshotHashes || []).length).toBe(1);
  });
});
