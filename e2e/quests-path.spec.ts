import { test, expect, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame, utcDay } from "./helpers/quests";

// QH-8.2 «My path»: personal 30-day quests — the five-step wizard, the cards, details, abandoning with a confirmation,
// restarting as a new run, limits, two tabs, reloads, RU/EN, 16–17 wording. Nothing here gives XP or Coins.

const today = utcDay();
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

type Run = { id: string; questId: string; category: string; verification: string; title: string; startDay: string; status: string; marks: unknown[]; restartOf?: string; abandonedAt?: string };
const runsOf = async (page: Page) => ((await readGame(page)) as unknown as { personalRuns?: Run[] }).personalRuns ?? [];

/** Progress the person already has: no personal quest change may touch it. */
const progress = {
  level: 7,
  xp: 150,
  coins: 410,
  currentStreak: 3,
  bestStreak: 8,
  achievements: { first_quest: true },
  history: [{ questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-10", at: "2026-11-10T09:00:00.000Z" }],
  customGoals: [{ id: "g1", title: "Без сдвига стопа", category: "Trading", createdAt: "2026-11-01" }],
};
const keep = (g: Record<string, unknown>) => ({ level: g.level, xp: g.xp, coins: g.coins, achievements: g.achievements, history: g.history, customGoals: g.customGoals, currentStreak: g.currentStreak, bestStreak: g.bestStreak, coinLog: g.coinLog });

function seededRun(over: Partial<Run> & { id: string; category: string; verification: string }) {
  return {
    questId: `pqq_${over.id}`,
    title: `Квест ${over.id}`,
    goal: "Цель квеста",
    dailyAction: "Одно действие в день",
    startState: "Как сейчас",
    expectedResult: "Что изменится",
    startDay: today,
    createdAt: `${today}T08:00:00.000Z`,
    marks: [],
    status: "active",
    ...over,
  };
}

async function openPath(page: Page) {
  await page.goto("/quests?tab=path");
  await expect(page.getByTestId("pq-main")).toBeVisible();
}

/** Fills the wizard for one quest and stops on step 5. */
async function fillWizard(page: Page, category: string, title: string) {
  const w = page.getByTestId("pq-wizard");
  await w.getByTestId(`pq-cat-${category}`).click();
  await w.getByTestId("pq-wizard-next").click();
  await w.getByTestId("pq-field-title").fill(title);
  await w.getByTestId("pq-field-goal").fill("Разобраться в структуре рынка");
  await w.getByTestId("pq-wizard-next").click();
  await w.getByTestId("pq-field-dailyAction").fill("Один урок и вывод своими словами");
  await w.getByTestId("pq-wizard-next").click();
  await w.getByTestId("pq-field-startState").fill("Учусь урывками");
  await w.getByTestId("pq-field-expectedResult").fill("Учёба каждый день");
  await w.getByTestId("pq-wizard-next").click();
  await expect(w).toContainText("Шаг 5 из 5");
}

test.describe("My path (QH-8.2)", () => {
  test.use({ reducedMotion: "reduce" });

  test("empty state → five steps → an active quest from today; survives a reload; gives nothing", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, ...progress }));
    await openPath(page);
    const before = await readGame(page);
    await expect(page.getByTestId("pq-empty")).toContainText("Ваш путь ещё не начат");
    await expect(page.getByTestId("pq-slots")).toHaveText("Активных квестов: 0 из 3");
    await expect(page.getByTestId("hub-rail").getByTestId("pq-local")).toContainText("Хранится на этом устройстве");

    await page.getByTestId("pq-new").click();
    const w = page.getByTestId("pq-wizard");
    await expect(w).toContainText("Шаг 1 из 5");
    await expect(w.getByTestId("pq-wizard-note")).toContainText("30 игровых дней");
    await expect(w.getByTestId("pq-wizard-note")).toContainText("только после завершения периода и итогового отчёта");
    // every category with its description and achievement
    for (const [id, ach] of [["discipline", "Несломленный"], ["physical", "Железная воля"], ["learning", "Искатель знаний"], ["psychology", "Властелин разума"], ["trading", "Хранитель стратегии"], ["habits", "Архитектор себя"]]) {
      await expect(w.getByTestId(`pq-cat-${id}`)).toContainText(ach);
    }
    // nothing chosen: a clear message, no step forward
    await w.getByTestId("pq-wizard-next").click();
    await expect(w.getByTestId("pq-wizard-error")).toHaveText("Выберите категорию.");
    await w.getByTestId("pq-cat-learning").click();
    await w.getByTestId("pq-wizard-next").click();
    // empty fields are refused
    await w.getByTestId("pq-wizard-next").click();
    await expect(w.getByTestId("pq-wizard-error")).toHaveText("Заполните все поля.");
    await expect(w.getByTestId("pq-field-title")).toHaveAttribute("placeholder", /Например: /);
    await w.getByTestId("pq-wizard-back").click();
    await expect(w).toContainText("Шаг 1 из 5");
    await w.getByTestId("pq-wizard-next").click();
    await w.getByTestId("pq-field-title").fill("Урок каждый день");
    await w.getByTestId("pq-field-goal").fill("Разобраться в структуре рынка");
    await w.getByTestId("pq-wizard-next").click();
    await w.getByTestId("pq-field-dailyAction").fill("Один урок и вывод своими словами");
    await w.getByTestId("pq-wizard-next").click();
    await w.getByTestId("pq-field-startState").fill("Учусь урывками");
    await w.getByTestId("pq-field-expectedResult").fill("Учёба каждый день");
    await w.getByTestId("pq-wizard-next").click();

    // step 5: verification, review, the future reward (variant C) — nothing given now
    await expect(w.getByTestId("pq-ver-app")).toHaveAttribute("aria-checked", "true");
    await expect(w.getByTestId("pq-wizard-rewards")).toContainText("250 XP");
    await w.getByTestId("pq-ver-self").click();
    await expect(w.getByTestId("pq-wizard-rewards")).toContainText("125 XP");
    await expect(w.getByTestId("pq-xp-bronze-self")).toHaveText("50 XP");
    await w.getByTestId("pq-ver-app").click();
    await expect(w.getByTestId("pq-review")).toContainText("Урок каждый день");
    await expect(w.getByTestId("pq-review-start")).toContainText("Начало: сегодня");
    await expect(w).toContainText("Coins не начисляются");
    await w.getByTestId("pq-wizard-create").click();
    await expect(w).toHaveCount(0);

    const card = page.getByTestId("pq-card");
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("pq-card-title")).toHaveText("Урок каждый день");
    await expect(card).toContainText("Обучение");
    await expect(card.getByTestId("pq-card-day")).toHaveText("День 1 из 30");
    await expect(card.getByTestId("pq-card-left")).toHaveText("Осталось дней: 30");
    await expect(card.getByTestId("pq-card-action")).toHaveText("Один урок и вывод своими словами");
    await expect(card.getByTestId("pq-verification")).toHaveText("Подтверждено данными AYRA");
    await expect(card.getByTestId("pq-card-achievement")).toContainText("Искатель знаний");
    await expect(card.getByTestId("pq-card-reward")).toHaveText("Будущая награда: до 250 XP");
    await expect(page.getByTestId("pq-slots")).toHaveText("Активных квестов: 1 из 3");

    const runs = await runsOf(page);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ category: "learning", verification: "app", startDay: today, status: "active", marks: [] });
    expect(runs[0].id).toMatch(/^pq_/);
    expect(keep((await readGame(page)) as unknown as Record<string, unknown>)).toEqual(keep(before as unknown as Record<string, unknown>));

    await page.reload();
    await expect(page.getByTestId("pq-card")).toHaveCount(1);
    await expect(page.getByTestId("pq-card").getByTestId("pq-card-title")).toHaveText("Урок каждый день");
    expect((await runsOf(page))[0].id).toBe(runs[0].id);
  });

  test("a double click on «Start quest» saves one run", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    await openPath(page);
    await page.getByTestId("pq-new").click();
    await fillWizard(page, "learning", "Один раз");
    await page.getByTestId("pq-wizard-create").dblclick();
    await expect(page.getByTestId("pq-card")).toHaveCount(1);
    await page.waitForTimeout(300);
    expect(await runsOf(page)).toHaveLength(1);
  });

  test("limits: one active quest per category, three in all; a category's confirmation only", async ({ context, page }) => {
    await seedGame(
      context,
      baseGame({
        lastQuestDate: today,
        personalRuns: [seededRun({ id: "pq_seed_learning", category: "learning", verification: "app" }), seededRun({ id: "pq_seed_habits", category: "habits", verification: "self" })],
      })
    );
    await openPath(page);
    await expect(page.getByTestId("pq-card")).toHaveCount(2);
    await page.getByTestId("pq-new").click();
    const w = page.getByTestId("pq-wizard");
    await expect(w.getByTestId("pq-cat-learning")).toBeDisabled();
    await expect(w.getByTestId("pq-cat-learning")).toContainText("Уже есть активный квест этой категории");
    await expect(w.getByTestId("pq-cat-habits")).toBeDisabled();
    // trading is confirmed by AYRA data only; physical by self-report only
    await fillWizard(page, "trading", "Разбор каждого дня");
    await expect(w.getByTestId("pq-ver-self")).toBeDisabled();
    await expect(w.getByTestId("pq-ver-self")).toContainText("Недоступно для этой категории");
    await w.getByTestId("pq-wizard-create").click();
    await expect(page.getByTestId("pq-card")).toHaveCount(3);
    // all three slots taken
    await expect(page.getByTestId("pq-new")).toBeDisabled();
    await expect(page.getByTestId("pq-full")).toContainText("Заняты все 3 слота");
    expect((await runsOf(page)).map((r) => r.category).sort()).toEqual(["habits", "learning", "trading"]);
  });

  test("details, abandon with a confirmation (cancel keeps it), history, restart as a new run with no progress", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, ...progress, personalRuns: [seededRun({ id: "pq_seed_old", category: "physical", verification: "self", title: "Утренняя растяжка", startDay: addDays(today, -11) })] }));
    await openPath(page);
    const before = await readGame(page);
    const card = page.getByTestId("pq-card");
    await expect(card.getByTestId("pq-card-day")).toHaveText("День 12 из 30");
    await expect(card.getByTestId("pq-card-left")).toHaveText("Осталось дней: 19");
    await expect(card.getByTestId("pq-verification")).toHaveText("Самоотчёт");
    await expect(card.getByTestId("pq-card-reward")).toHaveText("Будущая награда: до 125 XP");

    await card.getByTestId("pq-card-open").click();
    const d = page.getByTestId("pq-details");
    await expect(d.getByTestId("pq-detail-goal")).toHaveText("Цель квеста");
    await expect(d.getByTestId("pq-detail-startState")).toHaveText("Как сейчас");
    await expect(d.getByTestId("pq-detail-expectedResult")).toHaveText("Что изменится");
    await expect(d.getByTestId("pq-progress-soon")).toContainText("награды не выдаются");
    // cancel keeps the run
    await d.getByTestId("pq-abandon").click();
    await expect(page.getByTestId("pq-abandon-confirm")).toContainText("Прекратить квест?");
    await page.getByTestId("pq-abandon-cancel").click();
    await expect(page.getByTestId("pq-abandon-confirm")).toHaveCount(0);
    expect((await runsOf(page))[0].status).toBe("active");
    // confirm abandons it
    await d.getByTestId("pq-abandon").click();
    await page.getByTestId("pq-abandon-confirm-yes").click();
    await expect(page.getByTestId("pq-details")).toHaveCount(0);
    await expect(page.getByTestId("pq-empty")).toBeVisible();
    const item = page.getByTestId("pq-history-item");
    await expect(item).toHaveCount(1);
    await expect(item).toHaveAttribute("data-status", "abandoned");
    await expect(item.getByTestId("pq-history-status")).toHaveText("Прекращён");

    // restart: a new run from today, its own id, day 1 of 30; the old run stays in the history
    await item.getByTestId("pq-restart").click();
    await expect(page.getByTestId("pq-card")).toHaveCount(1);
    await expect(page.getByTestId("pq-card").getByTestId("pq-card-day")).toHaveText("День 1 из 30");
    await expect(page.getByTestId("pq-history-item")).toHaveCount(1);
    await expect(page.getByTestId("pq-restart")).toHaveCount(0);
    const runs = await runsOf(page);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ questId: "pqq_pq_seed_old", startDay: today, status: "active", marks: [], restartOf: "pq_seed_old" });
    expect(runs[0].id).not.toBe("pq_seed_old");
    expect(runs[1]).toMatchObject({ id: "pq_seed_old", status: "abandoned" });
    expect(keep((await readGame(page)) as unknown as Record<string, unknown>)).toEqual(keep(before as unknown as Record<string, unknown>));
  });

  test("two tabs: a quest made in one shows in the other; both taking the same category save one", async ({ context }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    const a = await context.newPage();
    const b = await context.newPage();
    await openPath(a);
    await openPath(b);
    for (const p of [a, b]) {
      await p.getByTestId("pq-new").click();
      await fillWizard(p, "learning", p === a ? "Из вкладки A" : "Из вкладки B");
    }
    await Promise.all([a.getByTestId("pq-wizard-create").click(), b.getByTestId("pq-wizard-create").click()]);
    await expect.poll(async () => (await runsOf(a)).length).toBe(1);
    await a.waitForTimeout(500);
    expect(await runsOf(a)).toHaveLength(1);
    // the tab that lost sees why, and both show the one saved quest
    const lost = (await a.getByTestId("pq-wizard").count()) ? a : b;
    await expect(lost.getByTestId("pq-wizard-error")).toHaveText("В этой категории уже есть активный квест. Выберите другую категорию.");
    await lost.getByTestId("pq-wizard").getByRole("button", { name: "Отмена" }).first().click();
    for (const p of [a, b]) await expect(p.getByTestId("pq-card")).toHaveCount(1);

    // abandoned in one tab → the other tab shows it in the history
    await a.getByTestId("pq-card-open").click();
    await a.getByTestId("pq-abandon").click();
    await a.getByTestId("pq-abandon-confirm-yes").click();
    await expect(b.getByTestId("pq-history-item")).toHaveCount(1);
    await expect(b.getByTestId("pq-card")).toHaveCount(0);
  });

  test("an old save without personal quests opens fine; damaged entries are dropped; other progress is kept", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, ...progress, personalRuns: [null, { id: "x" }, seededRun({ id: "pq_seed_ok", category: "habits", verification: "self" })] }));
    await openPath(page);
    await expect(page.getByTestId("pq-card")).toHaveCount(1);
    await page.goto("/quests");
    await expect(page.getByTestId("quests-hero")).toBeVisible();
    const g = (await readGame(page)) as unknown as Record<string, unknown>;
    expect(g.xp).toBe(progress.xp);
    expect(g.coins).toBe(progress.coins);
    expect(g.history).toEqual(progress.history);
  });

  test("16–17: physical and psychology are open with neutral wording", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, profile: { ...baseGame().profile, minorMode: true } }));
    await openPath(page);
    await page.getByTestId("pq-new").click();
    const w = page.getByTestId("pq-wizard");
    await w.getByTestId("pq-cat-physical").click();
    await w.getByTestId("pq-wizard-next").click();
    await expect(w.getByTestId("pq-minor-note")).toContainText("не ставятся цели о весе, калориях");
    const placeholders = await w.locator("input, textarea").evaluateAll((els) => els.map((e) => e.getAttribute("placeholder") || "").join(" "));
    expect(placeholders).not.toMatch(/вес|похуд|калори|диет|диагноз/i);
    await w.getByTestId("pq-wizard-back").click();
    await w.getByTestId("pq-cat-learning").click();
    await w.getByTestId("pq-wizard-next").click();
    await expect(w.getByTestId("pq-minor-note")).toHaveCount(0);
  });

  test("English", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, personalRuns: [seededRun({ id: "pq_seed_en", category: "trading", verification: "app", title: "Review every day" })] }), { ayra_lang: "en" });
    await openPath(page);
    await expect(page.getByTestId("hub-tab-path")).toHaveText("My path");
    const card = page.getByTestId("pq-card");
    await expect(card.getByTestId("pq-card-day")).toHaveText("Day 1 of 30");
    await expect(card.getByTestId("pq-verification")).toHaveText("Confirmed by AYRA data");
    await expect(card.getByTestId("pq-card-achievement")).toContainText("Strategy Keeper");
    await expect(card.getByTestId("pq-card-reward")).toHaveText("Future reward: up to 250 XP");
    await page.getByTestId("pq-new").click();
    await expect(page.getByTestId("pq-wizard")).toContainText("Step 1 of 5");
    await expect(page.getByTestId("pq-cat-trading")).toContainText("There is already an active quest in this category");
  });

  for (const width of [390, 1440]) {
    test(`${width}px: three cards and the wizard fit without horizontal scroll`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedGame(
        context,
        baseGame({
          lastQuestDate: today,
          personalRuns: [
            seededRun({ id: "pq_w_1", category: "learning", verification: "app", title: "Урок каждый день", startDay: addDays(today, -11) }),
            seededRun({ id: "pq_w_2", category: "habits", verification: "self", title: "Без телефона перед сном", startDay: addDays(today, -3) }),
            seededRun({ id: "pq_w_3", category: "trading", verification: "app", title: "Разбор каждого дня", startDay: addDays(today, -27) }),
            seededRun({ id: "pq_w_old", category: "physical", verification: "self", title: "Утренняя растяжка", startDay: addDays(today, -20), status: "abandoned", abandonedAt: `${addDays(today, -15)}T10:00:00.000Z` }),
          ],
        })
      );
      await openPath(page);
      await expect(page.getByTestId("pq-card")).toHaveCount(3);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(await overflow()).toBe(0);
      await page.screenshot({ path: `test-results/qh82-path-${width}.png`, fullPage: true });
      await page.getByTestId("pq-card").first().getByTestId("pq-card-open").click();
      await expect(page.getByTestId("pq-details")).toBeVisible();
      await page.screenshot({ path: `test-results/qh82-details-${width}.png` });
      await page.keyboard.press("Escape");
      await page.getByTestId("pq-card-open").first().click();
      await page.getByTestId("pq-abandon").click();
      await page.getByTestId("pq-abandon-confirm-yes").click();
      await page.getByTestId("pq-new").click();
      await page.getByTestId("pq-cat-discipline").click();
      await page.screenshot({ path: `test-results/qh82-wizard-${width}.png` });
      expect(await overflow()).toBe(0);
    });
  }
});
