/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseContinuing, parseEmployment, parsePersonal, parseProduction, parseRetail } from "./fundamentals-parsers";
import { orderedObservations, previousMonth } from "./fundamentals-data";
import { parsePceRelease } from "./bea-pce";

const fixture = (name: string) => readFileSync(new URL("./fixtures/fundamentals/" + name, import.meta.url), "utf8").replace(/^\uFEFF/, "");
const september = { period: "2026-09", publishedAt: "2026-10-29T12:30:00.000Z",
  url: "https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026" };
const july = { period: "2026-07", publishedAt: "2026-08-26T12:30:00.000Z",
  url: "https://www.bea.gov/news/2026/personal-income-and-outlays-july-2026" };

describe("real official fundamentals responses", () => {
  it("keeps hourly dollar levels separate from percentage growth and unemployment", () => {
    const earnings = parseEmployment(JSON.parse(fixture("bls-earnings.json")), "earnings");
    expect(earnings[0]).toMatchObject({ period: "2026-10", value: 38, previous: 37.86, publishedAt: null, stage: "preliminary", vintage: "current" });
    const unemployment = parseEmployment(JSON.parse(fixture("bls-unemployment.json")), "unemployment");
    expect(unemployment[0]).toMatchObject({ period: "2026-10", value: 4.1, previous: 4.2 });
    expect(() => parseEmployment(JSON.parse(fixture("bls-earnings.json")), "unemployment")).toThrow("bls_response");
  });
  it("does not bridge missing months or accept annual averages and blank values", () => {
    const json = JSON.parse(fixture("bls-earnings.json"));
    json.Results.series[0].data = [{ year: "2026", period: "M10", value: "38.00" }, { year: "2026", period: "M08", value: "37.76" },
      { year: "2026", period: "M13", value: "37.00" }];
    expect(parseEmployment(json, "earnings")).toHaveLength(2);
    expect(parseEmployment(json, "earnings")[0].previous).toBeNull();
    json.Results.series[0].data[0].value = "";
    expect(() => parseEmployment(json, "earnings")).toThrow("invalid_number");
    expect(() => parseEmployment({ status: "REQUEST_FAILED" }, "earnings")).toThrow("bls_response");
  });
  it("uses continued SA claims, excludes initial/NSA counts and keeps exact prior weeks", () => {
    const points = parseContinuing(fixture("dol-2026.xml"));
    expect(points[0]).toMatchObject({ period: "2026-01-03", value: 1875000, previous: null, publishedAt: null, stage: "current" });
    expect(points[1]).toMatchObject({ period: "2026-01-10", value: 1865000, previous: 1875000 });
    expect(points[0].vintage).toBe("2026-11-19");
    expect(() => parseContinuing(fixture("dol-2026.xml").replace("r539cyNational", "r539cyState"))).toThrow("dol_report_unverified");
  });
  it("reads income and nominal consumption from exact rows in one dated release", () => {
    const html = fixture("bea-september.html");
    expect(parsePersonal(html, september, "income")).toMatchObject({ value: 0.2, previous: 0.3, vintage: "BEA 26-46", stage: "initial" });
    expect(parsePersonal(html, september, "consumption")).toMatchObject({ value: 0.5, previous: 0.9, period: "2026-09" });
    expect(parsePersonal(fixture("bea-july.html"), july, "consumption")).toMatchObject({ value: 0.2, previous: 0.3 });
    expect(parsePersonal(html.replace(/From the preceding month[\s\S]*?from one year ago\./, ""),
      september, "income").value).toBe(0.2);
    expect(() => parsePersonal(html, { ...september, period: "2026-08" }, "income")).toThrow("pce_vintage_unverified");
    expect(() => parsePersonal(html.replace(">August<", ">July<"), september, "income")).toThrow("bea_columns_unverified");
    expect(() => parsePersonal(html.replace("Current-dollar personal income", "Different series"), september, "income")).toThrow("ambiguous_row");
  });
  it("confirms July core PCE 0.2 in BEA 26-39; the 0.0 cell belongs to real consumption", () => {
    const html = fixture("bea-july.html");
    expect(parsePceRelease(html, july).values).toEqual([0.2, 3.7, 0.2, 3.3]);
    expect(html).toMatch(/Real PCE<\/td>[\s\S]*?>0\.0<\/td>/);
    expect(html).toMatch(/PCE price index excluding food and energy<\/td>[\s\S]*?>0\.2<\/td>/);
  });
  it("keeps all G.17 monthly changes in the November vintage, including revisions", () => {
    const points = parseProduction(fixture("fed-november.html"));
    expect(points).toHaveLength(6);
    expect(points[0]).toMatchObject({ period: "2026-10", value: -0.4, previous: 0.7, vintage: "2026-11-17", stage: "preliminary" });
    expect(points[1]).toMatchObject({ period: "2026-09", value: 0.7, previous: -0.1, stage: "revised" });
    expect(points.at(-1)).toMatchObject({ period: "2026-05", value: 0.1, previous: null });
    expect(() => parseProduction(fixture("fed-november.html").replace("in October after", "in September after"))).toThrow("fed_period_unverified");
    expect(() => parseProduction(fixture("fed-november.html").replace("Total&nbsp;index", "Other index"))).toThrow("fed_table_unverified");
  });
});

// Exact Census HTML wording from CB26-181. Live server access currently returns HTTP 403.
const retail = '<p>FOR IMMEDIATE RELEASE: Tuesday, November 17, 2026 CB26-181</p>' +
  '<p>Advance estimates of U.S. retail and food services sales for October 2026, adjusted for seasonal variation and holiday and trading-day differences, but not for price changes, were $748.2 billion, up 0.2 percent (±0.4 percent)* from the previous month.</p>' +
  '<p>The August 2026 to September 2026 percent change was unrevised from up 0.8 percent (±0.2 percent).</p>';
it("recognises only published Census changes with confirmed release period and seasonal definition", () => {
  expect(parseRetail(retail)[0]).toMatchObject({ period: "2026-10", value: 0.2, previous: 0.8, vintage: "CB26-181", publishedAt: "2026-11-17" });
  expect(() => parseRetail(retail.replace("October 2026,", "September 2026,"))).toThrow("census_period_unverified");
  expect(() => parseRetail(retail.replace("adjusted for seasonal", "not adjusted for seasonal"))).toThrow("census_release_unverified");
  expect(parseRetail(retail.split("<p>The August")[0])[0].previous).toBeNull();
});
it("rejects future or contradictory periods, deduplicates identical entries and keeps real zero", () => {
  const point = parsePersonal(fixture("bea-september.html"), september, "income");
  expect(orderedObservations([point, point], Date.parse("2026-11-19"))).toHaveLength(1);
  expect(() => orderedObservations([point, { ...point, value: 1 }], Date.parse("2026-11-19"))).toThrow("conflicting_period");
  expect(() => orderedObservations([point], Date.parse("2026-10-29T12:29Z"))).toThrow("unverified_observation");
  expect(() => orderedObservations([{ ...point, period: "2026-02-31" }], Date.parse("2026-11-19"))).toThrow("unverified_observation");
  expect(orderedObservations([{ ...point, value: 0, previous: 0 }], Date.parse("2026-11-19"))[0].value).toBe(0);
  expect(previousMonth("2026-01")).toBe("2025-12");
});
