import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";

// NEW USER ACCEPTANCE (before QH-7): a brand-new account in the isolated test environment (fake Supabase, local build).
// Collects facts and screenshots for the report; asserts only what the rules say for sure.

const FAKE = "http://127.0.0.1:54329";
/** Screenshots for the acceptance report: only when NUA_SHOTS names a folder (never in CI). */
const SHOTS = process.env.NUA_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const log = (label: string, v: unknown) => console.log(`NUA ${label}: ${JSON.stringify(v)}`);
const userIdOf = async (page: Page, email: string) => (await (await page.request.get(`${FAKE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
const gameOf = (page: Page, id: string) => page.evaluate((u) => JSON.parse(localStorage.getItem(`ayra:${u}:ayra_demo_v1`) || "{}"), id);
const journalOf = (page: Page, id: string) => page.evaluate((u) => JSON.parse(localStorage.getItem(`ayra:${u}:ayra_journal_v1`) || "{}"), id);
const cloudRows = async (page: Page, email: string) => (await (await page.request.get(`${FAKE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Array<{ table: string; id: string; data: Record<string, unknown> }>;
const summary = (g: Record<string, any>) => ({
  level: g.level, xp: g.xp, coins: g.coins, streak: g.currentStreak, shields: g.streakShieldsAvailable,
  history: (g.history || []).map((h: any) => `${h.questId}:${h.xp}/${h.coins}`), achievements: Object.keys(g.achievements || {}).filter((k) => g.achievements[k]),
  firstActions: g.firstActions, done: g.completedQuestsToday, mode: g.questDay?.mode, core: g.questDay?.core, catalog: g.questDay?.catalogVersion,
  equipment: g.equipment, titles: g.unlockedTitles, chronicle: (g.chronicle || []).map((c: any) => c.type),
});

/** The onboarding, step by step, with a screenshot of each screen (phone width). */
async function onboard(page: Page, nickname: string, prefix: string) {
  await page.waitForURL("**/awakening**", { timeout: 15000 });
  await page.waitForTimeout(800);
  await shot(page, `${prefix}-01-awakening-first`);
  const nick = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
  await expect(async () => {
    if (await nick.isVisible()) {
      await nick.fill(nickname, { timeout: 3000 });
      await page.waitForTimeout(300);
      await expect(nick).toHaveValue(nickname, { timeout: 1000 });
      await page.locator('button:has-text("Продолжить")').first().click({ timeout: 3000 });
    }
    await expect(nick).toBeHidden({ timeout: 3000 });
  }).toPass({ timeout: 45000 });
  let n = 2;
  const step = async (sel: string) => {
    await shot(page, `${prefix}-${String(n++).padStart(2, "0")}-awakening`);
    await page.click(sel);
  };
  await step('button:has-text("Продолжить")');
  await step('button:has-text("Продолжить")');
  await step('button:has-text("18–24 года")');
  await page.click('button:has-text("Продолжить")');
  await step('button:has-text("Пропустить шаг целиком")');
  await step('button:has-text("1–2 года")');
  await page.click('button:has-text("Продолжить")');
  await step('button:has-text("Крипто")');
  await page.click('button:has-text("Продолжить")');
  await step('button:has-text("Дисциплина")');
  await page.click('button:has-text("Продолжить")');
  await step('button:has-text("Пропустить необязательные вопросы")');
  await step('button:has-text("Пропустить шаг целиком")');
  await step('button:has-text("Начать")');
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
}

test.describe.configure({ mode: "serial" });
test.describe("NEW USER ACCEPTANCE", () => {
  test.setTimeout(300_000);
  test.use({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });

  const email = `Newbie_${Date.now()}@example.com`;
  let userId = "";

  test("1–2. registration, onboarding, initial state, sign out and in, RU/EN", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    await shot(page, "a-00-first-visit-390");
    await signIn(page, email);
    await onboard(page, "Newbie", "a");
    userId = await userIdOf(page, email);
    await page.waitForTimeout(1500);
    await shot(page, "a-20-home-after-onboarding-390");
    const g0 = await gameOf(page, userId);
    const j0 = await journalOf(page, userId);
    log("initial game", summary(g0));
    log("initial journal", { trades: (j0.trades || []).length, plans: (j0.plans || []).length, notes: (j0.notes || []).length, accounts: (j0.accounts || []).length });
    expect(g0.level).toBe(1);
    expect((j0.trades || []).length).toBe(0);
    expect((j0.plans || []).length).toBe(0);
    expect((j0.notes || []).length).toBe(0);

    // Quest Hub, first day: every mode only viewed (nothing paid, nothing changes)
    await page.goto("/quests");
    await expect(page.getByTestId("missions")).toBeVisible();
    await page.waitForTimeout(1000);
    await shot(page, "a-30-quests-first-day-390");
    const modes: Record<string, string[]> = {};
    for (const m of ["trading", "study", "recovery", "rest"]) {
      await page.getByTestId(`mode-${m}`).click();
      await page.waitForTimeout(400);
      modes[m] = await page.locator('[data-testid="missions"] [data-testid^="quest-card-"]').evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") || "").replace("quest-card-", "")));
      await shot(page, `a-31-mode-${m}-390`);
    }
    log("modes", modes);
    expect(modes.trading).toEqual(["q_bias", "q_riskcheck", "q_reflect"]);
    expect(modes.study).toEqual(["m_observation", "m_backtest", "m_lesson"]);
    expect(modes.recovery).toEqual(["m_day_state", "m_mistake", "m_plan_tomorrow"]);
    expect(modes.rest).toEqual([]);
    await expect(page.getByTestId("rest-panel")).toBeVisible();
    // the History tab right after registration
    await page.getByTestId("mode-trading").click();
    await page.goto("/quests?tab=history");
    await page.waitForTimeout(1000);
    await shot(page, "a-40-history-empty-390");
    const histText = await page.getByTestId("hub-panel").innerText();
    log("history tab text", histText.slice(0, 600));
    expect((await gameOf(page, userId)).history.length).toBe((g0.history || []).length);

    // sign out and in again: the same account state
    await page.goto("/settings");
    await page.waitForTimeout(800);
    await shot(page, "a-50-settings-390");
    await page.goto("/logout");
    await page.waitForTimeout(1500);
    await shot(page, "a-51-after-logout-390");
    log("after logout url", page.url());
    await signIn(page, email);
    await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth"), { timeout: 20000 });
    await page.waitForTimeout(1500);
    log("after sign-in url", page.url());
    const g1 = await gameOf(page, userId);
    expect({ level: g1.level, xp: g1.xp, coins: g1.coins, name: g1.name }).toEqual({ level: g0.level, xp: g0.xp, coins: g0.coins, name: g0.name });

    // RU → EN → RU (a signed-in account switches the language in Settings)
    await page.goto("/settings");
    await page.getByTestId("settings-list-interface").click();
    await page.waitForTimeout(500);
    await shot(page, "a-59-settings-interface-390");
    await page.getByRole("button", { name: /English/ }).first().click();
    await page.waitForTimeout(800);
    await page.goto("/quests");
    await page.waitForTimeout(800);
    await shot(page, "a-60-quests-en-390");
    log("en heading", await page.locator("#missions-title").innerText());
    await page.goto("/settings");
    await page.getByTestId("settings-list-interface").click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Русский|Russian/ }).first().click();
    await page.waitForTimeout(500);
    await page.goto("/quests");
    log("ru heading", await page.locator("#missions-title").innerText());
  });

  test("4. first rewards through the Journal: 40 XP + 10 Coins once, reload, second tab, cap of three", async ({ page, context }) => {
    await signIn(page, email);
    await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth"), { timeout: 20000 });
    userId = await userIdOf(page, email);
    await page.request.get(`${FAKE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
    await page.reload();
    await page.waitForTimeout(1500);
    const g0 = await gameOf(page, userId);
    log("before first plan", summary(g0));

    // QH-6.6: the three trading quests are accepted first (accepting gives nothing)
    await page.goto("/quests");
    for (const id of ["q_bias", "q_riskcheck", "q_reflect"]) await page.getByTestId(`quest-card-${id}`).getByTestId("quest-accept").click();
    await expect(page.getByTestId("quest-card-q_reflect").getByTestId("quest-status")).toHaveText("В процессе");
    expect((await gameOf(page, userId)).coins).toBe(g0.coins);

    // the day plan: an empty direction row → instrument + direction, a level with a price
    await page.goto("/journal?tab=plan");
    await page.waitForTimeout(1500);
    await shot(page, "b-10-journal-plan-empty-390");
    await page.locator("#plan-bias").getByRole("button", { name: /Добавить/ }).click();
    await page.locator("#plan-bias input").first().fill("EURUSD");
    await page.waitForTimeout(800);
    let g = await gameOf(page, userId);
    log("after instrument only", { done: g.completedQuestsToday, xp: g.xp, coins: g.coins });
    expect(g.completedQuestsToday?.q_bias).toBeUndefined(); // no direction, no level yet
    await page.locator("#plan-bias").getByRole("button", { name: /Бычий/ }).click();
    await page.waitForTimeout(800);
    g = await gameOf(page, userId);
    expect(g.completedQuestsToday?.q_bias).toBeUndefined(); // no level yet
    await page.locator("#plan-levels").getByRole("button", { name: /Добавить/ }).click();
    await page.locator('#plan-levels input[type="number"]').first().fill("1.0832");
    // saved: ready to verify; the save itself pays nothing
    await expect(page.getByTestId("quest-ready-bar")).toContainText("«Подготовка»");
    expect((await gameOf(page, userId)).completedQuestsToday?.q_bias).toBeUndefined();
    await page.getByTestId("quest-ready-verify").click();
    await expect.poll(async () => (await gameOf(page, userId)).completedQuestsToday?.q_bias, { timeout: 15000 }).toBe(true);
    const g1 = await gameOf(page, userId);
    log("after Preparation", summary(g1));
    await shot(page, "b-11-journal-plan-filled-390");
    const bias = g1.history.find((h: any) => h.questId === "q_bias");
    expect(bias).toMatchObject({ xp: 40, coins: 10 });

    // the same plan saved again, a reload, a second tab: nothing more
    await page.locator("#plan-bias input").nth(1).fill("Ждём ретест уровня");
    await page.waitForTimeout(1200);
    await page.reload();
    await page.waitForTimeout(1500);
    const tab2 = await context.newPage();
    await tab2.goto("/quests");
    await page.waitForTimeout(2000);
    const g2 = await gameOf(page, userId);
    expect(g2.history.filter((h: any) => h.questId === "q_bias")).toHaveLength(1);
    expect(g2.coins).toBe(g1.coins);
    await tab2.close();

    // risk control: a limit and the standard checklist item
    await page.locator('#plan-limits input[type="number"]').last().fill("3");
    await page.waitForTimeout(800);
    await page.locator("#plan-checklist").getByText("Проверил лимиты риска").click();
    await page.getByTestId("quest-ready-verify").click();
    await expect.poll(async () => (await gameOf(page, userId)).completedQuestsToday?.q_riskcheck, { timeout: 15000 }).toBe(true);
    // day review: a «Session review» note of 80+ own characters
    await page.goto("/journal?tab=notes&new=session_review");
    const modal = page.getByTestId("note-modal");
    await expect(modal).toBeVisible();
    await shot(page, "b-20-note-session-review-390");
    await modal.locator("textarea").fill("Итог сессии: два входа по плану, один пропуск без сожалений; риск держал в пределах лимита дня.");
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByTestId("quest-ready-verify").click();
    await expect.poll(async () => (await gameOf(page, userId)).completedQuestsToday?.q_reflect, { timeout: 15000 }).toBe(true);
    const g3 = await gameOf(page, userId);
    log("after three missions", summary(g3));

    // a fourth mission in another mode: not paid (three a day)
    await page.goto("/quests");
    await page.getByTestId("mode-study").click();
    await page.getByTestId("mode-activate").click();
    await page.waitForTimeout(800);
    // the three done slots stay after the mode change: the day has no free slot, so «Lesson» is not even offered
    await expect(page.getByTestId("quest-card-m_lesson")).toHaveCount(0);
    await page.goto("/journal?tab=notes&new=lesson");
    await page.getByTestId("note-modal").locator("textarea").fill("Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.");
    await page.getByTestId("note-modal").getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.waitForTimeout(2500);
    const g4 = await gameOf(page, userId);
    log("after a 4th mission attempt", summary(g4));
    expect(g4.completedQuestsToday?.m_lesson).toBeUndefined();
    expect(Object.keys(g4.missionLedger?.claims || {})).toHaveLength(3);
    // the found bug (High): a «Session review» note in study paid «Day review» around the claim — must not be a 4th
    await page.goto("/journal?tab=notes&new=session_review");
    await page.getByTestId("note-modal").locator("textarea").fill("Итог сессии в учёбе: разобрал три графика, записал вывод о ложных пробоях и о риске на завтра.");
    await page.getByTestId("note-modal").getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.waitForTimeout(2500);
    const g4b = await gameOf(page, userId);
    log("after a session note in study (3 already paid)", { coins: g4b.coins, history: g4b.history.length });
    expect(g4b.coins).toBe(g4.coins);
    expect(g4b.history.filter((h: any) => h.questId === "q_reflect")).toHaveLength(1);

    // a self-report: XP only, it is not a mission
    await page.goto("/quests");
    await page.waitForTimeout(800);
    const self = page.locator('[data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-complete") }).first();
    const selfId = ((await self.getAttribute("data-testid")) || "").replace("quest-card-", "");
    await self.getByTestId("quest-complete").click();
    await page.waitForTimeout(1200);
    const g5 = await gameOf(page, userId);
    log("after a self-report", { selfId, coinsDelta: g5.coins - g4.coins, xpDelta: g5.xp - g4.xp, core: await page.getByTestId("core-count").innerText() });
    expect(g5.coins).toBe(g4.coins);
    await shot(page, "b-30-quests-after-rewards-390");
    await page.goto("/quests?tab=history");
    await page.getByTestId("history-toggle").click();
    await page.waitForTimeout(500);
    await shot(page, "b-31-history-after-rewards-390");

    // the journal went to the cloud
    await page.waitForTimeout(3000);
    const rows = await cloudRows(page, email);
    log("cloud rows", rows.map((r) => r.table));
    expect(rows.some((r) => r.table === "journal_day_plans")).toBe(true);
    expect(rows.some((r) => r.table === "journal_notes")).toBe(true);
  });

  test("6. second device of the same account; another account; offline", async ({ browser }) => {
    // the second device: same account, a new browser
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const b = await ctxB.newPage();
    await signIn(b, email);
    await b.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth"), { timeout: 20000 });
    await b.waitForTimeout(1500);
    log("device B url", b.url());
    await shot(b, "c-10-device-b-landing-390");
    if (b.url().includes("/awakening")) log("device B", "asks the onboarding again");
    await b.goto("/journal?tab=notes");
    await b.waitForTimeout(4000);
    const jb = await journalOf(b, userId);
    const gb = await gameOf(b, userId);
    log("device B journal", { plans: (jb.plans || []).length, notes: (jb.notes || []).length });
    log("device B game", summary(gb));
    await b.goto("/quests");
    await b.waitForTimeout(3000);
    const gb2 = await gameOf(b, userId);
    log("device B game after Quests", summary(gb2));
    await shot(b, "c-11-device-b-quests-390");

    // another account: nothing of the first one
    const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const c = await ctxC.newPage();
    const other = `Other_${Date.now()}@example.com`;
    await signIn(c, other);
    await c.waitForURL("**/awakening**", { timeout: 20000 });
    const otherId = await userIdOf(c, other);
    const jc = await journalOf(c, otherId);
    log("other account journal", { plans: (jc.plans || []).length, notes: (jc.notes || []).length });
    expect((jc.plans || []).length + (jc.notes || []).length).toBe(0);
    expect((await cloudRows(c, other)).length).toBe(0);

    // offline on device B: a note is kept and goes up when the network is back; nothing paid twice
    await b.goto("/journal?tab=notes&new=idea");
    await expect(b.getByTestId("note-modal")).toBeVisible();
    await ctxB.setOffline(true);
    await b.getByTestId("note-modal").locator("textarea").fill("Наблюдение без сети: EURUSD снял азиатский максимум и вернулся в диапазон.");
    await b.getByTestId("note-modal").getByRole("button", { name: "Сохранить", exact: true }).click();
    await b.waitForTimeout(2000);
    await shot(b, "c-20-offline-saved-390");
    const before = (await cloudRows(b, email)).filter((r) => r.table === "journal_notes").length;
    await ctxB.setOffline(false);
    await expect.poll(async () => (await cloudRows(b, email)).filter((r) => r.table === "journal_notes").length, { timeout: 30000 }).toBeGreaterThan(before);
    log("offline note synced", true);
    await ctxB.close();
    await ctxC.close();
  });
});
