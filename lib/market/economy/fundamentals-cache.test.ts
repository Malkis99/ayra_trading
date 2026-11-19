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
