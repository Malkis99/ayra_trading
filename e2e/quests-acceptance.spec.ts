import { test, expect, type Page } from "@playwright/test";
import { activateMode, baseGame, readGame, seedGame, utcDay } from "./helpers/quests";

// QH-6.6 «Accept → Go to the Journal → Verify → Completed» (docs/quest-hub-qh6-spec.md, 9). Accepting gives nothing; a
// save gives nothing for a mission; «Verify» of an accepted mission pays it once through the one claim (QH-6.4).

const SHOTS = process.env.QH66_SHOTS; // screenshots for the PR only (never in CI)
const today = utcDay();
const yesterday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
})();
type Saved = Awaited<ReturnType<typeof readGame>> & { questAccepted?: { day: string; at: Record<string, string> } };
const game = (page: Page) => readGame(page) as Promise<Saved>;
const journal = (over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans: [], weekPlans: [], noTrades: [], notes: [], ...over });
const card = (page: Page, id: string) => page.getByTestId(`quest-card-${id}`);
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

test.describe("Quest acceptance and verification (QH-6.6)", () => {
  test.use({ reducedMotion: "reduce" });

  test("a new account: accept → go → save → verify — four states, the reward once, kept after a reload", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday, journalFirstTradeDay: null }), { ayra_journal_v1: journal() });
    await page.goto("/quests");
    const prep = card(page, "q_bias");
    // AVAILABLE
    await expect(prep).toHaveAttribute("data-quest", "available");
    await expect(prep.getByTestId("quest-accept")).toBeVisible();
    await expect(prep.getByTestId("quest-journal-link")).toHaveCount(0);
    await shot(page, "state-1-available");
    const g0 = await game(page);
    // ACCEPTED (by keyboard): nothing given
    await prep.getByTestId("quest-accept").focus();
    await page.keyboard.press("Enter");
    await expect(prep).toHaveAttribute("data-quest", "accepted");
    await expect(prep.getByTestId("quest-status")).toHaveText("В процессе");
    const g1 = await game(page);
    expect({ xp: g1.xp, coins: g1.coins, history: g1.history.length }).toEqual({ xp: g0.xp, coins: g0.coins, history: g0.history.length });
    expect(Object.keys(g1.questAccepted?.at || {})).toEqual(["q_bias"]);
    await shot(page, "state-2-accepted");
    // a reload keeps the acceptance
    await page.reload();
    await expect(card(page, "q_bias")).toHaveAttribute("data-quest", "accepted");

    // GO: the direction block of the day plan
    await card(page, "q_bias").getByTestId("quest-journal-link").click();
    await page.waitForURL((u) => u.pathname === "/journal");
    await expect(page.locator("#plan-bias")).toBeVisible();
    await page.locator("#plan-bias").getByRole("button", { name: /Добавить/ }).click();
    await page.locator("#plan-bias input").first().fill("EURUSD");
    await page.locator("#plan-bias").getByRole("button", { name: /Бычий/ }).click();
    await page.locator("#plan-levels").getByRole("button", { name: /Добавить/ }).click();
    await page.locator('#plan-levels input[type="number"]').first().fill("1.0832");
    // saved: READY (the save itself paid nothing); the bar leads back to the quest
    await expect(page.getByTestId("quest-ready-bar")).toContainText("Готово к проверке: «Подготовка»");
    expect((await game(page)).completedQuestsToday.q_bias).toBeUndefined();
    await shot(page, "journal-ready-bar");
    await page.getByTestId("quest-ready-open").click();
    await page.waitForURL((u) => u.pathname === "/quests");
    await expect(card(page, "q_bias")).toHaveAttribute("data-quest", "ready");
    await expect(card(page, "q_bias").getByTestId("quest-status")).toHaveText("Готово к проверке");
    await shot(page, "state-3-ready");
    const before = await game(page);
    // COMPLETED
    await card(page, "q_bias").getByTestId("quest-verify").click();
    await expect(card(page, "q_bias")).toHaveAttribute("data-done", "true");
    await expect(card(page, "q_bias").getByTestId("quest-gained")).toHaveText("Задание выполнено · +40 XP · +10 Coins");
    await expect(card(page, "q_bias").getByRole("button")).toHaveCount(0);
    await shot(page, "state-4-completed");
    const after = await game(page);
    expect(after.coins - before.coins).toBe(10);
    expect(after.history.filter((h) => h.questId === "q_bias")).toHaveLength(1);
    // reduced motion: no animation
    const anim = await card(page, "q_bias").evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe("none");
    // a reload: still completed, nothing more paid
    await page.reload();
    await expect(card(page, "q_bias")).toHaveAttribute("data-done", "true");
    await page.waitForTimeout(800);
    expect((await game(page)).coins).toBe(after.coins);
  });

  test("save first, then accept and verify; verify with nothing saved explains what to add and pays nothing", async ({ context, page }) => {
    const lesson = { id: "n1", templateKey: "lesson", title: "", body: "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.", tags: [], pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archivedAt: null };
    await seedGame(context, baseGame({ lastQuestDate: yesterday, journalFirstTradeDay: null }), { ayra_journal_v1: journal({ notes: [lesson] }) });
    await page.goto("/quests");
    await activateMode(page, "study");
    // the lesson was saved earlier today: accepting makes the quest ready at once
    await card(page, "m_lesson").getByTestId("quest-accept").click();
    await expect(card(page, "m_lesson")).toHaveAttribute("data-quest", "ready");
    // the backtest: accepted, nothing saved → «Verify» names what is missing
    await card(page, "m_backtest").getByTestId("quest-accept").click();
    const coins = (await game(page)).coins;
    await card(page, "m_backtest").getByTestId("quest-verify").click();
    await expect(card(page, "m_backtest").getByTestId("quest-verify-failure")).toContainText("Сегодня нет сохранённого результата бэктеста");
    await shot(page, "verify-failure");
    expect((await game(page)).coins).toBe(coins);
    await card(page, "m_lesson").getByTestId("quest-verify").click();
    await expect(card(page, "m_lesson")).toHaveAttribute("data-done", "true");
    expect((await game(page)).coins - coins).toBe(10);
  });

  test("rest: nothing to accept; a completed quest keeps its place after a mode change", async ({ context, page }) => {
    const plan = { date: today, bias: [{ instrument: "EURUSD", direction: "bullish" }], levels: [{ instrument: "EURUSD", price: 1.0832, label: "POI" }], events: [], checklist: [], createdAt: new Date().toISOString(), firstSavedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await seedGame(context, baseGame({ lastQuestDate: yesterday, journalFirstTradeDay: null }), { ayra_journal_v1: journal({ plans: [plan] }) });
    await page.goto("/quests");
    await card(page, "q_bias").getByTestId("quest-accept").click();
    await card(page, "q_bias").getByTestId("quest-verify").click();
    await expect(card(page, "q_bias")).toHaveAttribute("data-done", "true");
    await activateMode(page, "study");
    await expect(card(page, "q_bias")).toHaveAttribute("data-done", "true");
    await expect(card(page, "q_bias").getByTestId("quest-carried")).toHaveText("Из режима «Торговля»");
    await expect(card(page, "m_backtest")).toHaveAttribute("data-quest", "available");
    await activateMode(page, "rest");
    await expect(page.getByTestId("quest-accept")).toHaveCount(0);
    await expect(page.getByTestId("rest-panel")).toBeVisible();
  });

  test("English: the quest flow labels", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: yesterday, journalFirstTradeDay: null }), { ayra_journal_v1: journal(), ayra_lang: "en" });
    await page.goto("/quests");
    await expect(card(page, "q_bias").getByTestId("quest-accept")).toHaveText("Accept quest");
    await card(page, "q_bias").getByTestId("quest-accept").click();
    await expect(card(page, "q_bias").getByTestId("quest-status")).toHaveText("In progress");
    await expect(card(page, "q_bias").getByTestId("quest-journal-link")).toContainText("Go to the Journal");
    await expect(card(page, "q_bias").getByTestId("quest-verify")).toHaveText("Verify completion");
  });
});
