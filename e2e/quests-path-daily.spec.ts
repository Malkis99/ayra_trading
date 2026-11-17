import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame } from "./helpers/quests";

// QH-8.3 «My path» daily journey: the 30-day calendar (done / missed / today / ahead), completion apart from the calendar,
// self-report marks (today only, once), Journal-confirmed days (real records only), chapters, the quest diary, two tabs,
// reloads, time zones. Nothing gives XP or Coins. The clock is fixed so day boundaries never depend on when CI runs.

const NOW = "2026-11-20T10:00:00.000Z"; // Friday; 14:00 in Tbilisi
const TODAY = "2026-11-20";
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const atOn = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
const journal = (over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 6, accounts: [], trades: [], plans: [], weekPlans: [], noTrades: [], notes: [], ...over });
const lesson = (id: string, day: string, body: string, over: Record<string, unknown> = {}) => ({ id, templateKey: "lesson", title: "", body, tags: [], pinned: false, createdAt: atOn(day, "09:00"), updatedAt: atOn(day, "09:00"), archivedAt: null, ...over });
const LESSON_A = "Урок: жду закрытия свечи над уровнем и только потом вхожу по плану, без спешки и догадок.";
const LESSON_B = "Урок: стоп ставлю за структуру, а не по сумме; размер позиции считаю от стопа, не наоборот.";

type Run = { id: string; marks: Array<{ day: string; savedOn: string; source: string; at: string }>; notes?: Array<{ day: string; savedOn: string; done: string; hard: string }> };
const runsOf = async (page: Page) => ((await readGame(page)) as unknown as { personalRuns?: Run[] }).personalRuns ?? [];

const progress = { level: 5, xp: 90, coins: 260, history: [{ questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-10", at: "2026-11-10T09:00:00.000Z" }] };
const keep = (g: Record<string, unknown>) => ({ level: g.level, xp: g.xp, coins: g.coins, history: g.history, achievements: g.achievements, coinLog: g.coinLog });

function seededRun(over: Record<string, unknown> & { id: string; category: string; verification: string }) {
  return { questId: `pqq_${over.id}`, title: `Квест ${over.id}`, goal: "Цель", dailyAction: "Одно действие в день", startState: "Сейчас", expectedResult: "Потом", startDay: TODAY, createdAt: atOn(TODAY, "08:00"), marks: [], status: "active", ...over };
}
const selfMark = (day: string) => ({ day, savedOn: day, at: atOn(day, "19:00"), source: "self" });

async function open(page: Page, now = NOW) {
  await page.clock.install({ time: new Date(now) });
  await page.goto("/quests?tab=path");
  await expect(page.getByTestId("pq-main")).toBeVisible();
}
const card = (page: Page, id: string) => page.locator(`[data-testid="pq-card"][data-run="${id}"]`);
async function seed(context: BrowserContext, runs: unknown[], extra: Record<string, string> = {}, game: Record<string, unknown> = {}) {
  await seedGame(context, baseGame({ lastQuestDate: addDays(TODAY, -1), ...progress, personalRuns: runs, ...game }), extra);
}

test.describe("My path — the daily journey (QH-8.3)", () => {
  test.use({ reducedMotion: "reduce" });

  test("self-report: calendar, completion apart from the day number, mark today once; reload keeps it; nothing given", async ({ context, page }) => {
    const start = addDays(TODAY, -11); // today is day 12
    await seed(context, [seededRun({ id: "pq_self", category: "habits", verification: "self", startDay: start, marks: [selfMark(start), selfMark(addDays(start, 1)), selfMark(addDays(start, 3))] })]);
    await open(page);
    const before = await readGame(page);
    const c = card(page, "pq_self");
    await expect(c.getByTestId("pq-card-day")).toHaveText("День 12 из 30");
    await expect(c.getByTestId("pq-card-done")).toHaveText("3 из 30");
    await expect(c.getByTestId("pq-card-missed")).toHaveText("Пропущено: 8");
    await expect(c.getByTestId("pq-chapter-line")).toHaveAttribute("data-chapter", "resistance");
    await expect(c.getByTestId("pq-ring")).toHaveAttribute("aria-label", "Выполнено дней: 3 из 30");

    // a double click marks once
    await c.getByTestId("pq-mark").dblclick();
    await expect(c.getByTestId("pq-today-done")).toHaveText("Выполнено сегодня · самоотчёт");
    await expect(c.getByTestId("pq-card-done")).toHaveText("4 из 30");
    await expect(c.getByTestId("pq-card-day")).toHaveText("День 12 из 30"); // the calendar does not move with a mark
    await page.waitForTimeout(300);
    const marks = (await runsOf(page))[0].marks;
    expect(marks.filter((m) => m.day === TODAY)).toHaveLength(1);
    expect(marks.find((m) => m.day === TODAY)).toMatchObject({ savedOn: TODAY, source: "self" });

    // the path: calendar states, today highlighted, history of marks
    await c.getByTestId("pq-card-open").click();
    const d = page.getByTestId("pq-details");
    const day = (n: number) => d.locator(`[data-testid="pq-day"][data-n="${n}"]`);
    await expect(day(1)).toHaveAttribute("data-state", "confirmed");
    await expect(day(3)).toHaveAttribute("data-state", "missed");
    await expect(day(12)).toHaveAttribute("data-state", "confirmed");
    await expect(day(12)).toHaveAttribute("aria-current", "date");
    await expect(day(13)).toHaveAttribute("data-state", "future");
    await expect(day(3)).toContainText("пропущен"); // the screen reader text
    await expect(d.getByTestId("pq-mark-item")).toHaveCount(4);
    // the time of a mark is shown in the account time zone (UTC here), not the device zone
    await expect(d.locator(`[data-testid="pq-mark-item"][data-day="${start}"]`)).toContainText("Самоотчёт · в 19:00");
    await expect(d.getByTestId("pq-chapter")).toContainText("Сопротивление");
    await expect(d.getByTestId("pq-chapter-next")).toHaveText("Дальше — «Укрепление», с 15-го дня");

    await page.reload();
    await expect(card(page, "pq_self").getByTestId("pq-card-done")).toHaveText("4 из 30");
    expect(keep((await readGame(page)) as unknown as Record<string, unknown>)).toEqual(keep(before as unknown as Record<string, unknown>));
  });

  test("AYRA data: only a real Journal record of that day confirms — not an invented key, an imported note or a copied text", async ({ context, page }) => {
    const start = addDays(TODAY, -3); // day 4
    const notes = [
      lesson("n_y3", addDays(TODAY, -3), LESSON_A), // day 1: a real lesson
      lesson("n_imp", addDays(TODAY, -2), LESSON_B, { importBatchId: "batch_1" }), // day 2: imported
      lesson("n_copy", addDays(TODAY, -1), LESSON_A), // day 3: a copy of day 1's text
    ];
    // a forged mark in the game state pointing to a note that does not exist
    const forged = [{ day: addDays(TODAY, -1), savedOn: addDays(TODAY, -1), at: "", source: "app", sourceKey: "note:forged" }];
    await seed(context, [seededRun({ id: "pq_app", category: "learning", verification: "app", startDay: start, marks: forged })], { ayra_journal_v1: journal({ notes }) });
    await open(page);
    const c = card(page, "pq_app");
    await expect(page.getByTestId("pq-main")).toHaveAttribute("data-journal", "ready");
    await expect(c.getByTestId("pq-card-done")).toHaveText("1 из 30");
    await expect(c.getByTestId("pq-today-waiting")).toContainText("Урок");
    await expect(c.getByTestId("pq-open-journal")).toHaveAttribute("href", "/journal");
    await c.getByTestId("pq-card-open").click();
    const d = page.getByTestId("pq-details");
    const states = await d.locator('[data-testid="pq-day"]').evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute("data-state")));
    expect(states).toEqual(["confirmed", "missed", "missed", "today", "future"]);
    await expect(d.getByTestId("pq-mark-item")).toHaveCount(1);
    await expect(d.getByTestId("pq-mark-item")).toContainText("Запись Журнала: Урок");
    // no «Mark as done» for a data-confirmed quest
    await expect(d.getByTestId("pq-mark")).toHaveCount(0);
  });

  test("AYRA data: a lesson saved today confirms today; the same note never confirms two days", async ({ context, page }) => {
    await seed(context, [seededRun({ id: "pq_app2", category: "learning", verification: "app", startDay: addDays(TODAY, -1) })], { ayra_journal_v1: journal({ notes: [lesson("n_today", TODAY, LESSON_B)] }) });
    await open(page);
    const c = card(page, "pq_app2");
    await expect(c.getByTestId("pq-today-done")).toHaveText("Подтверждено записью Журнала: Урок");
    await expect(c.getByTestId("pq-card-done")).toHaveText("1 из 30");
    await expect(c.getByTestId("pq-card-missed")).toHaveText("Пропущено: 1");
  });

  test("chapters by the calendar: days 1, 7, 8, 14, 15, 21, 22, 30", async ({ browser }) => {
    const cases: Array<[number, string, string]> = [
      [1, "awareness", "Дальше — «Сопротивление», с 8-го дня"],
      [7, "awareness", "Дальше — «Сопротивление», с 8-го дня"],
      [8, "resistance", "Дальше — «Укрепление», с 15-го дня"],
      [14, "resistance", "Дальше — «Укрепление», с 15-го дня"],
      [15, "strengthening", "Дальше — «Закрепление», с 22-го дня"],
      [21, "strengthening", "Дальше — «Закрепление», с 22-го дня"],
      [22, "consolidation", "Последняя глава пути"],
      [30, "consolidation", "Последняя глава пути"],
    ];
    for (const [n, chapter, next] of cases) {
      const ctx = await browser.newContext();
      await seed(ctx, [seededRun({ id: `pq_ch${n}`, category: "habits", verification: "self", startDay: addDays(TODAY, -(n - 1)) })]);
      const page = await ctx.newPage();
      await open(page);
      const c = card(page, `pq_ch${n}`);
      await expect(c.getByTestId("pq-card-day")).toHaveText(`День ${n} из 30`);
      await expect(c.getByTestId("pq-chapter-line")).toHaveAttribute("data-chapter", chapter);
      await c.getByTestId("pq-card-open").click();
      await expect(page.getByTestId("pq-chapter")).toHaveAttribute("data-chapter", chapter);
      await expect(page.getByTestId("pq-chapter-next")).toHaveText(next);
      if (n === 30) await expect(c.getByTestId("pq-card-left")).toHaveText("Сегодня последний день");
      await ctx.close();
    }
  });

  test("Asia/Tbilisi: after 20:00 UTC it is already the next game day — a mark is for that day (day 8, chapter two)", async ({ context, page }) => {
    // 21:30 UTC on the 20th is 01:30 on the 21st in Tbilisi
    await seed(context, [seededRun({ id: "pq_tz", category: "habits", verification: "self", startDay: "2026-11-14" })], {}, { profile: { ...baseGame().profile, timezone: "Asia/Tbilisi" } });
    await open(page, "2026-11-20T21:30:00.000Z");
    const c = card(page, "pq_tz");
    await expect(c.getByTestId("pq-card-day")).toHaveText("День 8 из 30");
    await expect(c.getByTestId("pq-chapter-line")).toHaveAttribute("data-chapter", "resistance");
    await c.getByTestId("pq-mark").click();
    await expect(c.getByTestId("pq-today-done")).toBeVisible();
    expect((await runsOf(page))[0].marks.map((m) => m.day)).toEqual(["2026-11-21"]);
  });

  test("the diary: today and yesterday (yesterday never confirms), kept after reload and after abandoning", async ({ context, page }) => {
    await seed(context, [seededRun({ id: "pq_diary", category: "habits", verification: "self", startDay: addDays(TODAY, -4) })]);
    await open(page);
    await card(page, "pq_diary").getByTestId("pq-card-open").click();
    const d = page.getByTestId("pq-details");
    await expect(d.getByTestId("pq-diary")).toContainText("опыт за записи не начисляется");
    await d.getByTestId("pq-diary-save").click();
    await expect(d.getByTestId("pq-diary-error")).toHaveText("Заполните хотя бы одно поле.");
    await d.getByTestId("pq-diary-done").fill("Убрал телефон в 22:00");
    await d.getByTestId("pq-diary-learned").fill("Вечер спокойнее");
    await d.getByTestId("pq-diary-save").click();
    await expect(d.getByTestId("pq-diary-entry")).toHaveCount(1);
    // yesterday: kept, labelled, does not confirm the day
    await d.getByTestId("pq-diary-day-yesterday").click();
    await expect(d.getByTestId("pq-diary-late")).toContainText("не подтвердит действие");
    await d.getByTestId("pq-diary-hard").fill("Хотелось проверить ленту");
    await d.getByTestId("pq-diary-save").click();
    await expect(d.getByTestId("pq-diary-entry")).toHaveCount(2);
    await expect(d.locator(`[data-testid="pq-diary-entry"][data-day="${addDays(TODAY, -1)}"]`).getByTestId("pq-diary-entry-late")).toBeVisible();
    await expect(d.locator(`[data-testid="pq-day"][data-n="4"]`)).toHaveAttribute("data-state", "missed");
    let runs = await runsOf(page);
    expect(runs[0].marks).toHaveLength(0);
    expect(runs[0].notes!.map((n) => [n.day, n.savedOn])).toEqual([[addDays(TODAY, -1), TODAY], [TODAY, TODAY]]);

    await page.reload();
    await card(page, "pq_diary").getByTestId("pq-card-open").click();
    await expect(page.getByTestId("pq-diary-entry")).toHaveCount(2);
    // abandon: the notes stay and the path is still readable from the history
    await page.getByTestId("pq-abandon").click();
    await page.getByTestId("pq-abandon-confirm-yes").click();
    await page.getByTestId("pq-history-open").click();
    await expect(page.getByTestId("pq-details").getByTestId("pq-diary-entry")).toHaveCount(2);
    await expect(page.getByTestId("pq-details").getByTestId("pq-diary-form")).toHaveCount(0);
    await expect(page.getByTestId("pq-details").getByTestId("pq-abandon")).toHaveCount(0);
    runs = await runsOf(page);
    expect(runs[0].notes).toHaveLength(2);
  });

  test("two tabs: a mark in one shows in the other; both marking at once save one mark", async ({ context }) => {
    await seed(context, [seededRun({ id: "pq_tabs", category: "habits", verification: "self", startDay: addDays(TODAY, -2) })]);
    const a = await context.newPage();
    const b = await context.newPage();
    await open(a);
    await open(b);
    // at the same moment the other tab may already show the day done (its button is gone): that is fine
    const tap = (p: Page) => card(p, "pq_tabs").getByTestId("pq-mark").click({ timeout: 3000 }).catch(() => undefined);
    await Promise.all([tap(a), tap(b)]);
    for (const p of [a, b]) await expect(card(p, "pq_tabs").getByTestId("pq-today-done")).toBeVisible();
    await a.waitForTimeout(300);
    expect((await runsOf(a))[0].marks).toHaveLength(1);
  });

  test("independent quests: a mark on one changes no other", async ({ context, page }) => {
    await seed(context, [
      seededRun({ id: "pq_i1", category: "habits", verification: "self", startDay: addDays(TODAY, -2) }),
      seededRun({ id: "pq_i2", category: "physical", verification: "self", startDay: addDays(TODAY, -5) }),
    ]);
    await open(page);
    await card(page, "pq_i1").getByTestId("pq-mark").click();
    await expect(card(page, "pq_i1").getByTestId("pq-card-done")).toHaveText("1 из 30");
    await expect(card(page, "pq_i2").getByTestId("pq-card-done")).toHaveText("0 из 30");
    await expect(card(page, "pq_i2").getByTestId("pq-mark")).toBeVisible();
  });

  for (const [width, lang] of [[390, "ru"], [1440, "en"]] as const) {
    test(`${width}px ${lang.toUpperCase()}: the cards and the path (calendar, chapters, diary) fit; screenshots`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const start = addDays(TODAY, -15); // day 16: chapter three
      const marks = [0, 1, 2, 4, 5, 6, 8, 9, 11, 12, 13, 14].map((i) => selfMark(addDays(start, i)));
      const notes = [{ day: addDays(TODAY, -1), savedOn: addDays(TODAY, -1), createdAt: atOn(addDays(TODAY, -1), "20:00"), at: atOn(addDays(TODAY, -1), "20:00"), done: lang === "ru" ? "Убрал телефон в 22:00" : "Phone away at 22:00", worked: lang === "ru" ? "Заснул быстрее" : "Fell asleep faster", hard: "", learned: "" }];
      await seed(
        context,
        [
          seededRun({ id: "pq_s1", category: "habits", verification: "self", title: lang === "ru" ? "Без телефона перед сном" : "No phone before bed", startDay: start, marks, notes }),
          seededRun({ id: "pq_s2", category: "learning", verification: "app", title: lang === "ru" ? "Урок каждый день" : "A lesson a day", startDay: addDays(TODAY, -6) }),
        ],
        { ayra_journal_v1: journal({ notes: [lesson("n_s1", addDays(TODAY, -6), LESSON_A), lesson("n_s2", addDays(TODAY, -4), LESSON_B)] }), ...(lang === "en" ? { ayra_lang: "en" } : {}) }
      );
      await open(page);
      await expect(page.getByTestId("pq-card")).toHaveCount(2);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(await overflow()).toBe(0);
      await page.screenshot({ path: `test-results/qh83-cards-${width}-${lang}.png`, fullPage: true });
      await card(page, "pq_s1").getByTestId("pq-card-open").click();
      const d = page.getByTestId("pq-details");
      await expect(d.getByTestId("pq-days")).toBeVisible();
      await expect(d.getByTestId("pq-chapter")).toHaveAttribute("data-chapter", "strengthening");
      await page.screenshot({ path: `test-results/qh83-path-${width}-${lang}.png` });
      await d.getByTestId("pq-diary").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/qh83-diary-${width}-${lang}.png` });
      await d.getByTestId("pq-chapter").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/qh83-chapters-${width}-${lang}.png` });
      await d.getByTestId("pq-marks").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/qh83-history-${width}-${lang}.png` });
      expect(await overflow()).toBe(0);
    });
  }
});
