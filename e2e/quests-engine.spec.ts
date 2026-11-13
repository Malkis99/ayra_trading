import { test, expect, type Page } from "@playwright/test";
import { activateMode, baseGame, expandBonus, readGame, seedGame, totalXp, utcDay } from "./helpers/quests";

// Q2 Quest Engine (docs/quests-2.0-plan.md, section 2): a saved day set, day modes, composite missions from the
// journal's day plan, «why not done», week missions and the Weekly Boss without rewards.

const today = utcDay();
const yesterday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
})();

type Saved = Awaited<ReturnType<typeof readGame>> & {
  questDay?: { day: string; mode: string; core: string[]; bonus: string[]; carried?: Record<string, string> };
  tradingDays?: number[];
};
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

  test("modes: any mode can be viewed at any time without changing anything", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    await expect(page.getByTestId("mission-morning_protocol")).toBeVisible();
    await expect.poll(async () => (await game(page)).questDay?.mode).toBe("trading");
    const before = await game(page);
    for (const m of ["study", "recovery", "rest", "trading", "study"] as const) {
      await page.getByTestId(`mode-${m}`).click();
      await expect(page.getByTestId("mode-panel")).toHaveAttribute("data-mode", m);
      await expect(page.getByTestId("mode-trading")).toHaveAttribute("data-active", "true");
      if (m !== "trading") await expect(page.getByTestId("mode-viewing")).toBeVisible();
    }
    // a viewed mode shows its quests read-only: no «Done» button anywhere in it
    await expect(page.getByTestId("mission-morning_protocol")).toHaveCount(0);
    await expect(page.getByTestId("mission-eod_ritual")).toBeVisible();
    await expect(page.getByTestId("mode-panel").getByTestId("quest-preview-only").first()).toBeVisible();
    await expect(page.getByTestId("mode-panel").getByRole("button", { name: "Выполнить" })).toHaveCount(0);
    const after = await game(page);
    expect(after.questDay).toEqual(before.questDay);
    expect(totalXp(after)).toBe(totalXp(before));
    expect(after.coins).toBe(before.coins);
  });

  test("modes: after a reward any mode can be made active; the done quest stays in its place; nothing is paid twice", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    await expect(page.getByTestId("mission-morning_protocol")).toBeVisible();
    await activateMode(page, "study");
    await expect(page.getByText("Активный режим: Учёба. Выполненное сегодня сохранено.")).toBeVisible();
    const xp0 = totalXp(await game(page));

    const core = page.locator('[data-testid="mode-panel"] [data-testid^="quest-card-"]');
    const card = core.filter({ has: page.getByTestId("quest-badge-self") }).first();
    const doneId = ((await card.getAttribute("data-testid")) || "").replace("quest-card-", "");
    await card.getByRole("button", { name: "Выполнить" }).click();
    await expect(card.getByTestId("quest-done")).toBeVisible();
    await expect.poll(async () => totalXp(await game(page))).toBeGreaterThan(xp0);
    const paid = await game(page);
    const slot = paid.questDay!.core.indexOf(doneId);

    for (const m of ["recovery", "trading", "rest", "trading", "study"] as const) {
      await activateMode(page, m);
      await expect.poll(async () => (await game(page)).questDay?.mode).toBe(m === "rest" ? "rest" : m);
      const g = await game(page);
      expect(totalXp(g)).toBe(totalXp(paid));
      expect(g.coins).toBe(paid.coins);
      expect(g.completedQuestsToday[doneId]).toBe(true);
      if (m === "rest") {
        await expect(page.getByTestId("rest-panel")).toBeVisible();
        continue;
      }
      expect(g.questDay!.core[slot]).toBe(doneId);
      await expect(page.getByTestId(`quest-card-${doneId}`).getByTestId("quest-done")).toBeVisible();
      await expect(page.getByTestId("core-count")).toContainText(/^[1-3] \/ 3$/);
      if (m !== "study") await expect(page.getByTestId(`quest-card-${doneId}`).getByTestId("quest-carried")).toHaveText("Из режима «Учёба»");
    }
    // a double click and a reload do not add anything either
    await page.reload();
    await expect(page.getByTestId(`quest-card-${doneId}`).getByTestId("quest-done")).toBeVisible();
    expect(totalXp(await game(page))).toBe(totalXp(paid));
  });

  test("every core quest is shown (E1); journal quests have a button to the exact place in the day plan", async ({ context, page }) => {
    const questDay = { day: today, mode: "trading", catalogVersion: 2, core: ["q_riskcheck", "q_walk", "q_read_pages"], bonus: ["q_gym"] };
    const plan = { date: today, bias: [{ instrument: "EURUSD", direction: "bullish" }], levels: [], events: [], checklist: [], createdAt: `${today}T07:00:00.000Z`, updatedAt: `${today}T07:00:00.000Z` };
    await seedGame(context, baseGame({ lastQuestDate: today, questDay }), { ayra_journal_v1: journal({ plans: [plan] }) });
    await page.goto("/quests");
    const core = page.locator('[data-testid="mode-panel"] [data-testid^="quest-card-"]');
    await expect(core).toHaveCount(3);
    await expect(page.getByTestId("core-count")).toHaveText("0 / 3");
    const risk = page.getByTestId("quest-card-q_riskcheck");
    await expect(risk.getByTestId("quest-badge-journal")).toBeVisible();
    await expect(risk.getByTestId("quest-journal-link")).toHaveText("Задать лимиты");
    await expect(risk.getByTestId("quest-journal-link")).toHaveAttribute("href", "/journal?tab=plan&focus=limits");
    // the morning protocol: «levels» has no reward of its own and says so; open steps lead to their block
    const levels = page.getByTestId("mission-step-levels");
    await expect(levels).not.toContainText("Награда");
    await expect(page.getByTestId("mission-step-bias")).toContainText("Награда: +40 XP");
    await expect(page.getByTestId("mission-step-go-calendar")).toHaveAttribute("href", "/journal?tab=plan&focus=events");

    await risk.getByTestId("quest-journal-link").click();
    await expect(page).toHaveURL(/\/journal\?tab=plan/);
    await expect(page.locator("#plan-limits")).toBeInViewport();
    await expect.poll(() => new URL(page.url()).searchParams.get("focus")).toBeNull();
  });

  test("the next step of a trading morning is the day plan, not an evening habit (E2)", async ({ context, page }) => {
    const questDay = { day: today, mode: "trading", catalogVersion: 2, core: ["q_sleep_prep", "q_logic_puzzle", "q_stretching"], bonus: ["q_gym"] };
    await seedGame(context, baseGame({ lastQuestDate: today, questDay }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    const next = page.getByTestId("hero-next");
    await expect(next).toHaveAttribute("href", "/journal?tab=plan&focus=bias");
    await expect(next).not.toContainText("сну");
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
    await expect(page.getByTestId("plan-steps-count")).toHaveText("2 из 5"); // four morning steps and the review
    // self-reported quests say how they are confirmed (quieter than the journal's mark)
    await expect(page.getByTestId("quest-badge-self").first()).toHaveText("Самоотчёт");
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

  test("the daily cap on self-report XP (90): the rest of it is given, then the quest still counts with 0 XP", async ({ context, page }) => {
    const earlier = { questId: "q_earlier", questTitle: "Earlier", category: "Mental", xp: 80, coins: 0, completedAt: today, at: `${today}T06:00:00.000Z` };
    await seedGame(context, baseGame({ lastQuestDate: today, history: [earlier], completedQuestsToday: { q_earlier: true } }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    await expect(page.getByTestId("self-cap")).toHaveText("Самоотчёты: 80 из 90 XP");
    await expandBonus(page);
    const card = page.locator('[data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-badge-self") }).filter({ hasNot: page.getByTestId("quest-done") }).first();
    const id = ((await card.getAttribute("data-testid")) || "").replace("quest-card-", "");
    const xp0 = totalXp(await game(page));
    await card.getByRole("button", { name: "Выполнить" }).click();
    await expect(page.getByText("Задание отмечено: +10 XP — дневной лимит XP за самоотчёты (90) достигнут")).toBeVisible();
    await expect(page.getByTestId(`quest-card-${id}`).getByTestId("quest-done")).toBeVisible();
    expect(totalXp(await game(page)) - xp0).toBe(10);
    await expect(page.getByTestId("self-cap")).toHaveText("Самоотчёты: 90 из 90 XP");
  });

  test("two tabs: a reward in one tab and a mode change in the other — the reward is kept once, the slot stays (fresh data)", async ({ context }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto("/quests");
    await b.goto("/quests");
    await expect(a.getByTestId("quests-hero")).toBeVisible();
    await expect(b.getByTestId("quests-hero")).toBeVisible();
    const card = a.locator('[data-testid="mode-panel"] [data-testid^="quest-card-"]').filter({ has: a.getByTestId("quest-badge-self") }).first();
    const doneId = ((await card.getAttribute("data-testid")) || "").replace("quest-card-", "");
    await card.getByRole("button", { name: "Выполнить" }).click();
    await expect(card.getByTestId("quest-done")).toBeVisible();
    await expect.poll(async () => (await game(a)).completedQuestsToday[doneId]).toBe(true);
    const paid = await game(a);
    // tab B changes the mode (its screen may be a moment behind): the change is made on fresh data
    await b.getByTestId("mode-study").click();
    await b.getByTestId("mode-activate").click();
    await expect.poll(async () => (await game(b)).questDay?.mode).toBe("study");
    const g = await game(b);
    expect(g.questDay!.core).toContain(doneId);
    expect(totalXp(g)).toBe(totalXp(paid));
    expect(g.coins).toBe(paid.coins);
    // tab A follows; the done quest is still done, and clicking around adds nothing
    await expect(a.getByTestId("mode-study")).toHaveAttribute("data-active", "true");
    await expect(a.getByTestId(`quest-card-${doneId}`).getByTestId("quest-done")).toBeVisible();
    expect(totalXp(await game(a))).toBe(totalXp(paid));
  });
});
