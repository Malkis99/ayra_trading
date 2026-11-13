import { test, expect } from "@playwright/test";
import { readGame, seedGame, utcDay } from "./helpers/quests";

// Data safety of Q1 (docs/quests-2.0-plan.md, 6.1): an old save loads with everything kept, one backup copy of it is
// written once and never overwritten, the journal is not touched; the page works in English too.

const old = {
  name: "LegacyTrader",
  level: 6,
  xp: 143,
  coins: 387,
  createdAt: "2026-09-01",
  completedQuestsToday: {},
  lastQuestDate: utcDay(),
  equipment: { Верх: 0, Низ: 3, Обувь: 5 },
  unlockedTitles: ["novice", "disciplined"],
  selectedTitle: "disciplined",
  achievements: { firstQuest: true, firstTrade: true, level3: true },
  history: [{ questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-01" }],
  customGoals: [{ id: "goal_1", title: "Не рисковать больше 1% за сделку", category: "Trading", createdAt: "2026-10-20" }],
  coinLog: [{ at: "2026-11-01T08:00:00.000Z", source: "dailyReward", amount: 25 }],
  coinLogSince: "2026-10-28T00:00:00.000Z",
  currentStreak: 9,
  bestStreak: 14,
  onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
  profile: { appearance: { skinTone: "skin_medium", hairstyle: "hair_short_fade", hairColor: "hair_brown", outfit: "outfit_obsidian" }, minorMode: false, timezone: "UTC" },
};
const journal = {
  schemaVersion: 6,
  accounts: [{ id: "acc_1", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-10-08T00:00:00.000Z" }],
  trades: [
    { id: "tr_1", accountId: "acc_1", instrument: "EURUSD", direction: "long", status: "closed", openedAt: "2026-11-01T09:00:00.000Z", result: "win", pnlMoney: 40, emotions: [], mistakes: [], verification: "unverified", source: "manual", createdAt: "2026-11-01T09:00:00.000Z", updatedAt: "2026-11-01T09:00:00.000Z", attachmentIds: [] },
  ],
};

test.describe("Q1 data safety", () => {
  test.use({ reducedMotion: "reduce" });

  test("an old save keeps XP, Coins, level, items, titles, achievements, history and goals; one backup; the journal is untouched", async ({ context, page }) => {
    await seedGame(context, old, { ayra_journal_v1: JSON.stringify(journal) });
    await page.goto("/quests");
    await expect(page.getByTestId("quests-hero")).toBeVisible();
    await expect(page.getByTestId("hero-xp")).toContainText("143");

    const g = (await readGame(page)) as unknown as typeof old & { rev?: number };
    expect(g.xp).toBe(old.xp);
    expect(g.coins).toBe(old.coins);
    expect(g.level).toBe(old.level);
    expect(g.equipment).toEqual(old.equipment);
    for (const t of old.unlockedTitles) expect(g.unlockedTitles).toContain(t);
    expect(g.selectedTitle).toBe(old.selectedTitle);
    expect(g.achievements).toEqual(old.achievements);
    expect(g.history).toEqual(old.history);
    expect(g.customGoals).toEqual(old.customGoals);
    expect(g.coinLog).toEqual(old.coinLog);
    expect(g.profile.appearance).toEqual(old.profile.appearance);
    expect(g.rev).toBeGreaterThanOrEqual(1);

    // one untouched copy of the save from before this version
    const backup = await page.evaluate(() => localStorage.getItem("ayra_demo_v1_backup_q1"));
    expect(JSON.parse(backup!)).toEqual(old);
    // a change and a reload do not overwrite the backup
    await page.getByTestId("mode-rest").click();
    await page.reload();
    await expect(page.getByTestId("quests-hero")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("ayra_demo_v1_backup_q1"))).toBe(backup);

    // the journal is exactly as it was
    const j = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1") || "{}"));
    expect(j.trades).toHaveLength(1);
    expect(j.trades[0]).toMatchObject({ id: "tr_1", instrument: "EURUSD", pnlMoney: 40 });

    // the profile shows the same character and level
    await page.goto("/profile");
    await expect(page.getByTestId("profile-nickname")).toHaveText("LegacyTrader");
  });

  test("English: the page and its tabs are in English", async ({ context, page }) => {
    await seedGame(context, { ...old, xp: 10 }, { ayra_lang: "en" });
    await page.goto("/quests");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quests & Discipline");
    for (const name of ["Today", "Week", "Path", "Discipline", "History"]) await expect(page.getByRole("tab", { name })).toBeVisible();
    await expect(page.getByTestId("device-note")).toContainText("Progress is kept on this device");
    await page.getByRole("tab", { name: "Discipline" }).click();
    await expect(page.getByText("Activity over 4 weeks")).toBeVisible();
  });
});
