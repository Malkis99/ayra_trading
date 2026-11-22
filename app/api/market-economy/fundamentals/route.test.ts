/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { GET } from "./route";
import { fundamentalSnapshot } from "@/lib/market/economy/fundamentals-cache";
vi.mock("@/lib/market/economy/fundamentals-cache", () => ({ fundamentalSnapshot: vi.fn() }));
it("validates allowlisted series/ranges and rejects duplicate or extra parameters", async () => {
  vi.mocked(fundamentalSnapshot).mockClear();
  for (const query of ["series=constructor&range=latest", "series=income&range=latest&range=history", "series=income", "series=income&range=full", "series=income&range=latest&url=https://example.test"]) {
    const result = await GET(new Request("http://localhost/?" + query));
    expect(result.status).toBe(400);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(fundamentalSnapshot).not.toHaveBeenCalled();
});
it("caches only ready results and includes stable series identity, units and adjustment", async () => {
  for (const status of ["ready", "stale", "partial", "unavailable", "error"] as const) {
    vi.mocked(fundamentalSnapshot).mockResolvedValueOnce({ status, points: [], retrievedAt: new Date().toISOString() });
    const result = await GET(new Request("http://localhost/?series=production&range=history"));
    expect(result.status).toBe(status === "error" ? 503 : 200);
    expect(result.headers.get("Cache-Control")).toBe(status === "ready" ? "public, max-age=60, s-maxage=300" : "no-store");
    expect((await result.json()).definition).toMatchObject({ seriesId: "Fed-G17-total-IP-mom", adjustment: "SA", unit: "percent-mom" });
    expect(fundamentalSnapshot).toHaveBeenLastCalledWith("production", true);
  }
});

it("limits both HTTP cache lifetimes to the remaining source-check lifetime", async () => {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    vi.mocked(fundamentalSnapshot).mockResolvedValueOnce({ status: "ready", points: [], retrievedAt: new Date(now - 3_590_000).toISOString() });
    const result = await GET(new Request("http://localhost/?series=production&range=latest"));
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=10, s-maxage=10");
    vi.mocked(fundamentalSnapshot).mockResolvedValueOnce({ status: "ready", points: [] });
    expect((await GET(new Request("http://localhost/?series=production&range=latest"))).headers.get("Cache-Control")).toBe("no-store");
  } finally { vi.restoreAllMocks(); }
});

it.each(["2026-11-01T07:00:00Z", undefined])("never caches or publishes expired/unconfirmed retrieval %s as ready", async retrievedAt => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-19T07:00:00Z"));
  try {
    vi.mocked(fundamentalSnapshot).mockResolvedValueOnce({ status: "ready", retrievedAt, points: [{ period: "2026-10", value: 38,
      previous: 37.86, sourceUrl: "https://api.bls.gov/publicAPI/v1/timeseries/data/CES0500000003", publishedAt: null, vintage: "current", stage: "preliminary" }] });
    const result = await GET(new Request("http://localhost/?series=earnings&range=latest"));
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(await result.json()).toMatchObject({ status: "stale", staleReason: retrievedAt ? "source_check_expired" : "source_check_unconfirmed" });
  } finally { vi.restoreAllMocks(); }
});
