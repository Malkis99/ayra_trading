import { test, expect, type Page } from "@playwright/test";
import { baseGame, expandBonus, readGame, seedGame, totalXp, utcDay } from "./helpers/quests";

// Q2 Quest Engine (docs/quests-2.0-plan.md, section 2): a saved day set, day modes, composite missions from the
// journal's day plan, «why not done», week missions and the Weekly Boss without rewards.

const today = utcDay();
const yesterday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
})();

type Saved = Awaited<ReturnType<typeof readGame>> & { questDay?: { day: string; mode: string; core: string[]; bonus: string[] }; tradingDays?: number[] };
const game = (page: Page) => readGame(page) as Promise<Saved>;

const journal = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: 6,
    accounts: [{ id: "acc_1", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-10-08T00:00:00.000Z" }],
    trades: [],
    plans: [],
    weekPlans: [],
    noTrades: [],
    ...over,
  });

test.describe("Quest Engine (Q2)", () => {
  test.use({ reducedMotion: "reduce" });

  test("the day set is generated once, kept on reload, and never offers a quest that needs a trade", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    await expect.poll(async () => (await game(page)).questDay?.day).toBe(today);
    const set = (await game(page)).questDay!;
    await page.reload();
    await expect(page.getByTestId("quests-hero")).toBeVisible();
    expect((await game(page)).questDay).toEqual(set);
    for (const mode of ["trading", "study", "recovery"]) {
      await page.getByTestId(`mode-${mode}`).click();
      await expandBonus(page);
      await expect(page.getByTestId("quest-card-q_tradelog")).toHaveCount(0);
    }
  });

  test("modes: free before a reward; after it only rest and back; no XP from switching", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    await expect(page.getByTestId("mission-morning_protocol")).toBeVisible();
    await page.getByTestId("mode-study").click();
    await expect(page.getByText("Режим дня: Учёба")).toBeVisible();
    await expect(page.getByTestId("mission-morning_protocol")).toHaveCount(0);
    await expect(page.getByTestId("mission-eod_ritual")).toBeVisible();
    const xp0 = totalXp(await game(page));

    await expandBonus(page);
    const card = page.locator('[data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-badge-self") }).first();
    await card.getByRole("button", { name: "Выполнить" }).click();
    await expect(card.getByTestId("quest-done")).toBeVisible();
    const xp1 = totalXp(await game(page));
    expect(xp1).toBeGreaterThan(xp0);

    await page.getByTestId("mode-recovery").click();
    await expect(page.getByText("Сегодня уже есть награда: режим можно сменить только на «Отдых»").first()).toBeVisible();
    expect((await game(page)).questDay?.mode).toBe("study");
    await page.getByTestId("mode-rest").click();
    await expect(page.getByTestId("rest-panel")).toBeVisible();
    await page.getByTestId("mode-study").click();
    await expect(page.getByTestId("mode-study")).toHaveAttribute("aria-checked", "true");
    expect(totalXp(await game(page))).toBe(xp1);
  });

  test("the morning protocol follows the journal's day plan and explains what is missing", async ({ context, page }) => {
    const plan = {
      date: today,
      bias: [{ instrument: "EURUSD", direction: "bullish" }],
      levels: [{ instrument: "EURUSD", price: 1.1, label: "POI" }],
      events: [],
      checklist: [],
      createdAt: `${today}T05:00:00.000Z`,
      updatedAt: `${today}T05:00:00.000Z`,
    };
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal({ plans: [plan] }) });
    await page.goto("/quests");
    const protocol = page.getByTestId("mission-morning_protocol");
    await expect(protocol.getByTestId("mission-step-bias")).toHaveAttribute("data-state", "done");
    await expect(protocol.getByTestId("mission-step-levels")).toHaveAttribute("data-state", "done");
    await expect(protocol.getByTestId("mission-step-calendar")).toHaveAttribute("data-state", "open");
    await expect(protocol.getByTestId("mission-step-risk")).toHaveAttribute("data-state", "open");
    await expect(protocol.getByTestId("mission-morning_protocol-progress")).toHaveText("2 из 4");
    // self-reported quests say how they are confirmed
    await expandBonus(page);
    await expect(page.getByTestId("quest-reason").first()).toContainText("самоотчёт");
  });

  test("week: without trades the challenge is «not applicable»; trading days are saved for the next days", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    await expect.poll(async () => (await game(page)).questDay?.day).toBe(today);
    const before = (await game(page)).questDay;
    await page.getByRole("tab", { name: "Неделя" }).click();
    await expect(page.getByTestId("weekly-boss")).toHaveAttribute("data-state", "notApplicable");
    await expect(page.getByTestId("boss-overall")).toHaveText("Не применимо — на неделе нет сделок");
    await expect(page.getByTestId("objective-reviewTrades")).toHaveAttribute("data-state", "notApplicable");
    await page.getByTestId("trading-day-6").click();
    await expect.poll(async () => (await game(page)).tradingDays).toEqual([0, 1, 2, 3, 4, 5]);
    expect((await game(page)).questDay).toEqual(before);
  });

  test("week objectives count real reviews from the journal", async ({ context, page }) => {
    const t = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      accountId: "acc_1",
      instrument: "EURUSD",
      direction: "long",
      status: "closed",
      openedAt: `${today}T08:00:00.000Z`,
      result: "win",
      emotions: [],
      mistakes: [],
      verification: "unverified",
      source: "manual",
      createdAt: `${today}T08:00:00.000Z`,
      updatedAt: `${today}T08:00:00.000Z`,
      attachmentIds: [],
      ...over,
    });
    const trades = [t("t1", { entryReason: "Retest of the level", emotions: ["calm"], executionRating: 4 }), t("t2", { openedAt: `${today}T09:00:00.000Z` })];
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal({ trades }) });
    await page.goto("/quests");
    await page.getByRole("tab", { name: "Неделя" }).click();
    const o = page.getByTestId("objective-reviewTrades");
    await expect(o).toHaveAttribute("data-state", "notMet");
    await expect(o).toContainText("1 из 2");
    await expect(page.getByTestId("objective-tradeLimit")).toHaveAttribute("data-state", "insufficientData");
  });

  test("two tabs: a reward in one tab locks the mode change in the other (checked on fresh data)", async ({ context }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto("/quests");
    await b.goto("/quests");
    await expect(a.getByTestId("quests-hero")).toBeVisible();
    await expect(b.getByTestId("quests-hero")).toBeVisible();
    await expandBonus(a);
    const card = a.locator('[data-testid^="quest-card-"]').filter({ has: a.getByTestId("quest-badge-self") }).first();
    await card.getByRole("button", { name: "Выполнить" }).click();
    await expect(card.getByTestId("quest-done")).toBeVisible();
    await b.getByTestId("mode-study").click();
    await expect.poll(async () => (await game(b)).questDay?.mode).toBe("trading");
    await expect(b.getByText("Сегодня уже есть награда: режим можно сменить только на «Отдых»").first()).toBeVisible();
  });
});
