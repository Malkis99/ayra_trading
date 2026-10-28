import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { signIn } from "../e2e/helpers/auth";

const FAKE_SUPABASE = "http://127.0.0.1:54329";

// T7b-4e: the cloud badge in the header and the warning before "Sign out and delete", against the fake Supabase.
// The flag is on ONLY for test users of the fake server; nothing here touches a real project.

async function addTrade(page: Page, instrument: string, firstAccount = false, navigate = true) {
  if (navigate) await page.goto("/journal");
  await page.getByRole("button", { name: "Добавить сделку" }).first().click();
  const drawer = page.getByTestId("add-trade-drawer");
  await expect(drawer).toBeVisible();
  if (firstAccount) {
    await drawer.getByPlaceholder("Название счёта").fill("Main");
    await drawer.getByRole("button", { name: "Создать счёт" }).click();
  }
  await page.getByTestId("instrument-input").fill(instrument);
  await page.fill("input[placeholder='150 / -50']", "40");
  await page.getByTestId("instrument-input").press("Control+Enter");
  await expect(drawer).toBeHidden();
}

type Row = { table: string; id: string; data: Record<string, unknown> };
const cloudTrades = async (request: APIRequestContext, email: string) =>
  ((await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[]).filter((r) => r.table === "journal_trades");

/** New account with the flag on (fake server only) and an empty journal: the first sync is done by itself. */
async function syncedAccount(page: Page, request: APIRequestContext, tag: string) {
  const email = `${tag}_${Date.now()}@example.com`;
  await signIn(page, email);
  await completeOnboarding(page, `${tag}${Date.now() % 100000}`);
  const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id) as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  await page.reload();
  return { email, userId };
}

const badge = (page: Page) => page.getByTestId("sync-badge");
const shotDir = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
};

test.describe("Cloud badge in the header", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  test.afterEach(async ({ request }) => {
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=0`);
  });

  test("states: saved → offline (change waits, 'Retry') → saved again; server error → 'Retry' → saved", async ({ page, context, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { email } = await syncedAccount(page, request, "Badge");
    await expect(badge(page)).toHaveAttribute("data-state", "synced", { timeout: 15000 });
    // order in the header: coins → cloud → bell
    const header = page.locator("header").first();
    const order = await header.evaluate((h) => {
      const all = [...h.querySelectorAll("*")];
      const idx = (el: Element | null) => (el ? all.indexOf(el) : -1);
      return [idx(h.querySelector('[data-testid="sync-badge"]')), idx(h.querySelector('[aria-label="Уведомления"]'))];
    });
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]);

    await addTrade(page, "nas100", true);
    await expect.poll(async () => (await cloudTrades(request, email)).length, { timeout: 15000 }).toBe(1);
    await expect(badge(page)).toHaveAttribute("data-state", "synced", { timeout: 15000 });
    await badge(page).click();
    await expect(page.getByTestId("sync-badge-panel")).toContainText("Последняя синхронизация");
    await shot(page, "badge-synced-1440");
    await page.keyboard.press("Escape");

    // offline: the change waits on the device
    await context.setOffline(true);
    await expect(badge(page)).toHaveAttribute("data-state", "offline");
    await addTrade(page, "eurusd", false, false);
    await badge(page).click();
    await expect(page.getByTestId("sync-badge-panel")).toContainText("Нет сети");
    await expect(page.getByTestId("sync-badge-pending")).toContainText("Ждёт отправки: 1");
    await expect(page.getByTestId("sync-badge-action")).toContainText("Повторить");
    await shot(page, "badge-offline-1440");
    await page.keyboard.press("Escape");
    await context.setOffline(false);
    await expect.poll(async () => (await cloudTrades(request, email)).length, { timeout: 20000 }).toBe(2);
    await expect(badge(page)).toHaveAttribute("data-state", "synced", { timeout: 20000 });

    // server error: 'Retry' sends now once the server is fine again
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=1000`);
    await addTrade(page, "xauusd", false, false);
    await expect(badge(page)).toHaveAttribute("data-state", "error", { timeout: 15000 });
    await badge(page).click();
    await expect(page.getByTestId("sync-badge-panel")).toContainText("Не удалось синхронизировать");
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=0`);
    await page.getByTestId("sync-badge-action").click();
    await expect.poll(async () => (await cloudTrades(request, email)).length, { timeout: 15000 }).toBe(3);
    await expect(badge(page)).toHaveAttribute("data-state", "synced", { timeout: 15000 });
  });

  test("conflict: 'Choice needed' on any page; 'Resolve conflict' opens the dialog right there", async ({ page, context, request }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const { email } = await syncedAccount(page, request, "BadgeC");
    await page.setViewportSize({ width: 1440, height: 900 });
    await addTrade(page, "nas100", true);
    await expect.poll(async () => (await cloudTrades(request, email)).length, { timeout: 15000 }).toBe(1);
    const row = (await cloudTrades(request, email))[0];

    await context.setOffline(true);
    await page.click("tr:has-text('NAS100')");
    await page.click("button:has-text('Редактировать')");
    await expect(page.getByTestId("instrument-input")).toHaveValue("NAS100");
    await page.getByTestId("instrument-input").fill("ger40");
    await page.click("button:has-text('Сохранить сделку')");
    // meanwhile another device changed the same trade
    await request.post(`${FAKE_SUPABASE}/__test/cloud-put?email=${encodeURIComponent(email)}&table=journal_trades`, {
      data: { ...row.data, instrument: "XAUUSD", updatedAt: new Date(Date.now() + 1000).toISOString() },
    });
    await context.setOffline(false);
    await page.goto("/");
    await page.setViewportSize({ width: 360, height: 740 });
    await expect(badge(page)).toHaveAttribute("data-state", "conflict", { timeout: 20000 });
    await expect(badge(page)).toHaveAttribute("aria-label", "Нужен выбор: 1");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0); // the header does not break on a phone
    // every header control, the avatar included, is fully on the screen
    const rights = await page.locator("header").first().evaluate((h) =>
      [...h.querySelectorAll("button, a")].map((el) => {
        const r = el.getBoundingClientRect();
        return { label: el.getAttribute("aria-label") || el.textContent?.trim() || "", left: r.left, right: r.right, width: r.width };
      }).filter((x) => x.width > 0)
    );
    for (const r of rights) {
      expect(r.left, r.label).toBeGreaterThanOrEqual(0);
      expect(r.right, r.label).toBeLessThanOrEqual(360);
    }
    await badge(page).click();
    const panel = await page.getByTestId("sync-badge-panel").boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(360);
    await shot(page, "badge-conflict-360");
    await page.getByTestId("sync-badge-action").click();
    await expect(page.getByTestId("sync-conflict-dialog")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("waiting for the first upload: 'Upload to the cloud' opens the upload window", async ({ browser, request }) => {
    const email = `BadgeU_${Date.now()}@example.com`;
    const context: BrowserContext = await browser.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, email);
    await completeOnboarding(page, `BadgeU${Date.now() % 100000}`);
    await addTrade(page, "nas100", true); // made before the flag is on: local data of this device
    await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
    await page.goto("/");
    await expect(badge(page)).toHaveAttribute("data-state", "waitingInitial", { timeout: 15000 });
    await expect(badge(page)).toHaveAttribute("aria-label", "Журнал ещё не в облаке");
    await badge(page).click();
    await page.getByTestId("sync-badge-action").click();
    await expect(page.getByTestId("initial-sync-dialog")).toBeVisible();
    await context.close();
  });

  test("'Sign out and delete' with an unsent change: warning with the count; 'Wait' sends it and leads to the usual confirmation", async ({ page, context, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { email } = await syncedAccount(page, request, "BadgeW");
    await addTrade(page, "nas100", true);
    await expect.poll(async () => (await cloudTrades(request, email)).length, { timeout: 15000 }).toBe(1);
    await expect(badge(page)).toHaveAttribute("data-state", "synced", { timeout: 15000 });

    // nothing waiting: the usual confirmation straight away
    await page.goto("/settings/cloud");
    const card = page.locator(".card", { hasText: "Данные на этом устройстве" });
    await card.getByRole("button", { name: "Выйти и удалить данные аккаунта с этого устройства" }).click();
    await expect(page.getByTestId("unsynced-warning")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toContainText("Выйти и удалить данные аккаунта?");
    await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).first().click();

    // one change not in the cloud
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=1000`);
    await addTrade(page, "eurusd");
    await expect(badge(page)).toHaveAttribute("data-state", "error", { timeout: 15000 });
    await page.goto("/settings/cloud");
    await card.getByRole("button", { name: "Выйти и удалить данные аккаунта с этого устройства" }).click();
    const warning = page.getByTestId("unsynced-warning");
    await expect(warning).toContainText("Не всё сохранено в облаке");
    await expect(warning.getByTestId("unsynced-counts")).toContainText("1 изменение ещё не в облаке");
    await shot(page, "signout-warning-1440");
    await warning.getByTestId("unsynced-cancel").click();
    await expect(warning).toHaveCount(0);

    await card.getByRole("button", { name: "Выйти и удалить данные аккаунта с этого устройства" }).click();
    await request.get(`${FAKE_SUPABASE}/__test/fail-journal-writes?count=0`);
    await page.getByTestId("unsynced-wait").click();
    await expect(page.getByRole("dialog")).toContainText("Выйти и удалить данные аккаунта?", { timeout: 20000 });
    expect((await cloudTrades(request, email)).length).toBe(2); // sent before deleting
  });
});
