import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame } from "./helpers/quests";

// QH-8.4 «My path» completion: from day 31 the final report (80+ characters), the rank by confirmed days, the category
// achievement (best rank only), the saved result and report, the history. No XP, no Coins. The clock is fixed.

const START = "2026-10-21";
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const DAY30 = addDays(START, 29);
const DAY31 = addDays(START, 30);
const NOW31 = `${DAY31}T10:00:00.000Z`;
const atOn = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
const REPORT = "Итог тридцати дней: убирал телефон до сна почти каждый вечер, засыпаю быстрее; сорвался в выходные, дальше держу ритм.";
const journal = (over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans: [], weekPlans: [], noTrades: [], notes: [], ...over });

type Saved = { xp: number; coins: number; level: number; history: unknown[]; personalRuns?: Array<{ id: string; status: string; result?: { rank: string | null; days: number }; report?: { text: string } }>; personalLedger?: Array<{ runId: string; xp: number; rank: string | null }>; personalAchievements?: Record<string, { rank: string; runId: string }> };
const game = (page: Page) => readGame(page) as unknown as Promise<Saved>;
const progress = { level: 5, xp: 90, coins: 260, history: [{ questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: "2026-10-10", at: "2026-10-10T09:00:00.000Z" }] };

function selfRun(id: string, hits: number, over: Record<string, unknown> = {}) {
  return {
    id, questId: `pqq_${id}`, category: "habits", verification: "self", title: `Квест ${id}`, goal: "Цель", dailyAction: "Убрать телефон за 30 минут до сна", startState: "Сейчас", expectedResult: "Потом",
    startDay: START, createdAt: atOn(START, "08:00"), status: "active",
    marks: Array.from({ length: hits }, (_, i) => ({ day: addDays(START, i), savedOn: addDays(START, i), at: atOn(addDays(START, i), "19:00"), source: "self" })),
    ...over,
  };
}
async function seed(context: BrowserContext, runs: unknown[], extra: Record<string, string> = {}, more: Record<string, unknown> = {}) {
  await seedGame(context, baseGame({ lastQuestDate: DAY30, ...progress, personalRuns: runs, ...more }), extra);
}
async function open(page: Page, now = NOW31) {
  await page.clock.install({ time: new Date(now) });
  await page.goto("/quests?tab=path");
  await expect(page.getByTestId("pq-main")).toBeVisible();
}
const card = (page: Page, id: string) => page.locator(`[data-testid="pq-card"][data-run="${id}"]`);

async function complete(page: Page, id: string, report = REPORT) {
  await card(page, id).getByTestId("pq-complete-open").click();
  const dlg = page.getByTestId("pq-complete");
  await dlg.getByTestId("pq-report").fill(report);
  await dlg.getByTestId("pq-complete-submit").click();
  await expect(dlg.getByTestId("pq-result")).toBeVisible();
  return dlg;
}

test.describe("My path — completion and achievements (QH-8.4)", () => {
  test.use({ reducedMotion: "reduce" });

  test("day 30: no completion yet; day 31: waiting for the report, the form checks 80 characters, Gold, the achievement, nothing given", async ({ browser }) => {
    // day 30
    const c30 = await browser.newContext();
    await seed(c30, [selfRun("pq_g", 29)]);
    const p30 = await c30.newPage();
    await open(p30, `${DAY30}T10:00:00.000Z`);
    await expect(card(p30, "pq_g").getByTestId("pq-card-day")).toHaveText("День 30 из 30");
    await expect(card(p30, "pq_g").getByTestId("pq-complete-open")).toHaveCount(0);
    await expect(card(p30, "pq_g").getByTestId("pq-mark")).toBeVisible();
    await c30.close();

    // day 31
    const ctx = await browser.newContext();
    await seed(ctx, [selfRun("pq_g", 30)]);
    const page = await ctx.newPage();
    await open(page);
    const before = await game(page);
    const c = card(page, "pq_g");
    await expect(c.getByTestId("pq-awaiting")).toContainText("Ожидает итогового отчёта");
    await c.getByTestId("pq-complete-open").click();
    const dlg = page.getByTestId("pq-complete");
    await expect(dlg.getByTestId("pq-complete-summary")).toHaveText("Подтверждённых дней: 30 из 30");
    await expect(dlg.getByTestId("pq-complete-expected")).toHaveAttribute("data-rank", "gold");
    // empty and short reports are refused with a clear message
    await dlg.getByTestId("pq-complete-submit").click();
    await expect(dlg.getByTestId("pq-complete-error")).toContainText("нужно минимум 80");
    await dlg.getByTestId("pq-report").fill("Получилось лучше, чем думал.");
    await expect(dlg.getByTestId("pq-report-counter")).toHaveText("28 / 80");
    await dlg.getByTestId("pq-complete-submit").click();
    await expect(dlg.getByTestId("pq-complete-error")).toContainText("Допишите ещё 52");
    await dlg.getByTestId("pq-report").fill(REPORT);
    await dlg.getByTestId("pq-complete-submit").click();
    const result = dlg.getByTestId("pq-result");
    await expect(result).toHaveAttribute("data-rank", "gold");
    await expect(result.getByTestId("pq-result-days")).toHaveText("30 из 30 подтверждённых дней");
    await expect(result.getByTestId("pq-result-achievement")).toContainText("Новое достижение: «Архитектор себя» — Золото");
    await expect(result.getByTestId("pq-result-xp-preview")).toContainText("Опыт пока не начисляется");
    await expect(result.getByTestId("pq-result-report")).toHaveText(REPORT);

    const g = await game(page);
    expect([g.xp, g.coins, g.level, g.history]).toEqual([before.xp, before.coins, before.level, before.history]);
    expect(g.personalRuns![0]).toMatchObject({ status: "completed", result: { rank: "gold", days: 30 }, report: { text: REPORT } });
    expect(g.personalLedger).toEqual([expect.objectContaining({ runId: "pq_g", rank: "gold", xp: 0 })]);
    expect(g.personalAchievements!.habits).toMatchObject({ rank: "gold", runId: "pq_g" });

    // after a reload: in the history with its rank, the saved result and report; the achievement in the rail and profile
    await page.reload();
    const item = page.locator('[data-testid="pq-history-item"][data-run="pq_g"]');
    await expect(item).toHaveAttribute("data-status", "completed");
    await expect(item.getByTestId("pq-rank")).toHaveText("Золото");
    await item.getByTestId("pq-history-open").click();
    await expect(page.getByTestId("pq-details").getByTestId("pq-result-report")).toHaveText(REPORT);
    await expect(page.getByTestId("pq-details").getByTestId("pq-abandon")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("hub-rail").locator('[data-testid="pq-achievement"][data-category="habits"]')).toHaveAttribute("data-rank", "gold");
    await page.goto("/profile?tab=achievements");
    const ach = page.locator('[data-testid="pq-achievement"][data-category="habits"]');
    await expect(ach).toHaveAttribute("data-rank", "gold");
    await expect(ach.getByTestId("pq-verification")).toHaveText("Самоотчёт");
    await expect(page.locator('[data-testid="pq-achievement"][data-rank="none"]')).toHaveCount(5);
    await ctx.close();
  });

  test("ranks: 20 days — completed without a rank, said respectfully; 24 Bronze; 28 Silver", async ({ browser }) => {
    for (const [hits, rank] of [[20, "none"], [24, "bronze"], [28, "silver"]] as const) {
      const ctx = await browser.newContext();
      await seed(ctx, [selfRun("pq_r", hits)]);
      const page = await ctx.newPage();
      await open(page);
      const dlg = await complete(page, "pq_r");
      await expect(dlg.getByTestId("pq-result")).toHaveAttribute("data-rank", rank);
      await expect(dlg.getByTestId("pq-result-days")).toHaveText(`${hits} из 30 подтверждённых дней`);
      if (rank === "none") {
        await expect(dlg.getByTestId("pq-result-title")).toHaveText("Путь завершён");
        await expect(dlg.getByTestId("pq-result-norank")).toContainText("опыт, на который можно опереться");
        expect((await game(page)).personalAchievements ?? {}).toEqual({});
      }
      await ctx.close();
    }
  });

  test("an achievement is raised, never lowered: Bronze before → Gold now says «raised»", async ({ context, page }) => {
    await seed(context, [selfRun("pq_up", 30)], {}, { personalAchievements: { habits: { rank: "bronze", runId: "pq_old", day: "2026-09-30", verification: "self" } } });
    await open(page);
    const dlg = await complete(page, "pq_up");
    await expect(dlg.getByTestId("pq-result-achievement")).toContainText("повышено: Золото");
    const g = await game(page);
    expect(Object.keys(g.personalAchievements!)).toEqual(["habits"]);
    expect(g.personalAchievements!.habits).toMatchObject({ rank: "gold", runId: "pq_up" });
  });

  test("two tabs completing at once save one result", async ({ context }) => {
    await seed(context, [selfRun("pq_two", 26)]);
    const a = await context.newPage();
    const b = await context.newPage();
    await open(a);
    await open(b);
    for (const p of [a, b]) {
      await card(p, "pq_two").getByTestId("pq-complete-open").click();
      await p.getByTestId("pq-report").fill(REPORT);
    }
    await Promise.all([a.getByTestId("pq-complete-submit").click(), b.getByTestId("pq-complete-submit").click()]);
    for (const p of [a, b]) await expect(p.getByTestId("pq-result")).toHaveAttribute("data-rank", "silver");
    await a.waitForTimeout(300);
    const g = await game(a);
    expect(g.personalLedger).toHaveLength(1);
    expect(g.personalRuns!.filter((r) => r.status === "completed")).toHaveLength(1);
  });

  test("AYRA data (В-24): two quests sharing day plans — 3 of 30 plans deleted before completion: Silver 27 for discipline, the 22 reviews give trading Bronze 22", async ({ context, page }) => {
    const days = Array.from({ length: 30 }, (_, i) => addDays(START, i));
    // three plans deleted before completion
    const plans = days.map((day, i) => ({ date: day, bias: [{ instrument: "EURUSD", direction: "bullish" }], levels: [{ instrument: "EURUSD", price: 1.0832, label: "POI" }], events: [], checklist: [], createdAt: atOn(day, "07:00"), firstSavedAt: atOn(day, "07:00"), updatedAt: atOn(day, "07:00"), ...(i < 3 ? { deletedAt: atOn(day, "20:00") } : {}) }));
    const notes = days.slice(0, 22).map((day, i) => ({ id: `rev${i}`, templateKey: "session_review", title: "", body: `Итог сессии ${i + 1}: держался плана, вошёл только по сетапу, стоп не двигал; вывод — ждать подтверждения.`, tags: [], pinned: false, createdAt: atOn(day, "18:00"), updatedAt: atOn(day, "18:00"), archivedAt: null }));
    const appRun = (id: string, category: string, createdAt: string) => ({ ...selfRun(id, 0), category, verification: "app", createdAt, marks: [] });
    await seed(context, [appRun("pq_disc", "discipline", atOn(START, "08:00")), appRun("pq_trad", "trading", atOn(START, "09:00"))], { ayra_journal_v1: journal({ plans, notes }) });
    await open(page);
    let dlg = await complete(page, "pq_disc");
    await expect(dlg.getByTestId("pq-result")).toHaveAttribute("data-days", "27"); // 30 − 3 deleted plans
    await expect(dlg.getByTestId("pq-result")).toHaveAttribute("data-rank", "silver");
    await page.getByTestId("pq-complete").getByRole("button", { name: "Готово" }).first().click();
    dlg = await complete(page, "pq_trad");
    // the 27 plans are the discipline quest's; trading keeps the 22 reviews
    await expect(dlg.getByTestId("pq-result")).toHaveAttribute("data-days", "22");
    await expect(dlg.getByTestId("pq-result")).toHaveAttribute("data-rank", "bronze");
  });

  test("Asia/Tbilisi: at 20:30 UTC on day 30 it is already day 31 there — completion is open", async ({ context, page }) => {
    await seed(context, [selfRun("pq_tb", 29)], {}, { profile: { ...baseGame().profile, timezone: "Asia/Tbilisi" } });
    await open(page, `${DAY30}T20:30:00.000Z`);
    await expect(card(page, "pq_tb").getByTestId("pq-awaiting")).toBeVisible();
    await complete(page, "pq_tb");
    await expect(page.getByTestId("pq-result")).toHaveAttribute("data-rank", "gold");
  });

  for (const [width, lang] of [[390, "ru"], [1440, "en"]] as const) {
    test(`${width}px ${lang.toUpperCase()}: completion form, result, history and achievements fit; screenshots`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const title = lang === "ru" ? "Без телефона перед сном" : "No phone before bed";
      const report = lang === "ru" ? REPORT : "Thirty days: phone away before bed almost every evening, I fall asleep faster; slipped on weekends, keeping the rhythm.";
      await seed(
        context,
        [selfRun("pq_s1", 27, { title }), selfRun("pq_done", 22, { category: "learning", title: lang === "ru" ? "Урок каждый день" : "A lesson a day", status: "completed", report: { at: atOn(DAY31, "09:00"), text: report }, result: { rank: "bronze", days: 22, day: DAY31, at: atOn(DAY31, "09:00"), verification: "self", marks: [] } })],
        lang === "en" ? { ayra_lang: "en" } : {},
        { personalAchievements: { learning: { rank: "bronze", runId: "pq_done", day: DAY31, verification: "self" } }, personalLedger: [{ runId: "pq_done", questId: "pqq_pq_done", category: "learning", rank: "bronze", days: 22, xp: 0, day: DAY31, at: atOn(DAY31, "09:00"), verification: "self" }] }
      );
      await open(page);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(await overflow()).toBe(0);
      await page.screenshot({ path: `test-results/qh84-awaiting-${width}-${lang}.png`, fullPage: true });
      await card(page, "pq_s1").getByTestId("pq-complete-open").click();
      await page.getByTestId("pq-report").fill(report);
      await page.screenshot({ path: `test-results/qh84-form-${width}-${lang}.png` });
      await page.getByTestId("pq-complete-submit").click();
      await expect(page.getByTestId("pq-result")).toHaveAttribute("data-rank", "silver");
      await page.screenshot({ path: `test-results/qh84-result-${width}-${lang}.png` });
      await page.keyboard.press("Escape");
      await page.getByTestId("pq-history").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/qh84-history-${width}-${lang}.png` });
      await page.goto("/profile?tab=achievements");
      await page.getByTestId("pq-achievements").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/qh84-achievements-${width}-${lang}.png` });
      expect(await overflow()).toBe(0);
    });
  }
});
