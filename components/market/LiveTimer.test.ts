import { describe, expect, it } from "vitest";
import { countdownText, isLongCountdown } from "./LiveTimer";

const ru = { d: "{n} д", h: "{n} ч", m: "{n} мин" };
const S = 1000;
const M = 60 * S;
const H = 60 * M;

describe("countdownText (PR 1.1d): one format everywhere", () => {
  it("«clock» up to a day: HH:MM:SS", () => {
    expect(countdownText(7 * H + 29 * M + 59 * S, "clock", ru)).toBe("07:29:59");
    expect(countdownText(24 * H, "clock", ru)).toBe("24:00:00");
    expect(countdownText(0, "clock", ru)).toBe("00:00:00");
    expect(countdownText(-5 * S, "clock", ru)).toBe("00:00:00");
  });

  it("«clock» over a day: days, hours and minutes, no seconds; minutes round up as in «human»", () => {
    expect(countdownText(24 * H + 52 * M + 21 * S, "clock", ru)).toBe("1 д 0 ч 53 мин");
    expect(countdownText(24 * H + 52 * M + 21 * S, "human", ru)).toBe("1 д 0 ч 53 мин");
    expect(countdownText(24 * H + 52 * M, "clock", ru)).toBe("1 д 0 ч 52 мин");
    expect(countdownText(2 * 24 * H + 3 * H + 5 * M, "clock", ru)).toBe("2 д 3 ч 5 мин");
    expect(isLongCountdown(24 * H)).toBe(false);
    expect(isLongCountdown(24 * H + S)).toBe(true);
  });

  it("«human»: the same parts in every row", () => {
    expect(countdownText(30 * M, "human", ru)).toBe("30 мин");
    expect(countdownText(5 * H, "human", ru)).toBe("5 ч 0 мин");
    expect(countdownText(7 * H + 33 * M, "human", ru)).toBe("7 ч 33 мин");
    expect(countdownText(24 * H + 52 * M, "human", ru)).toBe("1 д 0 ч 52 мин");
  });
});
