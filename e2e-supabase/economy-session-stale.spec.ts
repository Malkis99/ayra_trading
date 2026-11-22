import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Q4.5-2: the server decides whether a session is fresh for the economy (0018 game_session_check: the session exists,
// the mark in its token is the account's state now, issued after the change). A state change in the fake stand-in is
// what game_economy_transition() does: state, its time and the session mark together. Nothing here pays anything:
// the mission award is disabled and outside «local» the device gives nothing.

const api = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const r = await fetch(p, { method: "GET", cache: "no-store" });
    return { status: r.status, body: await r.json() };
  }, path);
const live = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/live-sessions?email=${encodeURIComponent(email)}`)).json()) as { live: number; refreshes: number };
const setState = (request: APIRequestContext, email: string, state: string) =>
  request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(email)}&state=${state}&sync=0&mode=study`);
const economyCalls = async (request: APIRequestContext) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/economy-calls`)).json()) as Array<{ fn: string; user: string; args: string[] }>;
const notice = (page: Page) => page.getByTestId("economy-notice");
const game = (page: Page, id: string) => page.evaluate((u) => JSON.parse(localStorage.getItem(`ayra:${u}:ayra_demo_v1`) || "{}"), id);

async function account(page: Page, request: APIRequestContext) {
  const email = `Stale_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `St${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  return { email, userId };
}

/**
 * signIn() of a known account only submits the form: wait until the sign-in has finished (the page left /login and the
 * session cookie is there) before asking the API. Only «not signed in yet» is waited out — every other answer is
 * asserted exactly by the test.
 */
async function signedIn(page: Page) {
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  await expect.poll(async () => (await api(page, "/api/game/day/status")).body.error ?? "ok", { timeout: 30_000 }).not.toBe("not_signed_in");
}

async function openQuests(page: Page) {
  await page.goto("/quests");
  await expect(page.getByTestId("missions")).toBeVisible();
}

test.describe("Q4.5-2 stale sessions (fake Supabase with the 0014–0018 stand-in)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);
  test.beforeEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=1`);
    await request.get(`${FAKE_SUPABASE}/__test/economy-calls?reset=1`);
  });
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=0`);
  });

  test("a token from before the change is refused (session_stale + the state); the app refreshes once and goes on fresh", async ({ page, request }) => {
    const { email, userId } = await account(page, request);
    expect((await api(page, "/api/game/day/status")).status).toBe(200); // local, fresh: no mark needed
    // the account is moved while this page holds a token without the mark
    await setState(request, email, "cloud_active");
    const stale = await api(page, "/api/game/day/status");
    expect(stale).toEqual({ status: 401, body: { error: "session_stale", state: "cloud_active", reason: "mark_changed" } });
    expect((await economyCalls(request)).filter((c) => c.fn !== "game_session_check" && c.fn !== "game_day_status")).toEqual([]); // nothing done
    const before = await live(request, email);
    await openQuests(page);
    await expect(notice(page)).toHaveAttribute("data-mode", "cloud_active");
    await expect.poll(async () => (await api(page, "/api/game/day/status")).status).toBe(200);
    const after = await live(request, email);
    expect(after.refreshes - before.refreshes).toBeGreaterThanOrEqual(1);
    expect(after.refreshes - before.refreshes).toBeLessThanOrEqual(2); // the app's one refresh (the auth client may add its own) — never a loop
    expect(after.live).toBe(before.live); // a refresh keeps the session
    expect(await page.evaluate((u) => localStorage.getItem(`ayra:${u}:ayra_economy_mode`), userId)).toBe("cloud_active");
  });

  test("the refresh is impossible (the session was ended): no loop, the state from the refusal still stops device rewards", async ({ page, request }) => {
    const { email, userId } = await account(page, request);
    await setState(request, email, "migration_pending");
    // the session ends at the auth server (as the transition with «end sessions» does): refresh refused
    await request.get(`${FAKE_SUPABASE}/__test/end-sessions?email=${encodeURIComponent(email)}`);
    const before = await live(request, email);
    expect(before.live).toBe(0);
    await openQuests(page);
    await expect(notice(page)).toHaveAttribute("data-mode", "migration_pending");
    expect(await page.evaluate((u) => localStorage.getItem(`ayra:${u}:ayra_economy_mode`), userId)).toBe("migration_pending");
    const g = await game(page, userId);
    await page.waitForTimeout(1500);
    const after = await live(request, email);
    expect(after.refreshes).toBe(before.refreshes); // a refused refresh is not counted and not repeated
    expect((await game(page, userId)).coins).toBe(g.coins);
  });

  test("two tabs: one refresh serves both; both see the server's state and every request after it is fresh", async ({ page, request, context }) => {
    const { email } = await account(page, request);
    const tab2 = await context.newPage();
    await openQuests(tab2);
    await setState(request, email, "cloud_active");
    await openQuests(page);
    await expect(notice(page)).toHaveAttribute("data-mode", "cloud_active");
    await tab2.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(notice(tab2)).toHaveAttribute("data-mode", "cloud_active");
    await expect.poll(async () => (await api(tab2, "/api/game/day/status")).status).toBe(200);
    await expect.poll(async () => (await api(page, "/api/game/day/status")).status).toBe(200);
  });

  test("a second device signed in after the change is fresh at once; the first one only after its refresh", async ({ page, request, browser }) => {
    const { email } = await account(page, request);
    await setState(request, email, "cloud_active");
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const device2 = await other.newPage();
    await signIn(device2, email);
    await signedIn(device2);
    expect(await api(device2, "/api/game/day/status")).toMatchObject({ status: 200, body: { status: { state: "cloud_active" } } });
    expect((await api(page, "/api/game/day/status")).body).toMatchObject({ error: "session_stale", state: "cloud_active" });
    await other.close();
  });

  test("offline → online: no refresh while offline; back online the app refreshes and the server answers", async ({ page, request, context }) => {
    const { email } = await account(page, request);
    await openQuests(page);
    await setState(request, email, "cloud_active");
    const before = await live(request, email);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("economy-line-notice")).toBeVisible();
    expect((await live(request, email)).refreshes).toBe(before.refreshes);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(notice(page)).toHaveAttribute("data-mode", "cloud_active");
    await expect.poll(async () => (await api(page, "/api/game/day/status")).status).toBe(200);
  });

  test("sign-out → sign-in of the same account: the old session ends, the new one is fresh; another account stays local", async ({ page, request }) => {
    const { email } = await account(page, request);
    await setState(request, email, "migration_pending");
    expect((await live(request, email)).live).toBe(1);
    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/login" || u.pathname === "/", { timeout: 30_000 });
    expect((await live(request, email)).live).toBe(0);
    await signIn(page, email);
    await signedIn(page);
    expect((await live(request, email)).live).toBe(1);
    expect(await api(page, "/api/game/day/status")).toMatchObject({ status: 200, body: { status: { state: "migration_pending" } } });
    // another account on the same device: its own state (local), fresh, not marked by the first one
    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/login" || u.pathname === "/", { timeout: 30_000 });
    const b = await account(page, request);
    expect(await api(page, "/api/game/day/status")).toMatchObject({ status: 200, body: { status: { state: "local" } } });
    expect((await economyCalls(request)).filter((c) => c.fn === "game_session_check").every((c) => c.args.join() === "p_session,p_iat,p_claim")).toBe(true);
    expect(await page.evaluate((u) => localStorage.getItem(`ayra:${u}:ayra_economy_mode`), b.userId)).toBeNull();
  });
});
