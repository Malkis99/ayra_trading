import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Owner decision 2026-11-23: «Выйти» ends the session of THIS device only (Supabase signOut scope «local»); the other
// devices of the account stay signed in. The fake auth server, like GoTrue, refuses the token of an ended session (403).

const api = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const r = await fetch(p, { method: "GET", cache: "no-store" });
    return { status: r.status, body: await r.json() };
  }, path);
const live = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/live-sessions?email=${encodeURIComponent(email)}`)).json()) as { live: number; refreshes: number };

/** The access token the app keeps in its cookies (@supabase/ssr: «base64-» + JSON, possibly in numbered chunks). */
async function accessTokenOf(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
  parts.sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()));
  const raw = parts.map((c) => c.value).join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : decodeURIComponent(raw);
  return (JSON.parse(json) as { access_token: string }).access_token;
}
const userStatus = async (request: APIRequestContext, token: string) =>
  (await request.get(`${FAKE_SUPABASE}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: "anon" } })).status();

/** signIn() of a known account only submits the form: wait until the session is there. */
async function signedIn(page: Page) {
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  await expect.poll(async () => (await api(page, "/api/game/day/status")).body.error ?? "ok", { timeout: 30_000 }).not.toBe("not_signed_in");
}
async function signOutHere(page: Page) {
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/login" || u.pathname === "/", { timeout: 30_000 });
}

test.describe("Logout ends this device only (owner decision 2026-11-23)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);
  test.beforeEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=1`);
    await request.get(`${FAKE_SUPABASE}/__test/logouts?reset=1`);
  });
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/economy-installed?on=0`);
  });

  test("sign-out on A: only A's session ends; B stays signed in, its requests and its refreshes work; A signs in again", async ({ page, context, browser, request }) => {
    const email = `Out_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
    // B's token is «old», so every page load on B refreshes it — a refresh of B's session must never sign B out
    await request.get(`${FAKE_SUPABASE}/__test/token-age?email=${encodeURIComponent(email)}&seconds=900`);
    await signIn(page, email);
    await completeOnboarding(page, `Out${Date.now() % 100000}`);
    const devB = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const pageB = await devB.newPage();
    await signIn(pageB, email);
    await signedIn(pageB);
    expect((await live(request, email)).live).toBe(2);
    const tokenA = await accessTokenOf(context);
    expect(await userStatus(request, tokenA)).toBe(200);

    await signOutHere(page);
    expect(await (await request.get(`${FAKE_SUPABASE}/__test/logouts`)).json()).toEqual(["local"]);
    expect((await live(request, email)).live).toBe(1);
    // the signed-out device's token: refused by the auth server at once (before its exp); the economy API refuses A too
    expect(await userStatus(request, tokenA)).toBe(403);
    expect((await api(page, "/api/game/day/status")).body.error).toBe("not_signed_in");

    // B: still signed in after reloads (each refreshes its old token), its API answers for it
    const before = await live(request, email);
    await pageB.goto("/settings/account");
    await expect(pageB.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
    await pageB.reload();
    await expect(pageB.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
    expect((await live(request, email)).refreshes).toBeGreaterThan(before.refreshes);
    expect((await api(pageB, "/api/game/day/status")).status).toBe(200);
    expect(await userStatus(request, await accessTokenOf(devB))).toBe(200);

    // A signs in again: a new session next to B's
    await signIn(page, email);
    await signedIn(page);
    expect((await live(request, email)).live).toBe(2);
    expect((await api(page, "/api/game/day/status")).status).toBe(200);
    await devB.close();
  });

  test("sign-out does not reset another account's economy on the device (nor on the server)", async ({ page, request }) => {
    const stamp = Date.now();
    const x = `OutX_${stamp}@example.com`;
    const y = `OutY_${stamp}@example.com`;
    await signIn(page, x);
    await completeOnboarding(page, `OutX${stamp % 100000}`);
    const xId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(x)}`)).json()).id as string;
    await request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(x)}&state=migration_pending&sync=0&mode=study`);
    await page.goto("/quests");
    await expect(page.getByTestId("economy-notice")).toHaveAttribute("data-mode", "migration_pending", { timeout: 30_000 });
    await signOutHere(page);
    // another account on the same device: its own (local) economy; X's record and server state untouched
    await signIn(page, y);
    await completeOnboarding(page, `OutY${stamp % 100000}`);
    await signOutHere(page);
    expect(await page.evaluate((u) => localStorage.getItem(`ayra:${u}:ayra_economy_mode`), xId)).toBe("migration_pending");
    await signIn(page, x);
    await signedIn(page);
    expect((await api(page, "/api/game/day/status")).body).toMatchObject({ status: { state: "migration_pending" }, account: xId });
    await page.goto("/quests");
    await expect(page.getByTestId("economy-notice")).toHaveAttribute("data-mode", "migration_pending");
  });
});
