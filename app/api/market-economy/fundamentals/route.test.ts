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
    vi.mocked(fundamentalSnapshot).mockResolvedValueOnce({ status, points: [] });
    const result = await GET(new Request("http://localhost/?series=production&range=history"));
    expect(result.status).toBe(status === "error" ? 503 : 200);
    expect(result.headers.get("Cache-Control")).toBe(status === "ready" ? "public, max-age=60, s-maxage=300" : "no-store");
    expect((await result.json()).definition).toMatchObject({ seriesId: "Fed-G17-total-IP-mom", adjustment: "SA", unit: "percent-mom" });
    expect(fundamentalSnapshot).toHaveBeenLastCalledWith("production", true);
  }
});
