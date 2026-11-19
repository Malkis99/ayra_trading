/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
const fixture = (name: string) => readFileSync(new URL("./fixtures/fundamentals/" + name, import.meta.url), "utf8");
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T07:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("rejects HTML disguised as JSON, oversized responses, and HTTP failures", async () => {
  const { fetchFundamental } = await import("./fundamentals-source");
  const mock = vi.fn().mockResolvedValueOnce(new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }))
    .mockResolvedValueOnce(new Response("x".repeat(2_000_001), { headers: { "content-type": "application/json" } }))
    .mockResolvedValueOnce(new Response("", { status: 403 }));
  vi.stubGlobal("fetch", mock);
  await expect(fetchFundamental("https://api.bls.gov/test", "json")).rejects.toThrow("unexpected_media_type");
  await expect(fetchFundamental("https://api.bls.gov/test", "json")).rejects.toThrow("response_too_large");
  await expect(fetchFundamental("https://api.bls.gov/test", "json")).rejects.toThrow("http_403");
});
it.each(["120", "Thu, 19 Nov 2026 07:02:00 GMT"])("honours Retry-After %s without another HTTP attempt", async retry => {
  const { fetchFundamental } = await import("./fundamentals-source");
  const mock = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": retry } }));
  vi.stubGlobal("fetch", mock);
  await expect(fetchFundamental("https://api.bls.gov/test", "json")).rejects.toThrow("http_429");
  vi.advanceTimersByTime(90_000);
  await expect(fetchFundamental("https://api.bls.gov/test", "json")).rejects.toThrow("cooldown");
  expect(mock).toHaveBeenCalledTimes(1);
});
it("bounds a hung HTTP request with its abort signal", async () => {
  const { fetchFundamental } = await import("./fundamentals-source");
  vi.stubGlobal("fetch", vi.fn((_: string, init: RequestInit) => {
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return Promise.reject(new DOMException("Timed out", "TimeoutError"));
  }));
  await expect(fetchFundamental("https://api.bls.gov/test", "json")).rejects.toMatchObject({ name: "TimeoutError" });
});
it("uses one report POST for current continued claims and an explicit bounded history range", async () => {
  const { loadFundamental } = await import("./fundamentals-source");
  const mock = vi.fn().mockImplementation(() => Promise.resolve(new Response(fixture("dol-2026.xml"), { headers: { "content-type": "text/xml" } })));
  vi.stubGlobal("fetch", mock);
  const result = await loadFundamental("continuing", false, Date.now());
  expect(result.points.length).toBeGreaterThan(20);
  expect(mock.mock.calls[0][1].body).toBe("level=us&strtdate=2026&enddate=2026&filetype=xml");
  await loadFundamental("continuing", true, Date.now());
  expect(mock.mock.calls[1][1].body).toBe("level=us&strtdate=2024&enddate=2026&filetype=xml");
});
it("shares BEA discovery and the latest document across income and spending; no history before requested", async () => {
  const { loadFundamental } = await import("./fundamentals-source");
  const mock = vi.fn((url: string) => Promise.resolve(new Response(
    url.includes("rss") ? '<rss><item><title>Personal Income and Outlays, September 2026</title><link>https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026</link><pubDate>Thu, 29 Oct 2026 08:30:00 EDT</pubDate></item></rss>'
      : fixture("bea-september.html"), { headers: { "content-type": url.includes("rss") ? "application/xml" : "text/html" } })));
  vi.stubGlobal("fetch", mock);
  const [income, consumption] = await Promise.all([loadFundamental("income", false, Date.now()), loadFundamental("consumption", false, Date.now())]);
  expect(mock).toHaveBeenCalledTimes(2);
  expect(income.points[0].value).toBe(0.2);
  expect(consumption.points[0].value).toBe(0.5);
  expect(consumption.retrievedAt).toBe("2026-11-19T07:00:00.000Z");
});
