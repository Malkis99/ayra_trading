import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { getDictionary } from "@/lib/i18n";
import { syncBadge, type SyncBadgeInput } from "@/lib/journal/cloud/badge";
import type { CloudStatusView } from "@/lib/journal/context";

const journal = {
  cloudActive: true,
  cloudStatus: { state: "synced", pending: 0, blocked: 0, conflicts: 0 } as CloudStatusView,
  online: true,
  initialSync: { needed: false, started: false },
  syncConflicts: [] as unknown[],
  syncNow: vi.fn(async () => {}),
  openInitialSync: vi.fn(),
  requestConflictDialog: vi.fn(),
  readUnsynced: vi.fn(() => ({ pending: 0, conflicts: 0 })),
};
vi.mock("@/lib/journal/context", () => ({ useJournal: () => journal }));
vi.mock("@/lib/context", () => {
  const app = () => ({ dict: getDictionary("ru"), lang: "ru", showToast: vi.fn() });
  return { useApp: app, useOptionalApp: app };
});

import { SyncBadge } from "./SyncBadge";
import { UnsyncedSignOutWarning } from "./UnsyncedSignOutWarning";

const base: SyncBadgeInput = { cloudActive: true, state: "synced", pending: 0, blocked: 0, conflicts: 0, initialNeeded: false, online: true };

beforeEach(() => {
  Object.assign(journal, {
    cloudActive: true,
    cloudStatus: { state: "synced", pending: 0, blocked: 0, conflicts: 0 },
    online: true,
    initialSync: { needed: false, started: false },
    syncConflicts: [],
  });
  journal.syncNow.mockClear();
  journal.openInitialSync.mockClear();
  journal.requestConflictDialog.mockClear();
});

describe("badge state (T7b-4e)", () => {
  it("no badge for guests or with the flag off", () => {
    expect(syncBadge({ ...base, cloudActive: false })).toBeNull();
  });

  it("each state with its action; the most urgent wins", () => {
    expect(syncBadge(base)).toEqual({ state: "synced", action: null, busy: false });
    expect(syncBadge({ ...base, state: "syncing" })).toEqual({ state: "syncing", action: null, busy: true });
    expect(syncBadge({ ...base, pending: 3 })).toEqual({ state: "syncing", action: "retry", busy: false });
    expect(syncBadge({ ...base, online: false, pending: 2 })).toEqual({ state: "offline", action: "retry", busy: false });
    expect(syncBadge({ ...base, state: "offline" })).toEqual({ state: "offline", action: null, busy: false });
    expect(syncBadge({ ...base, state: "error" })).toEqual({ state: "error", action: "retry", busy: false });
    expect(syncBadge({ ...base, initialNeeded: true, state: "waitingInitialSync" })).toEqual({ state: "waitingInitial", action: "upload", busy: false });
    // a choice beats everything, the first upload beats network trouble
    expect(syncBadge({ ...base, conflicts: 2, state: "error", online: false, initialNeeded: true })?.state).toBe("conflict");
    expect(syncBadge({ ...base, initialNeeded: true, online: false })?.state).toBe("waitingInitial");
  });
});

describe("SyncBadge in the header", () => {
  it("hidden for guests / flag off", () => {
    journal.cloudActive = false;
    const { container } = render(<SyncBadge />);
    expect(container.innerHTML).toBe("");
  });

  it("calm 'saved' state: no animation; a click explains with the last sync", () => {
    journal.cloudStatus = { state: "synced", pending: 0, blocked: 0, conflicts: 0, lastSyncAt: new Date(Date.now() - 120_000).toISOString() };
    render(<SyncBadge />);
    const badge = screen.getByTestId("sync-badge");
    expect(badge.getAttribute("data-state")).toBe("synced");
    expect(badge.getAttribute("aria-label")).toBe("Сохранено в облаке");
    expect(badge.querySelector(".motion-safe\\:animate-spin")).toBeNull();
    fireEvent.click(badge);
    const panel = screen.getByTestId("sync-badge-panel");
    expect(panel.textContent).toContain("Все изменения журнала в облаке.");
    expect(panel.textContent).toContain("Последняя синхронизация: 2 минуты назад");
    expect(screen.queryByTestId("sync-badge-action")).toBeNull();
  });

  it("sending: spins (only with motion allowed); pending count shown", () => {
    journal.cloudStatus = { state: "syncing", pending: 4, blocked: 0, conflicts: 0 };
    render(<SyncBadge />);
    const badge = screen.getByTestId("sync-badge");
    expect(badge.querySelector(".motion-safe\\:animate-spin")).not.toBeNull();
    fireEvent.click(badge);
    expect(screen.getByTestId("sync-badge-pending").textContent).toBe("Ждёт отправки: 4");
  });

  it("offline / error -> 'Retry' runs the exchange now; clock ahead has its own hint", async () => {
    journal.cloudStatus = { state: "error", pending: 2, blocked: 0, conflicts: 0, lastError: "deviceClockAhead" };
    render(<SyncBadge />);
    fireEvent.click(screen.getByTestId("sync-badge"));
    expect(screen.getByTestId("sync-badge-panel").textContent).toContain("Часы устройства спешат");
    await act(async () => {
      fireEvent.click(screen.getByTestId("sync-badge-action"));
    });
    expect(journal.syncNow).toHaveBeenCalled();
  });

  it("conflicts -> 'Resolve conflict' opens the dialog; waiting for the first upload -> 'Upload to the cloud'", () => {
    journal.syncConflicts = [{}, {}];
    const { unmount } = render(<SyncBadge />);
    expect(screen.getByTestId("sync-badge").getAttribute("aria-label")).toBe("Нужен выбор: 2");
    expect(screen.getByTestId("sync-badge").textContent).toContain("2");
    fireEvent.click(screen.getByTestId("sync-badge"));
    fireEvent.click(screen.getByTestId("sync-badge-action"));
    expect(journal.requestConflictDialog).toHaveBeenCalled();
    unmount();

    journal.syncConflicts = [];
    journal.initialSync = { needed: true, started: false };
    render(<SyncBadge />);
    expect(screen.getByTestId("sync-badge").getAttribute("data-state")).toBe("waitingInitial");
    fireEvent.click(screen.getByTestId("sync-badge"));
    fireEvent.click(screen.getByTestId("sync-badge-action"));
    expect(journal.openInitialSync).toHaveBeenCalled();
  });
});

describe("warning before 'Sign out and delete'", () => {
  it("shows how many changes and conflicts would be lost; 'Wait' sends and continues to the usual confirmation", async () => {
    let pending = 3;
    journal.readUnsynced.mockImplementation(() => ({ pending, conflicts: 0 }));
    journal.syncNow.mockImplementation(async () => {
      pending = 0;
    });
    const proceed = vi.fn();
    render(<UnsyncedSignOutWarning isOpen onCancel={vi.fn()} onProceed={proceed} />);
    expect(screen.getByTestId("unsynced-counts").textContent).toContain("3 изменения ещё не в облаке");
    await act(async () => {
      fireEvent.click(screen.getByTestId("unsynced-wait"));
    });
    expect(journal.syncNow).toHaveBeenCalled();
    expect(proceed).toHaveBeenCalled();
  });

  it("conflicts cannot be sent by waiting: the wait button is off; 'Sign out and delete' and 'Cancel' still work", () => {
    journal.readUnsynced.mockImplementation(() => ({ pending: 0, conflicts: 5 }));
    const proceed = vi.fn();
    const cancel = vi.fn();
    render(<UnsyncedSignOutWarning isOpen onCancel={cancel} onProceed={proceed} />);
    expect(screen.getByTestId("unsynced-counts").textContent).toContain("5 записей ждут выбора версии");
    expect((screen.getByTestId("unsynced-wait") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("unsynced-delete"));
    expect(proceed).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("unsynced-cancel"));
    expect(cancel).toHaveBeenCalled();
  });

  it("not everything sent within 30 s: says so and stays", async () => {
    vi.useFakeTimers();
    try {
      journal.readUnsynced.mockImplementation(() => ({ pending: 2, conflicts: 0 }));
      journal.syncNow.mockImplementation(async () => {});
      const proceed = vi.fn();
      render(<UnsyncedSignOutWarning isOpen onCancel={vi.fn()} onProceed={proceed} />);
      fireEvent.click(screen.getByTestId("unsynced-wait"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(proceed).not.toHaveBeenCalled();
      expect(screen.getByTestId("unsynced-not-all")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
