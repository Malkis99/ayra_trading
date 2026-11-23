import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Q4.6 (docs/q4-6-achievements-migration.md): on the server economy the profile shows the achievements the server
// recorded (proven / moved / waiting / not confirmed), the device's own flags stay as an archive; a save above 1 MiB is
// sent compressed in ONE request and arrives as the same content; a browser without compression keeps its save and says
// so. The fake database stands in for 0019/0020 (fresh token, window, replay, one per install, the person's own list).

type ImportRow = { user: string; snapshot: string; install: string; md5: string; status: string; content: Record<string, unknown> };
const setState = (request: APIRequestContext, email: string, state: string) =>
  request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(email)}&state=${state}&sync=0&mode=study`);
const imports = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/imports?email=${encodeURIComponent(email)}`)).json()) as ImportRow[];
const importCalls = async (request: APIRequestContext) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/economy-calls`)).json()) as Array<{ fn: string; user: string }>).filter((c) => c.fn === "game_import_snapshot");
const stored = (page: Page, id: string, key: string) => page.evaluate(([u, k]) => localStorage.getItem(`ayra:${u}:${k}`), [id, key] as const);
const card = (page: Page, id: string) => page.locator(`[data-testid="achievement-card"][data-id="${id}"]`);

async function account(page: Page, request: APIRequestContext, prefix: string) {
  const email = `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Ac${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  return { email, userId };
}

/** Grows the device's saved game to more than `bytes` bytes of synthetic history (no real data), and sets flags. */
async function growSave(page: Page, userId: string, bytes: number, achievements: Record<string, boolean> = {}): Promise<number> {
  return page.evaluate(([u, n, ach]) => {
    const key = `ayra:${u}:ayra_demo_v1`;
    const s = JSON.parse(localStorage.getItem(key) || "{}");
    // like real play: six quests a day over many days, each at its own time (saves compress about 20×; identical
    // entries would compress far more and be refused as a possible decompression bomb)
    const day = (i: number) => new Date(Date.UTC(2021, 0, 1) + Math.floor(i / 6) * 86400000).toISOString().slice(0, 10);
    s.history = Array.from({ length: Math.ceil((n as number) / 110) }, (_, i) => ({ questId: `q_${(i * 7) % 60}`, questTitle: ["Daily Bias", "Запись сделки", "Рефлексия", "План"][i % 4], category: ["trading", "psychology", "study"][i % 3], xp: 40, coins: 10, completedAt: day(i), at: `${day(i)}T${String(8 + (i % 6)).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}:00.000Z` }));
    s.achievements = { ...(s.achievements || {}), ...(ach as Record<string, boolean>) };
    localStorage.setItem(key, JSON.stringify(s));
    return new TextEncoder().encode(localStorage.getItem(key) || "").length;
  }, [userId, bytes, achievements] as const);
}

test.describe("Q4.6 achievements on the server and large snapshots (fake Supabase with the 0019/0020 stand-ins)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(180_000);
  test.beforeEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=1`);
    await request.get(`${FAKE_SUPABASE}/__test/economy-calls?reset=1`);
  });
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=0`);
  });

  test("cloud_active: the profile shows the server's states; the device's flags stay as an archive; a reload keeps it", async ({ page, request }) => {
    const { email, userId } = await account(page, request, "AchSrv");
    await page.evaluate((u) => {
      const key = `ayra:${u}:ayra_demo_v1`;
      const s = JSON.parse(localStorage.getItem(key) || "{}");
      s.achievements = { ...(s.achievements || {}), author: true, plans7: true, firstQuest: true };
      localStorage.setItem(key, JSON.stringify(s));
    }, userId);
    const archive = JSON.parse((await stored(page, userId, "ayra_demo_v1")) || "{}").achievements;
    await request.post(`${FAKE_SUPABASE}/__test/achievements?email=${encodeURIComponent(email)}`, { data: { transferred: true, items: [
      { id: "firstQuest", family: "profile", status: "verified", detail: {}, recordedAt: "2026-12-01T10:00:00Z" },
      { id: "author", family: "profile", status: "pending_review", detail: {}, recordedAt: "2026-12-01T10:00:00Z" },
      { id: "level3", family: "profile", status: "legacy_accepted", detail: {}, recordedAt: "2026-12-01T10:00:00Z" },
      { id: "plans7", family: "profile", status: "rejected", detail: {}, recordedAt: "2026-12-01T10:00:00Z" },
    ] } });
    await setState(request, email, "cloud_active");
    await page.goto("/quests");
    await expect(page.getByTestId("economy-notice")).toHaveAttribute("data-mode", "cloud_active");
    // the transfer is complete for the person: no «achievements still on the device» line
    await expect(page.getByTestId("economy-line-achievements")).toHaveCount(0);
    for (let round = 0; round < 2; round++) {
      await page.goto("/profile?tab=achievements");
      await expect(page.getByTestId("achievements-server-source")).toBeVisible();
      await expect(card(page, "firstQuest")).toHaveAttribute("data-status", "earned");
      await expect(card(page, "author")).toHaveAttribute("data-status", "pending_review");
      await expect(card(page, "author")).toContainText(/waiting for review|ждёт проверки/);
      await expect(card(page, "level3")).toContainText(/Moved from the device|Перенесено с устройства/);
      await expect(card(page, "plans7")).toHaveAttribute("data-earned", "false");
      await expect(card(page, "plans7")).toContainText(/Not confirmed|Не подтверждено/);
      // the device's own records are untouched (an archive)
      expect(JSON.parse((await stored(page, userId, "ayra_demo_v1")) || "{}").achievements).toEqual(archive);
    }
  });

  test("cloud_active before the achievements are on the server: the device's flags shown, the person told", async ({ page, request }) => {
    const { email } = await account(page, request, "AchDev");
    await setState(request, email, "cloud_active");
    await page.goto("/quests");
    await expect(page.getByTestId("economy-line-achievements")).toBeVisible();
    await page.goto("/profile?tab=achievements");
    await expect(page.getByTestId("achievements-server-source")).toHaveCount(0);
    await expect(page.getByTestId("achievement-card").first()).toBeVisible();
  });

  test("a save above 1 MiB: frozen compressed once, ONE request, the same content arrives; a retry is the same copy", async ({ page, request }) => {
    const { email, userId } = await account(page, request, "Big");
    await page.goto("/quests");
    const bytes = await growSave(page, userId, 1_300_000, { firstQuest: true });
    expect(bytes).toBeGreaterThan(1024 * 1024);
    const saved = JSON.parse((await stored(page, userId, "ayra_demo_v1")) || "{}");
    const bodies: Array<Record<string, unknown>> = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/game/migration/snapshot")) bodies.push(JSON.parse(r.postData() || "{}")); });
    await setState(request, email, "migration_pending");
    await page.goto("/quests");
    await expect.poll(async () => (await imports(request, email)).length, { timeout: 40_000 }).toBe(1);
    const [row] = await imports(request, email);
    expect(row.status).toBe("accepted");
    expect((row.content.history as unknown[]).length).toBe((saved.history as unknown[]).length);
    expect(row.content.achievements).toEqual(saved.achievements);
    expect(bodies[0]).toMatchObject({ encoding: "gzip", schema: 1 });
    expect(bodies[0].state).toBeUndefined();
    expect(JSON.parse((await stored(page, userId, "ayra_migration_snapshot")) || "{}").encoding).toBe("gzip");
    // reloads and focus: the kept answer stops sending
    const calls = (await importCalls(request)).length;
    await page.goto("/quests");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(1500);
    expect((await importCalls(request)).length).toBe(calls);
  });

  test("two tabs of one device in the window: one frozen copy, one snapshot on the server", async ({ page, request, context }) => {
    const { email, userId } = await account(page, request, "TwoTabs");
    await page.goto("/quests");
    await growSave(page, userId, 1_200_000);
    await setState(request, email, "migration_pending");
    const second = await context.newPage();
    await Promise.all([page.goto("/quests"), second.goto("/quests")]);
    await expect.poll(async () => (await imports(request, email)).length, { timeout: 40_000 }).toBe(1);
    await Promise.all([page.evaluate(() => window.dispatchEvent(new Event("focus"))), second.evaluate(() => window.dispatchEvent(new Event("focus")))]);
    await page.waitForTimeout(2000);
    const rows = await imports(request, email);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("accepted");
  });

  test("a browser without compression: a large save is not sent, the person is told, the save is kept", async ({ page, request }) => {
    await page.addInitScript(() => { (window as unknown as { CompressionStream?: unknown }).CompressionStream = undefined; });
    const { email, userId } = await account(page, request, "NoGzip");
    await page.goto("/quests");
    await growSave(page, userId, 1_200_000);
    const historyBefore = JSON.parse((await stored(page, userId, "ayra_demo_v1")) || "{}").history.length;
    await setState(request, email, "migration_pending");
    await page.goto("/quests");
    await expect(page.getByTestId("economy-line-transfer")).toContainText(/cannot compress|не умеет сжимать/, { timeout: 30_000 });
    expect(await importCalls(request)).toEqual([]);
    // the save is kept whole (the app may still write other fields of it, e.g. when it was last seen)
    expect(JSON.parse((await stored(page, userId, "ayra_demo_v1")) || "{}").history.length).toBe(historyBefore);
  });
});
