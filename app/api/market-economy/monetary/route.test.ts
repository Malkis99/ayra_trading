/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { monetarySnapshot } from "@/lib/market/economy/monetary-cache";
import { GET } from "./route";

vi.mock("@/lib/market/economy/monetary-cache", () => ({ monetarySnapshot: vi.fn() }));

function request(query: string) {
  return GET(new Request("http://localhost/api/market-economy/monetary?" + query));
}

describe("monetary route", () => {
  it("cache headers are restricted to ready snapshots", async () => {
    for (const status of ["ready", "stale", "unavailable", "error"] as const) {
      vi.mocked(monetarySnapshot).mockResolvedValueOnce({ status, points: [] });
      const response = await request("series=yields&range=latest");
      expect(monetarySnapshot).toHaveBeenLastCalledWith("yields", false);
      expect(response.status).toBe(status === "error" ? 503 : 200);
      expect(response.headers.get("Cache-Control")).toBe(status === "ready" ? "public, max-age=60, s-maxage=300" : "no-store");
    }
  });

  it("validates both parameters and only loads requested history", async () => {
    vi.mocked(monetarySnapshot).mockClear().mockResolvedValueOnce({ status: "ready", points: [] });
    expect((await request("series=constructor&range=history")).status).toBe(400);
    expect((await request("series=dollar&range=latest&range=history")).status).toBe(400);
    expect(monetarySnapshot).not.toHaveBeenCalled();
    expect((await request("series=dollar&range=history")).status).toBe(200);
    expect(monetarySnapshot).toHaveBeenCalledTimes(1);
    expect(monetarySnapshot).toHaveBeenCalledWith("dollar", true);
  });
});
