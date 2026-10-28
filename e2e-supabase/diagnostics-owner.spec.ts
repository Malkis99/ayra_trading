import { test, expect, type Page } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// «Diagnostics» only for the owner: app_metadata.ayra_role = "owner" (set on the server by SQL, never by the user).
// The fake server stands in for the owner's SQL with /__test/app-role.

test.describe("Diagnostics only for the owner", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(90_000);

  test("a regular account has no block; with ayra_role=owner it is visible after a reload; rollback hides it again", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = `Diag_${Date.now()}@example.com`;
    await signIn(page, email);
    await completeOnboarding(page, `Diag${Date.now() % 100000}`, { after: "left" });

    // regular account (and the user cannot give the role to himself: app_metadata is server-only)
    await page.goto("/settings/account");
    await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
    await expect(page.getByText("Диагностика")).toHaveCount(0);

    // the owner's SQL (here: the fake server) → after a reload the block is there
    await request.get(`${FAKE_SUPABASE}/__test/app-role?email=${encodeURIComponent(email)}&role=owner`);
    await page.reload();
    await expect(page.getByText("Диагностика")).toBeVisible({ timeout: 15000 });

    // rollback
    await request.get(`${FAKE_SUPABASE}/__test/app-role?email=${encodeURIComponent(email)}`);
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.getByText("Диагностика")).toHaveCount(0);
  });
});
