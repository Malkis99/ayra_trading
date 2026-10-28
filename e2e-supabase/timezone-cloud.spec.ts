import { test, expect, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Time zone in the cloud profile (profiles.timezone, no migration): it follows the cloud exchange of the journal —
// «Automatic» by itself, «Manual» on «Synchronise»; two devices of one account; guests and accounts without the cloud
// are not touched. Fake Supabase only.

/** Opens the time zone picker, searches the city (English name, as in the zone id) and takes the match. */
async function pickTimezone(page: Page, city: string) {
  await page.getByTestId("timezone-select").click();
  await page.getByRole("searchbox").or(page.getByPlaceholder(/Поиск/)).first().fill(city);
  await page.getByRole("listbox").getByRole("option", { name: new RegExp(city) }).first().click();
}

const q = (email: string) => encodeURIComponent(email);
const cloudTz = async (request: APIRequestContext, email: string) => (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${q(email)}`)).json())?.timezone as string;
const localTz = (page: Page, userId: string) => page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`) || "{}").profile?.timezone, userId);

async function device(browser: Browser, width = 1440) {
  const ctx = await browser.newContext({ timezoneId: "Asia/Tbilisi" });
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height: 900 });
  return { ctx, page };
}

/** A synced account on device A with the cloud on; its zone has gone up once (the cloud default UTC replaced). */
async function accountWithCloud(browser: Browser, request: APIRequestContext, tag: string) {
  const A = await device(browser);
  const email = `${tag}_${Date.now()}@example.com`;
  await signIn(A.page, email);
  await completeOnboarding(A.page, `${tag}${Date.now() % 100000}`, { after: "left" });
  const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${q(email)}`)).json()).id) as string;
  await A.page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);
  expect(await cloudTz(request, email)).toBe("UTC"); // the cloud default
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
  await A.page.goto("/journal");
  await expect.poll(() => cloudTz(request, email), { timeout: 20000 }).toBe("Asia/Tbilisi");
  return { A, email, userId };
}

test.describe("Time zone in the cloud profile", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("Automatic, two devices: the zone set on A comes to B; changed on B → appears on A", async ({ browser, request }) => {
    const { A, email, userId } = await accountWithCloud(browser, request, "TzAuto");

    await A.page.goto("/settings/journal");
    await expect(A.page.getByTestId("journal-settings-timezone-note")).toContainText("сохраняется в облачный профиль");
    await pickTimezone(A.page, "Berlin");
    await expect.poll(() => cloudTz(request, email), { timeout: 20000 }).toBe("Europe/Berlin");

    // B: a new device of the same account takes the zone from the cloud
    const B = await device(browser, 360);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await expect.poll(() => localTz(B.page, userId), { timeout: 20000 }).toBe("Europe/Berlin");

    // changed on B → in the cloud → on A after its next exchange (return to the app)
    await B.page.goto("/settings/journal");
    await pickTimezone(B.page, "New York");
    await expect.poll(() => cloudTz(request, email), { timeout: 20000 }).toBe("America/New_York");
    await A.page.goto("/journal");
    await expect.poll(() => localTz(A.page, userId), { timeout: 20000 }).toBe("America/New_York");
    await A.ctx.close();
    await B.ctx.close();
  });

  test("Manual: a change waits for «Synchronise» on this device; the other manual device takes it only on its own «Synchronise»", async ({ browser, request }) => {
    const { A, email, userId } = await accountWithCloud(browser, request, "TzMan");
    const B = await device(browser);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await expect.poll(() => localTz(B.page, userId), { timeout: 20000 }).toBe("Asia/Tbilisi");

    for (const p of [A.page, B.page]) {
      await p.goto("/settings/cloud");
      await p.getByTestId("cloud-sync-mode").getByRole("radio", { name: "Вручную" }).click();
    }

    // A changes the zone: nothing goes up by itself
    await A.page.goto("/settings/journal");
    await pickTimezone(A.page, "Berlin");
    await A.page.waitForTimeout(4000);
    expect(await cloudTz(request, email)).toBe("Asia/Tbilisi");
    await A.page.goto("/settings/cloud");
    await A.page.getByTestId("cloud-sync-now").click();
    await expect.poll(() => cloudTz(request, email), { timeout: 20000 }).toBe("Europe/Berlin");

    // B (manual) does not take it on reload, only on «Synchronise»
    await B.page.reload();
    await B.page.waitForTimeout(4000);
    expect(await localTz(B.page, userId)).toBe("Asia/Tbilisi");
    await B.page.goto("/settings/cloud");
    await B.page.getByTestId("cloud-sync-now").click();
    await expect.poll(() => localTz(B.page, userId), { timeout: 20000 }).toBe("Europe/Berlin");
    await A.ctx.close();
    await B.ctx.close();
  });

  test("cloud off: the zone stays on the device, the cloud profile is not touched; guest: no profile at all", async ({ browser, request }) => {
    const { ctx, page } = await device(browser);
    const email = `TzOff_${Date.now()}@example.com`;
    await signIn(page, email);
    await completeOnboarding(page, `TzOff${Date.now() % 100000}`, { after: "left" });
    await page.goto("/settings/journal");
    await expect(page.getByTestId("journal-settings-timezone-note")).toHaveText("Часовой пояс хранится на этом устройстве.");
    await pickTimezone(page, "Berlin");
    await page.waitForTimeout(3000);
    expect(await cloudTz(request, email)).toBe("UTC");
    await ctx.close();

    const g = await device(browser);
    await g.page.goto("/login");
    await g.page.getByRole("button", { name: "Продолжить без входа" }).click();
    await g.page.waitForURL((url) => url.pathname !== "/login");
    await g.page.goto("/settings/journal");
    await pickTimezone(g.page, "Berlin");
    await expect(g.page.getByTestId("journal-settings-timezone-note")).toHaveText("Часовой пояс хранится на этом устройстве.");
    expect(await g.page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}").profile?.timezone)).toBe("Europe/Berlin");
    await g.ctx.close();
  });
});
