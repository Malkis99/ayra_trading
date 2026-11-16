import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { cents, fiscalRange, formatUsd, type FiscalSeries } from "./fiscal-data";
import { loadTreasury, normalizeTreasury, TreasuryThrottle } from "./treasury";

function rows(series: FiscalSeries) {
  return JSON.parse(readFileSync(`lib/market/economy/fixtures/treasury-${series}.json`, "utf8")).data as Record<string, unknown>[];
}

describe("Treasury data", () => {
  test("preserves exact cents and displays billions and trillions", () => {
    const debt = normalizeTreasury("debt", rows("debt"));
    expect(debt.at(-1)?.values).toEqual(["4060850685690325", "3282438614342480", "778412071347845"]);
    expect(formatUsd(debt.at(-1)!.values[0]!, "en")).toBe("40.61 T USD");
    expect(formatUsd(String(cents("-404063547877.59")), "ru")).toBe("−404,06 млрд USD");
    expect(() => normalizeTreasury("debt", [{ ...rows("debt")[0], intragov_hold_amt: "1" }])).toThrow("reconciliation failure");
    const early = { record_date: "1993-04-01", tot_pub_debt_out_amt: "4225873987843.44",
      debt_held_public_amt: "null", intragov_hold_amt: "null" };
    expect(normalizeTreasury("debt", [early, ...rows("debt")])[0].values).toEqual(["422587398784344", null, null]);
    expect(() => normalizeTreasury("debt", [early])).toThrow("Incomplete latest");
    expect(() => cents("null")).toThrow("Invalid Treasury amount");
  });

  test("takes the official monthly and FYTD rows from their own fiscal year", () => {
    const points = normalizeTreasury("budget", rows("budget"));
    const latest = points.at(-1)!;
    expect(latest).toMatchObject({ date: "2026-10-31", fiscalYear: 2027,
      values: ["36894011860277", "77300366648036", "-40406354787759"] });
    expect(latest.ytd).toEqual(latest.values);
    const monthly = rows("budget").find(row => row.current_month_dfct_sur_amt === "404063547877.59" && row.record_type_cd === "MTH");
    expect(monthly).toBeDefined();
    const broken = rows("budget").filter(row => row.classification_id !== monthly!.classification_id);
    expect(() => normalizeTreasury("budget", broken)).toThrow("Missing or duplicate");
    const surplus = rows("budget").map(row => row.classification_id === monthly!.classification_id
      ? { ...row, current_month_gross_rcpt_amt: "900.00", current_month_gross_outly_amt: "800.00", current_month_dfct_sur_amt: "-100.00" } : row);
    expect(normalizeTreasury("budget", surplus).at(-1)?.values[2]).toBe("10000");
  });

  test("sums only verified interest detail rows and rejects a partial breakdown", () => {
    const all = rows("interest");
    const result = normalizeTreasury("interest", all);
    expect(result).toHaveLength(2);
    expect(result[1].values).toEqual(result[1].ytd);
    expect(BigInt(result[1].values[0]!)).toBeGreaterThan(BigInt(0));
    expect(() => normalizeTreasury("interest", all.filter(row => row.src_line_nbr !== "2"))).toThrow("interest breakdown");
  });

  test("uses actual observations and ends ranges on the last available date", () => {
    const points = [{ date: "2024-02-29", values: ["1"] }, { date: "2025-02-28", values: ["2"] }, { date: "2026-02-28", values: ["3"] }];
    expect(fiscalRange(points, "1")).toEqual(points.slice(1));
    expect(fiscalRange(points, "max")).toEqual(points);
  });

  test("handles empty, rate-limited and HTML responses", async () => {
    const request = vi.fn<Parameters<typeof fetch>, Promise<Response>>();
    request.mockResolvedValueOnce(Response.json({ data: [], meta: { count: 0, "total-count": 0, "total-pages": 0 } }));
    expect(await loadTreasury("debt", "2026-11-16", request)).toEqual([]);
    request.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    await expect(loadTreasury("debt", "2026-11-16", request)).rejects.toBeInstanceOf(TreasuryThrottle);
    request.mockResolvedValueOnce(new Response("<html>unavailable</html>", { headers: { "Content-Type": "text/html" } }));
    await expect(loadTreasury("debt", "2026-11-16", request)).rejects.toThrow("response unavailable");
  });

  test("fetches the next bounded page and rejects a changed total", async () => {
    const day = Date.parse("2000-01-01");
    const [sample] = rows("debt");
    const data = Array.from({ length: 3001 }, (_, i) => ({ ...sample, record_date: new Date(day + i * 86_400_000).toISOString().slice(0, 10) }));
    const request = vi.fn<Parameters<typeof fetch>, Promise<Response>>();
    const page = (data: unknown[], total: number) => Response.json({ data, meta: { count: data.length, "total-count": total, "total-pages": 2 } });
    request.mockResolvedValueOnce(page(data.slice(0, 3000), 3001)).mockResolvedValueOnce(page(data.slice(3000), 3001));
    expect(await loadTreasury("debt", "2026-11-16", request)).toHaveLength(3001);
    expect(new URL(String(request.mock.calls[1][0])).searchParams.get("page[number]")).toBe("2");
    request.mockResolvedValueOnce(page(data.slice(0, 3000), 3001)).mockResolvedValueOnce(page(data.slice(2999), 3002));
    await expect(loadTreasury("debt", "2026-11-16", request)).rejects.toThrow("pagination changed");
  });
});
