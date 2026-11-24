import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn, TEST_PASSWORD } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// Q4.7-Б1 (docs/q4-7-b1-account-deletion-storage.md): «Delete account» in the settings. The fake server stands in for
// 0023's steps, the Storage API with the service key and the auth admin API. Synthetic accounts and files only.

type Deletion = { exists: boolean; deletion: { state: string; listed: number; attempts: number; lastError: string | null } | null; deletedUsers: string[] };
const deletion = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/account-deletion?email=${encodeURIComponent(email)}`)).json()) as Deletion;
/** every file in the bucket; with a user id: the files in that account's folder (by path: works after the account is gone) */
const files = async (request: APIRequestContext, userId?: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/storage`)).json()) as { files: Array<{ path: string }> }).files.map((f) => f.path)
    .filter((p) => !userId || p.startsWith(`${userId}/`));
const putFiles = async (request: APIRequestContext, email: string, n: number) => {
  for (let i = 0; i < n; i++) {
    await request.post(`${FAKE_SUPABASE}/__test/storage-put?email=${encodeURIComponent(email)}&name=shot${i}.webp`, { data: Buffer.from(`img${i}`), headers: { "content-type": "image/webp" } });
  }
};
const live = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/live-sessions?email=${encodeURIComponent(email)}`)).json()) as { live: number }).live;

async function account(page: Page, request: APIRequestContext, prefix: string) {
  const email = `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `Dl${Date.now() % 100000}`);
  const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
  return { email, userId };
}
async function openDelete(page: Page) {
  await page.goto("/settings/account");
  await page.getByTestId("delete-account-open").click();
  await expect(page.getByTestId("delete-account-dialog")).toBeVisible();
}

test.describe("Q4.7-Б1 deleting one's own account (fake Supabase)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);
  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/storage-fail-delete?n=0`);
  });

  test("the whole path: what is deleted is shown, the typed word and the password are required; files, account and this device's copy go; another account is untouched", async ({ page, request, browser }) => {
    // another account with its own files and a file whose folder starts like the first one's
    const otherCtx = await browser.newContext();
    const otherPage = await otherCtx.newPage();
    const b = await account(otherPage, request, "DelKeep");
    await putFiles(request, b.email, 2);
    const a = await account(page, request, "DelA");
    await putFiles(request, a.email, 3);
    await request.post(`${FAKE_SUPABASE}/__test/storage-plant?owner=${encodeURIComponent(b.email)}&path=${a.userId}0/lookalike.webp`);
    // a second device of A
    const secondCtx = await browser.newContext();
    const second = await secondCtx.newPage();
    await signIn(second, a.email);
    await second.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth"), { timeout: 30_000 });
    await expect.poll(() => live(request, a.email)).toBe(2);

    await openDelete(page);
    const dialog = page.getByTestId("delete-account-dialog");
    await expect(dialog).toContainText("Скриншоты сделок в облаке");
    await expect(dialog).toContainText("Восстановить ничего будет нельзя");
    // one click is not enough: the word first
    await expect(page.getByTestId("delete-account-submit")).toBeDisabled();
    await page.getByTestId("delete-account-phrase").fill("удалить");
    await expect(page.getByTestId("delete-account-submit")).toBeDisabled();
    await page.getByTestId("delete-account-phrase").fill("УДАЛИТЬ");
    // a wrong password: nothing starts
    await page.getByTestId("delete-account-password").fill("not-the-password");
    await page.getByTestId("delete-account-submit").click();
    await expect(page.getByTestId("delete-account-error")).toHaveAttribute("data-code", "wrong_password");
    expect((await deletion(request, a.email)).deletion).toBeNull();
    expect(await files(request, a.userId)).toHaveLength(3);

    await page.getByTestId("delete-account-password").fill(TEST_PASSWORD);
    await page.getByTestId("delete-account-submit").click();
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
    const after = await deletion(request, a.email);
    expect(after.exists).toBe(false);
    expect(after.deletedUsers).toContain(a.userId);
    expect(await files(request, a.userId)).toEqual([]);
    // this device's copy of A is erased; the other account keeps its files (the look-alike folder too)
    expect(await page.evaluate((u) => Object.keys(localStorage).filter((k) => k.startsWith(`ayra:${u}:`)), a.userId)).toEqual([]);
    const all = await files(request);
    expect(all.filter((p) => p.startsWith(`${b.userId}/`))).toHaveLength(2);
    expect(all).toContain(`${a.userId}0/lookalike.webp`);
    // the second device is signed out (its session ended); the account cannot be signed in again
    expect(await live(request, a.email)).toBe(0);
    await otherCtx.close();
    await secondCtx.close();
  });

  test("some files cannot be removed: «retry» with what is left, the account kept and closed to writes; the retry finishes", async ({ page, request }) => {
    const a = await account(page, request, "DelRetry");
    await putFiles(request, a.email, 5);
    await request.get(`${FAKE_SUPABASE}/__test/storage-fail-delete?n=50`); // the Storage API fails for every file now
    await openDelete(page);
    await page.getByTestId("delete-account-phrase").fill("УДАЛИТЬ");
    await page.getByTestId("delete-account-password").fill(TEST_PASSWORD);
    await page.getByTestId("delete-account-submit").click();
    await expect(page.getByTestId("delete-account-error")).toHaveAttribute("data-code", "storage_error");
    await expect(page.getByTestId("delete-account-left")).toContainText("5");
    const mid = await deletion(request, a.email);
    expect(mid).toMatchObject({ exists: true, deletion: { state: "files_listed", listed: 5, lastError: "storage_error" } });
    // closed to writes while it is unfinished: an upload from this account is refused
    const upload = await page.evaluate(async (u) => {
      const raw = Object.keys(localStorage).find((k) => k.includes("auth-token"));
      const token = raw ? JSON.parse(localStorage.getItem(raw) || "{}").access_token : null;
      const r = await fetch(`http://127.0.0.1:54329/storage/v1/object/journal-attachments/${u}/late.webp`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/webp" }, body: "x" });
      return r.status;
    }, a.userId);
    expect(upload).toBe(400);
    expect(await files(request, a.userId)).toHaveLength(5);
    // the page again: the unfinished deletion is shown and can be continued
    await page.goto("/settings/account");
    await expect(page.getByTestId("delete-account-unfinished")).toBeVisible();
    await expect(page.getByTestId("delete-account-open")).toContainText("Продолжить удаление");
    await request.get(`${FAKE_SUPABASE}/__test/storage-fail-delete?n=0`);
    await page.getByTestId("delete-account-open").click();
    await expect(page.getByTestId("delete-account-resuming")).toBeVisible();
    await page.getByTestId("delete-account-phrase").fill("УДАЛИТЬ");
    await page.getByTestId("delete-account-password").fill(TEST_PASSWORD);
    await page.getByTestId("delete-account-submit").click();
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
    expect((await deletion(request, a.email)).exists).toBe(false);
    expect(await files(request, a.userId)).toEqual([]);
  });

  test("an old sign-in without the password: asked to confirm it is them, nothing starts; the password is enough", async ({ page, request }) => {
    const email = `DelOld_${Date.now()}_${Math.round(Math.random() * 1e4)}@example.com`;
    await request.get(`${FAKE_SUPABASE}/__test/auth-age?email=${encodeURIComponent(email)}&seconds=1800`); // its sign-ins count as 30 minutes old
    await signIn(page, email);
    await completeOnboarding(page, `Do${Date.now() % 100000}`);
    const userId = (await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id as string;
    await putFiles(request, email, 1);
    await openDelete(page);
    await page.getByTestId("delete-account-phrase").fill("УДАЛИТЬ");
    await page.getByTestId("delete-account-submit").click();
    await expect(page.getByTestId("delete-account-error")).toHaveAttribute("data-code", "reauth_required");
    expect((await deletion(request, email)).deletion).toBeNull();
    expect(await files(request, userId)).toHaveLength(1);
    await page.getByTestId("delete-account-password").fill(TEST_PASSWORD);
    await page.getByTestId("delete-account-submit").click();
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
    expect((await deletion(request, email)).exists).toBe(false);
    expect(await files(request, userId)).toEqual([]);
    await request.get(`${FAKE_SUPABASE}/__test/auth-age?email=${encodeURIComponent(email)}&seconds=0`);
  });

  test("a sign-in of a few minutes ago is enough without the password", async ({ page, request }) => {
    const a = await account(page, request, "DelFresh");
    await putFiles(request, a.email, 1);
    await openDelete(page);
    await page.getByTestId("delete-account-phrase").fill("УДАЛИТЬ");
    await page.getByTestId("delete-account-submit").click();
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
    expect((await deletion(request, a.email)).exists).toBe(false);
    expect(await files(request, a.userId)).toEqual([]);
  });

  test("a file in the account's folder that it did not upload: stopped for a check, nothing deleted", async ({ page, request, browser }) => {
    const otherCtx = await browser.newContext();
    const b = await account(await otherCtx.newPage(), request, "DelPlanter");
    const a = await account(page, request, "DelForeign");
    await putFiles(request, a.email, 2);
    await request.post(`${FAKE_SUPABASE}/__test/storage-plant?owner=${encodeURIComponent(b.email)}&path=${a.userId}/planted.webp`);
    await openDelete(page);
    await page.getByTestId("delete-account-phrase").fill("УДАЛИТЬ");
    await page.getByTestId("delete-account-password").fill(TEST_PASSWORD);
    await page.getByTestId("delete-account-submit").click();
    await expect(page.getByTestId("delete-account-error")).toHaveAttribute("data-code", "foreign_object");
    expect((await deletion(request, a.email)).exists).toBe(true);
    expect(await files(request, a.userId)).toHaveLength(3);
    await otherCtx.close();
  });

  test("an account in the server economy (migration_pending, then cloud_active): deleted the same way", async ({ page, request }) => {
    for (const state of ["migration_pending", "cloud_active"]) {
      const a = await account(page, request, `DelEco${state.slice(0, 4)}`);
      await request.get(`${FAKE_SUPABASE}/__test/economy?email=${encodeURIComponent(a.email)}&state=${state}&sync=0&mode=study`);
      await putFiles(request, a.email, 2);
      await openDelete(page);
      await page.getByTestId("delete-account-phrase").fill("УДАЛИТЬ");
      await page.getByTestId("delete-account-password").fill(TEST_PASSWORD);
      await page.getByTestId("delete-account-submit").click();
      await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
      expect((await deletion(request, a.email)).exists).toBe(false);
      expect(await files(request, a.userId)).toEqual([]);
    }
  });
});
