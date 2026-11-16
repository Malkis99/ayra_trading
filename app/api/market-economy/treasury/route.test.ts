import { expect, test, vi } from "vitest";
import { fiscalData, fiscalSeries } from "@/lib/market/economy/treasury-cache";
import { GET } from "./route";
import type { FiscalSnapshot } from "@/lib/market/economy/fiscal-data";

vi.mock("@/lib/market/economy/treasury-cache", () => ({ fiscalData: vi.fn(), fiscalSeries: vi.fn() }));
const route = (query = "") => new Request("http://localhost/api/market-economy/treasury" + query);

test("error responses avoid CDN cache, successful and stale snapshots use separate TTLs", async () => {
  vi.mocked(fiscalSeries).mockResolvedValueOnce({ status: "error", points: [] })
    .mockResolvedValueOnce({ status: "ready", points: [] })
    .mockResolvedValueOnce({ status: "stale", points: [] });
  const debt = await GET(route("?series=debt&range=latest"));
  expect(debt.status).toBe(503);
  expect(debt.headers.get("Cache-Control")).toBe("no-store");
  const budget = await GET(route("?series=budget&range=latest"));
  expect(budget.headers.get("Cache-Control")).toContain("s-maxage=300");
  const interest = await GET(route("?series=interest&range=latest"));
  expect(interest.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=30");
  expect((await GET(route("?series=toString&range=max"))).status).toBe(400);
});

test("legacy callers get partial availability with no-store and all failures return 503", async () => {
  const error: FiscalSnapshot = { status: "error", points: [] };
  const ready: FiscalSnapshot = { status: "ready", points: [] };
  vi.mocked(fiscalData).mockResolvedValueOnce({ debt: error, budget: ready, interest: ready })
    .mockResolvedValueOnce({ debt: error, budget: error, interest: error });
  const partial = await GET(route());
  expect(partial.status).toBe(200);
  expect(partial.headers.get("Cache-Control")).toBe("no-store");
  expect((await partial.json()).budget.status).toBe("ready");
  const unavailable = await GET(route());
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
});
