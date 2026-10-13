import { test, expect, type Page } from "@playwright/test";
import { pickOption, openTradeSection } from "./helpers/forms";

async function seed(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    localStorage.clear();
    localStorage.setItem("ayra_guest_dismissed", "1");
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({ name: "TraderOne", onboarding: { status: "done", step: 5, answers: { nickname: "TraderOne" } } })
    );
    localStorage.setItem(
      "ayra_journal_v1",
      JSON.stringify({
        schemaVersion: 5,
        accounts: [
          { id: "acc_main", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "acc_prop", name: "Prop", type: "prop", currency: "USD", platform: "manual", createdAt: "2026-01-02T00:00:00.000Z" },
        ],
        trades: [],
      })
    );
  });
}

const drawer = (page: Page) => page.getByTestId("add-trade-drawer");

async function openDrawer(page: Page) {
  await page.goto("/journal");
  await page.getByRole("button", { name: "Добавить сделку" }).first().click();
  await expect(drawer(page)).toBeVisible();
}

test.describe("Add trade drawer", () => {
  test.use({ reducedMotion: "reduce" });

  test("desktop: right panel; quick entry saves with Ctrl+Enter", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await openDrawer(page);
    const box = (await drawer(page).boundingBox())!;
    expect(Math.round(box.x + box.width)).toBe(1440);
    expect(box.height).toBeGreaterThan(850);

    await page.getByTestId("instrument-input").fill("nas100");
    await expect(page.getByTestId("instrument-input")).toHaveValue("NAS100");
    await page.getByRole("radio", { name: "Шорт (Продажа)" }).click();
    await page.fill("input[placeholder='150 / -50']", "-120");
    await pickOption(page, "account-select", /Prop/);
    await expect(page.getByTestId("account-select")).toContainText("Prop (USD)");
    await page.getByTestId("instrument-input").press("Control+Enter");
    await expect(drawer(page)).toBeHidden();

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1")!).trades);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ instrument: "NAS100", direction: "short", pnlMoney: -120, accountId: "acc_prop" });
  });

  test("draft is kept after closing with Esc and restored on reopen; discard clears it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await openDrawer(page);
    await page.getByTestId("instrument-input").fill("XAUUSD");
    await openTradeSection(page, "Психология");
    await page.getByRole("button", { name: "Спокойствие" }).click();
    await page.waitForTimeout(600);
    await page.keyboard.press("Escape"); // closes the suggestion list first
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();

    await page.reload();
    await page.getByRole("button", { name: "Добавить сделку" }).first().click();
    await expect(page.getByText("Черновик восстановлен")).toBeVisible();
    await expect(page.getByTestId("instrument-input")).toHaveValue("XAUUSD");
    await openTradeSection(page, "Психология");
    await expect(page.getByRole("button", { name: "Спокойствие" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Очистить" }).click();
    await expect(page.getByTestId("instrument-input")).toHaveValue("");
  });

  test("save and add another keeps the drawer open with the same instrument", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await openDrawer(page);
    await page.getByTestId("instrument-input").fill("EURUSD");
    await page.fill("input[placeholder='2.5 / -1']", "2");
    await page.getByRole("button", { name: "Сохранить и добавить ещё" }).click();
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByTestId("instrument-input")).toHaveValue("EURUSD");
    await expect(page.locator("input[placeholder='2.5 / -1']")).toHaveValue("");
    const count = await page.evaluate(() => JSON.parse(localStorage.getItem("ayra_journal_v1")!).trades.length);
    expect(count).toBe(1);
  });

  test("phone: bottom sheet, tap targets >= 44px, no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed(page);
    await openDrawer(page);
    const box = (await drawer(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(Math.round(box.width)).toBe(360);
    expect(Math.round(box.y + box.height)).toBe(740);
    for (const el of [page.getByTestId("instrument-input"), page.getByRole("radio", { name: "Лонг (Покупка)" }), page.getByTestId("account-select")]) {
      expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await openTradeSection(page, "Время и цены");
    const overflow = await drawer(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("date picker is custom (no native datetime input) and sets the opening day", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await openDrawer(page);
    await openTradeSection(page, "Время и цены");
    await expect(drawer(page).locator('input[type="datetime-local"]')).toHaveCount(0);
    await page.getByTestId("opened-at").click();
    await expect(page.getByRole("grid")).toBeVisible();
    const yesterday = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const day = page.locator(`[data-date="${yesterday}"]`);
    if ((await day.count()) === 0) await page.getByRole("button", { name: "Предыдущий месяц" }).click();
    await page.locator(`[data-date="${yesterday}"]`).first().click();
    await expect(page.getByTestId("opened-at")).toHaveAttribute("data-value", new RegExp(`^${yesterday}T`));
  });
});
