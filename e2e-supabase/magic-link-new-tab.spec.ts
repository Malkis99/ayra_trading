import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { submitPasswordSignIn, submitRegistration } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";
const SIGN_OUT_LABEL = "Выйти";

async function seedGuestWithData(context: BrowserContext) {
  await context.addInitScript(() => {
    if (localStorage.getItem("e2e_seeded_guest")) return;
    localStorage.setItem("e2e_seeded_guest", "1");
    localStorage.setItem("ayra_guest_dismissed", "1");
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({
        name: "GuestZed",
        level: 3,
        xp: 40,
        onboarding: { status: "done", step: 5, subStep: 0, answers: { nickname: "GuestZed", language: "ru" } },
      })
    );
  });
}

async function requestMagicLink(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await submitRegistration(page, email);
  await expect(page.locator("#otp-input")).toBeVisible();
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).link;
}

async function cloudProfile(page: Page, email: string) {
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`);
  return res.json();
}

// "callback": project redirect allowlist contains /auth/callback (server-side code exchange).
// "root": /auth/callback not allowlisted, Supabase falls back to Site URL "/?code=" (browser-side exchange).
const VARIANTS = ["callback", "root"] as const;

function linkForVariant(link: string, variant: (typeof VARIANTS)[number]): string {
  if (variant === "callback") return link;
  const u = new URL(link);
  return `${u.origin}/?code=${u.searchParams.get("code")}`;
}

for (const variant of VARIANTS) test.describe(`Magic link opened in a new tab (real PKCE flow, ${variant})`, () => {
  test("guest with local data + new account via email link in tab B -> /awakening, guest data not adopted", async ({ context }) => {
    await seedGuestWithData(context);
    const tabA = await context.newPage();
    await tabA.goto("/");
    await expect(tabA.locator("body")).toContainText("GuestZed");

    const email = `new_${Date.now()}@example.com`;
    const link = linkForVariant(await requestMagicLink(tabA, email), variant);

    const tabB = await context.newPage();
    const consoleLines: string[] = [];
    tabA.on("console", (m) => {
      if (m.text().startsWith("[AYRA:auth]")) consoleLines.push(`A ${m.text()}`);
    });
    tabB.on("console", (m) => {
      if (m.text().startsWith("[AYRA:auth]")) consoleLines.push(`B ${m.text()}`);
    });
    await tabB.goto(link);

    await tabB.waitForURL("**/awakening**", { timeout: 10000 }).catch(() => {});
    await tabB.waitForTimeout(1500);
    const profile = await cloudProfile(tabB, email);
    console.log(`tab B final URL: ${tabB.url()} cloudNickname=${profile.nickname}\n${consoleLines.join("\n")}`);

    expect(new URL(tabB.url()).pathname).toBe("/awakening");
    expect(profile.nickname).toBeNull();
    await expect(tabB.locator('input[placeholder="A-Z a-z 0-9 _ . -"]')).not.toHaveValue("GuestZed");

    const accountState = await tabB.evaluate((id) => {
      const raw = localStorage.getItem(`ayra:${id}:ayra_demo_v1`);
      return raw ? JSON.parse(raw) : null;
    }, profile.id);
    expect(accountState?.name ?? "").not.toBe("GuestZed");
    expect(accountState?.onboarding?.status ?? "none").not.toBe("legacy");

    const guest = await tabB.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "null"));
    expect(guest?.name).toBe("GuestZed");
  });
});

async function completeOnboarding(page: Page, nickname: string) {
  const nick = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
  await nick.fill(nickname);
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

test.describe("After onboarding: optional guest transfer, existing accounts", () => {
  test("new account finishes its own onboarding, then /profile-select offers the guest transfer", async ({ context }) => {
    await seedGuestWithData(context);
    const tabA = await context.newPage();
    await tabA.goto("/");
    const email = `flow_${Date.now()}@example.com`;
    const link = await requestMagicLink(tabA, email);

    const tabB = await context.newPage();
    await tabB.goto(link);
    await tabB.waitForURL("**/awakening**", { timeout: 10000 });
    await completeOnboarding(tabB, `Acc${Date.now() % 100000}`);

    await tabB.waitForURL("**/profile-select**", { timeout: 10000 });
    await expect(tabB.locator("main")).toContainText("GuestZed");
    await tabB.click("button:has-text('Перенести данные гостя')");
    await tabB.waitForURL((url) => url.pathname === "/", { timeout: 10000 });

    const profile = await cloudProfile(tabB, email);
    expect(profile.nickname).toMatch(/^Acc\d+$/);
    const account = await tabB.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`)!), profile.id);
    expect(account.name).toBe(profile.nickname);
    expect(account.level).toBe(3);
  });

  test("existing account (nickname + onboarded on this device) signs in by password and opens Home, no letter", async ({ context }) => {
    await seedGuestWithData(context);
    const tabA = await context.newPage();
    await tabA.goto("/");
    const email = `existing_${Date.now()}@example.com`;

    // First sign-in: onboard the account
    const first = await context.newPage();
    await first.goto(await requestMagicLink(tabA, email));
    await first.waitForURL("**/awakening**", { timeout: 10000 });
    await completeOnboarding(first, `Old${Date.now() % 100000}`);
    await first.waitForURL("**/profile-select**", { timeout: 10000 });
    await first.click("button:has-text('Не переносить')");
    await first.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await first.close();
    await tabA.goto("/settings/account");
    await tabA.getByRole("button", { name: SIGN_OUT_LABEL, exact: true }).click();
    await expect(tabA.getByRole("link", { name: /Войти/ }).first()).toBeVisible();

    // Second sign-in: e-mail + password (auth plan PR C), no letter, straight Home without onboarding
    await tabA.goto("/login");
    await submitPasswordSignIn(tabA, email);
    await tabA.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
    await tabA.waitForTimeout(1500);
    expect(new URL(tabA.url()).pathname).toBe("/");
  });
});
