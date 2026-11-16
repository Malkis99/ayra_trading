import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { pickOption } from "./helpers/forms";

// RISK-NOTIFICATION-FIX: a prop-limit warning is never replaced by a reward message (lib/toast-queue).
// The original bug: the first trade of an account that reaches 80% of the daily limit showed the warning for one
// moment; «Your first trade! +20 Coins, +20 XP» replaced it at once (one toast slot).
// Fixed clock and zone: the prop day and «now» are the same on every machine.

const NOW = "2026-11-18T10:00:00Z";
const WARNING_SEEN_MS = 3000; // well past the moment the reward used to replace the warning (and past 2.2 s of a plain message)

type Rules = { daily: number; drawdown?: number };
const account = (r: Rules) => ({
  id: "acc_prop",
  name: "Edge Prop",
  type: "prop",
  currency: "USD",
  startBalance: 100000,
  platform: "manual",
  createdAt: "2026-11-01T00:00:00.000Z",
  propRules: {
    phaseLabel: "Phase 1",
    initialBalance: 100000,
    startedAt: "2026-11-01T00:00:00.000Z",
    dayReset: { timezone: "UTC", hour: 0 },
    maxDailyLoss: { type: "money", value: r.daily, base: "initialBalance" },
    ...(r.drawdown ? { maxTotalDrawdown: { type: "money", value: r.drawdown, mode: "static" } } : {}),
  },
});
const personal = { id: "acc_main", name: "Main", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-11-01T00:00:00.000Z" };

/** A player who has not saved a trade yet (the first-trade reward is still to come) and the given accounts. */
async function seed(context: BrowserContext, accounts: unknown[], lang: "ru" | "en" = "ru") {
  await context.addInitScript(
    ({ journal, lang }) => {
      if (sessionStorage.getItem("ayra_seeded")) return;
      sessionStorage.setItem("ayra_seeded", "1");
      localStorage.clear();
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "RiskTrader",
          level: 1,
          xp: 0,
          coins: 0,
          createdAt: "2026-10-05",
          completedQuestsToday: {},
          lastQuestDate: "",
          onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
          profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: false, timezone: "UTC" },
        })
      );
      localStorage.setItem("ayra_journal_v1", journal);
      localStorage.setItem("ayra_lang", lang);
    },
    { journal: JSON.stringify({ schemaVersion: 4, accounts, trades: [] }), lang }
  );
}

const game = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}"));
const toast = (page: Page) => page.getByTestId("toast");
/** The warning as assistive technology meets it (Next.js has its own empty route announcer with the same role). */
const riskAlert = (page: Page) => page.locator('[role="alert"][data-testid="toast"]');

async function saveTrade(page: Page, accountLabel: string, instrument: string, pnl: string, addLabel = "Добавить сделку") {
  await page.getByRole("button", { name: addLabel, exact: true }).first().click();
  await pickOption(page, "account-select", accountLabel);
  await page.getByTestId("instrument-input").fill(instrument);
  await page.fill("input[placeholder='150 / -50']", pnl);
  await page.getByTestId("instrument-input").press("Control+Enter");
  await expect(page.getByTestId("instrument-input")).toBeHidden();
}

/** The warning is on screen as a risk message, is still there after the reward's moment, and is not a reward. */
async function expectWarningHolds(page: Page, text: string) {
  // first by its text alone (the same check fails on the build before the fix: the reward had replaced the text)
  await page.waitForTimeout(WARNING_SEEN_MS);
  await expect(page.getByText(text)).toBeVisible({ timeout: 1 });
  await expect(toast(page)).toHaveAttribute("data-level", "risk");
  await expect(riskAlert(page)).toContainText(text);
}

test.describe("Risk warnings come before reward messages", () => {
  test.use({ timezoneId: "UTC" });
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date(NOW) });
  });

  for (const [label, width, height] of [["phone", 390, 844], ["desktop", 1440, 900]] as const) {
    test(`${label}: the first trade at 80% of the daily limit — the warning stays, the reward comes after it, nothing is lost`, async ({ context, page }) => {
      await page.setViewportSize({ width, height });
      await seed(context, [account({ daily: 5000 })]);
      await page.goto("/journal");
      await saveTrade(page, "Edge Prop (USD)", "EURUSD", "-4000");
      await expectWarningHolds(page, "Дневной лимит использован на 80%");
      // on screen within the viewport (phone too), a large enough target to close
      const box = (await toast(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // the reward was earned as before (only its message waited)
      const g = await game(page);
      const first = (g.coinLog || []).filter((e: { source: string; kind?: string }) => e.source === "firstAction" && e.kind === "trade");
      expect({ trade: Boolean(g.firstActions?.trade), entries: first.map((e: { amount: number }) => e.amount) }).toEqual({ trade: true, entries: [20] });
      // closed by keyboard: the reward message comes up
      await page.getByTestId("toast-close").focus();
      await page.keyboard.press("Enter");
      await expect(toast(page)).toHaveAttribute("data-level", "info");
      await expect(toast(page)).toContainText("Впервые: сделка! +20 Coins, +20 XP");
      await expect(page.getByRole("status")).toContainText("Впервые: сделка!");
    });
  }

  test("the first trade reaches the daily limit — «limit reached» stays; the reward follows when its time runs out", async ({ context, page }) => {
    await seed(context, [account({ daily: 5000 })]);
    await page.goto("/journal");
    await saveTrade(page, "Edge Prop (USD)", "EURUSD", "-6000");
    await expectWarningHolds(page, "Лимит дня достигнут: проверь правила своей фирмы");
    // a warning's own time (7 s) ends; then the waiting reward
    await expect(toast(page)).toContainText("Впервые: сделка! +20 Coins, +20 XP", { timeout: 6000 });
  });

  test("a total-drawdown warning with the first-trade reward", async ({ context, page }) => {
    await seed(context, [account({ daily: 20000, drawdown: 10000 })]);
    await page.goto("/journal");
    await saveTrade(page, "Edge Prop (USD)", "EURUSD", "-8000");
    await expectWarningHolds(page, "Общая просадка использована на 80%");
  });

  test("two warnings in a short time: both are shown, in order; re-saving a trade repeats no warning; a reload shows none", async ({ context, page }) => {
    await seed(context, [account({ daily: 5000 })]);
    await page.goto("/journal");
    await saveTrade(page, "Edge Prop (USD)", "EURUSD", "-4000");
    await expect(page.getByText("Дневной лимит использован на 80%")).toBeVisible();
    await saveTrade(page, "Edge Prop (USD)", "GBPUSD", "-1500");
    // the first warning is not replaced by the second; the second waits
    await expect(page.getByText("Дневной лимит использован на 80%")).toBeVisible({ timeout: 1 });
    await page.getByTestId("toast-close").click();
    await expect(toast(page)).toContainText("Лимит дня достигнут: проверь правила своей фирмы");
    await page.getByTestId("toast-close").click();
    await expect(toast(page)).toContainText("Впервые: сделка!"); // the reward was not lost
    const coins = (await game(page)).coins;
    // re-saving an existing trade: no warning again, nothing earned
    await page.click("tr:has-text('GBPUSD')");
    await page.click("button:has-text('Редактировать')");
    await expect(page.getByTestId("instrument-input")).toHaveValue("GBPUSD"); // the form holds the trade before it is saved again
    await page.getByTestId("instrument-input").press("Control+Enter");
    await expect(page.getByTestId("instrument-input")).toBeHidden();
    await expect(toast(page)).toContainText("Сделка обновлена");
    await expect(riskAlert(page)).toHaveCount(0);
    expect((await game(page)).coins).toBe(coins);
    // a reload: no message is carried over
    await page.reload();
    await expect(page.getByRole("button", { name: "Добавить сделку", exact: true }).first()).toBeVisible();
    await expect(toast(page)).toHaveCount(0);
  });

  test("an ordinary reward without a warning is shown as before", async ({ context, page }) => {
    await seed(context, [personal]);
    await page.goto("/journal");
    await saveTrade(page, "Main (USD)", "EURUSD", "100");
    await expect(toast(page)).toHaveAttribute("data-level", "info");
    await expect(toast(page)).toContainText("Впервые: сделка! +20 Coins, +20 XP");
    await expect(riskAlert(page)).toHaveCount(0);
  });

  test("English: the warning stays and is read out as a risk warning", async ({ context, page }) => {
    await seed(context, [account({ daily: 5000 })], "en");
    await page.goto("/journal");
    await saveTrade(page, "Edge Prop (USD)", "EURUSD", "-4000", "Add trade");
    await expectWarningHolds(page, "Daily limit used at 80%");
    await expect(riskAlert(page)).toContainText("Risk warning");
    await expect(page.getByTestId("toast-close")).toHaveAttribute("aria-label", "Dismiss warning");
    await page.getByTestId("toast-close").click();
    await expect(toast(page)).toContainText("Your first trade! +20 Coins, +20 XP");
  });
});
