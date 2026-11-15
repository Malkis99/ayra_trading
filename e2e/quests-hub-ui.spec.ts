import { test, expect, type Page } from "@playwright/test";
import { activateMode, baseGame, readGame, seedGame, utcDay } from "./helpers/quests";

// QH-6.5 (docs/quest-hub-qh6-spec.md): one name and one look for every mission on «Today», «Week», «History», Home and
// Profile; each row says how it is confirmed, by which record and for what reward; «Done» only after the saved reward.

const today = utcDay();
const yesterday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
})();
const iso = (d: string, hhmm: string) => `${d}T${hhmm}:00.000Z`;

const journal = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans: [], weekPlans: [], noTrades: [], notes: [], ...over });

/** Today: «Preparation» paid at 07:42 (catalog 3); yesterday: a study day with two paid missions in its snapshot. */
const paidGame = () =>
  baseGame({
    lastQuestDate: today,
    journalFirstTradeDay: null,
    questDay: { day: today, mode: "trading", catalogVersion: 3, core: ["q_bias", "q_riskcheck", "q_reflect"], bonus: ["q_read_pages", "q_screenplan"], studyFirst: "m_observation" },
    completedQuestsToday: { q_bias: true },
    missionLedger: { day: today, claims: { q_bias: `plan:${today}:prep` } },
    xp: 40,
    coins: 10,
    history: [
      { questId: "q_bias", questTitle: "Daily Bias перед сессией", category: "trading", xp: 40, coins: 10, completedAt: today, at: iso(today, "07:42") },
      { questId: "m_lesson", questTitle: "Урок", category: "discipline", xp: 40, coins: 10, completedAt: yesterday, at: iso(yesterday, "15:12") },
    ],
    questDays: [
      {
        v: 1, day: yesterday, mode: "study", catalogVersion: 3, core: ["m_observation", "m_backtest", "m_lesson"], bonus: ["q_read_pages", "q_walk"],
        offered: ["m_observation", "m_backtest", "m_lesson", "q_read_pages", "q_walk"],
        done: { m_lesson: { source: "journal", at: iso(yesterday, "15:12"), xp: 40, coins: 10, missionSource: "note:l1" } },
        passed: [], replaced: [], modeChanges: [], restDay: false, shieldUsed: false, totals: { xp: 40, coins: 10, selfXp: 0, quests: 1 }, recordedAt: iso(today, "00:01"),
      },
    ],
  });
const plan = { date: today, bias: [{ instrument: "EURUSD", direction: "bullish" }], levels: [{ instrument: "EURUSD", price: 1.0832, label: "POI" }], events: [], checklist: [], createdAt: iso(today, "07:40"), firstSavedAt: iso(today, "07:40"), updatedAt: iso(today, "07:40") };
const missions = (page: Page) => page.locator('[data-testid="missions"] [data-testid^="quest-card-"]');

test.describe("Quest Hub interface (QH-6.5)", () => {
  test.use({ reducedMotion: "reduce" });

  test("a mission row: one name, the rule, the record that confirms it, the reward; done = credited", async ({ context, page }) => {
    await seedGame(context, paidGame(), { ayra_journal_v1: journal({ plans: [plan] }) });
    await page.goto("/quests");
    await expect(missions(page)).toHaveCount(3);
    const prep = page.getByTestId("quest-card-q_bias");
    await expect(prep.getByRole("heading", { name: "Подготовка" })).toBeVisible();
    await expect(prep.getByTestId("quest-done")).toContainText("Выполнено в 07:42");
    await expect(prep.getByTestId("quest-done")).toContainText("начислено +40 XP · +10 Coins");
    await expect(prep.getByRole("link")).toHaveCount(0);

    const risk = page.getByTestId("quest-card-q_riskcheck");
    await expect(risk.getByRole("heading", { name: "Контроль риска" })).toBeVisible();
    await expect(risk.getByTestId("quest-criterion")).toContainText("Готово, когда:");
    await expect(risk.getByTestId("quest-badge-journal")).toHaveText("Журнал");
    await expect(risk.getByTestId("quest-source")).toHaveText("план дня · лимиты и чек-лист");
    await expect(risk.getByTestId("quest-reward")).toHaveText("+40 XP · +10 Coins");
    await expect(risk).toHaveAttribute("data-done", "false");
    // QH-6.6: an available quest is accepted first; then «Go to the Journal» and «Verify»
    await expect(risk.getByTestId("quest-journal-link")).toHaveCount(0);
    await expect(risk.getByTestId("quest-accept")).toHaveAccessibleName("Принять задание: Контроль риска");
    await risk.getByTestId("quest-accept").click();
    await expect(risk.getByTestId("quest-status")).toHaveText("В процессе");
    await expect(risk.getByTestId("quest-journal-link")).toHaveAccessibleName("Перейти в Журнал: Контроль риска");
    await expect(risk.getByTestId("quest-verify")).toHaveAccessibleName("Проверить выполнение: Контроль риска");
    // «Verify» without the record: nothing paid, the exact thing to add
    await risk.getByTestId("quest-verify").click();
    await expect(risk.getByTestId("quest-verify-failure")).toContainText("В плане не заданы лимиты риска");
    expect((await readGame(page)).coins).toBe(10);
    await expect(page.getByTestId("quest-card-q_reflect").getByRole("heading", { name: "Итог дня" })).toBeVisible();

    // the day plan's steps name their mission instead of repeating its reward
    await expect(page.getByTestId("mission-step-note-bias")).toHaveText("Часть миссии «Подготовка»");
    await expect(page.getByTestId("mission-step-note-risk")).toHaveText("Часть миссии «Контроль риска»");
    // no «syncing» message for a device journal
    await expect(page.getByTestId("missions-syncing")).toHaveCount(0);
  });

  test("habits stay apart: optional self-reports with «Mark», outside the three missions", async ({ context, page }) => {
    await seedGame(context, paidGame(), { ayra_journal_v1: journal({ plans: [plan] }) });
    await page.goto("/quests");
    await expect(page.getByTestId("extras-note")).toContainText("вне трёх миссий");
    await expect(page.getByTestId("extras-note")).toContainText("до 90 XP в день");
    const extras = page.locator('[data-testid="extras-challenges"] [data-testid^="quest-card-"], [data-testid="extras-habits"] [data-testid^="quest-card-"]');
    for (const row of await extras.all()) {
      await expect(row.getByTestId("quest-badge-self")).toBeVisible();
      await expect(row.getByTestId("quest-complete")).toBeVisible();
      await expect(row.getByTestId("quest-source")).toHaveCount(0);
    }
    for (const row of await missions(page).all()) await expect(row.getByTestId("quest-complete")).toHaveCount(0);
  });

  test("the same names on Week, History, Home and Profile", async ({ context, page }) => {
    await seedGame(context, paidGame(), { ayra_journal_v1: journal({ plans: [plan] }) });
    await page.goto(`/quests?tab=week&day=${yesterday}`);
    await expect(page.getByTestId(`day-quest-m_lesson`)).toContainText("Урок");
    await page.goto(`/quests?tab=history&day=${yesterday}`);
    await expect(page.getByTestId("day-panel")).toContainText("Урок");
    await page.getByTestId("history-toggle").click(); // the full list is folded by default (QH-5)
    await expect(page.getByTestId("history-list")).toContainText("Подготовка");
    await expect(page.getByTestId("history-list")).toContainText("Урок");
    await page.goto("/");
    await expect(page.getByText("Подготовка", { exact: true }).first()).toBeVisible();
    await page.goto("/profile");
    await expect(page.getByText("Подготовка", { exact: true }).first()).toBeVisible();
  });

  test("modes: a paid mission keeps its place and its credit; rest asks for nothing; study without trades", async ({ context, page }) => {
    await seedGame(context, paidGame(), { ayra_journal_v1: journal({ plans: [plan] }) });
    await page.goto("/quests");
    await activateMode(page, "study");
    const prep = page.getByTestId("quest-card-q_bias");
    await expect(prep.getByTestId("quest-carried")).toHaveText("Из режима «Торговля»");
    await expect(prep.getByTestId("quest-done")).toContainText("начислено +40 XP · +10 Coins");
    await expect(page.getByTestId("quest-card-m_backtest").getByTestId("quest-source")).toHaveText("результат бэктеста");
    await expect(page.getByTestId("quest-card-m_lesson").getByTestId("quest-source")).toHaveText("заметка «Урок»");
    await activateMode(page, "rest");
    await expect(page.getByTestId("rest-panel")).toBeVisible();
    await expect(missions(page)).toHaveCount(0);
    const g = await readGame(page);
    expect(g.coins).toBe(10);
  });
});
