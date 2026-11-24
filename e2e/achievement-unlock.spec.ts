import { test, expect, type Page } from "@playwright/test";
import { pickOption, openJournalTab } from "./helpers/forms";
import { baseGame, readGame, seedGame, totalXp } from "./helpers/quests";

// Q4.7 (docs/q4-7-achievement-unlock.md): firstPlan, firstReview and plans7 open by their own rule (the Journal's day
// plans) when a plan is saved; firstPropRules is kept in the save, not only shown. Achievements pay no XP or Coins.
// The clock is fixed; the state is written before the app starts. Guest space (mock auth): accounts, sign-out and
// switching are in e2e-supabase/achievement-unlock-accounts.spec.ts.

const NOW = "2026-11-18T10:00:00Z"; // Wednesday
// the Journal's one-time first-action rewards (first plan, account) were already received: any XP or Coins would then come
// from the achievements, which must give none
const FIRST_DONE = { dayPlan: "2026-10-05T10:00:00.000Z", account: "2026-10-05T10:00:00.000Z", trade: "2026-10-05T10:00:00.000Z" };
const TODAY = "2026-11-18";
const pastPlan = (date: string) => ({
  date, bias: [], levels: [], events: [], checklist: [], createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`,
});
const pastDays = (n: number) => Array.from({ length: n }, (_, i) => pastPlan(`2026-11-${String(i + 1).padStart(2, "0")}`));
const journal = (plans: unknown[]) => JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans, weekPlans: [], noTrades: [], notes: [] });
type Game = Awaited<ReturnType<typeof readGame>> & { achievements?: Record<string, boolean>; chronicle?: Array<{ type: string; achievementId?: string }> };
const game = (page: Page) => readGame(page) as Promise<Game>;
const unlocks = (g: Game, id: string) => (g.chronicle || []).filter((e) => e.type === "achievementUnlocked" && e.achievementId === id).length;
const savedPlan = (page: Page) =>
  page.evaluate((d) => (JSON.parse(localStorage.getItem("ayra_journal_v1") || "{}").plans || []).find((p: { date: string }) => p.date === d) || null, TODAY);

async function openPlan(page: Page) {
  await page.goto("/journal");
  await openJournalTab(page, "План");
  await expect(page.getByPlaceholder("Мысли перед началом торгов, ожидания...")).toBeVisible();
}
/** Writes today's plan note and waits until the plan is saved (the tab saves ~0.5 s after the last change). */
async function writeNote(page: Page, text: string) {
  await page.getByPlaceholder("Мысли перед началом торгов, ожидания...").fill(text);
  await expect.poll(async () => (await savedPlan(page))?.note).toBe(text);
}

test.describe("Q4.7 achievement unlocks on the device (guest)", () => {
  test.use({ timezoneId: "UTC" });
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date(NOW) });
  });

  test("the first plan → firstPlan; the review completed → firstReview; kept after a reload; no XP or Coins from them; never twice", async ({ page, context }) => {
    await seedGame(context, baseGame({ achievements: { stylist: true }, lastQuestDate: TODAY, firstActions: FIRST_DONE }), { ayra_journal_v1: journal([]) });
    await openPlan(page);
    const before = await game(page);
    expect(before.achievements).toEqual({ stylist: true });

    await writeNote(page, "Только наблюдение за рынком.");
    await expect.poll(async () => (await game(page)).achievements?.firstPlan).toBe(true);
    let g = await game(page);
    expect(g.achievements?.firstReview).toBeUndefined();
    expect(g.achievements?.plans7).toBeUndefined();
    // the plan closes no quest (no bias, no limits, no review): every XP and Coin as before
    expect({ xp: totalXp(g), coins: g.coins }).toEqual({ xp: totalXp(before), coins: before.coins });

    await page.getByRole("button", { name: "Завершить день" }).click();
    await expect.poll(async () => (await game(page)).achievements?.firstReview).toBe(true);
    g = await game(page);
    const afterReview = { xp: totalXp(g), coins: g.coins };

    await page.reload();
    await openJournalTab(page, "План");
    await writeNote(page, "Ещё одна мысль после перезагрузки.");
    g = await game(page);
    expect(g.achievements).toMatchObject({ stylist: true, firstPlan: true, firstReview: true });
    expect(unlocks(g, "firstPlan")).toBe(1);
    expect(unlocks(g, "firstReview")).toBe(1);
    // the achievements added nothing; the only change after the review is that quest's own reward, if any, and it is unchanged by later saves
    expect({ xp: totalXp(g), coins: g.coins }).toEqual(afterReview);
  });

  test("plans7: six plans in the Journal and today's makes seven; five and today's (six) do not", async ({ page, context }) => {
    await seedGame(context, baseGame({ achievements: { stylist: true }, lastQuestDate: TODAY, firstActions: FIRST_DONE }), { ayra_journal_v1: journal(pastDays(5)) });
    await openPlan(page);
    await writeNote(page, "Шестой план.");
    await expect.poll(async () => (await game(page)).achievements?.firstPlan).toBe(true);
    expect((await game(page)).achievements?.plans7).toBeUndefined();
    // a seventh day: yesterday's plan arrives in the Journal (as from another device), then today's is saved again
    await page.evaluate(() => {
      const j = JSON.parse(localStorage.getItem("ayra_journal_v1") || "{}");
      j.plans.push({ date: "2026-11-17", bias: [], levels: [], events: [], checklist: [], createdAt: "2026-11-17T08:00:00.000Z", updatedAt: "2026-11-17T08:00:00.000Z" });
      localStorage.setItem("ayra_journal_v1", JSON.stringify(j));
    });
    await openPlan(page);
    await writeNote(page, "Седьмой план.");
    await expect.poll(async () => (await game(page)).achievements?.plans7).toBe(true);
    expect(unlocks(await game(page), "plans7")).toBe(1);
  });

  test("an old save that has the achievements already: nothing is reset or added again", async ({ page, context }) => {
    await seedGame(context, baseGame({ achievements: { stylist: true, firstPlan: true, firstReview: true, plans7: true, firstQuest: true },
      chronicle: [{ type: "characterCreated" }] }), { ayra_journal_v1: journal(pastDays(7)) });
    await openPlan(page);
    const before = await game(page);
    await writeNote(page, "Обычный день.");
    const g = await game(page);
    expect(g.achievements).toEqual(before.achievements);
    expect((g.chronicle || []).filter((e) => e.type === "achievementUnlocked")).toEqual([]);
  });

  test("two tabs: a plan saved in one tab, the other tab's later change keeps the achievement", async ({ page, context }) => {
    await seedGame(context, baseGame({ achievements: { stylist: true }, lastQuestDate: TODAY, firstActions: FIRST_DONE }), { ayra_journal_v1: journal([]) });
    const other = await context.newPage();
    await other.clock.install({ time: new Date(NOW) });
    await other.goto("/profile");
    await openPlan(page);
    await writeNote(page, "План из первой вкладки.");
    await expect.poll(async () => (await game(page)).achievements?.firstPlan).toBe(true);
    // the other tab changes the game afterwards (a frame): it writes on top of the freshest save, never its old copy
    await other.bringToFront();
    await other.evaluate(() => window.dispatchEvent(new Event("focus")));
    await other.goto("/journal");
    await openJournalTab(other, "План");
    await other.getByPlaceholder("Мысли перед началом торгов, ожидания...").fill("Из второй вкладки.");
    await expect.poll(async () => (await savedPlan(other))?.note).toBe("Из второй вкладки.");
    const g = await game(other);
    expect(g.achievements?.firstPlan).toBe(true);
    expect(unlocks(g, "firstPlan")).toBe(1);
  });

  test("prop rules saved → firstPropRules kept in the save (after a reload too); a second save does not unlock it again", async ({ page, context }) => {
    await seedGame(context, baseGame({ achievements: { stylist: true }, firstActions: FIRST_DONE }),
      { ayra_journal_v1: journal([]) });
    await page.goto("/journal");
    await openJournalTab(page, "Счета");
    await page.click("button:has-text('Добавить счёт')");
    await page.fill("input[placeholder='Основной счёт']", "Prop A");
    await pickOption(page, "account-type-select", "Проп");
    await page.fill("input[placeholder='10000']", "100000");
    await page.click("button[type='submit']:has-text('Сохранить')");
    await expect(page.locator("text=Prop A").first()).toBeVisible();
    const before = await game(page);

    const saveRules = async () => {
      await page.getByRole("button", { name: "Правила проп-счёта" }).first().click();
      await expect(page.getByRole("button", { name: "2. Лимиты" })).toBeVisible();
      await page.click("button:has-text('2. Лимиты')");
      await page.click("button:has-text('3. Расширенное')");
      await page.click("button:has-text('Сохранить')");
    };
    await saveRules();
    await expect.poll(async () => (await game(page)).achievements?.firstPropRules).toBe(true);
    let g = await game(page);
    expect({ xp: totalXp(g), coins: g.coins }).toEqual({ xp: totalXp(before), coins: before.coins });

    await page.reload();
    expect((await game(page)).achievements?.firstPropRules).toBe(true);
    await openJournalTab(page, "Счета");
    await saveRules();
    await expect(page.getByText("Счёт сохранён").first()).toBeVisible();
    g = await game(page);
    expect(unlocks(g, "firstPropRules")).toBe(1);
    expect({ xp: totalXp(g), coins: g.coins }).toEqual({ xp: totalXp(before), coins: before.coins });
  });
});
