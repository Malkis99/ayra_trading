import { expect, it } from "vitest";
import { projectInflation } from "./project-inflation";
import type { EconomyCalendarRow } from "./project-calendar";

const releasedAt = "2026-11-10T13:30:00Z";
const sourceUrl = "https://www.bls.gov/news.release/archives/cpi_11102026.htm";
const now = Date.parse("2026-11-16");
const cpi: EconomyCalendarRow = {
  id: "bls:us_cpi:2026-11-10", code: "us_cpi", country: "us", source: "bls", status: "released",
  kind: "release", hidden: false, time_tbd: false, starts_at: releasedAt, reference_period: "2026-10",
  release_stage: "regular", actual: "+0.4%", previous: null,
  result_meta: { period: "2026-10", series: "CUSR0000SA0", unit: "percent-mom", adjustment: "SA",
    source_updated: releasedAt, release_url: sourceUrl, vintage: "release" },
};

it("uses the release's figures and provenance, leaving missing annual observations empty", () => {
  const core = { ...cpi, code: "us_core_cpi", actual: "+0.3%",
    result_meta: { ...cpi.result_meta!, series: "CUSR0000SA0L1E" } };
  const cpiYoy = { ...cpi, code: "us_cpi_yoy", actual: null, result_meta: {
    ...cpi.result_meta!, series: "CUUR0000SA0", unit: "percent-yoy", adjustment: "NSA",
  } };
  const result = projectInflation([cpi, core, cpiYoy], now);
  expect(result.us_cpi).toEqual([{ period: "2026-10", actual: 0.4, previous: null, releasedAt, sourceUrl }]);
  expect(result.us_core_cpi[0].actual).toBe(0.3);
  expect(result.us_cpi_yoy).toEqual([]);
  expect(result.us_core_cpi_yoy).toEqual([]);
});

it("excludes incompatible periods, adjustments, sources, dates, and ambiguous duplicates", () => {
  const bad = [
    { ...cpi, reference_period: "2026-09" },
    { ...cpi, result_meta: { ...cpi.result_meta!, adjustment: "NSA" } },
    { ...cpi, result_meta: { ...cpi.result_meta!, release_url: "https://www.bls.gov/news.release/archives/cpi_10142026.htm" } },
    { ...cpi, result_meta: { ...cpi.result_meta!, release_url: "https://example.com/cpi_11102026.htm" } },
    { ...cpi, result_meta: null },
  ];
  expect(projectInflation(bad, now).us_cpi).toEqual([]);
  expect(projectInflation([cpi], Date.parse("2026-11-09")).us_cpi).toEqual([]);
  expect(projectInflation([cpi, { ...cpi, id: "duplicate", actual: "+0.5%" }], now).us_cpi).toEqual([]);
});
