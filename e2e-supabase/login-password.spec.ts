import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { TEST_PASSWORD, submitPasswordSignIn, submitRegistration } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Auth plan PR C: «Sign in / Sign up» screen. Sign-in is by e-mail + password (no letter); the code comes only for
// sign-up and «Forgot password». Runs against the fake Supabase only; no real project is touched.

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

const q = (email: string) => encodeURIComponent(email);
const lastCode = async (request: APIRequestContext, email: string) => (await (await request.get(`${FAKE_SUPABASE}/__test/last-code?email=${q(email)}`)).json()).code as string | null;
const profileId = async (request: APIRequestContext, email: string) => (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${q(email)}`)).json()).id as string;

/** Registers with the code typed by hand (not the link) and passes onboarding. */
async function register(page: Page, request: APIRequestContext, email: string, nickname: string) {
  await page.goto("/login");
  await submitRegistration(page, email);
  await expect(page.locator("#otp-input")).toBeVisible();
  await page.fill("#otp-input", (await lastCode(request, email))!);
  await page.getByRole("button", { name: "Подтвердить" }).click();
  await completeOnboarding(page, nickname);
}

async function plainSignOut(page: Page) {
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
  await expect(page.getByRole("heading", { name: "Войди во вселенную" })).toBeVisible();
}

const shotDir = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
};

test.describe("Login: e-mail + password", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);

  test("sign up with the code → sign out → sign in by password (no letter); same account, journal and cloud", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = `LoginPw_${Date.now()}@example.com`;
    await page.goto("/login");
    // «Sign in» is the first tab; the hint for accounts without a password is there
    await expect(page.getByRole("tab", { name: "Вход" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("old-account-hint")).toContainText("Раньше входил по коду и пароля нет?");
    await shot(page, "login-signin-1440");

    // sign up: the password rule is checked before anything is sent
    await page.getByRole("tab", { name: "Регистрация" }).click();
    await page.fill("#email-input", email);
    await page.fill("#password-input", "short");
    await page.click("input[type='checkbox']");
    await page.click("button[type='submit']");
    await expect(page.getByTestId("login-error")).toContainText("Пароль должен быть не короче 8 символов");
    expect(await lastCode(request, email)).toBeNull();
    await page.fill("#password-input", TEST_PASSWORD);
    await shot(page, "login-signup-1440");
    await page.click("button[type='submit']");
    await expect(page.getByTestId("login-subtitle")).toContainText(`Мы отправили код на ${email}`);
    await expect(page.getByTestId("existing-account-hint")).toBeVisible();
    await page.fill("#otp-input", (await lastCode(request, email))!);
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await completeOnboarding(page, `LoginPw${Date.now() % 100000}`);
    const userId = await profileId(request, email);

    // a trade with cloud sync on
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${q(email)}&on=1`);
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
    await expect(page.getByTestId("sync-badge")).toHaveAttribute("data-state", "synced", { timeout: 15000 });

    await plainSignOut(page);
    const codeBefore = await lastCode(request, email);

    // wrong password and unknown e-mail: one and the same answer, with technical details
    await submitPasswordSignIn(page, email, "wrong password");
    await expect(page.getByTestId("login-error")).toContainText("Неверная почта или пароль");
    await expect(page.getByTestId("login-error")).toContainText("Технические детали");
    await submitPasswordSignIn(page, `nobody_${Date.now()}@example.com`, "whatever123");
    await expect(page.getByTestId("login-error")).toContainText("Неверная почта или пароль");

    // «Show password»
    await page.fill("#password-input", TEST_PASSWORD);
    await expect(page.locator("#password-input")).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Показать пароль" }).click();
    await expect(page.locator("#password-input")).toHaveAttribute("type", "text");

    // right password: back where the user was (?next=/settings), no onboarding, same account, no letter sent
    await submitPasswordSignIn(page, email);
    await page.waitForURL((url) => url.pathname === "/settings/account", { timeout: 10000 });
    expect(await lastCode(request, email)).toBe(codeBefore);
    await page.goto("/journal");
    await expect(page.locator("main")).toContainText("NAS100");
    await expect(page.getByTestId("sync-badge")).toHaveAttribute("data-state", "synced", { timeout: 15000 });
    expect(await page.evaluate((id) => localStorage.getItem(`ayra:${id}:ayra_journal_v1`) || "", userId)).toContain("NAS100");
    await page.goto("/settings/account");
    await expect(page.getByTestId("password-open")).toHaveText("Сменить пароль");
  });

  test("5 wrong passwords lock the button for 30 s", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = `Lock_${Date.now()}@example.com`;
    await register(page, request, email, `Lock${Date.now() % 100000}`);
    await plainSignOut(page);
    for (let i = 0; i < 5; i++) {
      await submitPasswordSignIn(page, email, `wrong-${i}-password`);
      await expect(page.getByTestId("login-error")).toContainText("Неверная почта или пароль");
    }
    await expect(page.getByTestId("login-locked")).toContainText(/Слишком много попыток\. Попробуй снова через \d+ с/);
    await expect(page.locator("button[type='submit']")).toBeDisabled();
  });

  test("«Forgot password»: same answer for any e-mail; code + new password signs in here and out on the other device", async ({ browser, page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = `Forgot_${Date.now()}@example.com`;
    await register(page, request, email, `Forg${Date.now() % 100000}`);

    // a second device signed in to the same account
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/login");
    await submitPasswordSignIn(otherPage, email);
    await otherPage.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    expect((await (await request.get(`${FAKE_SUPABASE}/__test/sessions?email=${q(email)}`)).json()).live).toBeGreaterThanOrEqual(2);

    await plainSignOut(page);
    // unknown e-mail: the same screen, nothing tells it is not registered
    await page.getByTestId("forgot-link").click();
    await expect(page.getByRole("heading", { name: "Восстановление пароля" })).toBeVisible();
    const nobody = `nobody_${Date.now()}@example.com`;
    await page.fill("#email-input", nobody);
    await page.getByRole("button", { name: "Отправить код" }).click();
    await expect(page.getByTestId("login-subtitle")).toContainText(`Если почта ${nobody} зарегистрирована, мы отправили на неё код.`);
    await page.getByRole("button", { name: "Назад ко входу" }).click();

    await page.getByTestId("forgot-link").click();
    await page.fill("#email-input", email);
    await page.getByRole("button", { name: "Отправить код" }).click();
    await expect(page.getByTestId("login-subtitle")).toContainText(`Если почта ${email} зарегистрирована`);
    await expect(page.locator("#new-password-input")).toBeVisible();
    await shot(page, "login-reset-1440");
    await page.fill("#otp-input", (await lastCode(request, email))!);
    await page.fill("#new-password-input", "brand new password");
    await page.getByRole("button", { name: "Сохранить пароль" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });

    // the other device's session is ended (owner decision 4); only this one is alive
    const logouts = (await (await request.get(`${FAKE_SUPABASE}/__test/logouts`)).json()) as string[];
    expect(logouts).toContain("others");
    expect((await (await request.get(`${FAKE_SUPABASE}/__test/sessions?email=${q(email)}`)).json()).live).toBe(1);

    // the new password works, the old one does not
    await plainSignOut(page);
    await submitPasswordSignIn(page, email);
    await expect(page.getByTestId("login-error")).toContainText("Неверная почта или пароль");
    await submitPasswordSignIn(page, email, "brand new password");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
    await other.close();
  });

  test("sign-up with an e-mail that has an account: the same code screen, no letter; not confirmed e-mail: send the code again", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = `Exists_${Date.now()}@example.com`;
    await register(page, request, email, `Exst${Date.now() % 100000}`);
    await plainSignOut(page);
    const codeBefore = await lastCode(request, email);
    await submitRegistration(page, email, "another password");
    await expect(page.getByTestId("login-subtitle")).toContainText(`Мы отправили код на ${email}`);
    await expect(page.getByTestId("existing-account-hint")).toContainText("Если у этой почты уже есть аккаунт");
    expect(await lastCode(request, email)).toBe(codeBefore); // no letter for a taken e-mail

    // registered but never confirmed: sign-in says so only after the right password, and offers the code again
    const fresh = `Unconf_${Date.now()}@example.com`;
    await page.goto("/login");
    await submitRegistration(page, fresh);
    await expect(page.locator("#otp-input")).toBeVisible();
    const firstCode = await lastCode(request, fresh);
    await page.goto("/login");
    await submitPasswordSignIn(page, fresh, "wrong password");
    await expect(page.getByTestId("login-error")).toContainText("Неверная почта или пароль");
    await submitPasswordSignIn(page, fresh);
    await expect(page.getByTestId("login-error")).toContainText("Почта ещё не подтверждена");
    await page.getByRole("button", { name: "Отправить код ещё раз" }).click();
    await expect(page.locator("#otp-input")).toBeVisible();
    const secondCode = await lastCode(request, fresh);
    expect(secondCode).not.toBe(firstCode);
    await page.fill("#otp-input", secondCode!);
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await page.waitForURL("**/awakening**", { timeout: 10000 });
  });

  test("360px: tabs, fields and the code screen fit; no horizontal scroll", async ({ page, request }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/login");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await shot(page, "login-signin-360");
    await page.getByRole("tab", { name: "Регистрация" }).click();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await shot(page, "login-signup-360");
    const email = `Narrow_${Date.now()}@example.com`;
    await submitRegistration(page, email);
    await expect(page.locator("#otp-input")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await shot(page, "login-code-360");
    await page.goto("/login");
    await page.getByTestId("forgot-link").click();
    await page.fill("#email-input", email);
    await page.getByRole("button", { name: "Отправить код" }).click();
    await expect(page.locator("#new-password-input")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await shot(page, "login-reset-360");
    expect(await lastCode(request, email)).toBeTruthy();
  });
});
