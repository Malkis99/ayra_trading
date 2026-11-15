import { test, expect, type Page, type Route } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// QH-6.5: while the cloud journal loads its copy, missions are not paid yet (QH-6.4 claims only after it). «Today» says
// so, marks a mission whose record is already on this device, and shows «Done» only after the reward is really saved.

const today = new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const note = (id: string, body: string, createdAt = now()) => ({ id, templateKey: "lesson", title: "", body, tags: [], pinned: false, createdAt, updatedAt: createdAt, archivedAt: null });

const game = (page: Page, id: string) => page.evaluate((u) => JSON.parse(localStorage.getItem(`ayra:${u}:ayra_demo_v1`) || "{}"), id);

async function setUp(page: Page, request: import("@playwright/test").APIRequestContext) {
  const email = `Sync_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Sync${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  // a study day of catalog 3; this device has a lesson written today (its journal also syncs with the cloud)
  await page.evaluate(
    ({ id, today, lesson }) => {
      localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: "2026-10-01T00:00:00.000Z", lastSyncAt: "2026-10-01T00:00:00.000Z" }));
      const gk = `ayra:${id}:ayra_demo_v1`;
      const g = JSON.parse(localStorage.getItem(gk) || "{}");
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
    { id: userId, today, lesson: note("note_local_lesson", "Урок: я жду закрытия свечи над уровнем, прежде чем входить в сделку по плану.") }
  );
  return { userId };
}

test.describe("Quest Hub: missions and a loading cloud journal (QH-6.5)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);

  test("while the cloud copy loads: a message, the mission marked «counts after the sync», nothing paid; then paid once", async ({ page, request }) => {
    const { userId } = await setUp(page, request);
    const held: Route[] = [];
    let release = false;
    await page.route("**/rest/v1/journal_*", async (route) => {
      if (route.request().method() !== "GET" || release) return route.continue();
      held.push(route);
    });
    await page.goto("/quests");
    await expect(page.getByTestId("missions")).toBeVisible();
    await expect.poll(() => held.length).toBeGreaterThan(0);

    await expect(page.getByTestId("missions-syncing")).toBeVisible();
    const lesson = page.getByTestId("quest-card-m_lesson");
    await expect(lesson.getByTestId("quest-waiting-sync")).toBeVisible();
    await expect(lesson).toHaveAttribute("data-done", "false"); // «Done» only after the reward is saved
    await page.waitForTimeout(1500);
    const before = await game(page, userId);
    expect(before.completedQuestsToday?.m_lesson).toBeUndefined();

    release = true;
    for (const r of held.splice(0)) await r.continue();
    await expect(page.getByTestId("missions-syncing")).toHaveCount(0, { timeout: 30_000 });
    await expect(lesson).toHaveAttribute("data-done", "true");
    await expect(lesson.getByTestId("quest-done")).toContainText("начислено +40 XP · +10 Coins");
    const after = await game(page, userId);
    expect(after.completedQuestsToday.m_lesson).toBe(true);
    expect(after.coins - before.coins).toBe(10);
    // a reload pays nothing again
    await page.reload();
    await expect(page.getByTestId("quest-card-m_lesson")).toHaveAttribute("data-done", "true");
    await page.waitForTimeout(1500);
    expect((await game(page, userId)).coins).toBe(after.coins);
  });
});
