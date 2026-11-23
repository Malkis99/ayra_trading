import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";
const APP = "http://localhost:3001";

// Q4.4: the server game day API and who keeps the economy. The fake server answers like the real Supabase WITHOUT
// 0014–0016 unless a test installs its stand-in (/__test/economy-installed). Nothing here gives XP or Coins on the
// server: the mission award is disabled there, and outside «local» the device gives nothing.

const LESSON = "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.";
const game = (page: Page, id: string) => page.evaluate((u) => JSON.parse(localStorage.getItem(`ayra:${u}:ayra_demo_v1`) || "{}"), id);
const economy = (g: Record<string, unknown>) => ({ xp: g.xp, level: g.level, coins: g.coins, history: (g.history as unknown[] | undefined)?.length ?? 0, achievements: g.achievements });
const api = (page: Page, path: string, body?: unknown) =>
  page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, body === undefined ? { method: "GET" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    },
    { path, body }
  );

async function setUp(page: Page, request: APIRequestContext, opts: { installed: boolean; state?: string; sync?: boolean; mode?: string }) {
  await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=${opts.installed ? 1 : 0}`);
  const email = `Day_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Day${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  if (opts.state) await request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(email)}&state=${opts.state}&sync=${opts.sync ? 1 : 0}&mode=${opts.mode || "study"}`);
  // a lesson written today (on this device and in the cloud)
  const at = new Date().toISOString();
  const lesson = { id: "n_day_lesson", templateKey: "lesson", title: "", body: LESSON, tags: [], pinned: false, createdAt: at, updatedAt: at, archivedAt: null };
  await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_notes`, { data: lesson });
  await page.evaluate(
    ({ id, lesson }) => {
      localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: "2026-10-01T00:00:00.000Z", lastSyncAt: "2026-10-01T00:00:00.000Z" }));
      const gk = `ayra:${id}:ayra_demo_v1`;
      const g = JSON.parse(localStorage.getItem(gk) || "{}");
      const today = g.lastQuestDate || new Date().toISOString().slice(0, 10);
      g.lastQuestDate = today;
      g.journalFirstTradeDay = null;
      g.questDay = { day: today, mode: "study", catalogVersion: 3, core: ["m_observation", "m_backtest", "m_lesson"], bonus: ["q_read_pages", "q_logic_puzzle"], studyFirst: "m_observation" };
      g.completedQuestsToday = {};
      localStorage.setItem(gk, JSON.stringify(g));
      const jk = `ayra:${id}:ayra_journal_v1`;
      const j = JSON.parse(localStorage.getItem(jk) || "{}");
      j.notes = [...(j.notes || []), lesson];
      localStorage.setItem(jk, JSON.stringify(j));
    },
    { id: userId, lesson }
  );
  return { email, userId };
}

async function openQuests(page: Page) {
  await page.goto("/quests");
  await expect(page.getByTestId("missions")).toBeVisible();
  await expect(page.getByTestId("missions-syncing")).toHaveCount(0, { timeout: 30_000 });
}

test.describe("Q4.4 server game day API (fake Supabase)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=0`);
  });

  test("the real Supabase today (0014–0016 not applied): the API says so, the device economy works exactly as before", async ({ page, request }) => {
    const { userId } = await setUp(page, request, { installed: false });
    // Q4.5-2: every answer names the verified user it was given for (the app binds answers to it)
    expect(await api(page, "/api/game/day/status")).toEqual({ status: 503, body: { error: "server_economy_unavailable", account: userId } });
    await openQuests(page);
    await expect(page.getByTestId("economy-notice")).toHaveCount(0);
    const card = page.getByTestId("quest-card-m_lesson");
    await card.getByTestId("quest-accept").click();
    await expect(card).toHaveAttribute("data-quest", "ready");
    const before = await game(page, userId);
    await card.getByTestId("quest-verify").click();
    await expect(card).toHaveAttribute("data-done", "true");
    expect((await game(page, userId)).coins - before.coins).toBe(10); // the local reward, as before Q4.4
    expect(await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith("ayra_economy_mode")) || "none"))).toBeNull();
  });

  test("migration_pending: a clear notice, no reward on the device or on the server — and never back to local", async ({ page, request }) => {
    const { email, userId } = await setUp(page, request, { installed: true, state: "migration_pending" });
    await openQuests(page);
    await expect(page.getByTestId("economy-line-mode")).toHaveText("Прогресс переносится в облако. Пока перенос не закончен, XP и Coins не начисляются ни на устройстве, ни на сервере.");
    const card = page.getByTestId("quest-card-m_lesson");
    await card.getByTestId("quest-accept").click();
    await expect(card).toHaveAttribute("data-quest", "ready");
    const before = await game(page, userId);
    await card.getByTestId("quest-verify").click();
    await expect(card.getByTestId("quest-verify-failure")).toContainText("Начисления сейчас приостановлены: награда не начислена.");
    await page.waitForTimeout(800);
    expect(economy(await game(page, userId))).toEqual(economy(before));
    // the server «forgets» (or a request fails): the device still gives nothing
    await request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(email)}&state=local`);
    await page.reload();
    await expect(page.getByTestId("economy-line-mode")).toBeVisible();
    await expect(page.getByTestId("economy-notice")).toHaveAttribute("data-mode", "migration_pending");
  });

  test("cloud_active: the server opens and keeps the day; accept goes to the server; no reward anywhere (paused, then payouts off)", async ({ page, request }) => {
    const { email, userId } = await setUp(page, request, { installed: true, state: "cloud_active", sync: false, mode: "study" });
    await request.get(`${FAKE_SUPABASE}/__test/economy-calls?reset=1`);
    await openQuests(page);
    await expect(page.getByTestId("economy-line-mode")).toHaveText("Игровой день ведёт сервер. Серверные начисления сейчас приостановлены.");
    // the server opened the day (study, from the saved trading days) with the extras the app offered
    await expect.poll(async () => (await (await request.get(`${FAKE_SUPABASE}/__test/economy-calls`)).json()).map((c: { fn: string }) => c.fn)).toContain("game_day_open");
    const before = await game(page, userId);
    const card = page.getByTestId("quest-card-m_lesson");
    await card.getByTestId("quest-accept").click();
    await expect(card).toHaveAttribute("data-quest", /accepted|ready/);
    const st = await api(page, "/api/game/day/status");
    expect(st.body.status.day.accepted).toHaveProperty("m_lesson");
    // paused (game_sync off): nothing is checked or paid
    await card.getByTestId("quest-verify").click();
    await expect(card.getByTestId("quest-verify-failure")).toContainText("Начисления сейчас приостановлены: награда не начислена.");
    // game_sync on: the server checks fully, payouts are not switched on — nothing paid
    await request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(email)}&state=cloud_active&sync=1`);
    await page.reload();
    await expect(page.getByTestId("economy-line-mode")).toHaveText("Игровой день ведёт сервер. Начисления наград на сервере ещё не включены.");
    await page.getByTestId("quest-card-m_lesson").getByTestId("quest-verify").click();
    await expect(page.getByTestId("quest-card-m_lesson").getByTestId("quest-verify-failure")).toContainText("Запись подходит, но серверные начисления наград ещё не включены. Награда не начислена.");
    await page.waitForTimeout(800);
    expect(economy(await game(page, userId))).toEqual(economy(before));
    // the routes never sent a time or a day; the user is always the session's
    const calls = (await (await request.get(`${FAKE_SUPABASE}/__test/economy-calls`)).json()) as Array<{ fn: string; user: string; args: string[] }>;
    expect(calls.every((c) => c.user === userId)).toBe(true);
    const allowed = ["p_bonus", "p_mission", "p_mode", "p_from", "p_to", "p_days", "p_day"];
    // Q4.5-2: the claims of the verified token go only to the session functions (never a device time: p_iat is the
    // token's issue time, checked against the database's state time)
    const sessionArgs = ["p_session", "p_iat", "p_claim"];
    const sessionFns = ["game_session_check", "game_apply_reward_for_session", "game_import_snapshot", "game_achievements_for_session"];
    // Q4.5-4: the device's frozen snapshot goes to quarantine as it came (0019) — it decides nothing, credits nothing
    const snapshotArgs = ["p_snapshot", "p_install", "p_schema", "p_content"];
    expect(calls.flatMap((c) => c.args.filter((a) => !allowed.includes(a) && !(sessionFns.includes(c.fn) && sessionArgs.includes(a))
      && !(c.fn === "game_import_snapshot" && snapshotArgs.includes(a))).map((a) => `${c.fn}:${a}`))).toEqual([]);
    expect(calls.some((c) => c.fn === "game_session_check")).toBe(true);
    // the one day the routes pass is the server's own (to read the Journal for the mission check), never the client's
    expect(calls.filter((c) => c.args.includes("p_day")).map((c) => c.fn)).toEqual(calls.filter((c) => c.fn === "game_journal_for_check").map((c) => c.fn));
  });

  test("cloud_active: a dropped network changes nothing; a retry works; two tabs see the same server day", async ({ page, request, context }) => {
    await setUp(page, request, { installed: true, state: "cloud_active", sync: false, mode: "study" });
    await openQuests(page);
    await page.route("**/api/game/day/accept", (r) => r.abort("internetdisconnected"));
    const card = page.getByTestId("quest-card-m_lesson");
    await card.getByTestId("quest-accept").click();
    await expect(page.getByTestId("economy-line-notice")).toHaveText("Нет связи с сервером. Игровой день не изменён — попробуйте ещё раз.");
    expect((await api(page, "/api/game/day/status")).body.status.day.accepted).toEqual({});
    await page.unroute("**/api/game/day/accept");
    await card.getByTestId("quest-accept").click();
    await expect.poll(async () => Object.keys((await api(page, "/api/game/day/status")).body.status.day.accepted)).toEqual(["m_lesson"]);
    // a repeated accept is the same acceptance
    const again = await api(page, "/api/game/day/accept", { mission: "m_lesson" });
    expect(again.status).toBe(200);
    // another tab of the same account shows the server's day
    const second = await context.newPage();
    // (its Journal sync waits for the first tab; the acceptance comes from the server day, not from the Journal)
    await second.goto("/quests");
    await expect(second.getByTestId("missions")).toBeVisible();
    await expect(second.getByTestId("quest-card-m_lesson")).toHaveAttribute("data-quest", /accepted|ready/);
  });

  test("refusals: no session, another account's id, a forged mode, time or day, another site", async ({ page, request }) => {
    const { userId } = await setUp(page, request, { installed: true, state: "cloud_active", sync: false, mode: "study" });
    await openQuests(page);
    expect((await request.get(`${APP}/api/game/day/status`)).status()).toBe(401);
    expect((await request.post(`${APP}/api/game/day/accept`, { headers: { origin: APP }, data: { mission: "m_lesson" } })).status()).toBe(401);
    for (const body of [{ mission: "m_lesson", user_id: "00000000-0000-0000-0000-000000000bad" }, { mission: "m_lesson", day: "2030-01-01" }, { mission: "m_lesson", now: "2030-01-01T00:00:00Z" }]) {
      expect(await api(page, "/api/game/day/accept", body)).toEqual({ status: 400, body: { error: "bad_request", account: userId } }); // the session's own id, never the one sent
    }
    expect(await api(page, "/api/game/day/open", { extras: [], mode: "recovery" })).toEqual({ status: 400, body: { error: "bad_request", account: userId } }); // the session's own id, never the one sent
    expect((await request.post(`${APP}/api/game/day/accept`, { headers: { origin: "https://evil.example" }, data: { mission: "m_lesson" } })).status()).toBe(403);
    expect(await api(page, "/api/game/missions/verify", { mission: "m_lesson", xp: 400 })).toEqual({ status: 400, body: { error: "bad_request", account: userId } }); // the session's own id, never the one sent
  });
});
