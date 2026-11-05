import { test, expect, type Page, type Route } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";

test.use({ reducedMotion: "reduce" });

/** UI-only fixtures, intercepted locally. Real grants/RLS are covered separately by PGlite SQL tests. */
async function interceptNotifications(page: Page) {
  const rows = Array.from({ length: 23 }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
    type_code: i === 0 ? "security_new_device" : "market_actual",
    payload: i === 0 ? { subject: "Вход с нового устройства", source: "AYRA" } : { subject: "Индекс потребительских цен", source: "BLS", actual: "1.0", previous: "0.9" }, href: i === 0 ? "/settings/account" : "/market",
    created_at: new Date(Date.now() - i * 60000).toISOString(), read_at: null as string | null,
  }));
  let settings: Record<string, unknown> | null = null;
  let missing = false;
  const pattern = /\/rest\/v1\/(notifications|notification_settings|notification_preferences|rpc\/save_notification_settings)(\?|$)/;
  const handler = async (route: Route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    if (missing) return route.fulfill({ status: 404, json: { code: "PGRST205", message: "missing table" } });
    if (path.endsWith("/save_notification_settings")) {
      settings = req.postDataJSON().p_settings;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/notification_settings")) return route.fulfill({ json: settings });
    if (path.endsWith("/notification_preferences")) return route.fulfill({ json: [] });
    let selected = rows.filter((r) => !url.searchParams.has("read_at") || !r.read_at);
    if (url.searchParams.has("type_code")) selected = selected.filter((r) => r.type_code === url.searchParams.get("type_code")?.slice(3));
    if (url.searchParams.has("id")) selected = selected.filter((r) => r.id === url.searchParams.get("id")?.slice(3));
    if (req.method() === "PATCH") { selected.forEach((r) => { r.read_at = new Date().toISOString(); }); return route.fulfill({ status: 204 }); }
    if (req.method() === "HEAD") return route.fulfill({ status: 200, headers: { "content-range": `0-0/${selected.length}`, "access-control-expose-headers": "content-range" } });
    if (url.searchParams.has("or")) {
      const before = url.searchParams.get("or")?.match(/created_at\.lt\.([^,]+)/)?.[1];
      if (before) selected = selected.filter((r) => r.created_at < before);
    }
    return route.fulfill({ json: selected.slice(0, Number(url.searchParams.get("limit") ?? 20)) });
  };
  await page.route(pattern, handler);
  return { rows, getSettings: () => settings, setMissing: () => { missing = true; }, attach: (other: Page) => other.route(pattern, handler) };
}

test("notifications: inbox, explicit read, pagination, filters, cloud settings, RU/EN and responsive layouts", async ({ page }) => {
  test.setTimeout(180000);
  const fixtures = await interceptNotifications(page);
  await signIn(page, `Notify_${Date.now()}@example.com`);
  await completeOnboarding(page, `Notify${Date.now() % 100000}`, { after: "left" });
  await page.goto("/settings/notifications");
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await expect(page.getByRole("switch", { name: /^Все уведомления/ })).toBeChecked();
  await page.getByRole("switch", { name: /^Все уведомления/ }).click();
  await page.getByRole("switch", { name: /^Тихие часы/ }).click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Сохранено в аккаунте");
  expect(fixtures.getSettings()?.all_disabled).toBe(true);
  const second = await page.context().newPage();
  await fixtures.attach(second);
  await second.goto("/settings/notifications");
  await expect(second.getByRole("switch", { name: /^Все уведомления/ })).not.toBeChecked();
  await second.close();
  await page.reload();
  await expect(page.getByRole("switch", { name: /^Все уведомления/ })).not.toBeChecked();
  await expect(page.getByText("Важные уведомления безопасности остаются включены.")).toBeVisible();
  await expect(page.getByRole("switch", { name: /: Web Push$/ }).first()).toBeDisabled();
  expect(await page.getByTestId("notification-settings").innerText()).not.toMatch(/хранение|источник|демонстрацион|миграци|не подключен/i);
  const output = process.env.SHOT_DIR;
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: width === 360 ? 2100 : 2000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    const matrix = page.getByTestId("notification-matrix");
    expect(await matrix.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    if (output) await page.screenshot({ path: `${output}/notifications-settings-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Уведомления", exact: true }).click();
  const center = page.getByTestId("notification-center");
  await expect(center.getByTestId("notification-item")).toHaveCount(20);
  await expect(center.getByRole("button", { name: "Все", exact: true })).toBeFocused();
  const triggerBox = await page.getByRole("button", { name: "Уведомления", exact: true }).boundingBox();
  const popupBox = await center.boundingBox();
  expect(popupBox!.width).toBeGreaterThanOrEqual(380);
  expect(popupBox!.width).toBeLessThanOrEqual(420);
  expect(Math.abs(popupBox!.x + popupBox!.width - triggerBox!.x - triggerBox!.width)).toBeLessThanOrEqual(2);
  expect(popupBox!.y).toBeGreaterThan(triggerBox!.y + triggerBox!.height);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  const list = center.getByTestId("notification-list");
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  if (output) await page.screenshot({ path: `${output}/notifications-popover-desktop.png` });
  expect(fixtures.rows.every((r) => !r.read_at)).toBe(true);
  await center.getByRole("button", { name: "Показать ещё" }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(23);
  await center.getByRole("combobox", { name: "Тип уведомления" }).click();
  await page.getByRole("option", { name: "Новое устройство", exact: true }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(1);
  await center.getByRole("button", { name: "Прочитано", exact: true }).click();
  await expect.poll(() => fixtures.rows.filter((r) => r.read_at).length).toBe(1);
  await center.getByRole("button", { name: "Непрочитанные", exact: true }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(0);
  await center.getByRole("combobox", { name: "Тип уведомления" }).click();
  await page.getByRole("option", { name: "Все типы", exact: true }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(20);
  await center.getByRole("button", { name: "Все", exact: true }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(20);
  if (output) await page.screenshot({ path: `${output}/notifications-popover-test-list.png` });
  await center.getByRole("button", { name: "Непрочитанные", exact: true }).click();
  await center.getByRole("combobox", { name: "Тип уведомления" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(center).toBeVisible();
  await center.getByRole("button", { name: "Прочитать всё" }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(0);
  expect(fixtures.rows.every((r) => !!r.read_at)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(center).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Уведомления", exact: true })).toBeFocused();
  // A second bell click toggles the popover; outside pointer and Tab out also close it.
  const bell = page.getByRole("button", { name: "Уведомления", exact: true });
  await bell.click();
  await expect(center).toBeVisible();
  await bell.click();
  await expect(center).toHaveCount(0);
  await bell.click();
  await page.mouse.click(500, 650);
  await expect(center).toHaveCount(0);

  // Phones navigate to a real page, not a dialog. The same inbox and explicit-read rules apply.
  fixtures.rows.forEach((row, index) => { row.read_at = index === 0 ? new Date().toISOString() : null; });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload();
  await page.getByRole("link", { name: "Уведомления", exact: true }).click();
  await page.waitForURL("**/notifications?from=**");
  await expect(center.getByRole("heading", { name: "Уведомления", level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(center.getByTestId("notification-item")).toHaveCount(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(await page.locator("main").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  if (output) await page.screenshot({ path: `${output}/notifications-mobile-page.png` });
  await center.getByRole("button", { name: "Прочитано", exact: true }).first().click();
  await expect.poll(() => fixtures.rows.filter((row) => row.read_at).length).toBe(2);
  await center.getByRole("button", { name: "Непрочитанные", exact: true }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(20);
  await center.getByRole("combobox", { name: "Тип уведомления" }).click();
  await page.getByRole("option", { name: "Новое устройство", exact: true }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(center).toBeVisible();
  await center.getByRole("button", { name: "Назад", exact: true }).click();
  await page.waitForURL("**/settings/notifications");
  await page.goto("/");
  await page.getByRole("link", { name: "Уведомления", exact: true }).click();
  await page.waitForURL("**/notifications?from=**");
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");

  fixtures.rows.splice(0);
  await page.goto("/notifications");
  await expect(center.getByText("Пока нет уведомлений")).toBeVisible();
  await expect(center.getByRole("button", { name: "Прочитать всё" })).toHaveCount(0);
  if (output) await page.screenshot({ path: `${output}/notifications-mobile-empty.png` });
  await center.getByRole("button", { name: "Назад", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.setViewportSize({ width: 1440, height: 900 });
  await bell.click();
  await expect(center.getByText("Пока нет уведомлений")).toBeVisible();
  await expect(center.getByRole("button", { name: "Прочитать всё" })).toHaveCount(0);
  if (output) await page.screenshot({ path: `${output}/notifications-popover-empty.png` });
  await center.getByRole("link", { name: "Настройки уведомлений" }).focus();
  await page.keyboard.press("Tab");
  await expect(center).toHaveCount(0);
  if (output) {
    for (const section of ["profile", "journal", "interface", "privacy"]) {
      await page.goto(`/settings/${section}`);
      await expect(page.getByTestId(`settings-section-${section}`)).toBeVisible();
      await page.screenshot({ path: `${output}/settings-reference-${section}-360.png` });
    }
  }
  await page.goto("/settings/interface");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.goto("/settings/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  expect(await page.getByTestId("notification-settings").innerText()).not.toMatch(/[А-Яа-яЁё]/);
  if (output) await page.screenshot({ path: `${output}/notifications-settings-en-360.png` });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await page.waitForURL("**/notifications?from=**");
  await expect(center.getByText("No notifications yet", { exact: true })).toBeVisible();
  expect(await center.innerText()).not.toMatch(/[А-Яа-яЁё]/);
  await center.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForURL("**/settings/notifications");
  fixtures.setMissing();
  await page.reload();
  await expect(page.getByTestId("notification-settings").getByRole("alert")).toContainText("unavailable right now");
  await expect(page.getByRole("switch", { name: /^All notifications/ })).toBeDisabled();
});
