import { test, expect, type Page } from "@playwright/test";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// T7b-3 regression: a signed-in account WITHOUT cloud sync (the flag is off for everyone) — the Journal works
// exactly as before, keeps data locally and never calls the cloud journal tables.

async function requestMagicLink(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.fill("#email-input", email);
  await page.click("input[type='checkbox']");
  await page.click("button[type='submit']");
  await expect(page.locator("#otp-input")).toBeVisible();
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`);
  return (await res.json()).link;
}

async function completeOnboarding(page: Page, nickname: string) {
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill(nickname);
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("18–24 года")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Пропустить шаг целиком")');
  await page.click('button:has-text("1–2 года")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Крипто")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Дисциплина")');
  await page.click('button:has-text("Продолжить")');
  await page.click('button:has-text("Пропустить необязательные вопросы")');
  await page.click('button:has-text("Пропустить шаг целиком")');
  await page.click('button:has-text("Начать")');
}

test.describe("Cloud journal with the sync flag off", () => {
  test.use({ reducedMotion: "reduce" });

  test("journal works locally as before; no request reaches the journal tables", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await request.get(`${FAKE_SUPABASE}/__test/cloud-requests?reset=1`);
    const email = `cloudoff_${Date.now()}@example.com`;
    await page.goto(await requestMagicLink(page, email));
    await page.waitForURL("**/awakening**", { timeout: 10000 });
    await completeOnboarding(page, `Off${Date.now() % 100000}`);
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });

    await page.goto("/journal");
    await page.getByRole("button", { name: "Добавить сделку" }).first().click();
    const drawer = page.getByTestId("add-trade-drawer");
    await expect(drawer).toBeVisible();
    // a new account has no trading account yet: quick creation first
    await drawer.getByPlaceholder("Название счёта").fill("Main");
    await drawer.getByRole("button", { name: "Создать счёт" }).click();
    await page.getByTestId("instrument-input").fill("nas100");
    await page.fill("input[placeholder='150 / -50']", "75");
    await page.getByTestId("instrument-input").press("Control+Enter");
    await expect(drawer).toBeHidden();

    // stored in the account space of this device
    const profile = await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json();
    const stored = () =>
      page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_journal_v1`) || "{}").trades || [], profile.id);
    await expect.poll(async () => (await stored()).length).toBe(1);

    // still there after a reload, shown in the journal
    await page.reload();
    await expect(page.locator("main")).toContainText("NAS100");
    expect((await stored())[0]).toMatchObject({ instrument: "NAS100", pnlMoney: 75 });
    const accounts = await page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_journal_v1`) || "{}").accounts || [], profile.id);
    expect(accounts.map((a: { name: string }) => a.name)).toEqual(["Main"]);

    // the app asked whether sync is on (it is not) and never touched the journal tables
    await expect.poll(async () => (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-requests`)).json()).userFeatures).toBeGreaterThan(0);
    const counts = await (await request.get(`${FAKE_SUPABASE}/__test/cloud-requests`)).json();
    expect(counts.journal).toBe(0);
  });
});
