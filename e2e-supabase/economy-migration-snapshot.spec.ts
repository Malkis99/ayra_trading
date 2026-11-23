import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Q4.5-4: in the transfer window a device sends a frozen copy of its saved game state ONCE (the same copy on every
// retry); a device that comes after the transfer is kept apart (late). The fake database stands in for 0019
// game_import_snapshot (fresh token, window, replay, one per install). Nothing is credited, the device keeps its progress.

type ImportRow = { user: string; snapshot: string; install: string; md5: string; status: string; content: Record<string, unknown> };
const setState = (request: APIRequestContext, email: string, state: string) =>
  request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(email)}&state=${state}&sync=0&mode=study`);
const imports = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/imports?email=${encodeURIComponent(email)}`)).json()) as ImportRow[];
const importCalls = async (request: APIRequestContext) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/economy-calls`)).json()) as Array<{ fn: string; user: string }>).filter((c) => c.fn === "game_import_snapshot");
const notice = (page: Page) => page.getByTestId("economy-notice");
const game = (page: Page, id: string) => page.evaluate((u) => JSON.parse(localStorage.getItem(`ayra:${u}:ayra_demo_v1`) || "{}"), id);
const stored = (page: Page, id: string, key: string) => page.evaluate(([u, k]) => localStorage.getItem(`ayra:${u}:${k}`), [id, key] as const);

async function account(page: Page, request: APIRequestContext, prefix: string) {
  const email = `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Mg${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  return { email, userId };
}

async function openQuests(page: Page) {
  await page.goto("/quests");
  await expect(page.getByTestId("missions")).toBeVisible();
}

test.describe("Q4.5-4 device snapshots (fake Supabase with the 0019 stand-in)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);
  test.beforeEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=1`);
    await request.get(`${FAKE_SUPABASE}/__test/economy-calls?reset=1`);
  });
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=0`);
  });

  test("before the window nothing is sent; in the window one frozen copy, the same on every retry; the device keeps its progress", async ({ page, request }) => {
    const { email, userId } = await account(page, request, "Snap");
    await openQuests(page);
    await page.waitForTimeout(1000);
    expect(await importCalls(request)).toEqual([]); // local: nothing sent, nothing frozen
    expect(await stored(page, userId, "ayra_migration_snapshot")).toBeNull();

    const before = await game(page, userId);
    await setState(request, email, "migration_pending");
    await openQuests(page);
    await expect(notice(page)).toHaveAttribute("data-mode", "migration_pending");
    await expect.poll(async () => (await imports(request, email)).length, { timeout: 30_000 }).toBe(1);
    const [row] = await imports(request, email);
    expect(row).toMatchObject({ user: userId, status: "accepted" });
    // the copy is the device's saved state as it was, never a number to credit
    expect(row.content).toMatchObject({ level: before.level, xp: before.xp, coins: before.coins });
    await expect(page.getByTestId("economy-line-transfer")).toBeVisible();
    await expect.poll(async () => JSON.parse((await stored(page, userId, "ayra_migration_upload")) || "{}").status).toBe("accepted");

    // reloads and focus: the kept answer stops sending; the device's own progress is untouched
    const calls = (await importCalls(request)).length;
    await openQuests(page);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(1500);
    expect((await importCalls(request)).length).toBe(calls);
    expect(await imports(request, email)).toHaveLength(1);
    const after = await game(page, userId);
    expect([after.level, after.xp, after.coins]).toEqual([before.level, before.xp, before.coins]);
  });

  test("a lost answer: the retry is the same snapshot (a replay on the server, never a second one)", async ({ page, request }) => {
    const { email, userId } = await account(page, request, "Retry");
    await setState(request, email, "migration_pending");
    // the first answer never reaches the device (the server stored it)
    let dropped = false;
    const bodies: string[] = [];
    await page.route("**/api/game/migration/snapshot", async (route) => {
      bodies.push(route.request().postData() || "");
      const response = await route.fetch();
      // the first ACCEPTED answer is lost on the way back (an earlier refusal, e.g. a stale session, goes through)
      if (!dropped && response.status() === 200) {
        dropped = true;
        return route.abort("failed");
      }
      return route.fulfill({ response });
    });
    await openQuests(page);
    // the app tries again on the next load, focus or mode change (never two attempts at once): a focus per check
    await expect.poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      return JSON.parse((await stored(page, userId, "ayra_migration_upload")) || "{}").replay;
    }, { timeout: 30_000 }).toBe(true);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(new Set(bodies).size).toBe(1); // every attempt sent the same snapshot id, install and content
    expect(await imports(request, email)).toHaveLength(1);
  });

  test("a device that comes after the transfer: its copy is kept apart (late) and the person is told; achievements stay on the device", async ({ page, request }) => {
    const { email, userId } = await account(page, request, "Late");
    await setState(request, email, "cloud_active");
    await openQuests(page);
    await expect(notice(page)).toHaveAttribute("data-mode", "cloud_active");
    await expect.poll(async () => (await imports(request, email)).map((r) => r.status), { timeout: 30_000 }).toEqual(["late"]);
    await expect(page.getByTestId("economy-line-transfer")).toContainText(/after the transfer intake closed|после окончания приёма/);
    // the transfer is not complete for the person before Q4.6: achievements are still the device's
    await expect(page.getByTestId("economy-line-achievements")).toContainText(/kept on this device|хранятся на этом устройстве/);
    expect(await stored(page, userId, "ayra_migration_snapshot")).not.toBeNull();
  });

  test("accounts are apart: after signing out and in as another (local) account nothing is sent for it", async ({ page, request }) => {
    const a = await account(page, request, "IsoA");
    await setState(request, a.email, "migration_pending");
    await openQuests(page);
    await expect.poll(async () => (await imports(request, a.email)).length, { timeout: 30_000 }).toBe(1);
    await page.goto("/logout");
    await page.waitForURL((u) => u.pathname.startsWith("/login") || u.pathname === "/", { timeout: 30_000 });
    const b = await account(page, request, "IsoB");
    await openQuests(page);
    await page.waitForTimeout(1500);
    expect(await imports(request, b.email)).toEqual([]);
    expect((await importCalls(request)).filter((c) => c.user === b.userId)).toEqual([]);
    expect(await stored(page, b.userId, "ayra_migration_snapshot")).toBeNull();
    // A's copy is A's, in A's space only
    expect(await stored(page, a.userId, "ayra_migration_snapshot")).not.toBeNull();
  });
});
