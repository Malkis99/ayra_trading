import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { getDictionary } from "@/lib/i18n";
import { AppStorage } from "@/lib/storage";

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
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const text = (id: string) => screen.getByTestId(id).textContent;
const setVisibility = (v: DocumentVisibilityState) =>
  act(() => {
    visibility = v;
    document.dispatchEvent(new Event("visibilitychange"));
  });

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

// Monday 6 April 2026, 08:30 UTC = 04:30 in New York (the default display time), 12:30 in Tbilisi (the profile)
const MONDAY = "2026-04-06T08:30:00.000Z";

describe("Sessions: live cards in the display time (New York by default)", () => {
  it("the countdowns tick every second; the page does not re-render with the seconds", () => {
    at(MONDAY);
    render(<SessionsClock />);
    expect(text("market-london-timer")).toBe("07:30:00");
    expect(text("market-newyork-timer")).toBe("05:00:00");
    // seconds only on the main cards; the killzone counts minutes
    expect(text("market-londonKz-timer")).toBe("30 мин");
    const renders = gapCalls.n;
    act(() => vi.advanceTimersByTime(1000));
    expect(text("market-london-timer")).toBe("07:29:59");
    act(() => vi.advanceTimersByTime(4000));
    expect(text("market-london-timer")).toBe("07:29:55");
    expect(gapCalls.n).toBe(renders);
  });

  it("cards: status in words and an icon, a ring, hours in New York time with my time under them", () => {
    at(MONDAY);
    render(<SessionsClock />);
    expect(text("market-sessions-now")).toContain("04:30");
    expect(text("market-london-status")).toBe("Открыта");
    // a dot and a word
    expect(screen.getByTestId("market-london-status").querySelector("span[aria-hidden]")).not.toBeNull();
    expect(text("market-london-hours")).toBe("03:00–12:00");
    expect(text("market-london-mine")).toBe("У тебя: 11:00–20:00");
    // London 07:00–16:00 UTC: 1 h 30 of 9 h passed
    expect(screen.getByTestId("market-london-ring").getAttribute("data-progress")).toBe("16");
    expect(text("market-newyork-status")).toBe("Закрыта");
    expect(text("market-newyork-hours")).toBe("09:30–18:00");
    expect(text("market-asia-hours")).toBe("19:00–04:00 (+1)");
    expect(text("market-overlap-hours")).toBe("09:30–12:00");
    expect(text("market-londonKz-hours")).toBe("02:00–05:00");
  });

  it("sub-sessions: a compact list with hours, status, countdown and a «?»", () => {
    at(MONDAY);
    render(<SessionsClock />);
    const list = screen.getByTestId("market-subsessions");
    // the overlap and the five sub-sessions, one row each
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(text("market-frankfurt-status")).toBe("Открыта");
    expect(text("market-frankfurt-hours")).toBe("02:00–11:00");
    expect(text("market-sydney-status")).toBe("Закрыта");
    expect(screen.queryByTestId("market-sydney-about")).toBeNull();
    fireEvent.click(screen.getByTestId("market-sydney-hint"));
    expect(text("market-sydney-about")).toContain("Тихоокеанская сессия");
    // one hint at a time
    fireEvent.pointerDown(screen.getByTestId("market-london-hint"));
    fireEvent.click(screen.getByTestId("market-london-hint"));
    expect(screen.queryByTestId("market-sydney-about")).toBeNull();
    expect(text("market-london-about")).toContain("Европейская сессия");
    expect(text("market-london-about")).toContain("Общее описание, не является финансовой рекомендацией.");
  });

  it("across midnight of the display time: Tokyo stays one session, «Yesterday · 19:00–04:00 (+1)» after 00:00", () => {
    at("2026-04-07T03:59:58.000Z"); // 23:59:58 in New York
    render(<SessionsClock />);
    expect(text("market-asia-hours")).toBe("19:00–04:00 (+1)");
    act(() => vi.advanceTimersByTime(3000));
    expect(text("market-asia-status")).toBe("Открыта");
    expect(text("market-asia-timer")).toBe("03:59:59");
    expect(text("market-asia-hours")).toBe("Вчера · 19:00–04:00 (+1)");
  });

  it("the weekend: «Выходные», the market opens on Sunday evening, Sydney opens first", () => {
    at("2026-03-07T12:00:00.000Z"); // Saturday
    render(<SessionsClock />);
    // the word stays for screen readers only; the block says it once, at the top
    for (const id of ["asia", "london", "newyork"]) expect(text(`market-${id}-status`)).toBe("Выходные");
    // the table rows say «Closed · opens in …» in words (owner 2026-11-02)
    for (const id of ["sydney", "chicago"]) expect(text(`market-${id}-status`)).toBe("Закрыта");
    expect(text("market-sydney-row-status")).toMatch(/^Закрыта · откроется через \d/);
    expect(text("market-weekend")).toBe("Выходные: рынок закрыт, откроется в воскресенье 17:00");
    const visible = screen.getByTestId("market-sessions").cloneNode(true) as HTMLElement;
    visible.querySelectorAll(".sr-only").forEach((n) => n.remove());
    expect(visible.textContent?.match(/Выходные/g)).toHaveLength(1);
    expect(screen.queryByTestId("market-active-now")).toBeNull();
    expect(screen.getAllByTestId("market-next-item")[0].textContent).toContain("Открывается Сидней");
    // more than a day to the opening: days, hours and minutes, no seconds
    expect(text("market-asia-timer")).toMatch(/^1 д \d{1,2} ч \d{1,2} мин$/);
    expect(screen.getByTestId("market-asia-timer").getAttribute("data-long")).toBe("true");
  });

  it("a background tab: nothing ticks; on return the countdown is right at once", () => {
    at(MONDAY);
    render(<SessionsClock />);
    setVisibility("hidden");
    act(() => vi.advanceTimersByTime(65_000));
    expect(text("market-london-timer")).toBe("07:30:00");
    setVisibility("visible");
    expect(text("market-london-timer")).toBe("07:28:55");
  });

  it("the display time: only New York and my zone in the block; UTC from the settings — everything follows; kept", () => {
    at(MONDAY);
    const { unmount } = render(<SessionsClock />);
    expect(screen.queryByTestId("market-display-utc")).toBeNull();
    expect(screen.queryByTestId("market-display-zone")).toBeNull();
    expect(text("market-display-profile")).toBe("Мой пояс · UTC+4");
    fireEvent.click(screen.getByTestId("market-display-profile"));
    expect(text("market-london-hours")).toBe("11:00–20:00");
    expect(screen.queryByTestId("market-london-mine")).toBeNull();
    expect(text("market-sessions-now")).toContain("12:30");
    fireEvent.click(screen.getByTestId("market-settings-open"));
    fireEvent.click(screen.getByTestId("market-settings-display-utc"));
    fireEvent.click(screen.getByTestId("market-settings-done"));
    expect(text("market-london-hours")).toBe("07:00–16:00");
    // neither quick choice is marked; a line says where it is changed
    expect(screen.getByTestId("market-display-newyork").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("market-display-profile").getAttribute("aria-checked")).toBe("false");
    expect(text("market-display-elsewhere")).toBe("Время показа: UTC, меняется в настройках");
    expect(text("market-newyorkKz-hours")).toBe("11:00–14:00");
    expect(screen.getAllByTestId("market-next-item")[0].textContent).toContain("09:00");
    unmount();
    render(<SessionsClock />);
    expect(text("market-london-hours")).toBe("07:00–16:00");
    expect(JSON.parse(AppStorage.getItem("ayra_market_sessions") || "{}").display).toEqual({ kind: "utc" });
  });

  it("another time zone in the profile while showing «my zone»: the hours follow", () => {
    at("2026-10-28T08:00:00.000Z");
    AppStorage.setItem("ayra_market_sessions", JSON.stringify({ display: { kind: "profile" } }));
    const { rerender } = render(<SessionsClock />);
    expect(text("market-london-hours")).toBe("12:00–21:00");
    game.gameState.profile.timezone = "Europe/London";
    rerender(<SessionsClock />);
    expect(text("market-london-hours")).toBe("08:00–17:00");
    fireEvent.click(screen.getByTestId("market-block-hint"));
    expect(text("market-gap")).toContain("сейчас 4 ч");
  });

  it("«Set up» → Sessions: hours typed in the display time are kept in the city's time; wrong ones are not saved; reset", () => {
    at(MONDAY);
    render(<SessionsClock />);
    fireEvent.click(screen.getByTestId("market-settings-open"));
    fireEvent.click(screen.getByRole("tab", { name: "Сессии" }));
    expect((screen.getByTestId("market-hours-london-start") as HTMLInputElement).value).toBe("03:00");
    expect(text("market-hours-london-local")).toBe("= 08:00–17:00 по местному времени Лондона");
    fireEvent.change(screen.getByTestId("market-hours-london-start"), { target: { value: "02:00" } });
    expect(text("market-hours-london-local")).toBe("= 07:00–17:00 по местному времени Лондона");
    expect(text("market-london-hours")).toBe("02:00–12:00");
    expect(JSON.parse(AppStorage.getItem("ayra_market_sessions") || "{}").sessions.london).toEqual({ start: "07:00", end: "17:00" });
    // start = end: an error, nothing saved
    fireEvent.change(screen.getByTestId("market-hours-london-end"), { target: { value: "02:00" } });
    expect(text("market-hours-london-local")).toBe("Нужен формат ЧЧ:ММ, начало и конец не должны совпадать.");
    expect(text("market-london-hours")).toBe("02:00–12:00");
    fireEvent.click(screen.getByTestId("market-hours-london-reset"));
    expect(text("market-london-hours")).toBe("03:00–12:00");
    // across midnight is allowed
    fireEvent.change(screen.getByTestId("market-hours-chicago-end"), { target: { value: "01:00" } });
    expect(text("market-hours-chicago-local")).toBe("= 09:00–00:00 по местному времени Чикаго");
    fireEvent.click(screen.getByTestId("market-settings-reset-all"));
    expect(text("market-hours-chicago-local")).toBe("= 09:00–18:00 по местному времени Чикаго");
  });

  it("killzones saved before this change are kept; edited in the display time", () => {
    at(MONDAY);
    AppStorage.setItem("ayra_market_killzones", JSON.stringify({ londonKz: { start: "03:00", end: "06:00" } }));
    render(<SessionsClock />);
    expect(text("market-londonKz-hours")).toBe("03:00–06:00");
    fireEvent.click(screen.getByTestId("market-settings-open"));
    fireEvent.click(screen.getByTestId("market-settings-display-utc"));
    fireEvent.click(screen.getByRole("tab", { name: "Killzones" }));
    expect((screen.getByTestId("market-hours-londonKz-start") as HTMLInputElement).value).toBe("07:00");
    expect(text("market-hours-londonKz-local")).toBe("= 03:00–06:00 по местному времени Нью-Йорка");
  });

  it("a hint closes on a tap outside and on Esc", () => {
    at(MONDAY);
    render(<SessionsClock />);
    fireEvent.click(screen.getByTestId("market-london-hint"));
    expect(screen.getByTestId("market-london-about")).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId("market-active-now"));
    expect(screen.queryByTestId("market-london-about")).toBeNull();
    fireEvent.click(screen.getByTestId("market-london-hint"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("market-london-about")).toBeNull();
  });

  it("why the hours move: London in winter and in summer, on my clock (Tbilisi)", () => {
    at("2026-11-04T12:00:00.000Z");
    AppStorage.setItem("ayra_market_sessions", JSON.stringify({ display: { kind: "profile" } }));
    const { unmount } = render(<SessionsClock />);
    fireEvent.click(screen.getByTestId("market-london-hint"));
    expect(text("market-london-season")).toBe(
      "Местные часы: 08:00–17:00 (UTC+0). Сейчас в Лондоне зимнее время, поэтому по твоему времени сессия на 1 ч позже, чем летом."
    );
    unmount();
    at("2026-07-15T12:00:00.000Z");
    render(<SessionsClock />);
    fireEvent.click(screen.getByTestId("market-london-hint"));
    expect(text("market-london-season")).toBe(
      "Местные часы: 08:00–17:00 (UTC+1). Сейчас в Лондоне летнее время, поэтому по твоему времени сессия на 1 ч раньше, чем зимой."
    );
  });

  it("why the hours move: Sydney (southern summer in November) and Tokyo (no summer time) in New York time", () => {
    at("2026-11-04T12:00:00.000Z");
    render(<SessionsClock />);
    fireEvent.click(screen.getByTestId("market-asia-hint"));
    expect(text("market-asia-season")).toBe(
      "Местные часы: 08:00–17:00 (UTC+9). В Токио нет перехода на летнее время, а по времени показа часы переводят, поэтому сейчас сессия на 1 ч раньше, чем в другую половину года."
    );
    fireEvent.pointerDown(screen.getByTestId("market-sydney-hint"));
    fireEvent.click(screen.getByTestId("market-sydney-hint"));
    expect(text("market-sydney-season")).toBe(
      "Местные часы: 08:00–17:00 (UTC+11). Сейчас в Сиднее летнее время, поэтому по времени показа сессия на 2 ч раньше, чем зимой."
    );
    fireEvent.pointerDown(screen.getByTestId("market-london-hint"));
    fireEvent.click(screen.getByTestId("market-london-hint"));
    expect(text("market-london-season")).toBe(
      "Местные часы: 08:00–17:00 (UTC+0). Сейчас в Лондоне зимнее время, но по времени показа часы сессии весь год одинаковы: этот пояс тоже переводит часы."
    );
  });
});
