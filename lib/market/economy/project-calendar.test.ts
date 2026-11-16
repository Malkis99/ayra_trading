import { expect, test } from "vitest";
import { economyHistory, projectEconomy, type EconomyCalendarRow } from "./project-calendar";

const starts = "2026-10-29T12:30:00Z";
const now = Date.parse("2026-11-16");
const gdp: EconomyCalendarRow = {
  id: "bea:gdp", source: "bea", country: "us", code: "us_gdp", kind: "release", status: "released",
  hidden: false, time_tbd: false, actual: "+3.4%", previous: "+2.2%", starts_at: starts,
  reference_period: "2026-Q3", release_stage: "advance",
  result_meta: { series: "us_gdp", period: "2026-Q3", unit: "percent", adjustment: "official-release", source_updated: starts },
};

test("projects one exact GDP release and rejects ambiguous, future and incompatible facts", () => {
  expect(projectEconomy([gdp], now).us_gdp[0]).toMatchObject({ actual: 3.4, previous: 2.2, period: "2026-Q3" });
  expect(projectEconomy([gdp, { ...gdp, id: "duplicate" }], now).us_gdp).toEqual([]);
  expect(projectEconomy([{ ...gdp, result_meta: null }, { ...gdp, reference_period: "2025-Q1" }], now).us_gdp).toEqual([]);
  expect(projectEconomy([gdp], Date.parse("2026-10-01")).us_gdp).toEqual([]);
  expect(projectEconomy([{ ...gdp, previous: "unavailable" }], now).us_gdp[0].previous).toBeNull();
});

test("keeps payrolls separate from unemployment and leaves the upstream update unknown", () => {
  const nfp: EconomyCalendarRow = { ...gdp, id: "bls:nfp", code: "us_nfp", source: "bls",
    actual: "+165K · 4.1%", previous: "4.2%", reference_period: "2026-10", release_stage: "regular",
    result_meta: { period: "2026-10", series: "us_nfp", unit: "thousand-change-and-percent", adjustment: "SA" } };
  expect(projectEconomy([nfp], now).us_nfp[0]).toMatchObject({ actual: 165, previous: null, confirmedAt: null });
});

test("skips claims revisions as original observations and keeps GDP stages apart", () => {
  const claims: EconomyCalendarRow = { ...gdp, source: "dol", code: "us_jobless_claims",
    actual: "200K", previous: null, reference_period: "2026-11-07", release_stage: "regular",
    result_meta: { period: "2026-11-07", series: "initial-claims", unit: "thousand", adjustment: "SA", source_updated: "2026-11-12T13:30:00Z" } };
  expect(projectEconomy([claims], now).us_jobless_claims).toEqual([]);
  const rows = projectEconomy([gdp, { ...gdp, id: "bea:second", release_stage: "second" }], now).us_gdp;
  expect(rows).toHaveLength(2);
  expect(economyHistory(rows, "advance", "max", now)).toHaveLength(1);
});
