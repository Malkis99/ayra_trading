import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame, totalXp } from "./helpers/quests";

// QH-8.5 «My path» XP: a completed path pays its variant C XP once — with the result, the ledger, the level, the
// achievement and one chronicle entry in the same saved change. Runs completed before QH-8.5 are never paid afterwards.
// A change that could not be saved shows no success. The clock is fixed.

const START = "2026-10-21";
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const DAY30 = addDays(START, 29);
const DAY31 = addDays(START, 30);
const atOn = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
const REPORT = "Итог тридцати дней: урок каждый день, выводы в Журнале; понял структуру рынка лучше, дальше — бэктесты по выходным.";
const journal = (over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans: [], weekPlans: [], noTrades: [], notes: [], ...over });
const days = Array.from({ length: 30 }, (_, i) => addDays(START, i));
const lessons = days.map((day, i) => ({ id: `l${i}`, templateKey: "lesson", title: "", body: `Урок ${i + 1}: жду закрытия свечи над уровнем и только потом вхожу по плану, без спешки и догадок.`, tags: [], pinned: false, createdAt: atOn(day, "12:00"), updatedAt: atOn(day, "12:00"), archivedAt: null }));

type Saved = { xp: number; level: number; coins: number; history: unknown[]; chronicle: Array<{ type?: string; xp?: number; runId?: string }>; personalLedger?: Array<{ runId: string; xp: number; paid?: boolean }> };
const game = (page: Page) => readGame(page) as unknown as Promise<Saved>;

function appRun(id: string, over: Record<string, unknown> = {}) {
  return { id, questId: `pqq_${id}`, category: "learning", verification: "app", title: "Урок каждый день", goal: "Цель", dailyAction: "Один урок и вывод в Журнале", startState: "Сейчас", expectedResult: "Потом", startDay: START, createdAt: atOn(START, "08:00"), status: "active", marks: [], ...over };
}
function selfRun(id: string, hits: number, over: Record<string, unknown> = {}) {
  return {
    id, questId: `pqq_${id}`, category: "habits", verification: "self", title: "Без телефона перед сном", goal: "Цель", dailyAction: "Убрать телефон за 30 минут до сна", startState: "Сейчас", expectedResult: "Потом", startDay: START, createdAt: atOn(START, "08:00"), status: "active",
    marks: Array.from({ length: hits }, (_, i) => ({ day: addDays(START, i), savedOn: addDays(START, i), at: atOn(addDays(START, i), "19:00"), source: "self" })),
    ...over,
  };
}
// a path completed in QH-8.4 (before rewards): its ledger entry has no paid mark
const OLD = {
  run: selfRun("pq_old", 30, { category: "physical", title: "Утренняя растяжка", status: "completed", report: { at: atOn(DAY31, "08:00"), text: REPORT }, result: { rank: "gold", days: 30, day: DAY31, at: atOn(DAY31, "08:00"), verification: "self", marks: [] } }),
  entry: { runId: "pq_old", questId: "pqq_pq_old", category: "physical", rank: "gold", days: 30, xp: 0, day: DAY31, at: atOn(DAY31, "08:00"), verification: "self" },
};

async function seed(context: BrowserContext, runs: unknown[], extra: Record<string, string> = {}, more: Record<string, unknown> = {}) {
  await seedGame(context, baseGame({ lastQuestDate: DAY30, level: 1, xp: 0, coins: 40, chronicle: [], personalRuns: runs, ...more }), extra);
}
async function open(page: Page) {
  await page.clock.install({ time: new Date(atOn(DAY31, "10:00")) });
  await page.goto("/quests?tab=path");
  await expect(page.getByTestId("pq-main")).toBeVisible();
}
const card = (page: Page, id: string) => page.locator(`[data-testid="pq-card"][data-run="${id}"]`);

test.describe("My path — XP for a completed path (QH-8.5)", () => {
  test.use({ reducedMotion: "reduce" });

  test("AYRA data Gold: +250 XP and a new level shown and kept after a reload; one chronicle entry; no Coins", async ({ context, page }) => {
    await seed(context, [appRun("pq_app")], { ayra_journal_v1: journal({ notes: lessons }) });
    await open(page);
    const before = await game(page);
    await card(page, "pq_app").getByTestId("pq-complete-open").click();
    const dlg = page.getByTestId("pq-complete");
    await expect(dlg.getByTestId("pq-complete-willpay")).toHaveText("За ранг «Золото» будет начислено 250 XP — один раз, при завершении.");
    await dlg.getByTestId("pq-report").fill(REPORT);
    await dlg.getByTestId("pq-complete-submit").dblclick();
    await expect(dlg.getByTestId("pq-result")).toHaveAttribute("data-rank", "gold");
    await expect(dlg.getByTestId("pq-result-xp")).toHaveText("+250 XP начислено");
    // level 1 needs 120: 250 → level 2 with 130
    await expect(dlg.getByTestId("pq-result-levelup")).toHaveText("Новый уровень: 2");
    await expect(dlg.getByTestId("pq-result-report")).toHaveText(REPORT);
    await page.waitForTimeout(300);
    let g = await game(page);
    expect(totalXp(g) - totalXp(before)).toBe(250);
    expect([g.level, g.xp, g.coins]).toEqual([2, 130, before.coins]);
    expect(g.personalLedger).toEqual([expect.objectContaining({ runId: "pq_app", xp: 250, paid: true })]);
    expect(g.chronicle.filter((e) => e.type === "personalPath")).toEqual([expect.objectContaining({ runId: "pq_app", xp: 250 })]);

    await page.reload();
    g = await game(page);
    expect([g.level, g.xp]).toEqual([2, 130]);
    const item = page.locator('[data-testid="pq-history-item"][data-run="pq_app"]');
    await expect(item.getByTestId("pq-history-xp")).toHaveText("+250 XP начислено");
    await page.goto("/profile?tab=stats");
    await expect(page.getByText("Личный путь «Обучение» пройден: Золото, 30 из 30 дней, +250 XP")).toHaveCount(1);
  });

  test("a path completed before rewards stays unpaid: «completed before rewards started», no XP or chronicle on load", async ({ context, page }) => {
    await seed(context, [OLD.run], {}, { personalLedger: [OLD.entry], personalAchievements: { physical: { rank: "gold", runId: "pq_old", day: DAY31, verification: "self" } } });
    await open(page);
    const item = page.locator('[data-testid="pq-history-item"][data-run="pq_old"]');
    await expect(item.getByTestId("pq-history-unpaid")).toContainText("Завершён до запуска наград");
    await item.getByTestId("pq-history-open").click();
    await expect(page.getByTestId("pq-details").getByTestId("pq-result-unpaid")).toBeVisible();
    await expect(page.getByTestId("pq-details").getByTestId("pq-result-xp")).toHaveCount(0);
    await page.reload();
    const g = await game(page);
    expect([g.level, g.xp]).toEqual([1, 0]);
    expect(g.personalLedger).toEqual([expect.objectContaining({ runId: "pq_old", xp: 0 })]);
    expect(g.chronicle.filter((e) => e.type === "personalPath")).toHaveLength(0);
  });

  test("two tabs completing at once pay once", async ({ context }) => {
    await seed(context, [selfRun("pq_two", 25)]);
    const a = await context.newPage();
    const b = await context.newPage();
    for (const p of [a, b]) {
      await open(p);
      await card(p, "pq_two").getByTestId("pq-complete-open").click();
      await p.getByTestId("pq-report").fill(REPORT);
    }
    await Promise.all([a.getByTestId("pq-complete-submit").click(), b.getByTestId("pq-complete-submit").click()]);
    for (const p of [a, b]) await expect(p.getByTestId("pq-result")).toHaveAttribute("data-rank", "silver");
    await a.waitForTimeout(400);
    const g = await game(a);
    expect(totalXp(g)).toBe(90);
    expect(g.personalLedger).toHaveLength(1);
    expect(g.chronicle.filter((e) => e.type === "personalPath")).toHaveLength(1);
  });

  test("storage full: no success, no XP; after space is back the completion pays once", async ({ context, page }) => {
    await seed(context, [selfRun("pq_full", 22)]);
    await open(page);
    await card(page, "pq_full").getByTestId("pq-complete-open").click();
    await page.getByTestId("pq-report").fill(REPORT);
    await page.evaluate(() => {
      const w = window as unknown as { __origSetItem?: typeof Storage.prototype.setItem };
      w.__origSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.endsWith("ayra_demo_v1")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return w.__origSetItem!.call(this, key, value);
      };
    });
    await page.getByTestId("pq-complete-submit").click();
    await expect(page.getByTestId("pq-complete-error")).toHaveText("Не удалось сохранить. Попробуйте ещё раз.");
    await expect(page.getByTestId("pq-result")).toHaveCount(0);
    let g = await game(page);
    expect([g.level, g.xp]).toEqual([1, 0]);
    expect(g.personalLedger ?? []).toHaveLength(0);
    await page.evaluate(() => {
      const w = window as unknown as { __origSetItem?: typeof Storage.prototype.setItem };
      Storage.prototype.setItem = w.__origSetItem!;
    });
    await page.getByTestId("pq-complete-submit").click();
    await expect(page.getByTestId("pq-result-xp")).toHaveText("+50 XP начислено");
    g = await game(page);
    expect(totalXp(g)).toBe(50);
    expect(g.personalLedger).toHaveLength(1);
  });

  for (const [width, lang] of [[390, "ru"], [1440, "en"]] as const) {
    test(`${width}px ${lang.toUpperCase()}: the result with XP and a new level, the history (paid and before rewards), the chronicle; screenshots`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await seed(context, [appRun("pq_app", lang === "en" ? { title: "A lesson a day" } : {}), OLD.run], { ayra_journal_v1: journal({ notes: lessons }), ...(lang === "en" ? { ayra_lang: "en" } : {}) }, { personalLedger: [OLD.entry] });
      await open(page);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await card(page, "pq_app").getByTestId("pq-complete-open").click();
      await page.getByTestId("pq-report").fill(REPORT);
      await page.screenshot({ path: `test-results/qh85-form-${width}-${lang}.png` });
      await page.getByTestId("pq-complete-submit").click();
      await expect(page.getByTestId("pq-result-levelup")).toBeVisible();
      await page.screenshot({ path: `test-results/qh85-result-${width}-${lang}.png` });
      await page.keyboard.press("Escape");
      await page.getByTestId("pq-history").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/qh85-history-${width}-${lang}.png` });
      expect(await overflow()).toBe(0);
      await page.goto("/profile?tab=stats");
      await page.getByText(lang === "ru" ? /Личный путь «Обучение» пройден/ : /Personal path «Learning» completed/).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/qh85-chronicle-${width}-${lang}.png` });
      expect(await overflow()).toBe(0);
    });
  }
});
