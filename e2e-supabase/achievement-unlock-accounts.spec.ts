import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Q4.7 (docs/q4-7-achievement-unlock.md): the day-plan achievements and firstPropRules are kept in the space of the
// account that met the rule — never the guest's, never another account's; they survive sign-out → sign-in; the first-plan
// reward of the Journal stays the only XP and Coins of a first plan.

type Save = { xp: number; level: number; coins: number; achievements?: Record<string, boolean>; chronicle?: Array<{ type: string; achievementId?: string }> };
const save = (page: Page, userId: string | null) =>
  page.evaluate((u) => JSON.parse(localStorage.getItem(u ? `ayra:${u}:ayra_demo_v1` : "ayra_demo_v1") || "null"), userId) as Promise<Save | null>;
const plansOf = (page: Page, userId: string | null) =>
  page.evaluate((u) => (JSON.parse(localStorage.getItem(u ? `ayra:${u}:ayra_journal_v1` : "ayra_journal_v1") || "{}").plans || []) as Array<{ date: string; note?: string }>, userId);
const unlocks = (s: Save | null, id: string) => (s?.chronicle || []).filter((e) => e.type === "achievementUnlocked" && e.achievementId === id).length;
const total = (s: Save) => { let sum = s.xp; for (let lv = 1; lv < s.level; lv++) sum += 80 + lv * 40; return sum; };
const NOTE = "Мысли перед началом торгов, ожидания...";

async function account(page: Page, request: APIRequestContext, prefix: string) {
  const email = `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Au${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  return { email, userId };
}
async function signOut(page: Page) {
  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 15_000 });
}
async function writePlanNote(page: Page, userId: string, text: string) {
  await page.goto("/journal");
  await page.getByRole("tab", { name: "План", exact: true }).first().click();
  await page.getByPlaceholder(NOTE).fill(text);
  await expect.poll(async () => (await plansOf(page, userId)).some((p) => p.note === text)).toBe(true);
}

test.describe("Q4.7 achievements kept in the right space (fake Supabase)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test("A meets firstPlan → only A has it; guest and B never; sign-out → sign-in of A keeps it once; the first plan pays only its first-action reward", async ({ page, request }) => {
    const a = await account(page, request, "UnlockA");
    const before = (await save(page, a.userId))!;
    expect(before.achievements?.firstPlan).toBeUndefined();
    await writePlanNote(page, a.userId, "План аккаунта A.");
    await expect.poll(async () => (await save(page, a.userId))?.achievements?.firstPlan).toBe(true);
    const afterA = (await save(page, a.userId))!;
    // the Journal's one-time first-plan reward (10 XP, 5 Coins) — and nothing from the achievement
    expect({ xp: total(afterA) - total(before), coins: afterA.coins - before.coins }).toEqual({ xp: 10, coins: 5 });

    await signOut(page);
    expect((await save(page, null))?.achievements?.firstPlan).toBeUndefined();

    const b = await account(page, request, "UnlockB");
    expect((await save(page, b.userId))?.achievements?.firstPlan).toBeUndefined();
    expect(JSON.stringify(await save(page, b.userId))).not.toContain("План аккаунта A.");
    await signOut(page);

    await signIn(page, a.email);
    await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth"), { timeout: 30_000 });
    await writePlanNote(page, a.userId, "Снова A.");
    const again = (await save(page, a.userId))!;
    expect(again.achievements?.firstPlan).toBe(true);
    expect(unlocks(again, "firstPlan")).toBe(1);
    expect({ xp: total(again), coins: again.coins }).toEqual({ xp: total(afterA), coins: afterA.coins });
    expect((await save(page, b.userId))?.achievements?.firstPlan).toBeUndefined();
  });

  test("a plan typed in one tab while another tab signs out: nothing of the account reaches the guest", async ({ page, request, context }) => {
    const a = await account(page, request, "UnlockTabs");
    const other = await context.newPage();
    await other.goto("/settings/account");
    await expect(other.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
    await page.goto("/journal");
    await page.getByRole("tab", { name: "План", exact: true }).first().click();
    // typed, not saved yet (the tab saves ~0.5 s after the last change): the other tab signs out right now
    await page.getByPlaceholder(NOTE).fill("Набрано перед выходом в другой вкладке.");
    await other.getByRole("button", { name: "Выйти", exact: true }).click();
    await other.waitForURL((u) => u.pathname === "/login", { timeout: 15_000 });
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 15_000 });
    await page.waitForTimeout(1500); // any late save of the first tab has happened by now
    const guest = await save(page, null);
    expect(guest?.achievements?.firstPlan).toBeUndefined();
    expect(guest?.xp ?? 0).toBe(0);
    expect(guest?.coins ?? 0).toBe(0);
    expect((await plansOf(page, null)).map((p) => p.note)).not.toContain("Набрано перед выходом в другой вкладке.");
    // the account's own save keeps what it had (nothing of the guest, no achievement it did not meet in its space)
    const acc = await save(page, a.userId);
    expect(unlocks(acc, "firstPlan")).toBeLessThanOrEqual(1);
  });
});
