import { describe, expect, it } from "vitest";
import { marketKindOf, marketState, nyseState } from "./market-hours";

const at = (iso: string) => Date.parse(iso);

describe("market open / closed next to the chart", () => {
  it("kinds: crypto, forex, CFD, stocks", () => {
    expect(marketKindOf("btc")).toBe("crypto");
    expect(marketKindOf("eurgbp")).toBe("forex");
    expect(marketKindOf("hk50")).toBe("cfd");
    expect(marketKindOf("gold")).toBe("cfd");
    expect(marketKindOf("aapl")).toBe("stocks");
  });

  it("crypto: around the clock", () => {
    expect(marketState("crypto", at("2026-11-01T12:00:00Z"))).toEqual({ open: true, changeAt: null });
  });

  it("forex and CFD: the forex week (Sunday 17:00 – Friday 17:00 New York)", () => {
    // Saturday 31 October 2026: closed, opens Sunday 1 November 17:00 New York (EST, after the switch) = 22:00 UTC
    expect(marketState("forex", at("2026-10-31T12:00:00Z"))).toEqual({ open: false, changeAt: at("2026-11-01T22:00:00Z") });
    // Monday 2 November: open, closes Friday 6 November 17:00 New York = 22:00 UTC
    expect(marketState("cfd", at("2026-11-02T12:00:00Z"))).toEqual({ open: true, changeAt: at("2026-11-06T22:00:00Z") });
  });

  it("stocks: NYSE 09:30–16:00 New York, Monday–Friday", () => {
    // Monday 2 November 2026, 10:00 New York (15:00 UTC): open until 16:00 (21:00 UTC)
    expect(nyseState(at("2026-11-02T15:00:00Z"))).toEqual({ open: true, changeAt: at("2026-11-02T21:00:00Z") });
    // the same day, 08:00 New York: opens at 09:30
    expect(nyseState(at("2026-11-02T13:00:00Z"))).toEqual({ open: false, changeAt: at("2026-11-02T14:30:00Z") });
    // Friday 6 November, 17:00 New York: next opening Monday 9 November 09:30
    expect(nyseState(at("2026-11-06T22:00:00Z"))).toEqual({ open: false, changeAt: at("2026-11-09T14:30:00Z") });
    // Saturday: Monday 09:30
    expect(nyseState(at("2026-11-07T15:00:00Z"))).toEqual({ open: false, changeAt: at("2026-11-09T14:30:00Z") });
    // exactly 16:00 is closed
    expect(nyseState(at("2026-11-02T21:00:00Z")).open).toBe(false);
  });
});
