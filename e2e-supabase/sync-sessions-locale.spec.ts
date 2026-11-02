import { test, expect, type Browser, type APIRequestContext } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// «Everything from the laptop on the phone» (owner 2026-11-02), no migration: the interface language goes to the
// cloud profile (`profiles.locale`, by the time zone's rules), the sessions block's settings ride in the Market's
// `chart_view` row (0008). Two browser contexts = two devices of one account. Fake Supabase only.

const q = (email: string) => encodeURIComponent(email);
const cloudProfile = async (request: APIRequestContext, email: string) => (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${q(email)}`)).json()) as { id: string; locale: string; timezone: string };
const viewRow = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${q(email)}`)).json()) as { table: string; id: string; data: Record<string, unknown> }[]).find(
    (r) => r.table === "market_user_data" && r.id === "chart_view"
  );

async function device(browser: Browser, width = 1440) {
  const ctx = await browser.newContext({ timezoneId: "Asia/Tbilisi" });
  await ctx.route("https://s3.tradingview.com/**", (r) => r.abort());
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height: 900 });
  return { ctx, page };
}

/** A new account on device A, onboarding done, the cloud switch on; its first exchange has gone through. */
async function accountWithCloud(browser: Browser, request: APIRequestContext, tag: string) {
  const A = await device(browser);
  const email = `${tag}_${Date.now()}@example.com`;
  await signIn(A.page, email);
  await completeOnboarding(A.page, `${tag}${Date.now() % 100000}`, { after: "left" });
  const userId = (await cloudProfile(request, email)).id;
  await A.page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
  await A.page.goto("/journal");
  await expect.poll(async () => (await cloudProfile(request, email)).timezone, { timeout: 20000 }).toBe("Asia/Tbilisi");
  return { A, email };
}

test.describe("Language and sessions settings follow the account", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("the language chosen on the laptop comes to the phone; changed on the phone → back on the laptop", async ({ browser, request }) => {
    const { A, email } = await accountWithCloud(browser, request, "Lang");
    await A.page.goto("/settings/interface");
    await A.page.getByRole("button", { name: "English" }).click();
    await expect(A.page.locator("html")).toHaveAttribute("lang", "en");
    await expect.poll(async () => (await cloudProfile(request, email)).locale, { timeout: 20000 }).toBe("en");

    // the phone: never chose a language → takes the account's
    const B = await device(browser, 360);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await expect(B.page.locator("html")).toHaveAttribute("lang", "en", { timeout: 20000 });
    expect(await B.page.evaluate(() => localStorage.getItem("ayra_lang"))).toBe("en");

    // back to Russian on the phone → the laptop after its next exchange
    await B.page.goto("/settings/interface");
    await B.page.getByRole("button", { name: "Russian" }).click();
    await expect.poll(async () => (await cloudProfile(request, email)).locale, { timeout: 20000 }).toBe("ru");
    await A.page.goto("/journal");
    await expect(A.page.locator("html")).toHaveAttribute("lang", "ru", { timeout: 20000 });
    await A.ctx.close();
    await B.ctx.close();
  });

  test("the sessions block's display time set on the laptop comes to the phone (chart_view row, no new table)", async ({ browser, request }) => {
    const { A, email } = await accountWithCloud(browser, request, "Sess");
    await A.page.goto("/market");
    await A.page.getByTestId("market-settings-open").click();
    await A.page.getByTestId("market-settings-display-utc").click();
    await A.page.getByTestId("market-settings-done").click();
    await expect(A.page.getByTestId("market-display-elsewhere")).toHaveText("Время показа: UTC, меняется в настройках");
    await expect.poll(async () => ((await viewRow(request, email))?.data.sessions as { display?: { kind: string } } | undefined)?.display?.kind, { timeout: 20000 }).toBe("utc");

    const B = await device(browser, 360);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await B.page.goto("/market");
    await expect(B.page.getByTestId("market-display-elsewhere")).toHaveText("Время показа: UTC, меняется в настройках", { timeout: 20000 });
    // and it stays after a reload
    await B.page.reload();
    await expect(B.page.getByTestId("market-display-elsewhere")).toHaveText("Время показа: UTC, меняется в настройках");
    await A.ctx.close();
    await B.ctx.close();
  });
});
