import { test, expect, type Page } from "@playwright/test";
import { activateMode, baseGame, readGame, seedGame, utcDay } from "./helpers/quests";

// QH-6.3 (docs/quest-hub-qh6-spec.md, 8): catalog 3 — every active mode has its three verifiable missions (journal checks,
// «Go» to the journal, never «Mark»); self-reports are only extras; the study mission is chosen once for the day; a plan
// made in advance is confirmed today. Nothing new is paid.

const today = utcDay();
const shift = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return utcDay(d);
};
const yesterday = shift(-1);
const tomorrow = shift(1);

type Saved = Awaited<ReturnType<typeof readGame>> & {
  questDay?: { day: string; mode: string; catalogVersion: number; core: string[]; bonus: string[]; studyFirst?: string; studyPending?: boolean };
  journalFirstTradeDay?: string | null;
};
const game = (page: Page) => readGame(page) as Promise<Saved>;
const journalSaved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1") || "{}"));

const journal = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: 6,
    accounts: [{ id: "acc_1", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-10-08T00:00:00.000Z" }],
    trades: [],
    plans: [],
    weekPlans: [],
    noTrades: [],
    notes: [],
    ...over,
  });
const pastTrade = { id: "t_old", accountId: "acc_1", instrument: "EURUSD", direction: "long", status: "closed", result: "win", openedAt: "2026-10-20T10:00:00.000Z", createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z", emotions: [], mistakes: [], verification: "unverified", source: "manual", schemaVersion: 6 };

const missions = (page: Page) => page.locator('[data-testid="missions"] [data-testid^="quest-card-"]');
const missionIds = async (page: Page) => (await missions(page).evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") || "").replace("quest-card-", ""))));

test.describe("Quest catalog 3 (QH-6.3)", () => {
  test.use({ reducedMotion: "reduce" });

  test("trading: three journal missions with «Go», no «Mark»; extras are self-reports; reload keeps the set", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    await expect(missions(page)).toHaveCount(3);
    expect(await missionIds(page)).toEqual(["q_bias", "q_riskcheck", "q_reflect"]);
    for (const row of await missions(page).all()) {
      await expect(row.getByTestId("quest-badge-journal")).toBeVisible();
      await expect(row.getByTestId("quest-complete")).toHaveCount(0);
    }
    await expect(page.getByTestId("quest-card-q_bias").getByTestId("quest-criterion")).toContainText("уровень (POI)");
    // the extras: only self-reports with «Mark»
    const extras = page.locator('[data-testid="extras-challenges"] [data-testid^="quest-card-"], [data-testid="extras-habits"] [data-testid^="quest-card-"]');
    await expect(extras).toHaveCount(2);
    for (const row of await extras.all()) await expect(row.getByTestId("quest-badge-self")).toBeVisible();
    const set = (await game(page)).questDay!;
    expect(set.catalogVersion).toBe(3);
    await page.reload();
    await expect(missions(page)).toHaveCount(3);
    expect((await game(page)).questDay).toEqual(set);
  });

  test("study: «Trade review» when the journal has a past trade, «Observation» without; chosen once for the day", async ({ browser }) => {
    for (const [trades, first] of [[[pastTrade], "m_trade_review"], [[], "m_observation"]] as const) {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal({ trades }) });
      await page.goto("/quests");
      await expect.poll(async () => (await game(page)).questDay?.studyPending).toBeUndefined();
      await activateMode(page, "study");
      await expect(missions(page)).toHaveCount(3);
      expect(await missionIds(page)).toEqual([first, "m_backtest", "m_lesson"]);
      for (const row of await missions(page).all()) {
        await expect(row.getByTestId("quest-complete")).toHaveCount(0);
        await expect(row.getByTestId("quest-reward")).toHaveText("Награда — скоро");
      }
      await page.reload();
      expect(await missionIds(page)).toEqual([first, "m_backtest", "m_lesson"]);
      await context.close();
    }
  });

  test("«Go» opens the right journal place for every mission", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal({ trades: [pastTrade] }) });
    const go = async (mode: "trading" | "study" | "recovery", id: string) => {
      await page.goto("/quests");
      await expect(missions(page).first()).toBeVisible();
      if ((await game(page)).questDay?.mode !== mode) await activateMode(page, mode);
      await page.getByTestId(`quest-card-${id}`).getByTestId("quest-journal-link").click();
      await page.waitForURL(/\/journal/);
    };

    await go("trading", "q_bias");
    await expect(page.locator("#plan-bias")).toBeVisible();
    await go("trading", "q_riskcheck");
    await expect(page.locator("#plan-limits")).toBeVisible();
    await go("trading", "q_reflect");
    await expect(page.locator("#plan-review")).toBeVisible();

    await go("study", "m_trade_review");
    expect(new URL(page.url()).searchParams.get("tab")).toBe("trades");
    await go("study", "m_backtest");
    await expect(page.getByTestId("backtest-modal")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("new")).toBeNull(); // opened once, the parameter is removed
    await go("study", "m_lesson");
    await expect(page.getByTestId("note-modal")).toBeVisible();
    await expect(page.getByTestId("note-modal").locator("textarea")).toHaveValue(/Выученный урок/);

    await go("recovery", "m_mistake");
    await expect(page.getByTestId("note-modal").locator("textarea")).toHaveValue(/Ошибка недели/);
    await go("recovery", "m_day_state");
    await expect(page.locator("#plan-review")).toBeVisible();
    await go("recovery", "m_plan_tomorrow");
    // tomorrow's plan is open: a direction added here is saved for tomorrow's date
    await page.locator("#plan-bias").getByRole("button", { name: /Добавить|Add/ }).click();
    await page.locator("#plan-bias input").first().fill("EURUSD");
    await expect.poll(async () => ((await journalSaved(page)).plans || []).map((p: { date: string }) => p.date)).toContain(tomorrow);
  });

  test("«+ direction» adds an empty row: no direction is chosen for the person", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    await page.goto("/journal?tab=plan");
    await page.locator("#plan-bias").getByRole("button", { name: /Добавить|Add/ }).click();
    await expect(page.locator("#plan-bias input").first()).toHaveValue("");
    await expect(page.getByTestId("bias-direction-empty")).toBeVisible();
    await expect.poll(async () => ((await journalSaved(page)).plans || [])[0]?.bias?.[0]).toEqual({ instrument: "", note: "" });
  });

  test("a plan made in advance: Preparation closes only after today's confirmation; nothing new is paid", async ({ context, page }) => {
    const early = {
      date: today,
      bias: [{ instrument: "EURUSD", direction: "bullish" }],
      levels: [{ instrument: "EURUSD", price: 1.0832, label: "POI" }],
      events: [],
      limits: { maxTrades: 3 },
      checklist: [{ key: "risk_limits_checked", done: false }],
      createdAt: `${yesterday}T20:00:00.000Z`,
      firstSavedAt: `${yesterday}T20:00:01.000Z`,
      updatedAt: `${yesterday}T20:00:01.000Z`,
    };
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal({ plans: [early] }) });
    await page.goto("/journal?tab=plan");
    await expect(page.getByTestId("prep-confirm")).toBeVisible();
    // an unrelated edit of yesterday's plan does not close Preparation
    await page.locator("#plan-bias input").nth(1).fill("Пробой азиатского максимума");
    await page.waitForTimeout(900);
    expect((await game(page)).completedQuestsToday.q_bias).toBeUndefined();
    const before = await game(page);
    await page.getByTestId("prep-confirm-btn").click();
    await expect(page.getByTestId("prep-confirmed")).toBeVisible();
    await expect.poll(async () => (await game(page)).completedQuestsToday.q_bias).toBe(true);
    const after = await game(page);
    // the existing rate of the trading mission (40 XP + 10 Coins), nothing more
    expect(after.coins - before.coins).toBe(10);
    expect(Object.keys(after.completedQuestsToday).filter((id) => id.startsWith("m_"))).toEqual([]);
    expect(((await journalSaved(page)).plans || [])[0].prepConfirmedAt).toBeTruthy();
  });

  test("a mission confirmed by the journal shows done but pays nothing yet (no XP, no Coins, no history)", async ({ context, page }) => {
    const lesson = { id: "note_l1", templateKey: "lesson", title: "", body: "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку.", tags: [], pinned: false, createdAt: `${today}T05:00:00.000Z`, updatedAt: `${today}T05:00:00.000Z`, archivedAt: null };
    await seedGame(context, baseGame({ lastQuestDate: yesterday, journalFirstTradeDay: null }), { ayra_journal_v1: journal({ notes: [lesson] }) });
    await page.goto("/quests");
    await activateMode(page, "study");
    const before = await game(page);
    const row = page.getByTestId("quest-card-m_lesson");
    await expect(row).toHaveAttribute("data-done", "true");
    await expect(row.getByRole("button")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("quest-card-m_lesson")).toHaveAttribute("data-done", "true");
    const after = await game(page);
    expect(after.xp).toBe(before.xp);
    expect(after.coins).toBe(before.coins);
    expect(after.history.filter((h) => h.questId.startsWith("m_"))).toEqual([]);
    expect(after.completedQuestsToday.m_lesson).toBeUndefined();
  });

  test("rest: no missions and nothing «not done»", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    await activateMode(page, "rest");
    await expect(page.getByTestId("rest-panel")).toBeVisible();
    await expect(missions(page)).toHaveCount(0);
    await expect(page.getByTestId("core-count")).toHaveCount(0);
  });
});
