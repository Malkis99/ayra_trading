/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("./fundamentals-source", () => ({ loadFundamental: load }));
const point = { period: "2026-10", value: 38, previous: 37.86, sourceUrl: "https://api.bls.gov/publicAPI/v1/timeseries/data/CES0500000003",
  publishedAt: null, vintage: "current", stage: "preliminary" };
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T07:00Z")); load.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const data = () => ({ points: [point], retrievedAt: new Date().toISOString() });

it("coalesces parallel same-series reads and reuses the snapshot briefly", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  load.mockResolvedValue(data());
  const [a, b] = await Promise.all([fundamentalSnapshot("earnings", false), fundamentalSnapshot("earnings", false)]);
  expect(a).toEqual(b);
  expect(a.status).toBe("ready");
  expect(load).toHaveBeenCalledTimes(1);
  await fundamentalSnapshot("earnings", false);
  expect(load).toHaveBeenCalledTimes(1);
});
it("one blocked or failing dataset never blocks other independent cards", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  let finish!: () => void;
  load.mockImplementation((series: string) => series === "retail" ? new Promise(resolve => {
    finish = () => resolve({ points: [], retrievedAt: new Date().toISOString() });
  }) : Promise.resolve(data()));
  const retail = fundamentalSnapshot("retail", false);
  expect((await fundamentalSnapshot("earnings", false)).status).toBe("ready");
  finish();
  expect((await retail).status).toBe("unavailable");
});
it("retains confirmed values on network failure and avoids retry storms", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  load.mockResolvedValueOnce(data()).mockRejectedValue(new Error("http_503"));
  await fundamentalSnapshot("earnings", false);
  vi.advanceTimersByTime(61_000);
  const result = await fundamentalSnapshot("earnings", false);
  expect(result).toMatchObject({ status: "stale", points: [point] });
  await fundamentalSnapshot("earnings", false);
  expect(load).toHaveBeenCalledTimes(2);
});
it("rejects a conflicting same-vintage response or an older period", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  load.mockResolvedValueOnce(data()).mockResolvedValueOnce({ ...data(), points: [{ ...point, value: 37 }] })
    .mockResolvedValueOnce({ ...data(), points: [{ ...point, period: "2026-09" }] });
  await fundamentalSnapshot("earnings", false);
  vi.advanceTimersByTime(61_000);
  expect(await fundamentalSnapshot("earnings", false)).toMatchObject({ status: "stale", points: [point] });
  vi.advanceTimersByTime(61_000);
  expect(await fundamentalSnapshot("earnings", false)).toMatchObject({ status: "stale", points: [point] });
});
it("marks old observations stale and isolates latest from requested history", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  load.mockResolvedValue({ ...data(), points: [{ ...point, period: "2026-01" }] });
  expect((await fundamentalSnapshot("earnings", false)).status).toBe("stale");
  await fundamentalSnapshot("earnings", true);
  expect(load).toHaveBeenLastCalledWith("earnings", true, Date.now());
});
it("an initial error never becomes a successful empty snapshot", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  load.mockRejectedValue(new Error("http_403"));
  expect(await fundamentalSnapshot("retail", false)).toEqual({ status: "error", points: [] });
});
it("an older DOL report cannot overwrite a newer confirmed vintage for the same week", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  const claim = { ...point, period: "2026-11-07", value: 1717000, previous: null, vintage: "2026-11-19" };
  load.mockResolvedValueOnce({ ...data(), points: [claim] })
    .mockResolvedValueOnce({ ...data(), points: [{ ...claim, vintage: "2026-11-18", value: 1700000 }] });
  await fundamentalSnapshot("continuing", false);
  vi.advanceTimersByTime(61_000);
  expect(await fundamentalSnapshot("continuing", false)).toMatchObject({ status: "stale", points: [claim] });
});

it("November 19: an October observation retrieved on November 1 is stale, not ready", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  load.mockResolvedValue({ points: [point], retrievedAt: "2026-11-01T07:00:00.000Z" });
  expect(await fundamentalSnapshot("earnings", false)).toMatchObject({
    status: "stale", staleReason: "source_check_expired", points: [point], retrievedAt: "2026-11-01T07:00:00.000Z",
  });
});

it.each(["earnings", "unemployment", "continuing", "income", "consumption", "retail", "production"] as const)(
  "%s expires at its exact document TTL, including in-process hits", async series => {
    const { fundamentalSnapshot } = await import("./fundamentals-cache");
    const { sourceCheckTtlSeconds } = await import("./fundamentals-freshness");
    const retrievedAt = new Date(Date.now() - sourceCheckTtlSeconds(series) * 1000 + 1).toISOString();
    load.mockResolvedValue({ points: [{ ...point, period: series === "continuing" ? "2026-11-14" : "2026-10" }], retrievedAt });
    expect((await fundamentalSnapshot(series, false)).status).toBe("ready");
    vi.advanceTimersByTime(1);
    expect(await fundamentalSnapshot(series, false)).toMatchObject({ status: "stale", staleReason: "source_check_expired", retrievedAt });
    expect(load).toHaveBeenCalledTimes(1);
  });

it.each([undefined, "not-a-date", "2026-11-20T07:00:00.000Z"])("unconfirmed retrieval time %s never becomes ready", async retrievedAt => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  load.mockResolvedValue({ points: [point], retrievedAt });
  expect(await fundamentalSnapshot("earnings", false)).toMatchObject({ status: "stale", staleReason: "source_check_unconfirmed", points: [point] });
});

it("failed background revalidation returns the cached document as stale without restamping it; a real refresh recovers", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  const retrievedAt = "2026-11-18T19:00:00.000Z";
  // Next SWR returns the old successful document, rather than throwing a failed background request.
  load.mockResolvedValue({ points: [point], retrievedAt });
  expect((await fundamentalSnapshot("earnings", false)).status).toBe("stale");
  vi.advanceTimersByTime(61_000);
  expect(await fundamentalSnapshot("earnings", false)).toMatchObject({ status: "stale", retrievedAt, points: [point] });
  vi.advanceTimersByTime(61_000);
  const refreshedAt = new Date().toISOString();
  load.mockResolvedValue({ points: [point], retrievedAt: refreshedAt });
  expect(await fundamentalSnapshot("earnings", false)).toMatchObject({ status: "ready", retrievedAt: refreshedAt, points: [point] });
});

it("a failed request preserves the value and exact successful retrieval time", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  const confirmed = data();
  load.mockResolvedValueOnce(confirmed).mockRejectedValue(new Error("http_503"));
  await fundamentalSnapshot("income", false);
  vi.advanceTimersByTime(61_000);
  expect(await fundamentalSnapshot("income", false)).toMatchObject({ status: "stale", staleReason: "source_unavailable", retrievedAt: confirmed.retrievedAt, points: [point] });
});

it("an unavailable refreshed dataset does not erase the last confirmed observation", async () => {
  const { fundamentalSnapshot } = await import("./fundamentals-cache");
  const confirmed = data();
  load.mockResolvedValueOnce(confirmed).mockResolvedValueOnce({ points: [], retrievedAt: new Date().toISOString() });
  await fundamentalSnapshot("retail", false);
  vi.advanceTimersByTime(61_000);
  expect(await fundamentalSnapshot("retail", false)).toMatchObject({ status: "stale", staleReason: "source_unavailable", retrievedAt: confirmed.retrievedAt, points: [point] });
});
