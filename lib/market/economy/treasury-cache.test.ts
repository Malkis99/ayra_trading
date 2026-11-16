import { afterEach, expect, test, vi } from "vitest";
import { fiscalData, fiscalSeries, treasuryStatus } from "./treasury-cache";
import { loadTreasury, TreasuryFailure } from "./treasury";

vi.mock("next/cache", () => ({ unstable_cache: (load: () => unknown) => load }));
vi.mock("./treasury", async () => ({
  ...await vi.importActual<object>("./treasury"),
  loadTreasury: vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); });

test("marks an old observation or an old cached response as stale", () => {
  const now = Date.parse("2026-11-16");
  expect(treasuryStatus("debt", { checkedAt: "2026-11-16", points: [{ date: "2026-11-01", values: ["1"] }] }, now).status).toBe("stale");
  expect(treasuryStatus("budget", { checkedAt: "2026-11-14", points: [{ date: "2026-10-31", values: ["1"] }] }, now).status).toBe("stale");
  expect(treasuryStatus("budget", { checkedAt: "2026-11-16", points: [] }, now).status).toBe("empty");
});

test("coalesces simultaneous loads and cools down a failed dataset", async () => {
  const load = vi.mocked(loadTreasury);
  load.mockImplementation(async series => {
    if (series === "interest") throw new Error("temporarily unavailable");
    return [];
  });
  const [one, two] = await Promise.all([fiscalData(), fiscalData()]);
  expect(one).toEqual(two);
  expect(one.interest.status).toBe("error");
  expect(one.debt.status).toBe("empty");
  expect(load).toHaveBeenCalledTimes(3);
  await fiscalData();
  expect(load.mock.calls.filter(([series]) => series === "interest")).toHaveLength(1);
});

test("logs structured diagnostics and honors Retry-After across ranges", async () => {
  const load = vi.mocked(loadTreasury);
  load.mockClear();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  load.mockRejectedValueOnce(new TreasuryFailure("throttled", 2, 243, Date.now() + 300_000, "untrusted detail"));
  expect(await fiscalSeries("debt", "max")).toEqual({ status: "error", points: [] });
  expect(await fiscalSeries("debt", "1")).toEqual({ status: "error", points: [] });
  expect(load).toHaveBeenCalledTimes(1);
  expect(JSON.parse(warning.mock.calls[0][0])).toEqual({
    event: "treasury_read_failed", series: "debt", range: "max", category: "throttled", pages: 2, durationMs: 243,
  });
});
