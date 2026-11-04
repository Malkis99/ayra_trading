import { test, expect, type Page, type Route } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";

/** UI-only fixtures, intercepted locally. Real grants/RLS are covered separately by PGlite SQL tests. */
async function interceptNotifications(page: Page) {
  const rows = Array.from({ length: 23 }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
    type_code: i === 0 ? "security_new_device" : "market_actual",
    payload: { subject: `CPI ${i + 1}`, source: "BLS", actual: "1.0" }, href: "/market",
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
    if (req.method() === "HEAD") return route.fulfill({ status: 200, headers: { "content-range": `0-0/${selected.length}` } });
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
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole("button", { name: "Уведомления", exact: true }).click();
  const center = page.getByTestId("notification-center");
  await expect(center.getByTestId("notification-item")).toHaveCount(20);
  expect(fixtures.rows.every((r) => !r.read_at)).toBe(true);
  await center.getByRole("button", { name: "Показать ещё" }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(23);
  await center.getByLabel("Тип уведомления").selectOption("security_new_device");
  await expect(center.getByTestId("notification-item")).toHaveCount(1);
  await center.getByRole("button", { name: "Прочитано", exact: true }).click();
  await expect.poll(() => fixtures.rows.filter((r) => r.read_at).length).toBe(1);
  await center.getByRole("button", { name: "Непрочитанные", exact: true }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(0);
  await center.getByLabel("Тип уведомления").selectOption("");
  await expect(center.getByTestId("notification-item")).toHaveCount(20);
  if (output) await page.screenshot({ path: `${output}/notifications-center-360.png` });
  await center.getByRole("button", { name: "Прочитать всё" }).click();
  await expect(center.getByTestId("notification-item")).toHaveCount(0);
  expect(fixtures.rows.every((r) => !!r.read_at)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(center).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Уведомления", exact: true })).toBeFocused();
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
  fixtures.setMissing();
  await page.reload();
  await expect(page.getByTestId("notification-settings").getByRole("alert")).toContainText("unavailable right now");
  await expect(page.getByRole("switch", { name: /^All notifications/ })).toBeDisabled();
});
