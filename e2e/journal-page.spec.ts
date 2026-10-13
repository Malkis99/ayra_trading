import { test, expect, type Page } from "@playwright/test";
import { openJournalTab } from "./helpers/forms";

// Today/yesterday trades are created in the browser so dates match the app's local day.
async function seed(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    localStorage.clear();
    localStorage.setItem("ayra_guest_dismissed", "1");
    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const at = (daysAgo: number, h: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, 15);
      return d.toISOString();
    };
    const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({ name: "TraderOne", onboarding: { status: "done", step: 5, answers: { nickname: "TraderOne" } }, profile: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } })
    );
    const base = { status: "closed", emotions: [], verification: "unverified", source: "manual", schemaVersion: 3 };
    const mk = (id: string, instrument: string, direction: string, r: number, openedAt: string, extra: Record<string, unknown> = {}) => ({
      ...base,
      id,
      accountId: "acc_main",
      instrument,
      direction,
      rMultiple: r,
      pnlMoney: r * 100,
      result: r > 0 ? "win" : r < 0 ? "loss" : "breakeven",
      mistakes: [],
      openedAt,
      closedAt: openedAt,
      createdAt: openedAt,
      updatedAt: openedAt,
      ...extra,
    });
    localStorage.setItem(
      "ayra_journal_v1",
      JSON.stringify({
        schemaVersion: 5,
        accounts: [{ id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00.000Z" }],
        trades: [
          mk("t1", "XAUUSD", "long", 2, at(0, 9), { processScore: 90 }),
          mk("t2", "EURUSD", "short", -1.5, at(0, 11), { mistakes: ["fomo"], processScore: 40 }),
          mk("t3", "NAS100", "long", 1, at(1, 10)),
        ],
        strategies: [],
        plans: [
          {
            date: todayKey,
            bias: [{ instrument: "XAUUSD", direction: "bullish" }],
            levels: [],
            events: [],
            limits: { maxDailyLoss: { type: "r", value: 3 } },
            checklist: [{ key: "bias_defined", done: false }],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        ],
      })
    );
  });
}

test.describe("Journal page", () => {
  test.use({ reducedMotion: "reduce" });

  test("trades first, KPI strip by period, Today panel with plan, checklist and daily R limit", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal");

    await expect(page.getByRole("tab", { name: "Сделки" })).toHaveAttribute("aria-selected", "true");

    const kpis = page.getByTestId("journal-kpis");
    await kpis.getByRole("radio", { name: "День" }).click();
    await expect(kpis.locator('[data-kpi="result"]')).toContainText("+0.50 R");
    await expect(kpis.locator('[data-kpi="winrate"]')).toContainText("50%");
    await expect(kpis.locator('[data-kpi="process"]')).toContainText("65/100");
    await expect(kpis.locator('[data-kpi="clean"]')).toContainText("0");
    await kpis.getByRole("radio", { name: "Всё" }).click();
    await expect(kpis.locator('[data-kpi="result"]')).toContainText("+1.50 R");
    await kpis.getByRole("radio", { name: "$" }).click();
    await expect(kpis.locator('[data-kpi="result"]')).toContainText("150");

    const today = page.getByTestId("today-panel");
    await expect(today).toContainText("XAUUSD · Бычий");
    await expect(today).toContainText("1 из 2 без нарушений");
    await expect(today.getByTestId("daily-risk")).toContainText("0.0 из 3.0 R");
    const check = today.getByRole("checkbox", { name: "Определил направление рынка" });
    await check.check();
    await page.reload();
    await expect(page.getByTestId("today-panel").getByRole("checkbox", { name: "Определил направление рынка" })).toBeChecked();
  });

  test("table: grouped by day, filter chips, sorting, density, quick view drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal");
    const table = page.getByTestId("trades-table");
    await expect(table.locator("tbody")).toHaveCount(2); // today, yesterday
    await expect(table.locator("tbody").first().locator("tr")).toHaveCount(3); // day header + 2 trades

    await page.getByTestId("filter-result").click();
    await page.getByRole("listbox").getByRole("option", { name: "Победа" }).click();
    await expect(table.locator("tbody tr:not(:has(th))")).toHaveCount(2);
    await expect(page.getByTestId("filter-result")).toContainText("Результат: Победа");
    await page.getByRole("button", { name: "Сбросить фильтр «Результат»" }).click();
    await expect(table.locator("tbody tr:not(:has(th))")).toHaveCount(3);

    await table.locator("thead").getByRole("button", { name: "Результат" }).click(); // sort by result, desc
    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toContainText("XAUUSD");

    await table.getByRole("radio", { name: "Компактная" }).click();
    await page.reload();
    await expect(page.getByTestId("trades-table").getByRole("radio", { name: "Компактная" })).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("trades-table").locator("tr", { hasText: "EURUSD" }).click();
    const view = page.getByTestId("trade-quick-view");
    await expect(view.getByRole("heading", { name: "Карточка сделки" })).toBeVisible();
    await expect(view).toContainText("FOMO");
    await page.keyboard.press("Escape");
    await expect(view).toBeHidden();
  });

  test("analytics: metrics with explanations, equity, calendar, breakdowns and matrix", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal?tab=analytics");
    await expect(page.locator('[data-metric="result"]')).toContainText("+1.50 R");
    await page.getByRole("button", { name: "Что означает «Profit Factor»" }).click();
    await expect(page.getByRole("dialog", { name: "Profit Factor" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("text=Кривая капитала (Equity)")).toBeVisible();
    await expect(page.locator("text=Итог месяца")).toBeVisible();
    await expect(page.getByTestId("slice-mistake")).toContainText("FOMO");
    await expect(page.getByTestId("slice-mistake")).toContainText("Без ошибок");
    await expect(page.getByTestId("process-matrix")).toContainText("Правильно");
  });

  test("rare tabs live in the 'More' menu; the chosen one is shown as active", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto("/journal");
    await openJournalTab(page, "Счета");
    await expect(page.getByRole("tab", { name: /Счета/ })).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).searchParams.get("tab")).toBe("accounts");
    await page.goto("/journal?tab=strategies");
    await expect(page.getByRole("tab", { name: /Стратегии/ })).toHaveAttribute("aria-selected", "true");
  });

  test("360px: Today collapses, cards instead of table, no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed(page);
    await page.goto("/journal");
    const today = page.getByTestId("today-panel");
    const toggle = today.getByRole("button", { name: /Сегодня/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(today.getByText("План дня")).toBeHidden();
    await toggle.click();
    await expect(today.getByText("План дня")).toBeVisible();
    await expect(page.getByTestId("trades-table").locator("table")).toBeHidden();
    await expect(page.getByTestId("trades-table").getByRole("button", { name: /XAUUSD/ })).toBeVisible();
    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
