import { test, expect, type Page } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Auth plan PR B: an account made by the e-mail code (simulated: password removed on the server) gets a password in Settings — no e-mail is sent, the session,
// the user id, the journal and cloud sync stay as they were. Runs against the fake Supabase only.

async function completeOnboarding(page: Page, nickname: string) {
  await page.waitForURL("**/awakening**", { timeout: 10000 });
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
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
}

const shotDir = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
};

test.describe("Settings: create and change the password", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 740 }]) {
    test(`code account → «Create password» → «Change password»; same session, journal and cloud (${viewport.width}px)`, async ({ page, request }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const email = `Pwd${viewport.width}_${Date.now()}@example.com`;
      await signIn(page, email);
      await completeOnboarding(page, `Pwd${Date.now() % 100000}`);
      const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id) as string;
      // an account made by the e-mail code before passwords existed: no password on the server
      await request.get(`${FAKE_SUPABASE}/__test/clear-password?email=${encodeURIComponent(email)}`);

      // cloud sync on with one trade in the cloud: must keep working after the password is set
      await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
      await page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);
      await page.goto("/journal");
      await page.getByRole("button", { name: "Добавить сделку" }).first().click();
      const drawer = page.getByTestId("add-trade-drawer");
      await drawer.getByPlaceholder("Название счёта").fill("Main");
      await drawer.getByRole("button", { name: "Создать счёт" }).click();
      await page.getByTestId("instrument-input").fill("nas100");
      await page.fill("input[placeholder='150 / -50']", "40");
      await page.getByTestId("instrument-input").press("Control+Enter");
      await expect(drawer).toBeHidden();
      const cloudTrades = async () =>
        ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as { table: string }[]).filter(
          (r) => r.table === "journal_trades"
        ).length;
      await expect.poll(cloudTrades, { timeout: 15000 }).toBe(1);

      await page.setViewportSize(viewport);
      await page.goto("/settings");
      await request.get(`${FAKE_SUPABASE}/__test/logouts?reset=1`);
      const lastLinkBefore = await (await request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`)).json();

      // no password yet: «Create password»; the rule is checked before anything is sent
      const open = page.getByTestId("password-open");
      await expect(open).toHaveText("Создать пароль");
      await open.click();
      const dialog = page.getByTestId("set-password-dialog");
      await expect(dialog).toContainText("Письмо для этого не отправляется");
      await expect(page.getByTestId("password-current")).toHaveCount(0);
      await page.getByTestId("password-new").fill("short");
      await page.getByTestId("password-save").click();
      await expect(dialog).toContainText("Пароль должен быть не короче 8 символов");
      expect((await (await request.get(`${FAKE_SUPABASE}/__test/password?email=${encodeURIComponent(email)}`)).json()).hasPassword).toBe(false);

      // «Show password» toggles the field type
      await page.getByTestId("password-new").fill("rainy morning trades");
      await expect(page.getByTestId("password-new")).toHaveAttribute("type", "password");
      await dialog.getByRole("button", { name: "Показать пароль" }).click();
      await expect(page.getByTestId("password-new")).toHaveAttribute("type", "text");
      if (viewport.width === 360) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      }
      await shot(page, `password-create-${viewport.width}`);
      await page.getByTestId("password-save").click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId("password-saved")).toHaveText("Пароль сохранён");
      await expect(open).toHaveText("Сменить пароль");
      const stored = await (await request.get(`${FAKE_SUPABASE}/__test/password?email=${encodeURIComponent(email)}`)).json();
      expect(stored).toEqual({ hasPassword: true, metadata: { has_password: true } });

      // no e-mail was sent and the session was never ended
      const lastLinkAfter = await (await request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`)).json();
      expect(lastLinkAfter).toEqual(lastLinkBefore);
      expect(await (await request.get(`${FAKE_SUPABASE}/__test/logouts`)).json()).toEqual([]);

      // after a reload: still signed in as the same user, «Change password», journal and cloud as before
      await page.reload();
      await expect(open).toHaveText("Сменить пароль");
      await expect(page.locator("body")).toContainText(email);
      await page.goto("/journal");
      await expect(page.locator("main")).toContainText("NAS100");
      await expect(page.getByTestId("sync-badge")).toHaveAttribute("data-state", "synced", { timeout: 15000 });
      const space = await page.evaluate((id) => localStorage.getItem(`ayra:${id}:ayra_journal_v1`) || "", userId);
      expect(space).toContain("NAS100");

      // change: the current password is checked first; a wrong one changes nothing
      await page.goto("/settings");
      await open.click();
      await expect(page.getByTestId("password-current")).toBeVisible();
      await page.getByTestId("password-current").fill("wrong password");
      await page.getByTestId("password-new").fill("sunny evening trades");
      await page.getByTestId("password-save").click();
      await expect(dialog).toContainText("Текущий пароль неверный");
      await shot(page, `password-change-wrong-${viewport.width}`);

      // the same password as now: a clear message
      await page.getByTestId("password-current").fill("rainy morning trades");
      await page.getByTestId("password-new").fill("rainy morning trades");
      await page.getByTestId("password-save").click();
      await expect(page.getByTestId("password-error")).toContainText("Новый пароль совпадает с текущим");
      await expect(page.getByTestId("password-error")).toContainText("Технические детали");

      await request.get(`${FAKE_SUPABASE}/__test/logouts?reset=1`);
      await page.getByTestId("password-new").fill("sunny evening trades");
      await page.getByTestId("password-save").click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId("password-saved")).toBeVisible();
      // the check client signed out only itself; the app's session stays
      expect(await (await request.get(`${FAKE_SUPABASE}/__test/logouts`)).json()).toEqual(["local"]);
      await page.goto("/journal");
      await expect(page.locator("main")).toContainText("NAS100");
      expect(await cloudTrades()).toBe(1);
    });
  }
});
