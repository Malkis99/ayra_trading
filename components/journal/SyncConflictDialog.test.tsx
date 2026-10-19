import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { getDictionary } from "@/lib/i18n";
import type { JournalSnapshot, SyncConflict, Trade } from "@/lib/journal/types";
import { describeConflict } from "@/lib/journal/cloud/conflict-view";

// The dialog reads the journal and app contexts; both are replaced by controlled values here.
const journal = {
  conflictDialogRequest: 0,
  cloudActive: true,
  syncConflicts: [] as SyncConflict[],
  resolveSyncConflict: vi.fn(() => true),
  getAllRecords: (): JournalSnapshot => snapshot,
  accounts: [{ id: "acc_1", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "x" }],
};
const toast = vi.fn();
let snapshot: JournalSnapshot;
vi.mock("@/lib/journal/context", () => ({ useJournal: () => journal }));
vi.mock("next/navigation", () => ({ usePathname: () => "/journal" }));
vi.mock("@/lib/context", () => {
  const app = () => ({ dict: getDictionary("ru"), lang: "ru", showToast: toast });
  return { useApp: app, useOptionalApp: app };
});

import { SyncConflictDialog } from "./SyncConflictDialog";

const trade = (over: Partial<Trade> = {}): Trade =>
  ({
    id: "t1",
    accountId: "acc_1",
    instrument: "NAS100",
    direction: "long",
    status: "closed",
    openedAt: "2026-10-13T09:00:00.000Z",
    result: "win",
    pnlMoney: 120,
    emotions: [],
    mistakes: [],
    verification: "unverified",
    source: "manual",
    createdAt: "2026-10-13T09:00:00.000Z",
    updatedAt: "2026-10-18T10:00:00.000Z",
    schemaVersion: 6,
    ...over,
  }) as Trade;

const conflict = (cloud: Record<string, unknown>, id = "t1"): SyncConflict => ({ table: "journal_trades", id, cloud, detectedAt: "2026-10-19T10:00:00.000Z" });

beforeEach(() => {
  journal.cloudActive = true;
  journal.resolveSyncConflict.mockClear();
  toast.mockClear();
  snapshot = { schemaVersion: 6, accounts: [], trades: [trade({ instrument: "GER40" })], strategies: [], noTrades: [], plans: [], weekPlans: [], notes: [] };
});

describe("conflict view model", () => {
  it("both edited: key trade fields of both versions, the different ones marked", () => {
    const v = describeConflict(conflict({ ...trade(), pnlMoney: 80, updatedAt: "2026-10-18T11:00:00.000Z" }), trade({ instrument: "GER40" }) as never, journal.accounts as never);
    expect(v).toMatchObject({ kind: "trade", situation: "bothEdited", label: "GER40", labelDate: "2026-10-13T09:00:00.000Z" });
    const byId = Object.fromEntries(v.fields.map((f) => [f.id, f]));
    expect(byId.instrument).toMatchObject({ device: "GER40", cloud: "NAS100", differs: true });
    expect(byId.result).toMatchObject({ device: "+120.00", cloud: "+80.00", differs: true });
    expect(byId.account).toMatchObject({ device: "Main", cloud: "Main", differs: false });
  });

  it("deleted in the cloud / deleted here; notes", () => {
    const del = describeConflict(conflict({ ...trade(), deletedAt: "2026-10-18T12:00:00.000Z" }), trade({ instrument: "GER40" }) as never);
    expect(del.situation).toBe("deletedInCloud");
    expect(del.fields.some((f) => f.differs)).toBe(false); // nothing to compare with a deleted version
    expect(describeConflict(conflict(trade() as never), { ...trade(), deletedAt: "2026-10-18T12:00:00.000Z" } as never).situation).toBe("deletedHere");
    const note = describeConflict({ table: "journal_notes", id: "n1", cloud: { id: "n1", title: "Plan", body: "cloud text", updatedAt: "x" }, detectedAt: "x" }, { id: "n1", title: "Plan", body: "device text" });
    expect(note).toMatchObject({ kind: "note", label: "Plan" });
    expect(note.fields.find((f) => f.id === "body")).toMatchObject({ differs: true });
  });
});

describe("SyncConflictDialog", () => {
  it("nothing when the cloud is not active (guest, flag off) or there are no conflicts", () => {
    journal.syncConflicts = [conflict(trade() as never)];
    journal.cloudActive = false;
    const { container } = render(<SyncConflictDialog />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("sync-conflict-dialog")).toBeNull();
  });

  it("opens by itself: what the record is, both versions with the differences, the two choices and 'decide later'", () => {
    journal.syncConflicts = [conflict({ ...trade(), updatedAt: "2026-10-18T11:00:00.000Z" })];
    render(<SyncConflictDialog />);
    const dialog = screen.getByTestId("sync-conflict-dialog");
    expect(dialog.textContent).toContain("Запись изменена на двух устройствах");
    expect(dialog.textContent).toContain("Сделка");
    expect(screen.getByTestId("conflict-device").textContent).toContain("GER40");
    expect(screen.getByTestId("conflict-cloud").textContent).toContain("NAS100");
    expect(screen.getByTestId("conflict-device").querySelector('[data-differs="true"]')?.textContent).toContain("GER40");
    expect(screen.queryByTestId("conflict-keep-all")).toBeNull(); // only one record
    fireEvent.click(screen.getByTestId("conflict-keep"));
    expect(journal.resolveSyncConflict).toHaveBeenCalledWith("journal_trades", "t1", "device");
  });

  it("deleted on another device: its own wording; 'take from cloud' resolves with cloud", () => {
    journal.syncConflicts = [conflict({ ...trade(), deletedAt: "2026-10-18T12:00:00.000Z", updatedAt: "2026-10-18T12:00:00.000Z" })];
    render(<SyncConflictDialog />);
    expect(screen.getByTestId("sync-conflict").textContent).toContain("На другом устройстве эту сделку удалили, а здесь изменили.");
    expect(screen.getByTestId("conflict-cloud").textContent).toContain("Удалено");
    expect(screen.getByTestId("sync-conflict").textContent).toContain("Запись удалится и на этом устройстве.");
    fireEvent.click(screen.getByTestId("conflict-take"));
    expect(journal.resolveSyncConflict).toHaveBeenCalledWith("journal_trades", "t1", "cloud");
  });

  it("several records: 'for all' buttons; 'decide later' closes and does not resolve anything", () => {
    snapshot.trades.push(trade({ id: "t2", instrument: "EURUSD" }));
    journal.syncConflicts = [conflict(trade() as never), conflict(trade({ id: "t2", instrument: "XAUUSD" }) as never, "t2")];
    render(<SyncConflictDialog />);
    expect(screen.getByTestId("sync-conflict-dialog").textContent).toContain("Записи изменены на двух устройствах: 2");
    // "For all" asks first, with the number of entries
    fireEvent.click(screen.getByTestId("conflict-take-all"));
    expect(journal.resolveSyncConflict).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Заменить 2 записи версией из облака?");
    // the confirmation has two ways to cancel (the button and the close cross): either one cancels
    fireEvent.click(screen.getAllByRole("button", { name: "Отмена" })[0]);
    expect(journal.resolveSyncConflict).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("conflict-take-all"));
    fireEvent.click(screen.getByRole("button", { name: "Заменить: 2" }));
    expect(journal.resolveSyncConflict).toHaveBeenCalledTimes(2);
    expect(journal.resolveSyncConflict).toHaveBeenCalledWith("journal_trades", "t2", "cloud");
    journal.resolveSyncConflict.mockClear();
    fireEvent.click(screen.getByTestId("conflict-later"));
    expect(screen.queryByTestId("sync-conflict-dialog")).toBeNull();
    expect(journal.resolveSyncConflict).not.toHaveBeenCalled();
  });

  it("waits while another dialog is open (e.g. the add-trade drawer)", () => {
    vi.useFakeTimers();
    try {
      const other = document.createElement("div");
      other.setAttribute("role", "dialog");
      document.body.appendChild(other);
      journal.syncConflicts = [conflict(trade() as never)];
      render(<SyncConflictDialog />);
      expect(screen.queryByTestId("sync-conflict-dialog")).toBeNull();
      other.remove();
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      expect(screen.getByTestId("sync-conflict-dialog")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
