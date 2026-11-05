import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCensus } from "./census-fetch";
import { censusLatest, censusResult, censusUrl, parseCensus } from "./census";
import { collectFeeds, type Fetcher } from "./collect";
import { listedEvents } from "./schedules";
import { memoryFeedsDb } from "./memory-db";

const head = ["cell_value", "data_type_code", "category_code", "seasonally_adj", "time", "us"];
// Synthetic schema fixtures, deliberately not described as a successful live Census response.
const table = [head, ["0", "MPCSM", "44X72", "yes", "2026-10", "1"], ["-0.2", "MPCSM", "44X72", "yes", "2026-09", "1"]];
const url = censusUrl("us_retail_sales", "2026-10");
const key = "DO-NOT-LOG-THIS";
const response = (body: string, status = 200, type = "application/json") => ({ ok: status >= 200 && status < 300, status, headers: { get: (n: string) => n === "content-type" ? type : null }, text: async () => body });

afterEach(() => { vi.useRealTimers(); });

describe("Census credential-safe transport", () => {
  it("does not send an unauthenticated data request", async () => {
    const fetcher = vi.fn();
    await expect(fetchCensus(fetcher, url, undefined, "us_retail_sales")).rejects.toThrow("CENSUS_API_KEY is not set; no request sent");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the official query, bounded reference period, key, JSON accept and manual redirects", async () => {
    const fetcher = vi.fn(async () => response(JSON.stringify(table)));
    expect(await fetchCensus(fetcher, url, key, "us_retail_sales")).toEqual(table);
    const call = fetcher.mock.calls[0] as unknown as Parameters<Fetcher>;
    expect(new URL(call[0]).searchParams.get("key")).toBe(key);
    expect(new URL(call[0]).searchParams.get("time")).toBe("from 2026-07 to 2026-10");
    expect(call[1]).toMatchObject({ redirect: "manual", headers: { Accept: "application/json" } });
  });
  it.each([
    [200, "<html>Missing Key: a valid key must be included</html>", "missing API key page"],
    [200, "<html>Invalid Key</html>", "invalid API key page"],
    [403, "<!DOCTYPE html><html>Cloudflare: you have been blocked</html>", "access blocked HTML"],
    [200, "<html>Maintenance</html>", "unexpected HTML"],
    [429, "Too many requests", "rate limited"],
    [503, "Service unavailable", "request failed"],
    [200, "not JSON", "invalid JSON"],
    [200, '{"error":"bad query"}', "unexpected table schema"],
    [200, '[["cell_value"],["42"]]', "unexpected table schema"],
    [302, "redirect", "redirect refused"],
  ])("classifies HTTP %s without recording a body or credential", async (status, body, expected) => {
    const fetcher: Fetcher = async () => response(`${body}${body.startsWith("<") ? key : ""}`, status, body.startsWith("<") ? "text/html" : "application/json");
    const error = await fetchCensus(fetcher, url, key, "us_retail_sales").catch((e: Error) => e.message);
    expect(error).toContain(expected);
    expect(error).toContain(`HTTP ${status}`);
    expect(error).not.toContain(key);
    expect(error).not.toContain("https://");
  });
  it("redacts network failures which may contain a full credential-bearing URL", async () => {
    await expect(fetchCensus(async (u) => { throw new Error(u); }, url, key, "us_retail_sales")).rejects.toThrow(/^Census API us_retail_sales: network or response read failed$/);
  });
  it("aborts a hanging body read, not just the response headers", async () => {
    vi.useFakeTimers();
    const fetcher: Fetcher = async (_u, init) => ({ ...response(""), text: () => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error(key)))) });
    const result = fetchCensus(fetcher, url, key, "us_retail_sales").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toBe("Census API us_retail_sales: timeout");
  });
});

describe("Census values and collector isolation", () => {
  it("preserves an actual zero and the prior reference month, never the latest unrelated month", () => {
    const data = parseCensus([...table, ["99", "MPCSM", "44X72", "yes", "2026-11", "1"], ["(S)", "MPCSM", "44X72", "yes", "2026-08", "1"]], "44X72");
    expect(censusResult("census:us_retail_sales:2026-11-17", data)).toMatchObject({ actual: "+0.0%", previous: "−0.2%" });
    expect(censusLatest("us_retail_sales", "2026-10", data)).toBe("−0.2%");
    expect(data.get("MPCSM")?.has("2026-08")).toBe(false);
    expect(censusResult("census:us_retail_sales:2026-11-17", parseCensus([head], "44X72"))).toBeNull();
  });
  it("does not accept a table lacking seasonal adjustment", () => {
    expect(parseCensus([["cell_value", "data_type_code", "category_code", "time"], ["12", "MPCSM", "44X72", "2026-10"]], "44X72").size).toBe(0);
  });
  it("logs a Census HTML failure, keeps stored values and still runs a later source", async () => {
    const { db, events, runs } = memoryFeedsDb({ events: listedEvents() });
    const before = { ...events.get("census:us_retail_sales:2026-11-17") };
    const fetcher: Fetcher = async (u) => u.startsWith("https://api.census.gov/") ? response(`<html>Missing Key ${key}</html>`, 200, "text/html") : response("", 503);
    const result = await collectFeeds({ scope: "releases", now: Date.UTC(2026, 10, 17, 13, 45), fetch: fetcher, db, censusKey: key });
    expect(result.results.find((r) => r.source === "census-api")).toMatchObject({ ok: false });
    expect(result.results.find((r) => r.source === "dol-claims")).toBeDefined();
    expect(events.get("census:us_retail_sales:2026-11-17")).toEqual(before);
    expect(JSON.stringify(runs)).not.toContain(key);
  });
});
