import { test, expect, type Page } from "@playwright/test";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Owner's production scenario: one incognito window (one browser context, shared localStorage),
// no guest data. Tab A stays on /login after requesting the email; tab B opens the email link.

async function requestMagicLink(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.fill("#email-input", email);
  await page.click("input[type='checkbox']");
  await page.click("button[type='submit']");
  await expect(page.locator("#otp-input")).toBeVisible();
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).link;
}

function collectAuthLogs(page: Page, tag: string, lines: string[]) {
  page.on("console", (m) => {
    if (m.text().startsWith("[AYRA:auth]")) lines.push(`${tag} ${m.text()}`);
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) lines.push(`${tag} navigated ${new URL(f.url()).pathname}${new URL(f.url()).search}`);
  });
}

/** Records every pathname the tab renders, to catch Home flashing before the redirect. */
async function trackPaths(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = ((window as any).__paths = (window as any).__paths || []);
    const push = () => {
      if (document.querySelector('[data-testid="home-dashboard"]')) seen.push(location.pathname);
    };
    new MutationObserver(push).observe(document, { childList: true, subtree: true });
  });
}

// "profile-fails": the first profile reads fail (slow/cold database on production) — the case where
// Shell used to wait for a loaded profile forever while Home was already shown.
for (const variant of ["callback", "callback-next-root", "callback-next-journal", "root", "profile-fails"] as const) {
  test(`incognito: tab A on /login, tab B opens the email link (${variant}) -> /awakening`, async ({ context }) => {
    const lines: string[] = [];
    const tabA = await context.newPage();
    collectAuthLogs(tabA, "A", lines);
    const email = `incog_${variant}_${Date.now()}@example.com`;
    const link = await requestMagicLink(tabA, email);
    const code = new URL(link).searchParams.get("code");
    const origin = new URL(link).origin;
    const url =
      variant === "callback" || variant === "profile-fails"
        ? link
        : variant === "callback-next-root"
        ? `${origin}/auth/callback?code=${code}&next=%2F`
        : variant === "callback-next-journal"
        ? `${origin}/auth/callback?code=${code}&next=%2Fjournal`
        : `${origin}/?code=${code}`;

    if (variant === "profile-fails") await tabA.request.get(`${FAKE_SUPABASE}/__test/fail-profile-reads?count=4`);
    const tabB = await context.newPage();
    collectAuthLogs(tabB, "B", lines);
    await trackPaths(tabB);
    await tabB.goto(url);
    await tabB.waitForURL("**/awakening**", { timeout: 8000 }).catch(() => {});
    await tabB.waitForTimeout(1500);
    console.log(`[${variant}] tab B: ${tabB.url()} | tab A: ${tabA.url()}\n${lines.join("\n")}`);

    expect(new URL(tabB.url()).pathname).toBe("/awakening");
    // Home must never be shown to this signed-in account before its onboarding (not even briefly)
    expect(await tabB.evaluate(() => (window as any).__paths?.length ?? 0)).toBe(0);

    // Tab A keeps offering "Continue here", which uses the same router
    await tabA.bringToFront();
    const continueHere = tabA.getByRole("button", { name: "Продолжить здесь" });
    await expect(continueHere).toBeVisible({ timeout: 5000 });
    await continueHere.click();
    await tabA.waitForURL("**/awakening**", { timeout: 8000 });
  });
}

test("profile cannot be loaded: no Home, a retry screen; retry then routes to /awakening", async ({ context }) => {
  const tabA = await context.newPage();
  const link = await requestMagicLink(tabA, `down_${Date.now()}@example.com`);
  await tabA.request.get(`${FAKE_SUPABASE}/__test/fail-profile-reads?count=1000`);
  const tabB = await context.newPage();
  await trackPaths(tabB);
  try {
    await tabB.goto(link);
    await expect(tabB.getByRole("alert").filter({ hasText: "Не удалось загрузить профиль" })).toBeVisible({ timeout: 15000 });
    expect(new URL(tabB.url()).pathname).toBe("/auth/continue");
    expect(await tabB.evaluate(() => (window as any).__paths?.length ?? 0)).toBe(0);
  } finally {
    await tabA.request.get(`${FAKE_SUPABASE}/__test/fail-profile-reads?count=0`);
  }
  await tabB.getByRole("button", { name: "Повторить" }).click();
  await tabB.waitForURL("**/awakening**", { timeout: 8000 });
});

test("signed-in account without onboarding opening / directly is sent to /awakening, Home never shown", async ({ context }) => {
  const tabA = await context.newPage();
  const link = await requestMagicLink(tabA, `direct_${Date.now()}@example.com`);
  const tabB = await context.newPage();
  await tabB.goto(link);
  await tabB.waitForURL("**/awakening**", { timeout: 8000 });
  const tabC = await context.newPage();
  await trackPaths(tabC);
  await tabC.goto("/");
  await tabC.waitForURL("**/awakening**", { timeout: 8000 });
  expect(await tabC.evaluate(() => (window as any).__paths?.length ?? 0)).toBe(0);
});
