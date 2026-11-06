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
  await expect.poll(() => A.page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_locale_sync`) || "{}").synced, userId)).toBe("ru");
  return { A, email };
}

test.describe("Language and sessions settings follow the account", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("the language chosen on the laptop comes to the phone; changed on the phone → back on the laptop", async ({ browser, request }) => {
    const { A, email } = await accountWithCloud(browser, request, "Lang");
    await A.page.goto("/settings/interface");
    const userId = (await cloudProfile(request, email)).id;
    // Wait for the completed initial profile exchange, not just the journal's parallel upload.
    // This removes the race that used to let an unrelated exchange save the first choice by accident.
    await expect.poll(() => A.page.evaluate((id) => {
      const state = JSON.parse(localStorage.getItem(`ayra:${id}:ayra_locale_sync`) || "null");
      return state?.synced;
    }, userId)).toBe("ru");
    await A.page.getByRole("button", { name: "English" }).click();
    await expect(A.page.locator("html")).toHaveAttribute("lang", "en");
    await expect.poll(async () => (await cloudProfile(request, email)).locale, { timeout: 20000 }).toBe("en");
    await A.page.reload();
    await expect(A.page.locator("html")).toHaveAttribute("lang", "en");

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
    // A real second sign-in on the same device keeps the account language.
    await A.ctx.clearCookies();
    await signIn(A.page, email);
    await A.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await expect(A.page.locator("html")).toHaveAttribute("lang", "ru");
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

  test("Market 1.4: the calendar filters and the news instrument set on the laptop come to the phone", async ({ browser, request }) => {
    const { A, email } = await accountWithCloud(browser, request, "Cal");
    await A.page.goto("/market?tab=calendar&view=world");
    await A.page.getByTestId("market-calendar-importance-low").click();
    await A.page.getByTestId("market-calendar-country-cn").click();
    await A.page.goto("/market?tab=news&view=market");
    await A.page.getByTestId("market-news-instrument").click();
    await A.page.locator("#market-news-cat-tab-commodities").click();
    await A.page.getByTestId("market-news-pick-gold").click();
    await expect
      .poll(async () => (await viewRow(request, email))?.data.calendar as Record<string, unknown> | undefined, { timeout: 20000 })
      .toMatchObject({ importance: ["high", "medium", "low"], countries: ["us", "eu", "gb", "jp", "cn"], newsInstrument: "gold" });

    const B = await device(browser, 360);
    await signIn(B.page, email);
    await B.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await B.page.goto("/market?tab=calendar&view=world");
    await expect(B.page.getByTestId("market-calendar-importance-low")).toHaveAttribute("aria-pressed", "true", { timeout: 20000 });
    await expect(B.page.getByTestId("market-calendar-country-cn")).toHaveAttribute("aria-pressed", "true");
    await B.page.goto("/market?tab=news&view=market");
    await expect(B.page.getByTestId("market-news-instrument")).toContainText("Золото", { timeout: 20000 });
    await A.ctx.close();
    await B.ctx.close();
  });
});

// Locale regressions deliberately wait for the initial profile baseline before choosing a language.
test.describe("Locale sync request ordering", () => {
  test.setTimeout(150_000);
  test.use({ reducedMotion: "reduce" });

  test("manual language stays local through reload until explicit Synchronise", async ({ browser, request }) => {
    const { A, email } = await accountWithCloud(browser, request, "LangManual");
    const userId = (await cloudProfile(request, email)).id;
    await A.page.goto("/settings/cloud");
    await A.page.getByTestId("cloud-sync-mode").getByRole("radio", { name: "Вручную" }).click();
    await A.page.goto("/settings/interface");
    await A.page.getByRole("button", { name: "English" }).click();
    await expect.poll(() => A.page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_locale_sync`) || "{}").pending, userId)).toBe("en");
    await A.page.reload();
    await expect(A.page.locator("html")).toHaveAttribute("lang", "en");
    expect((await cloudProfile(request, email)).locale).toBe("ru");
    await A.page.goto("/settings/cloud");
    await A.page.getByTestId("cloud-sync-now").click();
    await expect.poll(async () => (await cloudProfile(request, email)).locale, { timeout: 20000 }).toBe("en");
    await A.ctx.close();
  });

  test("manual failed PATCH keeps local EN pending; explicit retry saves it", async ({ browser, request }) => {
    const { A, email } = await accountWithCloud(browser, request, "LangError");
    const userId = (await cloudProfile(request, email)).id;
    await A.page.goto("/settings/cloud");
    await A.page.getByTestId("cloud-sync-mode").getByRole("radio", { name: "Вручную" }).click();
    await A.page.goto("/settings/interface");
    let failures = 0;
    const failLocale = async (route: import("@playwright/test").Route) => {
      if (route.request().method() === "PATCH" && route.request().postDataJSON()?.locale) {
        failures++;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "test network failure" }) });
      } else await route.continue();
    };
    await A.page.route("**/rest/v1/profiles?**", failLocale);
    await A.page.getByRole("button", { name: "English" }).click();
    expect(failures).toBe(0);
    await A.page.goto("/settings/cloud");
    await A.page.getByTestId("cloud-sync-now").click();
    await expect.poll(() => failures).toBe(1);
    await expect(A.page.locator("html")).toHaveAttribute("lang", "en");
    expect((await cloudProfile(request, email)).locale).toBe("ru");
    expect(await A.page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_locale_sync`) || "{}"), userId)).toMatchObject({ pending: "en", dirty: true, synced: "ru" });
    await A.page.unroute("**/rest/v1/profiles?**", failLocale);
    await A.page.getByTestId("cloud-sync-now").click();
    await expect.poll(async () => (await cloudProfile(request, email)).locale, { timeout: 20000 }).toBe("en");
    await expect.poll(() => A.page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_locale_sync`) || "{}").dirty, userId)).toBe(false);
    await A.ctx.close();
  });

  test("a delayed EN PATCH cannot erase a later RU choice", async ({ browser, request }) => {
    const { A, email } = await accountWithCloud(browser, request, "LangRapid");
    await A.page.goto("/settings/interface");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const values: string[] = [];
    await A.page.route("**/rest/v1/profiles?**", async (route) => {
      const value = route.request().method() === "PATCH" ? route.request().postDataJSON()?.locale : undefined;
      if (value) {
        values.push(value);
        if (values.length === 1) await gate;
      }
      await route.continue();
    });
    await A.page.getByRole("button", { name: "English" }).click();
    await expect.poll(() => values).toEqual(["en"]);
    await A.page.getByRole("button", { name: "Russian" }).click();
    await expect(A.page.locator("html")).toHaveAttribute("lang", "ru");
    release();
    await expect.poll(() => values).toEqual(["en", "ru"]);
    await expect.poll(async () => (await cloudProfile(request, email)).locale).toBe("ru");
    await A.page.reload();
    await expect(A.page.locator("html")).toHaveAttribute("lang", "ru");
    expect(values).toEqual(["en", "ru"]);
    await A.ctx.close();
  });
});
