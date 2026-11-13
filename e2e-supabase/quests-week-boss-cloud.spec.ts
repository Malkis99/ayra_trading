import { test, expect, type Page, type Route } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// QH-3: the closed week challenge result is written once, by the journal. With the cloud journal it waits until the
// cloud copy fetched after opening is on the device: a slow or failed sync never fixes a «not met» from missing data.

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return day(d);
};
const today = day(new Date());
const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
const lastMonday = addDays(monday, -7);

type Week = { week: string; bossResult?: { state: string; conditions: Array<{ key: string; state: string; done: number; total: number }>; at: string } };
const weeks = (page: Page, userId: string) =>
  page.evaluate((id) => (JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`) || "{}").questWeeks || []) as Week[], userId);

const trade = (id: string, on: string, extra: Record<string, unknown> = {}) => ({
  id,
  accountId: "acc_1",
  instrument: "EURUSD",
  direction: "long",
  status: "closed",
  openedAt: `${on}T09:00:00.000Z`,
  result: "win",
  emotions: [],
  mistakes: [],
  verification: "unverified",
  source: "manual",
  createdAt: `${on}T09:00:00.000Z`,
  updatedAt: new Date().toISOString(),
  schemaVersion: 6,
  stopLoss: 1.08,
  ...extra,
});

/** A signed-in account with the cloud journal on, last week's trades only in the cloud, a closed week waiting. */
async function setUp(page: Page, request: import("@playwright/test").APIRequestContext) {
  const email = `Boss_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Boss${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  // another device synced last week: two trades with a stop, one of them «moved the stop»
  for (const t of [trade("t_cloud_1", addDays(lastMonday, 1)), trade("t_cloud_2", addDays(lastMonday, 2), { mistakes: ["moved_stop"] })]) {
    await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_trades`, { data: t });
  }
  // this device: first sync done long ago, its journal has nothing of last week; the closed week waits for its result
  await page.evaluate(
    ({ id, lastMonday, monday }) => {
      localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: "2026-10-01T00:00:00.000Z", lastSyncAt: "2026-10-01T00:00:00.000Z" }));
      const key = `ayra:${id}:ayra_demo_v1`;
      const g = JSON.parse(localStorage.getItem(key) || "{}");
      g.lastWeeklyResetDate = monday;
      g.questWeeks = [{ v: 1, week: lastMonday, boss: "respectStop", daysRecorded: [], totals: { xp: 0, coins: 0, quests: 0 }, recordedAt: `${monday}T06:00:00.000Z` }];
      localStorage.setItem(key, JSON.stringify(g));
    },
    { id: userId, lastMonday, monday }
  );
  return { userId };
}

test.describe("Quest Hub: the closed week result and the cloud journal (QH-3)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);

  test("a slow cloud sync: the result waits, then is written once from the full journal, with no XP or Coins", async ({ page, request }) => {
    const { userId } = await setUp(page, request);
    const before = await page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`) || "{}"), userId);
    // hold every read of the cloud journal until released
    const held: Route[] = [];
    let release = false;
    await page.route("**/rest/v1/journal_*", async (route) => {
      if (route.request().method() !== "GET" || release) return route.continue();
      held.push(route);
    });
    await page.goto("/quests");
    await expect(page.getByTestId("missions")).toBeVisible();
    await expect.poll(() => held.length).toBeGreaterThan(0);
    // the local journal is read, the cloud is still loading: nothing is fixed
    await page.waitForTimeout(2500);
    expect((await weeks(page, userId))[0].bossResult).toBeUndefined();

    release = true;
    for (const r of held.splice(0)) await r.continue();
    await expect.poll(async () => (await weeks(page, userId))[0].bossResult?.state, { timeout: 30_000 }).toBe("notMet");
    const w = (await weeks(page, userId))[0];
    // judged on the two cloud trades, not on an empty journal
    expect(w.bossResult!.conditions.find((c) => c.key === "stopSet")).toMatchObject({ state: "met", done: 2, total: 2 });
    expect(w.bossResult!.conditions.find((c) => c.key === "stopNotMoved")).toMatchObject({ state: "notMet", done: 1, total: 2 });
    const after = await page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`) || "{}"), userId);
    expect({ xp: after.xp, level: after.level, coins: after.coins }).toEqual({ xp: before.xp, level: before.level, coins: before.coins });
    // written once: a reload keeps the same result
    await page.reload();
    await expect(page.getByTestId("missions")).toBeVisible();
    await page.waitForTimeout(1500);
    expect((await weeks(page, userId))[0].bossResult!.at).toBe(w.bossResult!.at);
  });

  test("the cloud fails (network error): the result stays pending, never «not met»; it is written after a good sync", async ({ page, request }) => {
    const { userId } = await setUp(page, request);
    let fail = true;
    await page.route("**/rest/v1/journal_*", (route) => (fail ? route.abort("failed") : route.continue()));
    await page.goto("/quests");
    await expect(page.getByTestId("missions")).toBeVisible();
    await page.waitForTimeout(4000);
    expect((await weeks(page, userId))[0].bossResult).toBeUndefined();

    fail = false;
    await page.reload(); // a new page load tries the cloud again
    await expect.poll(async () => (await weeks(page, userId))[0].bossResult?.state, { timeout: 30_000 }).toBe("notMet");
    expect((await weeks(page, userId))[0].bossResult!.conditions.find((c) => c.key === "stopSet")).toMatchObject({ done: 2, total: 2 });
  });
});
