import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

const call = (handler: typeof POST, headers: Record<string, string> = {}) => handler(new Request("https://example.test/api/market-feeds/collect?scope=news", { method: "POST", headers }));

describe("POST /api/market-feeds/collect", () => {
  it("says what is missing when the collector is not set up (no secret)", async () => {
    delete process.env.MARKET_FEEDS_SECRET;
    const res = await call(POST, { Authorization: "Bearer x" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "collector_not_configured", missing: ["MARKET_FEEDS_SECRET"] });
  });

  it("refuses a wrong or missing secret", async () => {
    process.env.MARKET_FEEDS_SECRET = "a-long-secret-value";
    expect((await call(POST)).status).toBe(401);
    expect((await call(GET, { Authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("with the right secret but no server key: says so, writes nothing", async () => {
    process.env.MARKET_FEEDS_SECRET = "a-long-secret-value";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await call(POST, { Authorization: "Bearer a-long-secret-value" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "collector_not_configured", missing: ["SUPABASE_SERVICE_ROLE_KEY"] });
  });
});
