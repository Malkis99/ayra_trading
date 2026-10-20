import { test, expect, type Page, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const FAKE_SUPABASE = "http://127.0.0.1:54329";
const TRADETRACK = fs.readFileSync(path.join(process.cwd(), "lib/journal/import/__fixtures__/tradetrack.csv"));
const SCREENSHOT = path.join(process.cwd(), "e2e/fixtures/test-screenshot.png");

// T7b-4f «day in the life»: the owner's manual checklist (docs/t7b-4f-plan.md, section 5) run end to end on the fake
// Supabase. Device A = desktop, device B = phone-sized browser, both signed in to one account. The flag is turned on
// ONLY for test users of the fake server; nothing here touches a real project.

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email-input", email);
  await page.click("input[type='checkbox']");
  await page.click("button[type='submit']");
  await expect(page.locator("#otp-input")).toBeVisible();
  const res = await page.request.get(`${FAKE_SUPABASE}/__test/last-link?email=${encodeURIComponent(email)}`);
  await page.goto((await res.json()).link);
}

async function completeOnboarding(page: Page, nickname: string) {
  await page.waitForURL("**/awakening**", { timeout: 10000 });
  await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill(nickname);
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
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
}

async function addTrade(page: Page, instrument: string, opts: { firstAccount?: string; navigate?: boolean } = {}) {
  // offline a page cannot be loaded: then the trade is added on the already open journal
  if (opts.navigate !== false) await page.goto("/journal");
  await page.getByRole("button", { name: "Добавить сделку" }).first().click();
  const drawer = page.getByTestId("add-trade-drawer");
  await expect(drawer).toBeVisible();
  if (opts.firstAccount) {
    await drawer.getByPlaceholder("Название счёта").fill(opts.firstAccount);
    await drawer.getByRole("button", { name: "Создать счёт" }).click();
  }
  await page.getByTestId("instrument-input").fill(instrument);
  await page.fill("input[placeholder='150 / -50']", "40");
  await page.getByTestId("instrument-input").press("Control+Enter");
  await expect(drawer).toBeHidden();
}

async function editInstrument(page: Page, from: string, to: string) {
  await page.click(`tr:has-text('${from}')`);
  await page.click("button:has-text('Редактировать')");
  // the edit form fills in the current value right after it opens: wait for it, or typing may be appended to it
  await expect(page.getByTestId("instrument-input")).toHaveValue(from);
  await page.getByTestId("instrument-input").fill(to);
  await page.click("button:has-text('Сохранить сделку')");
  await expect(page.getByTestId("trades-table")).toContainText(to.toUpperCase());
}

async function deleteTrade(page: Page, instrument: string) {
  await page.click(`tr:has-text('${instrument}')`);
  await page.click("button:has-text('Удалить')");
  await expect(page.locator("text=Удалить сделку?")).toBeVisible();
  await page.locator("button:has-text('Удалить')").first().click();
}

type Row = { table: string; id: string; data: Record<string, unknown> };
const cloudRows = async (request: APIRequestContext, email: string) =>
  (await (await request.get(`${FAKE_SUPABASE}/__test/cloud-rows?email=${encodeURIComponent(email)}`)).json()) as Row[];
/** Same as the `live` column of supabase/checks/cloud_sync_owner.sql. */
const cloudLive = async (request: APIRequestContext, email: string) => {
  const out: Record<string, number> = {};
  for (const r of await cloudRows(request, email)) if (!r.data.deletedAt && !r.data.undoneAt) out[r.table] = (out[r.table] ?? 0) + 1;
  return out;
};
const liveInstruments = async (request: APIRequestContext, email: string) =>
  (await cloudRows(request, email)).filter((r) => r.table === "journal_trades" && !r.data.deletedAt).map((r) => String(r.data.instrument)).sort();

const local = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);
const accountXp = (page: Page, userId: string) => page.evaluate((id) => JSON.parse(localStorage.getItem(`ayra:${id}:ayra_demo_v1`) || "{}").xp ?? 0, userId);

/** Settings → «Данные на этом устройстве» → journal counters of the open account, by cloud table. */
async function deviceCounts(page: Page) {
  await page.goto("/settings");
  const list = page.getByTestId("device-journal-counts");
  await expect(list).toBeVisible();
  return list.evaluate((dl) => {
    const out: Record<string, number> = {};
    for (const el of dl.querySelectorAll("[data-kind]")) {
      const n = Number(el.querySelector("dd")?.textContent?.replace(/\D/g, "") || "0");
      if (n > 0) out[el.getAttribute("data-kind")!] = n;
    }
    return out;
  });
}

const badge = (page: Page) => page.getByTestId("sync-badge");
const shotDir = process.env.SHOT_DIR;
const shot = async (page: Page, name: string, target?: string) => {
  if (!shotDir) return;
  if (target) await page.getByTestId(target).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shotDir}/${name}.png` });
};
const signOutDeleteBtn = (page: Page) =>
  page.locator(".card", { hasText: "Данные на этом устройстве" }).getByRole("button", { name: "Выйти и удалить данные аккаунта с этого устройства" });

async function plainSignOut(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
}

async function openDevice(browser: Browser, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  return { context, page };
}

/** Part 2 starts from a synced account on two devices (part 1 covers the first upload itself). */
async function syncedPair(browser: Browser, request: APIRequestContext, email: string, nickname: string) {
  const A = await openDevice(browser, { width: 1440, height: 900 });
  await signIn(A.page, email);
  await completeOnboarding(A.page, nickname);
  const userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id) as string;
  await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
  await A.page.evaluate((id) => localStorage.setItem(`ayra:${id}:ayra_sync_state`, JSON.stringify({ initialSyncAt: new Date().toISOString() })), userId);
  await addTrade(A.page, "nas100", { firstAccount: "Main" });
  await expect.poll(() => liveInstruments(request, email), { timeout: 15000 }).toEqual(["NAS100"]);
  const B = await openDevice(browser, { width: 1440, height: 900 });
  await signIn(B.page, email);
  await B.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  await expect(B.page.getByText("Журнал загружен из облака")).toBeVisible({ timeout: 15000 });
  await B.page.goto("/journal");
  await expect(B.page.getByTestId("trades-table")).toContainText("NAS100", { timeout: 15000 });
  return { A, B, userId };
}

test.describe("Cloud journal: a day in the life (T7b-4f)", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(180_000);

  test("part 1: first upload → empty phone → create/edit/delete → offline → both conflict choices", async ({
    browser,
    request,
  }) => {
    const stamp = Date.now();
    const email = `Day_${stamp}@example.com`;
    const PHONE = { width: 390, height: 844 };

    const A = await openDevice(browser, { width: 1440, height: 900 });
    let userId = "";

    await test.step("1–5: data made before sync waits for the button; counters match the window and the cloud", async () => {
      await signIn(A.page, email);
      await completeOnboarding(A.page, `Day${stamp % 100000}`);
      userId = ((await (await request.get(`${FAKE_SUPABASE}/__test/profile?email=${encodeURIComponent(email)}`)).json()).id) as string;
      await addTrade(A.page, "nas100", { firstAccount: "Main" }); // the owner's real journal before the flag
      await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=1`);
      await A.page.goto("/journal");
      await expect(badge(A.page)).toHaveAttribute("data-state", "waitingInitial", { timeout: 15000 });
      await expect(A.page.getByTestId("initial-sync-button")).toBeVisible();

      const before = await deviceCounts(A.page);
      expect(before).toEqual({ journal_accounts: 1, journal_trades: 1 });
      await A.page.goto("/journal");
      await A.page.getByTestId("initial-sync-button").click();
      const dialog = A.page.getByTestId("initial-sync-dialog");
      const counts = dialog.getByTestId("initial-sync-counts");
      await expect(counts.locator('[data-kind="journal_accounts"]')).toContainText(String(before.journal_accounts));
      await expect(counts.locator('[data-kind="journal_trades"]')).toContainText(String(before.journal_trades));
      await dialog.getByTestId("initial-sync-start").click();
      await expect(dialog.getByTestId("initial-sync-done")).toContainText("Готово: журнал в облаке", { timeout: 15000 });
      await dialog.getByTestId("initial-sync-close").click();
      await expect(A.page.getByTestId("initial-sync-button")).toHaveCount(0);
      await expect(badge(A.page)).toHaveAttribute("data-state", "synced", { timeout: 15000 });
      const live = await cloudLive(request, email);
      expect({ journal_accounts: live.journal_accounts, journal_trades: live.journal_trades }).toEqual(before); // no duplicates
    });

    const B = await openDevice(browser, PHONE);
    await test.step("6–7: the empty phone downloads by itself; same counters; the header fits", async () => {
      await signIn(B.page, email);
      await B.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
      await expect(B.page.getByText("Журнал загружен из облака")).toBeVisible({ timeout: 15000 });
      await expect(badge(B.page)).toHaveAttribute("data-state", "synced", { timeout: 15000 });
      const overflow = await B.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await deviceCounts(B.page)).toEqual(await deviceCounts(A.page));
      await shot(A.page, "counters-1440", "device-journal-counts");
      await B.page.setViewportSize({ width: 360, height: 740 });
      await shot(B.page, "counters-360", "device-journal-counts");
      await B.page.setViewportSize({ width: 1440, height: 900 }); // trades are edited on the desktop table below
      await B.page.goto("/journal");
      await expect(B.page.getByTestId("initial-sync-button")).toHaveCount(0);
      await expect(B.page.getByTestId("trades-table")).toContainText("NAS100");
    });

    await test.step("9–11: create on A → on B; edit on B → on A; delete on A → gone on B", async () => {
      await addTrade(A.page, "eurusd");
      await expect.poll(() => liveInstruments(request, email), { timeout: 15000 }).toEqual(["EURUSD", "NAS100"]);
      await B.page.reload();
      await expect(B.page.getByTestId("trades-table")).toContainText("EURUSD", { timeout: 15000 });
      await editInstrument(B.page, "EURUSD", "gbpusd");
      await expect.poll(() => liveInstruments(request, email), { timeout: 15000 }).toEqual(["GBPUSD", "NAS100"]);
      await A.page.goto("/journal");
      await expect(A.page.getByTestId("trades-table")).toContainText("GBPUSD", { timeout: 15000 });
      await deleteTrade(A.page, "GBPUSD");
      await expect.poll(() => liveInstruments(request, email), { timeout: 15000 }).toEqual(["NAS100"]);
      await B.page.reload();
      await expect(B.page.getByTestId("trades-table")).toContainText("NAS100", { timeout: 15000 });
      await expect(B.page.getByTestId("trades-table")).not.toContainText("GBPUSD", { timeout: 15000 });
    });

    await test.step("12: offline on B — badge «no network», 1 waiting; back online → sent, on A", async () => {
      await B.context.setOffline(true);
      await addTrade(B.page, "usdjpy", { navigate: false });
      await expect(badge(B.page)).toHaveAttribute("data-state", "offline", { timeout: 15000 });
      await badge(B.page).click();
      await expect(B.page.getByTestId("sync-badge-panel")).toContainText("1");
      await B.page.keyboard.press("Escape");
      await B.context.setOffline(false);
      await expect.poll(() => liveInstruments(request, email), { timeout: 30000 }).toEqual(["NAS100", "USDJPY"]);
      await expect(badge(B.page)).toHaveAttribute("data-state", "synced", { timeout: 15000 });
      await A.page.goto("/journal");
      await expect(A.page.getByTestId("trades-table")).toContainText("USDJPY", { timeout: 15000 });
    });

    await test.step("13–14: edited on both — «Keep this device» wins everywhere", async () => {
      await B.context.setOffline(true);
      await editInstrument(B.page, "USDJPY", "audusd");
      await editInstrument(A.page, "USDJPY", "cadjpy");
      await expect.poll(() => liveInstruments(request, email), { timeout: 15000 }).toEqual(["CADJPY", "NAS100"]);
      await B.context.setOffline(false);
      await B.page.reload();
      const dialog = B.page.getByTestId("sync-conflict-dialog");
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await expect(dialog).toContainText("Запись изменена на двух устройствах");
      await expect(dialog.getByTestId("conflict-device")).toContainText("AUDUSD");
      await expect(dialog.getByTestId("conflict-cloud")).toContainText("CADJPY");
      await dialog.getByTestId("conflict-keep").click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => liveInstruments(request, email), { timeout: 15000 }).toEqual(["AUDUSD", "NAS100"]);
      await A.page.reload();
      await expect(A.page.getByTestId("trades-table")).toContainText("AUDUSD", { timeout: 15000 });
    });

    await test.step("17: deleted on A, edited on B — «Decide later», then from the badge «Take from cloud»", async () => {
      await B.context.setOffline(true);
      await editInstrument(B.page, "AUDUSD", "chfjpy");
      await deleteTrade(A.page, "AUDUSD");
      await expect.poll(() => liveInstruments(request, email), { timeout: 15000 }).toEqual(["NAS100"]);
      await B.context.setOffline(false);
      await B.page.reload();
      const dialog = B.page.getByTestId("sync-conflict-dialog");
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await expect(dialog).toContainText("На другом устройстве эту сделку удалили, а здесь изменили.");
      await dialog.getByTestId("conflict-later").click();
      await expect(dialog).toBeHidden();
      await expect(badge(B.page)).toHaveAttribute("aria-label", "Нужен выбор: 1", { timeout: 15000 });
      await badge(B.page).click();
      await B.page.getByTestId("sync-badge-action").click();
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("conflict-take").click();
      await expect(dialog).toBeHidden();
      await expect(B.page.getByTestId("trades-table")).not.toContainText("CHFJPY");
      expect(await liveInstruments(request, email)).toEqual(["NAS100"]);
    });

    await A.context.close();
    await B.context.close();
  });

  test("part 2: import and undo → screenshot caption → unsent sign-out → second account and guest isolation → counters → flag off", async ({
    browser,
    request,
  }) => {
    const stamp = Date.now();
    const email = `Day2_${stamp}@example.com`;
    const otherEmail = `Day2Other_${stamp}@example.com`;
    const { A, B, userId } = await syncedPair(browser, request, email, `DayB${stamp % 100000}`);

    await test.step("21: import TradeTrack on A → on B, no XP; «Undo import» → gone on B, the rest stays", async () => {
      await A.page.goto("/journal");
      const xpBefore = await accountXp(A.page, userId);
      await A.page.getByTestId("journal-import").click();
      const wizard = A.page.getByTestId("import-wizard");
      await wizard.getByTestId("import-next").click();
      await wizard.getByTestId("import-file-input").setInputFiles({ name: "tradetrack.csv", mimeType: "text/csv", buffer: TRADETRACK });
      await expect(wizard.getByTestId("import-file-summary")).toContainText("Формат: TradeTrack");
      await wizard.getByTestId("import-next").click();
      await wizard.getByTestId("import-next").click();
      await wizard.getByTestId("import-next").click();
      await wizard.getByTestId("import-confirm").click();
      await expect(wizard).toContainText("Добавлено сделок: 29");
      await expect.poll(async () => (await liveInstruments(request, email)).length, { timeout: 30000 }).toBe(30);
      expect(await accountXp(A.page, userId)).toBe(xpBefore); // no XP for imported trades
      for (const r of await cloudRows(request, email)) for (const k of ["xp", "coins", "xpAwarded", "coinsAwarded"]) expect(r.data).not.toHaveProperty(k);
      await B.page.reload();
      await expect.poll(async () => ((await local(B.page, `ayra:${userId}:ayra_journal_v1`)).trades as Row["data"][]).filter((t) => !t.deletedAt).length, { timeout: 15000 }).toBe(30);

      await wizard.getByRole("button", { name: "Отменить импорт" }).click();
      await A.page.getByRole("button", { name: "Удалить сделки импорта" }).click();
      await expect(A.page.getByText("Импорт отменён: удалено сделок — 29")).toBeVisible();
      await expect.poll(() => liveInstruments(request, email), { timeout: 30000 }).toEqual(["NAS100"]);
      await B.page.reload();
      await expect.poll(async () => ((await local(B.page, `ayra:${userId}:ayra_journal_v1`)).trades as Row["data"][]).filter((t) => !t.deletedAt).map((t) => t.instrument), { timeout: 15000 }).toEqual(["NAS100"]);
    });

    await test.step("22: screenshot added on A → on B the trade says it is stored on another device", async () => {
      await A.page.goto("/journal");
      await A.page.keyboard.press("Escape");
      await A.page.click("tr:has-text('NAS100')");
      await A.page.locator("input[type='file'][accept='image/*']").setInputFiles(SCREENSHOT);
      await expect(A.page.locator(".aspect-video").first()).toBeVisible();
      await expect(A.page.getByTestId("screenshots-elsewhere")).toHaveCount(0); // the file is here
      await expect
        .poll(async () => ((await cloudRows(request, email)).find((r) => r.table === "journal_trades" && r.data.instrument === "NAS100")?.data.attachmentIds as string[] | undefined)?.length ?? 0, { timeout: 15000 })
        .toBe(1);
      await B.page.goto("/journal");
      await expect.poll(async () => ((await local(B.page, `ayra:${userId}:ayra_journal_v1`)).trades as Row["data"][]).find((t) => t.instrument === "NAS100")?.attachmentIds, { timeout: 15000 }).toHaveLength(1);
      await B.page.reload();
      await B.page.click("tr:has-text('NAS100')");
      await expect(B.page.getByTestId("screenshots-elsewhere")).toContainText("Скриншот хранится на другом устройстве");
      await shot(B.page, "caption-1440", "screenshots-elsewhere");
      await B.page.setViewportSize({ width: 360, height: 740 });
      await shot(B.page, "caption-360", "screenshots-elsewhere");
      await B.page.setViewportSize({ width: 1440, height: 900 });
      await B.page.keyboard.press("Escape");
    });

    await test.step("18: «Sign out and delete» with an unsent change — warning with the count, only «Cancel»", async () => {
      // offline another page cannot be opened: Settings is opened first, the trade is added from the header «+»
      await B.page.goto("/settings");
      await expect(signOutDeleteBtn(B.page)).toBeVisible();
      await B.context.setOffline(true);
      await B.page.getByRole("button", { name: "Добавить", exact: true }).click();
      await B.page.getByRole("button", { name: "Сделка", exact: true }).click();
      const drawer = B.page.getByTestId("add-trade-drawer");
      await expect(drawer).toBeVisible();
      await B.page.getByTestId("instrument-input").fill("eurgbp");
      await B.page.fill("input[placeholder='150 / -50']", "40");
      await B.page.getByTestId("instrument-input").press("Control+Enter");
      await expect(drawer).toBeHidden();
      await signOutDeleteBtn(B.page).click();
      const warning = B.page.getByTestId("unsynced-warning");
      await expect(warning.getByTestId("unsynced-counts")).toContainText("1 изменение ещё не в облаке");
      await warning.getByTestId("unsynced-cancel").click();
      await expect(warning).toHaveCount(0);
      await B.context.setOffline(false);
      await expect.poll(() => liveInstruments(request, email), { timeout: 30000 }).toEqual(["EURGBP", "NAS100"]);
      await expect(badge(B.page)).toHaveAttribute("data-state", "synced", { timeout: 15000 });
    });

    const ownerCloud = async () => JSON.stringify(await cloudLive(request, email));
    await test.step("19: a second account on A — no badge, none of the owner's trades; its trade never reaches the owner", async () => {
      const cloudBefore = await ownerCloud();
      await plainSignOut(A.page);
      await signIn(A.page, otherEmail);
      await completeOnboarding(A.page, `DayO${stamp % 100000}`);
      await A.page.goto("/journal");
      await expect(badge(A.page)).toHaveCount(0);
      await expect(A.page.locator("main")).not.toContainText("NAS100");
      await addTrade(A.page, "spx500", { firstAccount: "Test" });
      await plainSignOut(A.page);
      await signIn(A.page, email);
      await A.page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
      await A.page.goto("/journal");
      await expect(badge(A.page)).toBeVisible({ timeout: 15000 });
      await expect(A.page.getByTestId("trades-table")).toContainText("NAS100", { timeout: 15000 });
      await expect(A.page.getByTestId("trades-table")).not.toContainText("SPX500");
      await A.page.waitForTimeout(1500);
      expect(await ownerCloud()).toBe(cloudBefore);
      expect(await cloudRows(request, otherEmail)).toEqual([]); // flag off for the second account: nothing went up
    });

    await test.step("20: a guest on B — no badge, the owner's journal is not visible; the guest trade stays out of the cloud", async () => {
      const cloudBefore = await ownerCloud();
      await plainSignOut(B.page);
      await B.page.getByRole("button", { name: "Продолжить без входа" }).click();
      await B.page.waitForURL((url) => url.pathname !== "/login", { timeout: 10000 });
      if (new URL(B.page.url()).pathname.startsWith("/awakening")) await completeOnboarding(B.page, `Guest${stamp % 100000}`);
      await B.page.goto("/journal");
      await expect(badge(B.page)).toHaveCount(0);
      await expect(B.page.locator("main")).not.toContainText("NAS100");
      await addTrade(B.page, "ger40", { firstAccount: "Guest" });
      await signIn(B.page, email);
      await B.page.waitForURL((url) => url.pathname === "/" || url.pathname.startsWith("/profile-select"), { timeout: 10000 });
      if (new URL(B.page.url()).pathname.startsWith("/profile-select")) await B.page.click("button:has-text('Не переносить')");
      await B.page.goto("/journal");
      await expect(B.page.getByTestId("trades-table")).toContainText("NAS100", { timeout: 15000 });
      await expect(B.page.getByTestId("trades-table")).not.toContainText("GER40");
      await B.page.waitForTimeout(1500);
      expect(await ownerCloud()).toBe(cloudBefore);
    });

    await test.step("24: counters on A = on B = cloud", async () => {
      const a = await deviceCounts(A.page);
      const b = await deviceCounts(B.page);
      expect(b).toEqual(a);
      const live = await cloudLive(request, email);
      expect(a.journal_trades).toBe(live.journal_trades);
      expect(a.journal_accounts).toBe(live.journal_accounts);
    });

    await test.step("25: flag off — no badge, the journal works locally, nothing deleted, nothing sent", async () => {
      const cloudBefore = await ownerCloud();
      await request.get(`${FAKE_SUPABASE}/__test/cloud-flag?email=${encodeURIComponent(email)}&on=0`);
      await A.page.goto("/journal");
      await expect(badge(A.page)).toHaveCount(0, { timeout: 15000 });
      await expect(A.page.getByTestId("trades-table")).toContainText("NAS100");
      await addTrade(A.page, "btcusd");
      await expect(A.page.getByTestId("trades-table")).toContainText("BTCUSD");
      await A.page.waitForTimeout(1500);
      expect(await ownerCloud()).toBe(cloudBefore);
    });

    await A.context.close();
    await B.context.close();
  });
});
