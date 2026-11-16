import { afterEach, describe, expect, it, vi } from "vitest";
import { monetarySnapshot } from "./monetary-cache";
import { loadMonetary } from "./monetary";

vi.mock("next/cache", () => ({ unstable_cache: (read: () => unknown) => read }));
vi.mock("./monetary", async importOriginal => ({
  ...await importOriginal<typeof import("./monetary")>(),
  loadMonetary: vi.fn(),
}));

const points = [{ date: "2025-12-11", values: [3.5, 3.75] }];

afterEach(() => { vi.restoreAllMocks(); });

describe("EFFR freshness", () => {
  it.each([
    ["prior business day", "2026-11-13", "2026-11-16T15:00:00Z", false],
    ["weekend", "2026-11-13", "2026-11-15T15:00:00Z", false],
    ["Tuesday after a Monday holiday", "2026-01-16", "2026-01-20T14:30:00Z", false],
    ["still Tuesday in New York", "2026-01-16", "2026-01-21T02:00:00Z", false],
    ["publishing gap", "2026-01-16", "2026-01-21T15:00:00Z", true],
    ["several weeks without an observation", "2026-10-16", "2026-11-16T15:00:00Z", true],
  ])("handles %s independently of the target range", async (_label, date, now, stale) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
    const effectiveRate = { date, values: [3.88] };
    vi.mocked(loadMonetary).mockResolvedValueOnce({ points, effectiveRate });
    expect(await monetarySnapshot("policy", false)).toEqual({
      points, status: "ready", effectiveRate, effectiveRateStale: stale,
    });
  });

  it("returns the confirmed target range when EFFR is unavailable", async () => {
    vi.mocked(loadMonetary).mockResolvedValueOnce({ points });
    expect(await monetarySnapshot("policy", false)).toEqual({ status: "ready", points });
  });
});
