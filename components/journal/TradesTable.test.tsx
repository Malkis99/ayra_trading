import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TradesTable } from "./TradesTable";
import { ru } from "@/lib/i18n/dictionaries/ru";
import type { Account, Trade } from "@/lib/journal/types";
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/storage", () => ({ AppStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } }));
afterEach(() => { cleanup(); storage.clear(); });
const account: Account = { id: "a", name: "Main", type: "personal", currency: "USD", platform: "manual", createdAt: "2026-01-01T00:00:00Z" };
const make = (id: string, instrument: string): Trade => ({ id, instrument, accountId: "a", direction: "long", status: "closed", result: "win", pnlMoney: 100, rMultiple: 1, openedAt: "2026-11-01T23:30:00Z", createdAt: "2026-11-01T23:30:00Z", updatedAt: "2026-11-01T23:30:00Z", emotions: [], mistakes: [], source: "manual", verification: "unverified", schemaVersion: 5 });
const rows = [make("x", "EURUSD"), make("y", "XAUUSD")];
const mount = (trades = rows) => {
  const onOpenTrade = vi.fn();
  const props = { trades, accounts: [account], strategies: [], tz: "Asia/Tbilisi", unit: "money" as const, dict: ru, lang: "ru", formatTradeValue: (t: Trade) => String(t.pnlMoney), onOpenTrade, onAddTrade: vi.fn() };
  return { ...render(<TradesTable {...props} />), onOpenTrade, props };
};
it("switches actual layouts without losing search, and only opens real trades after a day is expanded", async () => {
  const { onOpenTrade } = mount();
  fireEvent.change(screen.getByRole("textbox", { name: ru.journal.tradesTab.searchPlaceholder }), { target: { value: "EUR" } });
  fireEvent.click(screen.getByRole("radio", { name: "По дням" }));
  const day = screen.getByTestId("trade-day");
  expect(day.textContent).toContain("Сделок: 1"); expect(day.textContent).not.toContain("XAUUSD");
  expect(within(day).queryByRole("table")).toBeNull();
  day.setAttribute("open", ""); fireEvent(day, new Event("toggle"));
  await waitFor(() => expect(within(day).getAllByText("EURUSD").length).toBeGreaterThan(0));
  fireEvent.keyDown(day.querySelector("tbody tr")!, { key: "Enter" }); expect(onOpenTrade).toHaveBeenCalledWith(rows[0]);
  fireEvent.click(screen.getByRole("radio", { name: "Список" }));
  expect(screen.queryByTestId("trades-days")).toBeNull();
  expect(screen.getByRole("textbox", { name: ru.journal.tradesTab.searchPlaceholder }).getAttribute("value")).toBe("EUR");
  expect(screen.getByTestId("trades-table").textContent).not.toContain("XAUUSD");
});
it("restores the view without reusing the old density key or writing trade records", () => {
  storage.set("ayra_journal_density", "compact"); storage.set("ayra_journal_trade_view_v1", "days");
  const before = structuredClone(rows); mount();
  expect(screen.getByRole("radio", { name: "По дням" }).getAttribute("aria-checked")).toBe("true");
  expect(rows).toEqual(before); expect(storage.get("ayra_journal_density")).toBe("compact");
});
it("handles empty results, profile timezone and partial daily totals honestly", () => {
  mount([rows[0], { ...rows[1], pnlMoney: undefined, rMultiple: undefined }]);
  expect(screen.getByTestId("trades-table").textContent).toContain("Неполный итог");
  expect(screen.getAllByText("03:30").length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole("textbox", { name: ru.journal.tradesTab.searchPlaceholder }), { target: { value: "nothing" } });
  expect(screen.getByText(ru.journal.overview.emptyFiltered)).toBeTruthy();
});
