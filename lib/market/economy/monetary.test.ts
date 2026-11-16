import { afterEach, describe, expect, it, vi } from "vitest";
import { dollarChanges } from "./monetary-data";
import { loadMonetary, parseBroad, parsePolicy, parseYields } from "./monetary";

const today = "2026-11-16";
const treasuryCsv = [
  'Date,"3 Mo","2 Yr","5 Yr","10 Yr","30 Yr"',
  "11/13/2026,4.32,4.88,4.98,5.15,5.47",
  "11/12/2026,4.32,4.86,4.95,5.10,5.43",
].join("\n");
const policyHtml = '<h4>2026</h4><div><table><tr><td>September 17</td><td>25</td><td>0</td><td>3.75-4.00</td></tr></table></div>';

// January 2006 daily values and November 2026 release excerpt from the Board's H.10 series.
const january = [
  101.4155, 100.7558, 100.2288, 100.2992, 100.0241, 100.1794, 100.1436, 99.8710, 100.0643, 99.9675, 99.9715,
  100.2447, 100.4085, 100.1901, 99.9017, 99.3783, 99.3434, 99.3480, 99.4798, 99.6433, 99.7144, 99.4311,
];
const days = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 30, 31];
function broadHtml(scale = 1) {
  return "Nominal Broad Dollar Index - Daily Index\nRelease Date: Monday, November 09, 2026\n"
    + january.map((value, i) => "<tr><th>" + days[i] + "-JAN-06</th><td>" + (value * scale).toFixed(4) + "</td></tr>").join("")
    + "<tr><th>6-NOV-26</th><td>121.8803</td></tr><tr><th>9-NOV-26</th><td>ND</td></tr>"
    + "<tr><th>10-NOV-26</th><td>122.1000</td></tr>";
}

afterEach(() => { vi.restoreAllMocks(); });

describe("official monetary series", () => {
  it("keeps the federal funds target range separate from the effective rate", async () => {
    const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValueOnce(new Response(policyHtml, { headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(Response.json({ refRates: [{ type: "EFFR", effectiveDate: "2026-11-13", percentRate: 3.88 }] }));
    const data = await loadMonetary("policy", false, today, fetcher);
    expect(data.points).toEqual([{ date: "2026-09-17", values: [3.75, 4] }]);
    expect(data.effectiveRate).toEqual({ date: "2026-11-13", values: [3.88] });
    expect(parsePolicy(policyHtml, "2026-09-16")).toEqual([]);
  });

  it("keeps the confirmed target range when the effective rate endpoint fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValueOnce(new Response(policyHtml, { headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const data = await loadMonetary("policy", false, today, fetcher);
    expect(data.points).toHaveLength(1);
    expect(data.effectiveRate).toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"category":"http_503"'));
  });

  it("sorts Treasury observations and computes same-day spreads in whole basis points", () => {
    const data = parseYields(treasuryCsv + "\n11/16/2026,,4.90,,5.20,", today);
    expect(data[0].date).toBe("2026-11-12");
    expect(data[1].values).toEqual([4.32, 4.88, 4.98, 5.15, 5.47, 27, 83]);
    expect(data[2].values).toEqual([null, 4.9, null, 5.2, null, 30, null]);
    expect(parseYields(treasuryCsv, "2026-11-12")).toHaveLength(1);
    expect(() => parseYields(treasuryCsv + "\n11/13/2026,4.32,4.88,4.98,5.16,5.47", today)).toThrow("conflicting_observation");
  });

  it("accepts the reindexed daily Broad H.10 series and rejects incompatible bases", () => {
    const data = parseBroad(broadHtml(), today);
    expect(data.releasedOn).toBe("2026-11-09");
    expect(data.points.at(-1)).toEqual({ date: "2026-11-06", values: [121.8803] });
    expect(() => parseBroad(broadHtml(1 / 1.014163), today)).toThrow("unexpected_h10_base");
    expect(() => parseBroad(broadHtml().replace("Nominal Broad Dollar Index", "Real Broad Dollar Index"), today)).toThrow("unexpected_h10_series");
  });

  it("uses a recent comparable observation at or before each calendar cutoff", () => {
    const change = dollarChanges([
      { date: "2025-11-06", values: [120] },
      { date: "2026-07-28", values: [100] },
      { date: "2026-10-05", values: [120.5] },
      { date: "2026-10-07", values: [140] },
      { date: "2026-11-06", values: [121.8803] },
    ]);
    expect(change[0]).toBeCloseTo(1.14548, 4);
    expect(change[1]).toBeNull();
    expect(change[2]).toBeCloseTo(1.56692, 4);
  });

  it("rejects unexpected HTML in place of Treasury CSV", async () => {
    const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("<html>Unavailable</html>", { headers: { "Content-Type": "text/html" } }));
    await expect(loadMonetary("yields", false, today, fetcher)).rejects.toThrow("content_type");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After across latest and history without retrying the failed GET", async () => {
    const time = vi.spyOn(Date, "now").mockReturnValue(1000);
    const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    await expect(loadMonetary("yields", false, today, fetcher)).rejects.toMatchObject({ message: "http_429", retryAt: 121000 });
    await expect(loadMonetary("yields", true, today, fetcher)).rejects.toThrow("cooldown");
    expect(fetcher).toHaveBeenCalledTimes(1);
    time.mockReturnValue(122000);
    fetcher.mockResolvedValue(new Response(treasuryCsv, { headers: { "Content-Type": "text/csv" } }));
    await expect(loadMonetary("yields", false, today, fetcher)).resolves.toMatchObject({ points: expect.any(Array) });
  });
});
