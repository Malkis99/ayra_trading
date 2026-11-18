import { test, expect, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";
const APP = "http://localhost:3001";

// Q4.2: after «Verify» the app asks the server to repeat the check on the cloud journal (shadow mode). The server's
// answer is kept for diagnostics only: it never pays, never takes back, never changes the game — whatever it says.

const LESSON = "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.";
const now = () => new Date().toISOString();
const note = (id: string, body: string, at = now()) => ({ id, templateKey: "lesson", title: "", body, tags: [], pinned: false, createdAt: at, updatedAt: at, archivedAt: null });

type Shadow = { ok: boolean; error?: string; status?: number; result?: { authorizedForPayout: boolean; unverified: string[]; serverDay: string; results: Array<{ id: string; comparison: string; payout: string; server: { confirmed: boolean; sources: string[]; flags: string[]; evidence?: { id: string; version: string; fp: string } } }> } };
const game = (page: Page, id: string) => page.evaluate((u) => JSON.parse(localStorage.getItem(`ayra:${u}:ayra_demo_v1`) || "{}"), id);
const shadows = (page: Page) => page.evaluate(() => (window as unknown as { __ayraMissionShadow?: unknown[] }).__ayraMissionShadow || []) as Promise<Shadow[]>;
/** What the economy is made of: none of it may change because of a shadow answer. */
const economy = (g: Record<string, unknown>) => ({
  xp: g.xp, level: g.level, coins: g.coins, history: g.history, completedQuestsToday: g.completedQuestsToday, missionLedger: g.missionLedger,
  unlockedAchievements: g.unlockedAchievements, chronicle: g.chronicle, dailyStats: g.dailyStats, coinLog: g.coinLog,
});
/** The page asks the route itself (same origin, the page's session cookies). */
const ask = (page: Page, body: unknown) =>
  page.evaluate(async (b) => {
    const r = await fetch("/api/game/missions/shadow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json() };
  }, body);

async function setUp(page: Page, request: APIRequestContext) {
  const email = `Shadow_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Shad${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  const lesson = note("note_shadow_lesson", LESSON);
  // the lesson is on this device and in the cloud (written by the app's sync on another device)
  await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_notes`, { data: lesson });
  const day = await page.evaluate(
    ({ id, lesson }) => {
      localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: "2026-10-01T00:00:00.000Z", lastSyncAt: "2026-10-01T00:00:00.000Z" }));
      const gk = `ayra:${id}:ayra_demo_v1`;
      const g = JSON.parse(localStorage.getItem(gk) || "{}");
      const today = g.lastQuestDate || new Date().toISOString().slice(0, 10);
      g.lastQuestDate = today;
      g.journalFirstTradeDay = null;
      g.questDay = { day: today, mode: "study", catalogVersion: 3, core: ["m_observation", "m_backtest", "m_lesson"], bonus: ["q_read_pages", "q_logic_puzzle"], studyFirst: "m_observation" };
      g.questAccepted = { day: today, at: { m_lesson: new Date().toISOString() } };
      g.completedQuestsToday = {};
      localStorage.setItem(gk, JSON.stringify(g));
      const jk = `ayra:${id}:ayra_journal_v1`;
      const j = JSON.parse(localStorage.getItem(jk) || "{}");
      j.notes = [...(j.notes || []), lesson];
      localStorage.setItem(jk, JSON.stringify(j));
      return today;
    },
    { id: userId, lesson }
  );
  return { email, userId, day, lesson };
}

/** Opens Quests and waits until the cloud copy is in and the lesson is ready for «Verify». */
async function readyLesson(page: Page) {
  await page.goto("/quests");
  await expect(page.getByTestId("missions")).toBeVisible();
  await expect(page.getByTestId("missions-syncing")).toHaveCount(0, { timeout: 30_000 });
  const card = page.getByTestId("quest-card-m_lesson");
  await expect(card).toHaveAttribute("data-quest", "ready", { timeout: 15_000 });
  return card;
}

/** From now on the browser does not pull the cloud journal (the route on the server still reads it). */
async function holdBrowserPulls(page: Page) {
  const held: Route[] = [];
  await page.route("**/rest/v1/journal_*", async (route) => (route.request().method() === "GET" ? held.push(route) : route.continue()));
  return held;
}

test.describe("Q4.2 shadow mission check (fake Supabase)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("agreement: the app pays once, the server confirms the same record, shadow only — nothing more is paid", async ({ page, request }) => {
    const { userId, day } = await setUp(page, request);
    const card = await readyLesson(page);
    const before = await game(page, userId);
    await card.getByTestId("quest-verify").click();
    await expect(card).toHaveAttribute("data-done", "true");
    await expect.poll(async () => (await shadows(page)).length, { timeout: 15_000 }).toBe(1);
    const [s] = await shadows(page);
    expect(s.ok).toBe(true);
    expect(s.result!.authorizedForPayout).toBe(false);
    expect(s.result!.serverDay).toBe(day);
    expect(s.result!.unverified).toEqual(["daySet", "accepted", "dayClaims", "paidToday", "dayStarted"]);
    expect(s.result!.results[0]).toMatchObject({ id: "m_lesson", comparison: "agree_done", payout: "not_authorized", server: { confirmed: true, sources: ["note:note_shadow_lesson"] } });
    expect(s.result!.results[0].server.evidence!.id).toBe("note_shadow_lesson");
    // exactly the app's own reward (40 XP + 10 Coins), and nothing more after the server's answer
    const after = await game(page, userId);
    expect(after.coins - before.coins).toBe(10);
    await page.waitForTimeout(1500);
    expect(economy(await game(page, userId))).toEqual(economy(after));
    // the answer never carries the note's text
    expect(JSON.stringify(s)).not.toContain("свечи");
  });

  test("disagreement: the cloud copy is a short text — the server does not confirm, the app's decision and the economy stay as they are", async ({ page, request }) => {
    const { email, userId, lesson } = await setUp(page, request);
    const card = await readyLesson(page);
    await holdBrowserPulls(page);
    // another device shortened the note (the browser has not pulled it yet)
    await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_notes`, {
      data: { ...lesson, body: "Коротко.", updatedAt: new Date(Date.now() + 1000).toISOString() },
    });
    const before = await game(page, userId);
    await card.getByTestId("quest-verify").click();
    await expect(card).toHaveAttribute("data-done", "true"); // the app decided on its own data, as before Q4.2
    const paid = await game(page, userId);
    await expect.poll(async () => (await shadows(page)).length, { timeout: 15_000 }).toBe(1);
    const [s] = await shadows(page);
    expect(s.result!.results[0]).toMatchObject({ comparison: "client_only", payout: "not_authorized", server: { confirmed: false } });
    expect(s.result!.results[0].server.flags).toContain("sourceNotConfirmed");
    // the mismatch changes nothing: no XP, Coins, level, achievements, chronicle or ledger taken back or added
    expect(paid.coins - before.coins).toBe(10);
    await page.waitForTimeout(1500);
    expect(economy(await game(page, userId))).toEqual(economy(paid));
  });

  test("the cloud journal is unavailable: the server answers with a code, the app's payment is untouched", async ({ page, request }) => {
    const { userId } = await setUp(page, request);
    const card = await readyLesson(page);
    await holdBrowserPulls(page);
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-reads?count=20`);
    try {
      await card.getByTestId("quest-verify").click();
      await expect(card).toHaveAttribute("data-done", "true");
      await expect.poll(async () => (await shadows(page)).length, { timeout: 15_000 }).toBe(1);
      const [s] = await shadows(page);
      expect(s).toMatchObject({ ok: false, error: "cloud_journal_unavailable", status: 503 });
      expect(JSON.stringify(s)).not.toMatch(/XX000|fake transient|127\.0\.0\.1/);
      const paid = await game(page, userId);
      await page.waitForTimeout(1000);
      expect(economy(await game(page, userId))).toEqual(economy(paid));
    } finally {
      await request.get(`${FAKE_SUPABASE}/__test/fail-journal-reads?count=0`);
    }
  });

  test("a repeat and a second tab: the same answer, nothing paid again; a changed and a deleted record are not confirmed", async ({ page, request, context }) => {
    const { email, userId, day, lesson } = await setUp(page, request);
    const card = await readyLesson(page);
    await card.getByTestId("quest-verify").click();
    await expect(card).toHaveAttribute("data-done", "true");
    const paid = await game(page, userId);
    const body = { missions: [{ id: "m_lesson", day, done: true, source: "note:note_shadow_lesson" }] };
    const second = await context.newPage();
    await second.goto("/quests");
    await expect(second.getByTestId("quest-card-m_lesson")).toHaveAttribute("data-done", "true");
    const [a, b] = await Promise.all([ask(page, body), ask(second, body)]);
    expect(a.status).toBe(200);
    expect(b).toEqual(a);
    expect(await ask(page, body)).toEqual(a);

    // changed in the cloud with the SAME updatedAt (the journal takes it as a retry): another fingerprint
    await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_notes`, { data: { ...lesson, body: LESSON + " Дополнено." } });
    const changed = await ask(page, body);
    expect(changed.body.results[0].server.evidence.fp).not.toBe(a.body.results[0].server.evidence.fp);
    // deleted in the cloud: not confirmed any more
    await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_notes`, {
      data: { ...lesson, deletedAt: new Date(Date.now() + 2000).toISOString(), updatedAt: new Date(Date.now() + 2000).toISOString() },
    });
    const deleted = await ask(page, body);
    expect(deleted.body.results[0]).toMatchObject({ comparison: "client_only", server: { confirmed: false } });

    await page.waitForTimeout(1000);
    expect(economy(await game(page, userId))).toEqual(economy(paid));
    expect(economy(await game(second, userId))).toEqual(economy(paid));
  });

  test("an imported note is not confirmed by the server either", async ({ page, request }) => {
    const { email, day } = await setUp(page, request);
    await readyLesson(page);
    await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_notes`, {
      data: { ...note("note_imported", "Импортированный урок о том, что стоп ставится до входа и не двигается."), importBatchId: "imp_1" },
    });
    const r = await ask(page, { missions: [{ id: "m_observation", day, done: true, source: "note:note_imported" }] });
    expect(r.status).toBe(200);
    expect(r.body.results[0]).toMatchObject({ comparison: "client_only", server: { confirmed: false } });
  });

  test("isolation and refusals: another account's record, no session, another site, a forged amount", async ({ page, request, browser }) => {
    const { day } = await setUp(page, request);
    await readyLesson(page);
    // account B asks about A's note: B's journal does not have it
    const emailB = `ShadowB_${Date.now()}@example.com`;
    const ctxB = await browser.newContext({ baseURL: APP });
    const pageB = await ctxB.newPage();
    await signIn(pageB, emailB);
    await completeOnboarding(pageB, `ShB${Date.now() % 100000}`);
    // while B's cloud journal is off, the server does not read it at all
    expect(await ask(pageB, { missions: [{ id: "m_lesson", day, done: true, source: "note:note_shadow_lesson" }] })).toEqual({ status: 409, body: { error: "cloud_journal_off" } });
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(emailB)}&on=1`);
    const foreign = await ask(pageB, { missions: [{ id: "m_lesson", day, done: true, source: "note:note_shadow_lesson" }] });
    expect(foreign.status).toBe(200);
    expect(foreign.body.results[0]).toMatchObject({ comparison: "client_only", server: { confirmed: false, sources: [] } });
    expect(foreign.body.results[0].server.flags).toContain("sourceNotConfirmed");
    expect(JSON.stringify(foreign.body)).not.toContain("свечи");
    await ctxB.close();

    // no session at all (a request without the site's cookies)
    const anon = await request.post(`${APP}/api/game/missions/shadow`, { headers: { origin: APP }, data: { missions: [{ id: "m_lesson", day, done: true }] } });
    expect(anon.status()).toBe(401);
    // another site
    const evil = await request.post(`${APP}/api/game/missions/shadow`, { headers: { origin: "https://evil.example" }, data: { missions: [{ id: "m_lesson", day, done: true }] } });
    expect(evil.status()).toBe(403);
    // an amount in the request is not «ignored» — the whole request is refused
    const forged = await ask(page, { missions: [{ id: "m_lesson", day, done: true, xp: 400 }] });
    expect(forged).toEqual({ status: 400, body: { error: "bad_request" } });
  });
});
