import { test, expect, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame } from "./helpers/quests";

// NEW USER ACCEPTANCE — the first game day and its end, with the browser clock (Playwright) — never the system clock.
// A new account right after the onboarding: level 1, nothing earned, no journal.

/** Screenshots for the acceptance report: only when NUA_SHOTS names a folder (never in CI). */
const SHOTS = process.env.NUA_SHOTS;
const log = (label: string, v: unknown) => console.log(`NUA ${label}: ${JSON.stringify(v)}`);
const DAY = "2026-11-16";
const NEXT = "2026-11-17";
type Saved = Awaited<ReturnType<typeof readGame>> & { questDays?: Array<{ day: string; done: Record<string, { at?: string; xp?: number; coins?: number; missionSource?: string }> }>; missionLedger?: { day: string; claims: Record<string, string> } };
const game = (page: Page) => readGame(page) as Promise<Saved>;

test.describe("NEW USER ACCEPTANCE — the first day ends", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });

  test("first mission → snapshot at midnight → History shows the day; nothing invented; nothing paid again", async ({ context, page }) => {
    await page.clock.install({ time: new Date(`${DAY}T08:00:00Z`) });
    // a new account just after the onboarding (the state the onboarding leaves: level 1, nothing else)
    await seedGame(context, baseGame({ createdAt: DAY, lastQuestDate: "", streakShieldsAvailable: 1 }), { ayra_journal_v1: JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans: [], weekPlans: [], noTrades: [], notes: [] }) });
    await page.goto("/quests?tab=history");
    await expect(page.getByTestId("hub-panel")).toBeVisible();
    await page.waitForTimeout(800);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d-10-history-new-390.png`, fullPage: true });
    // no made-up activity: no snapshot days and no completed quests yet — the page says so
    await expect(page.getByTestId("hub-panel")).toContainText("появится после первого дня со снимком");

    // Home of a new account: the first-day greeting, the missions with their real reward, a row leads to its form
    await page.goto("/");
    await expect(page.getByText("QuestTrader, твой путь начинается")).toBeVisible();
    const risk = page.getByRole("button", { name: /Контроль риска/ });
    await expect(risk).toContainText("+40 XP · +10 Coins");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d-05-home-new-390.png`, fullPage: true });
    // QH-6.6: a mission not accepted yet leads to Quests, where it is accepted
    await risk.click();
    await page.waitForURL((u) => u.pathname === "/quests");
    await page.getByTestId("quest-card-q_bias").getByTestId("quest-accept").click();
    await expect(page.getByTestId("quest-card-q_bias").getByTestId("quest-status")).toHaveText("В процессе");
    // «Go to the Journal» opens the direction block
    await page.getByTestId("quest-card-q_bias").getByTestId("quest-journal-link").click();
    await page.waitForURL((u) => u.pathname === "/journal" && u.searchParams.get("tab") === "plan");
    await expect(page.locator("#plan-bias")).toBeVisible();

    // the first mission through the Journal
    await page.locator("#plan-bias").getByRole("button", { name: /Добавить/ }).click();
    await page.locator("#plan-bias input").first().fill("EURUSD");
    await page.locator("#plan-bias").getByRole("button", { name: /Бычий/ }).click();
    await page.locator("#plan-levels").getByRole("button", { name: /Добавить/ }).click();
    await page.locator('#plan-levels input[type="number"]').first().fill("1.0832");
    await page.clock.runFor(2000);
    // saved: the quest is ready; «Verify» pays it
    await expect(page.getByTestId("quest-ready-bar")).toBeVisible();
    expect((await game(page)).completedQuestsToday.q_bias).toBeUndefined();
    await page.getByTestId("quest-ready-verify").click();
    await expect.poll(async () => (await game(page)).completedQuestsToday.q_bias, { timeout: 15000 }).toBe(true);
    const paid = await game(page);
    log("day 1 paid", { xp: paid.xp, coins: paid.coins, history: paid.history.map((h) => `${h.questId}:${h.xp}/${h.coins}`), ledger: paid.missionLedger });

    // midnight passes while the tab is open
    await page.clock.fastForward("16:30:00"); // 08:00 → 00:30 next day
    await page.clock.runFor(70_000);
    await expect.poll(async () => (await game(page)).lastQuestDate, { timeout: 15000 }).toBe(NEXT);
    const next = await game(page);
    const snap = next.questDays?.find((d) => d.day === DAY);
    log("snapshot of day 1", snap ? { done: snap.done } : null);
    expect(snap?.done.q_bias).toMatchObject({ xp: 40, coins: 10, missionSource: `plan:${DAY}:prep` });
    // yesterday's plan pays nothing today (no retroactive reward), the new day starts with an empty ledger
    await page.goto("/quests");
    await page.waitForTimeout(1500);
    const day2 = await game(page);
    expect(day2.completedQuestsToday.q_bias).toBeUndefined();
    expect(day2.coins).toBe(paid.coins);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d-20-quests-day2-390.png`, fullPage: true });
    await page.goto(`/quests?tab=history&day=${DAY}`);
    await page.waitForTimeout(800);
    await expect(page.getByTestId("day-panel")).toContainText("Подготовка");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d-21-history-day1-390.png`, fullPage: true });
  });
});
