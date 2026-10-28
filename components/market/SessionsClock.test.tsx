import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { getDictionary } from "@/lib/i18n";

vi.mock("@/lib/context", () => {
  const app = () => ({ dict: getDictionary("ru"), lang: "ru", showToast: vi.fn() });
  return { useApp: app, useOptionalApp: app };
});
const game = { gameState: { profile: { timezone: "Asia/Tbilisi" } } };
vi.mock("@/lib/game-context", () => ({ useOptionalGame: () => game }));
// counts renders of the page part (it calls this on every render)
const gapCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/market/sessions", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/market/sessions")>();
  return {
    ...mod,
    londonNewYorkGapHours: (ms: number) => {
      gapCalls.n++;
      return mod.londonNewYorkGapHours(ms);
    },
  };
});

import { SessionsClock } from "./SessionsClock";

let visibility: DocumentVisibilityState = "visible";
const at = (iso: string) => {
  vi.setSystemTime(new Date(iso));
};
const text = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  game.gameState.profile.timezone = "Asia/Tbilisi";
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Sessions cards", () => {
  it("the countdowns tick every second; the page does not re-render with the seconds", () => {
    at("2026-04-06T08:30:00.000Z"); // 12:30 in Tbilisi
    render(<SessionsClock />);
    expect(text("market-london-status")).toBe("Открыта");
    expect(text("market-london-timer")).toBe("07:30:00");
    expect(text("market-newyork-timer")).toBe("03:30:00");
    expect(text("market-londonKz-timer")).toBe("00:30:00");
    const renders = gapCalls.n;
    act(() => vi.advanceTimersByTime(1000));
    expect(text("market-london-timer")).toBe("07:29:59");
    act(() => vi.advanceTimersByTime(4000));
    expect(text("market-london-timer")).toBe("07:29:55");
    expect(gapCalls.n).toBe(renders);
  });

  it("status in words and an icon, a progress ring, hours with «(+1)»", () => {
    at("2026-04-06T08:30:00.000Z");
    render(<SessionsClock />);
    expect(text("market-asia-status")).toBe("Открыта");
    expect(text("market-newyork-status")).toBe("Закрыта");
    expect(screen.getByTestId("market-london-status").querySelector("svg")).not.toBeNull();
    // London 11:00–20:00 here: 1 h 30 of 9 h passed
    expect(screen.getByTestId("market-london-ring").getAttribute("data-progress")).toBe("16");
    expect(screen.getByTestId("market-newyork-ring").getAttribute("data-progress")).toBe("0");
    expect(text("market-newyork-hours")).toBe("Сегодня · 16:00–01:00 (+1)");
    expect(text("market-overlap-hours")).toBe("Сегодня · 16:00–20:00");
    expect(screen.getAllByTestId("market-next-item")).toHaveLength(5);
    expect(screen.getAllByTestId("market-next-item")[0].textContent).toContain("Закрывается Токио");
    expect(screen.getAllByTestId("market-next-item")[1].textContent).toContain("Заканчивается Killzone Лондона");
  });

  it("across the user's midnight: New York stays one session, «Yesterday · 16:00–01:00 (+1)» after 00:00", () => {
    at("2026-04-06T19:59:58.000Z"); // 23:59:58 in Tbilisi
    render(<SessionsClock />);
    expect(text("market-newyork-hours")).toBe("Сегодня · 16:00–01:00 (+1)");
    expect(text("market-newyork-timer")).toBe("01:00:02");
    act(() => vi.advanceTimersByTime(3000)); // 00:00:01
    expect(text("market-newyork-status")).toBe("Открыта");
    expect(text("market-newyork-timer")).toBe("00:59:59");
    expect(text("market-newyork-hours")).toBe("Вчера · 16:00–01:00 (+1)");
  });

  it("the weekend: «Выходные», the market opens on Sunday evening, the next events are on Monday", () => {
    at("2026-03-07T12:00:00.000Z"); // Saturday
    render(<SessionsClock />);
    for (const id of ["asia", "london", "newyork"]) expect(text(`market-${id}-status`)).toBe("Выходные");
    expect(text("market-weekend")).toContain("Рынок закрыт, откроется");
    expect(text("market-active-now")).toBe("Сейчас ничего не открыто: выходные");
    expect(screen.getAllByTestId("market-next-item")[0].textContent).toContain("Открывается Токио");
  });

  it("a background tab: nothing ticks; on return the countdown is right at once", () => {
    at("2026-04-06T08:30:00.000Z");
    render(<SessionsClock />);
    act(() => {
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => vi.advanceTimersByTime(65_000));
    expect(text("market-london-timer")).toBe("07:30:00");
    act(() => {
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(text("market-london-timer")).toBe("07:28:55");
  });

  it("another time zone in the profile: the hours follow", () => {
    at("2026-10-28T08:00:00.000Z");
    const { rerender } = render(<SessionsClock />);
    expect(text("market-london-hours")).toBe("Сегодня · 12:00–21:00");
    game.gameState.profile.timezone = "Europe/London";
    rerender(<SessionsClock />);
    expect(text("market-london-hours")).toBe("Сегодня · 08:00–17:00");
    expect(text("market-newyork-hours")).toBe("Сегодня · 12:00–21:00");
    // the 4-hour week hint stays
    expect(text("market-gap")).toContain("сейчас 4 ч");
  });
});
