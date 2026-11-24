import { test, expect, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Q4.7-B10 (docs/q4-7-b10-logout-race.md): a sign-in seen before «Выйти» (a token refresh: TOKEN_REFRESHED) reads the
// profile and only then marks the app signed in. When that read answers after the sign-out, its answer belonged to an
// ended session and must change nothing. Before the fix it set «authenticated» with no user: no redirect to /login, the
// old account's profile back on screen and its nickname written into the guest's game. Here the read is held on purpose
// and answered only after the sign-out has finished — the order seen in the flaky economy-session-stale.spec.ts:142.

const api = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const r = await fetch(p, { method: "GET", cache: "no-store" });
    return { status: r.status, body: await r.json() };
  }, path);
const setState = (request: APIRequestContext, email: string, state: string) =>
  request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(email)}&state=${state}&sync=0&mode=study`);
const live = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/live-sessions?email=${encodeURIComponent(email)}`)).json()) as { live: number };
const logouts = async (request: APIRequestContext) => (await (await request.get(`${FAKE_SUPABASE}/__test/logouts`)).json()) as string[];
/** The game saved in a space: an account's own keys, or the guest's bare ones. */
const saved = (page: Page, userId: string | null) =>
  page.evaluate((u) => JSON.parse(localStorage.getItem(u ? `ayra:${u}:ayra_demo_v1` : "ayra_demo_v1") || "null"), userId);
const signOutButton = (page: Page) => page.getByRole("button", { name: "Выйти", exact: true });
const atLogin = (page: Page) => page.waitForURL((u) => u.pathname === "/login", { timeout: 15_000 });

async function account(page: Page, request: APIRequestContext, prefix: string) {
  const email = `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  const nickname = `Lo${Date.now() % 100000}`;
  await signIn(page, email);
  await completeOnboarding(page, nickname);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  return { email, userId, nickname };
}

/**
 * Holds the next profile read of this page (once armed) until release(); `held` resolves when one is waiting.
 * Only the read is delayed — its answer is the server's own.
 */
async function holdProfileRead(page: Page) {
  let armed = false;
  let markHeld!: () => void;
  const held = new Promise<void>((r) => (markHeld = r));
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route("**/rest/v1/profiles*", async (route: Route) => {
    if (armed && route.request().method() === "GET") {
      armed = false;
      markHeld();
      await released;
    }
    await route.continue().catch(() => {}); // the page may have moved on; nothing to answer then
  });
  return { arm: () => (armed = true), held, release };
}

/** Makes the app refresh its session now: the account's state changes (the token's mark is old), the app is focused. */
async function causeTokenRefresh(page: Page, request: APIRequestContext, email: string) {
  await setState(request, email, "migration_pending");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test.describe("Q4.7-B10 sign-out vs a late profile answer (fake Supabase)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);
  test.beforeEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=1`);
    await request.get(`${FAKE_SUPABASE}/__test/logouts?reset=1`);
  });
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=0`);
  });

  test("a profile answer of the ended session arrives after «Выйти»: /login, a clean guest, the account's own save untouched; signing in again restores it", async ({ page, request }) => {
    const a = await account(page, request, "LateA");
    await page.goto("/settings/account");
    await expect(signOutButton(page)).toBeVisible();
    const before = await saved(page, a.userId);
    expect(before.name).toBe(a.nickname);

    const hold = await holdProfileRead(page);
    hold.arm();
    await causeTokenRefresh(page, request, a.email);
    await hold.held; // the sign-in of the refreshed token now waits for its profile

    const loggedOut = page.waitForResponse((r) => r.url().includes("/auth/v1/logout"));
    await signOutButton(page).click();
    await loggedOut;
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50))); // the sign-out is applied in the page
    hold.release(); // the old session's profile answers only now

    await atLogin(page);
    // the app really is a guest: an app page sends it to /login again
    await page.goto("/settings/account");
    await atLogin(page);
    expect(await api(page, "/api/game/day/status")).toMatchObject({ status: 401, body: { error: "not_signed_in" } });
    // (read after the reload: every write of the signed-out page has landed by then)
    // the guest has nothing of the account: not its nickname, not its progress
    const guest = await saved(page, null);
    expect(guest?.name ?? null).not.toBe(a.nickname);
    expect(guest?.xp ?? 0).toBe(0);
    expect(guest?.coins ?? 0).toBe(0);
    // only this device's session ended
    expect(await logouts(request)).toEqual(["local"]);
    expect((await live(request, a.email)).live).toBe(0);

    // the account's own save is exactly as it was, and signing in again opens it
    const after = await saved(page, a.userId);
    expect({ xp: after.xp, coins: after.coins, nickname: after.name }).toEqual({ xp: before.xp, coins: before.coins, nickname: before.name });
    await signIn(page, a.email);
    await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth"), { timeout: 30_000 });
    await page.goto("/settings/account");
    await expect(signOutButton(page)).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(a.nickname) }).first()).toBeVisible();
    expect(await api(page, "/api/game/day/status")).toMatchObject({ status: 200, body: { status: { state: "migration_pending" } } });
  });

  test("two tabs and another device: the late answer in one tab changes nothing; both tabs leave, the other device stays signed in", async ({ page, request, browser }) => {
    const a = await account(page, request, "LateTabs");
    // another device of the same account
    const other = await browser.newContext();
    const device2 = await other.newPage();
    await signIn(device2, a.email);
    await device2.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth"), { timeout: 30_000 });
    await expect.poll(async () => (await live(request, a.email)).live).toBe(2);

    const tab2 = await page.context().newPage();
    await tab2.goto("/quests");
    await expect(tab2.getByTestId("missions")).toBeVisible();
    await page.goto("/settings/account");
    await expect(signOutButton(page)).toBeVisible();

    const hold = await holdProfileRead(page);
    hold.arm();
    await causeTokenRefresh(page, request, a.email);
    await hold.held;
    const loggedOut = page.waitForResponse((r) => r.url().includes("/auth/v1/logout"));
    await signOutButton(page).click();
    await loggedOut;
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    hold.release();

    await atLogin(page);
    await atLogin(tab2); // the other tab of this device follows the sign-out
    expect(await logouts(request)).toEqual(["local"]);
    expect((await live(request, a.email)).live).toBe(1);
    // the other device is still signed in and served
    // (its token predates the state change, so the server asks it to refresh: a live session, not «not signed in»)
    expect(await api(device2, "/api/game/day/status")).toMatchObject({ status: 401, body: { error: "session_stale" } });
    await other.close();
  });

  test("A → guest → B on one device after a late answer of A: B gets only its own profile and save", async ({ page, request }) => {
    const a = await account(page, request, "LateAB");
    await page.goto("/settings/account");
    await expect(signOutButton(page)).toBeVisible();
    const hold = await holdProfileRead(page);
    hold.arm();
    await causeTokenRefresh(page, request, a.email);
    await hold.held;
    const loggedOut = page.waitForResponse((r) => r.url().includes("/auth/v1/logout"));
    await signOutButton(page).click();
    await loggedOut;
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    hold.release();
    await atLogin(page);
    const aSave = await saved(page, a.userId);

    const b = await account(page, request, "LateB");
    expect(b.userId).not.toBe(a.userId);
    const bSave = await saved(page, b.userId);
    expect(bSave.name).toBe(b.nickname);
    expect(await api(page, "/api/game/day/status")).toMatchObject({ status: 200, body: { status: { state: "local" } } });
    // A's save is untouched and nothing of A reached B
    expect(await saved(page, a.userId)).toEqual(aSave);
    expect(JSON.stringify(bSave)).not.toContain(a.nickname);
  });
});
