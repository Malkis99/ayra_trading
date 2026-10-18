import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openJournalTab } from "./helpers/forms";

// T7b-1: a journal saved by an older version (v4) opens without losses; deleting a trade keeps a tombstone.
const V4 = fs.readFileSync(path.join(__dirname, "..", "lib", "journal", "__fixtures__", "journal-v4.json"), "utf8");

test("old journal (v4) opens with every trade; a deleted trade disappears but stays as a tombstone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((journal) => {
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    localStorage.clear();
    localStorage.setItem("ayra_guest_dismissed", "1");
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({ name: "TraderOne", onboarding: { status: "done", step: 5, answers: { nickname: "TraderOne" } } })
    );
    localStorage.setItem("ayra_journal_v1", journal);
  }, V4);

  await page.goto("/journal");
  await openJournalTab(page, "Сделки");
  await expect(page.locator("tr:has-text('XAUUSD')")).toBeVisible();
  await expect(page.locator("tr:has-text('NAS100')")).toBeVisible();

  // delete XAUUSD through the UI
  await page.click("tr:has-text('XAUUSD')");
  await page.click("button:has-text('Удалить')");
  await expect(page.locator("text=Удалить сделку?")).toBeVisible();
  await page.locator("button:has-text('Удалить')").first().click();
  await expect(page.locator("tr:has-text('XAUUSD')")).toHaveCount(0);

  await page.reload();
  await openJournalTab(page, "Сделки");
  await expect(page.locator("tr:has-text('XAUUSD')")).toHaveCount(0);
  await expect(page.locator("tr:has-text('NAS100')")).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1")!));
  expect(stored.schemaVersion).toBe(6);
  expect(stored.trades).toHaveLength(2); // nothing physically removed
  const tomb = stored.trades.find((t: { id: string }) => t.id === "tr_old_1");
  expect(tomb.deletedAt).toBeTruthy();
  expect(tomb.updatedAt).toBe(tomb.deletedAt);
  expect(stored.trades.find((t: { id: string }) => t.id === "tr_old_2").deletedAt).toBeNull();
  expect(stored.accounts).toHaveLength(2);
  expect(stored.strategies).toHaveLength(1);
  expect(stored.noTrades).toHaveLength(1);
  for (const a of stored.accounts) expect(a.updatedAt).toBeTruthy();
});
