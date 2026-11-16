/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { pceSnapshot } from "@/lib/market/economy/bea-cache";
import { GET } from "./route";

vi.mock("@/lib/market/economy/bea-cache", () => ({ pceSnapshot: vi.fn() }));

it("validates range and caches only successful snapshots", async () => {
  const url = "https://ayra.test/api/market-economy/bea/pce";
  const request = (range: string) => GET(new Request(url + "?range=" + range));
  expect((await request("history&range=latest")).status).toBe(400);
  expect(pceSnapshot).not.toHaveBeenCalled();
  for (const status of ["ready", "stale", "partial", "error"] as const) {
    vi.mocked(pceSnapshot).mockResolvedValueOnce({ status, points: [] });
    const response = await request(status === "ready" ? "latest" : "history");
    expect(pceSnapshot).toHaveBeenLastCalledWith(status !== "ready");
    expect(response.status).toBe(status === "error" ? 503 : 200);
    expect(response.headers.get("Cache-Control")).toBe(status === "ready" ? "public, max-age=60, s-maxage=300" : "no-store");
  }
});
