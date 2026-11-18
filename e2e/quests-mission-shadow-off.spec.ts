import { test, expect } from "@playwright/test";
import { activateMode, baseGame, readGame, seedGame, utcDay } from "./helpers/quests";

// Q4.2 shadow mission check, as production ships it: switched OFF. «Verify» works exactly as before (QH-6.6), the app
// sends nothing to the server, and the route itself answers 404. (With the switch on it is tested in e2e-supabase.)

const yesterday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
})();
const journal = (over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans: [], weekPlans: [], noTrades: [], notes: [], ...over });

test.describe("Q4.2 shadow check switched off (mock auth)", () => {
  test.use({ reducedMotion: "reduce" });

  test("«Verify» pays as before, no request goes to the shadow route, the route is closed", async ({ context, page }) => {
    const lesson = { id: "n1", templateKey: "lesson", title: "", body: "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.", tags: [], pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archivedAt: null };
    await seedGame(context, baseGame({ lastQuestDate: yesterday, journalFirstTradeDay: null }), { ayra_journal_v1: journal({ notes: [lesson] }) });
    const shadowCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/game/missions/shadow")) shadowCalls.push(r.url());
    });
    await page.goto("/quests");
    await activateMode(page, "study");
    const card = page.getByTestId("quest-card-m_lesson");
    await card.getByTestId("quest-accept").click();
    await expect(card).toHaveAttribute("data-quest", "ready");
    const before = await readGame(page);
    await card.getByTestId("quest-verify").click();
    await expect(card).toHaveAttribute("data-done", "true");
    const after = await readGame(page);
    expect(after.coins - before.coins).toBe(10);
    await page.waitForTimeout(1000);
    expect(shadowCalls).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __ayraMissionShadow?: unknown }).__ayraMissionShadow)).toBeUndefined();
    const closed = await page.evaluate(async () => (await fetch("/api/game/missions/shadow", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status);
    expect(closed).toBe(404);
  });
});
