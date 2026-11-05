import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { en } from "@/lib/i18n/dictionaries/en";
import { defaultSettings } from "@/lib/notifications/types";
import { NotificationRepositoryError } from "@/lib/notifications/repository";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { NotificationCenter } from "./NotificationCenter";
import { useNotificationInbox, useUnreadCount } from "@/lib/notifications/use-notifications";

const mock = vi.hoisted(() => ({ settings: vi.fn(), save: vi.fn(), list: vi.fn(), count: vi.fn(), markRead: vi.fn(), userId: "a", language: "ru" }));
vi.mock("@/lib/context", () => ({
  useApp: () => ({ dict: mock.language === "en" ? en : ru, lang: mock.language }),
  useOptionalApp: () => ({ dict: mock.language === "en" ? en : ru, lang: mock.language }),
}));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: { id: mock.userId }, profile: { timezone: "UTC" } }) }));
vi.mock("@/lib/notifications/repository", async (original) => {
  const actual = await original<typeof import("@/lib/notifications/repository")>();
  return { ...actual, notificationRepository: mock };
});

beforeEach(() => {
  vi.clearAllMocks(); mock.userId = "a"; mock.language = "ru";
  mock.settings.mockResolvedValue({ settings: defaultSettings(), preferences: [] });
  mock.save.mockResolvedValue(undefined); mock.list.mockResolvedValue([]); mock.count.mockResolvedValue(0); mock.markRead.mockResolvedValue(undefined);
});
afterEach(cleanup);

function TestCenter() {
  const trigger = React.useRef<HTMLButtonElement>(null);
  return <><button ref={trigger}>Bell</button><NotificationCenter anchor={trigger} trigger={trigger} unreadCount={1} onClose={() => undefined} /></>;
}

describe("notification UI boundaries", () => {
  it("never saves defaults after initial cloud read failed", async () => {
    mock.settings.mockRejectedValue(new Error("offline"));
    render(<NotificationSettings />);
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("keeps an unsuccessful save dirty, and does not claim success", async () => {
    mock.save.mockRejectedValue(new Error("offline"));
    render(<NotificationSettings />);
    await waitFor(() => expect(screen.queryByText("Загрузка…")).toBeNull());
    const master = screen.getByRole("switch", { name: /^Все уведомления/ });
    expect(master.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(master);
    expect(master.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Сохранено в аккаунте")).toBeNull();
    expect(screen.getByText("Есть несохранённые изменения")).toBeTruthy();
    expect(mock.save).toHaveBeenCalledWith("a", expect.objectContaining({ all_disabled: true }), []);
  });
  it("shows pending functions honestly, with English-only visible text", async () => {
    mock.language = "en";
    const { container } = render(<NotificationSettings />);
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(container.textContent).not.toMatch(/[А-Яа-яЁё]/);
    const external = screen.getAllByRole("switch", { name: /: Web Push$/ });
    expect(external.every((el) => (el as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByText(en.notifications.securityException)).toBeTruthy();
    expect(container.textContent).not.toMatch(/storage|sources|migration|demo/i);
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([
      "Events", "On siteComing soon", "Web PushComing soon", "TelegramComing soon", "EmailComing soon",
    ]);
  });
  it("enabling All notifications saves all_disabled=false without changing other preferences", async () => {
    const stored = { ...defaultSettings(), all_disabled: true, quiet_enabled: true, min_importance: 3, instrument_ids: ["btc"] };
    mock.settings.mockResolvedValue({ settings: stored, preferences: [] });
    render(<NotificationSettings />);
    await waitFor(() => expect(screen.queryByText("Загрузка…")).toBeNull());
    const master = screen.getByRole("switch", { name: /^Все уведомления/ });
    expect(master.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(master);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Сохранено в аккаунте");
    expect(mock.save).toHaveBeenCalledWith("a", { ...stored, all_disabled: false }, []);
  });
  it("opening the center does not mark anything read", async () => {
    render(<TestCenter />);
    await screen.findByText(ru.notifications.empty);
    expect(mock.markRead).not.toHaveBeenCalled();
  });
  it("renders the mobile page without a dialog and only leaves through Back", async () => {
    const goBack = vi.fn();
    render(<NotificationCenter presentation="page" unreadCount={0} onClose={goBack} />);
    await screen.findByText(ru.notifications.empty);
    expect(screen.getByRole("heading", { level: 1, name: "Уведомления" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(goBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(goBack).toHaveBeenCalledTimes(1);
  });
  it("reports missing migration without a fake empty-success state", async () => {
    mock.list.mockRejectedValue(new NotificationRepositoryError("setup"));
    render(<TestCenter />);
    await screen.findByText(ru.notifications.setup);
    expect(screen.queryByText(ru.notifications.empty)).toBeNull();
  });
  it("discards a late inbox response after identity change", async () => {
    let finish!: (rows: unknown[]) => void;
    mock.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ id }) => useNotificationInbox(id, false, ""), { initialProps: { id: "a" } });
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { finish([{ id: "secret-a" }]); });
    expect(result.current.rows).toEqual([]);
  });
  it("discards a late badge response from the previous account", async () => {
    let finish!: (n: number) => void;
    mock.count.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ id }) => useUnreadCount(id), { initialProps: { id: "a" } });
    rerender({ id: "b" });
    await act(async () => { finish(999); });
    expect(result.current).toBe(0);
  });
});
