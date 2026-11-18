import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Q4.5-1: the server's economy mark travels with the account's session (app_metadata.ayra_economy). A device that never
// saw the mark (a new device, a private window, cleared storage) takes it from the session; once known it never goes
// back — offline, on API errors (here the server economy is not installed: 503), in every tab. Accounts without a mark
// keep the device economy exactly as before.

const LESSON = "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.";
const game = (page: Page, id: string) => page.evaluate((u) => JSON.parse(localStorage.getItem(`ayra:${u}:ayra_demo_v1`) || "{}"), id);
const economy = (g: Record<string, unknown>) => ({ xp: g.xp, level: g.level, coins: g.coins, history: (g.history as unknown[] | undefined)?.length ?? 0 });
const stickyMode = (page: Page, id: string) => page.evaluate((u) => localStorage.getItem(`ayra:${u}:ayra_economy_mode`), id);
const mark = (request: APIRequestContext, email: string, state: string | null) =>
  request.get(`${FAKE_SUPABASE}/__test/app-economy?email=${encodeURIComponent(email)}${state ? `&state=${state}` : ""}`);

async function newAccount(page: Page, request: APIRequestContext) {
  const email = `Mark_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Mrk${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  const at = new Date().toISOString();
  await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_notes`, {
    data: { id: "n_mark_lesson", templateKey: "lesson", title: "", body: LESSON, tags: [], pinned: false, createdAt: at, updatedAt: at, archivedAt: null },
  });
  return { email, userId };
}

/** A study day with the lesson written today on this device (the mission is ready to verify once accepted). */
async function seedDay(page: Page, userId: string) {
  const at = new Date().toISOString();
  await page.evaluate(
    ({ id, at, body }) => {
      localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: "2026-10-01T00:00:00.000Z", lastSyncAt: "2026-10-01T00:00:00.000Z" }));
      const gk = `ayra:${id}:ayra_demo_v1`;
      const g = JSON.parse(localStorage.getItem(gk) || "{}");
      // a new device has no local game yet: the onboarding was finished on the first device
      if (!g.onboarding || g.onboarding.status !== "done") g.onboarding = { status: "done", step: 5, subStep: 0, answers: {} };
      const today = g.lastQuestDate || new Date().toISOString().slice(0, 10);
      g.lastQuestDate = today;
      g.journalFirstTradeDay = null;
      g.questDay = { day: today, mode: "study", catalogVersion: 3, core: ["m_observation", "m_backtest", "m_lesson"], bonus: ["q_read_pages", "q_logic_puzzle"], studyFirst: "m_observation" };
      g.questAccepted = { day: today, at: { m_lesson: at } };
      g.completedQuestsToday = {};
      localStorage.setItem(gk, JSON.stringify(g));
      const jk = `ayra:${id}:ayra_journal_v1`;
      const j = JSON.parse(localStorage.getItem(jk) || "{}");
      j.notes = [...(j.notes || []).filter((n: { id: string }) => n.id !== "n_mark_lesson"), { id: "n_mark_lesson", templateKey: "lesson", title: "", body, tags: [], pinned: false, createdAt: at, updatedAt: at, archivedAt: null }];
      localStorage.setItem(jk, JSON.stringify(j));
    },
    { id: userId, at, body: LESSON }
  );
}

async function lessonCard(page: Page) {
  await page.goto("/quests");
  await expect(page.getByTestId("missions")).toBeVisible();
  await expect(page.getByTestId("missions-syncing")).toHaveCount(0, { timeout: 30_000 });
  const card = page.getByTestId("quest-card-m_lesson");
  await expect(card).toHaveAttribute("data-quest", "ready", { timeout: 15_000 });
  return card;
}

/** «Verify» of the ready lesson: refused as paused (the device gives nothing). */
async function expectPaused(page: Page, userId: string) {
  const card = await lessonCard(page);
  const before = await game(page, userId);
  await card.getByTestId("quest-verify").click();
  await expect(card.getByTestId("quest-verify-failure")).toContainText("Начисления сейчас приостановлены: награда не начислена.");
  await page.waitForTimeout(600);
  expect(economy(await game(page, userId))).toEqual(economy(before));
}

/** «Verify» pays on the device, as before Q4.4 (40 XP + 10 Coins). */
async function expectPaid(page: Page, userId: string) {
  const card = await lessonCard(page);
  const before = await game(page, userId);
  await card.getByTestId("quest-verify").click();
  await expect(card).toHaveAttribute("data-done", "true");
  expect((await game(page, userId)).coins - before.coins).toBe(10);
}

async function newDevice(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  return { ctx, page };
}

test.describe("Q4.5-1 the economy mark from the session (fake Supabase)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(180_000);

  test("an unmarked account keeps the device economy exactly as before", async ({ page, request }) => {
    const { userId } = await newAccount(page, request);
    await seedDay(page, userId);
    await expectPaid(page, userId);
    expect(await stickyMode(page, userId)).toBeNull();
    await expect(page.getByTestId("economy-notice")).toHaveCount(0);
  });

  test("a new device (and a private window) takes the mark from the session: no device rewards from the first load", async ({ page, request, browser }) => {
    const { email } = await newAccount(page, request);
    await mark(request, email, "migration_pending");
    for (let i = 0; i < 2; i++) {
      // each new browser context is a device that never saw the mark (empty storage, like a private window)
      const { ctx, page: device } = await newDevice(browser, email);
      const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
      await seedDay(device, userId);
      await expectPaused(device, userId);
      await expect(device.getByTestId("economy-line-mode")).toContainText("Прогресс переносится в облако");
      expect(await stickyMode(device, userId)).toBe("migration_pending");
      await ctx.close();
    }
  });

  test("cleared storage: the mark comes back from the session; the device record alone removed changes nothing", async ({ page, request }) => {
    const { email, userId } = await newAccount(page, request);
    await mark(request, email, "migration_pending");
    await seedDay(page, userId);
    await expectPaused(page, userId);
    // only the device's own record removed
    await page.evaluate((u) => localStorage.removeItem(`ayra:${u}:ayra_economy_mode`), userId);
    await expectPaused(page, userId);
    expect(await stickyMode(page, userId)).toBe("migration_pending");
    // the whole localStorage cleared (the session lives in cookies, as with Supabase): the mark is written back
    await page.evaluate(() => localStorage.clear());
    await page.goto("/");
    await expect.poll(() => stickyMode(page, userId), { timeout: 20_000 }).toBe("migration_pending");
  });

  test("offline and API errors (the server economy is not installed: 503) never reopen device rewards", async ({ page, request, context }) => {
    const { email, userId } = await newAccount(page, request);
    await mark(request, email, "migration_pending");
    await seedDay(page, userId);
    const card = await lessonCard(page);
    expect((await page.evaluate(async () => (await fetch("/api/game/day/status")).status))).toBe(503);
    await context.setOffline(true);
    const before = await game(page, userId);
    await card.getByTestId("quest-verify").click();
    await expect(card.getByTestId("quest-verify-failure")).toContainText("Начисления сейчас приостановлены");
    await page.waitForTimeout(600);
    expect(economy(await game(page, userId))).toEqual(economy(before));
    await context.setOffline(false);
    // the server «forgets» the mark (or an old token without it is used): the device keeps it
    await mark(request, email, null);
    await page.reload();
    await expectPaused(page, userId);
  });

  test("two tabs: a mark learned in one tab stops device rewards in the other at once, without a reload", async ({ page, request, context }) => {
    const { email, userId } = await newAccount(page, request);
    await seedDay(page, userId);
    const card = await lessonCard(page); // tab A: unmarked, the lesson ready
    await mark(request, email, "migration_pending");
    const second = await context.newPage(); // tab B reads the account from the auth server and learns the mark
    await second.goto("/quests");
    await expect.poll(() => stickyMode(second, userId), { timeout: 20_000 }).toBe("migration_pending");
    const before = await game(page, userId);
    await card.getByTestId("quest-verify").click();
    await expect(card.getByTestId("quest-verify-failure")).toContainText("Начисления сейчас приостановлены");
    await page.waitForTimeout(600);
    expect(economy(await game(page, userId))).toEqual(economy(before));
  });

  test("two tabs, no session change: a mode one tab saved (as from a server answer) holds in the other at once", async ({ page, request, context }) => {
    const { userId } = await newAccount(page, request);
    await seedDay(page, userId);
    const card = await lessonCard(page); // tab A: unmarked, the lesson ready
    const second = await context.newPage();
    await second.goto("/quests");
    await expect(second.getByTestId("missions")).toBeVisible();
    // tab B saves the mode only (no mark in the session, no server economy): tab A must read it right before its change
    await second.evaluate((u) => localStorage.setItem(`ayra:${u}:ayra_economy_mode`, "cloud_active"), userId);
    const before = await game(page, userId);
    await card.getByTestId("quest-verify").click();
    await expect(card.getByTestId("quest-verify-failure")).toContainText("Начисления сейчас приостановлены");
    await page.waitForTimeout(600);
    expect(economy(await game(page, userId))).toEqual(economy(before));
  });

  test("account change: the mark stays with its account; another account on the same device is not affected", async ({ page, request }) => {
    const a = await newAccount(page, request);
    await mark(request, a.email, "migration_pending");
    await seedDay(page, a.userId);
    await expectPaused(page, a.userId);
    // sign out, sign in with another (unmarked) account
    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/login" || u.pathname === "/", { timeout: 30_000 });
    const b = await newAccount(page, request);
    await seedDay(page, b.userId);
    await expectPaid(page, b.userId);
    expect(await stickyMode(page, b.userId)).toBeNull();
    expect(await stickyMode(page, a.userId)).toBe("migration_pending");
  });
});
