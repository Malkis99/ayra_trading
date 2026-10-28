import { test, expect, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { submitRegistration } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// T7b-3 regression: a signed-in account WITHOUT cloud sync (the flag is off for everyone) — the Journal works
// exactly as before, keeps data locally and never calls the cloud journal tables.

async function requestMagicLink(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await submitRegistration(page, email);
  await expect(page.locator("#otp-input")).toBeVisible();
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`);
  return (await res.json()).link;
}

test.describe("Cloud journal with the sync flag off", () => {
  test.use({ reducedMotion: "reduce" });

  test("journal works locally as before; no request reaches the journal tables", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await request.get(`${FAKE_SUPABASE}/__test/cloud-requests?reset=1`);
    const email = `cloudoff_${Date.now()}@example.com`;
    await page.goto(await requestMagicLink(page, email));
    await page.waitForURL("**/awakening**", { timeout: 10000 });
    await completeOnboarding(page, `Off${Date.now() % 100000}`, { after: "none" });
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
    // flag off: no cloud badge in the header
    await expect(page.getByTestId("sync-badge")).toHaveCount(0);

    // flag off: Settings texts as before (local data notice, «no cloud sync yet» in the sign-out confirmation)
    await page.goto("/settings/cloud");
    const notice = page.getByTestId("account-data-notice");
    await expect(notice).toHaveAttribute("data-state", "local");
    await expect(notice).toContainText("Данные пока хранятся на этом устройстве");
    await page
      .locator(".card", { hasText: "Данные на этом устройстве" })
      .getByRole("button", { name: "Выйти и удалить данные аккаунта с этого устройства" })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Синхронизации с облаком пока нет");
    await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).first().click();
  });
});
