import { expect, test } from "vitest";
import { economyHistory, projectEconomy, type EconomyCalendarRow } from "./project-calendar";

const starts = "2026-10-29T12:30:00Z";
const now = Date.parse("2026-11-16");
const gdp: EconomyCalendarRow = {
  id: "bea:us_gdp:2026-10-29", source: "bea", country: "us", code: "us_gdp", kind: "release", status: "released",
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
  const nfp: EconomyCalendarRow = { ...gdp, id: "bls:us_nfp:2026-11-06", code: "us_nfp", source: "bls",
    starts_at: "2026-11-06T13:35:00Z",
    actual: "+165K · 4.1%", previous: "4.2%", reference_period: "2026-10", release_stage: "regular",
    result_meta: { period: "2026-10", series: "us_nfp", unit: "thousand-change-and-percent", adjustment: "SA" } };
  expect(projectEconomy([nfp], now).us_nfp[0]).toMatchObject({
    actual: 165, unemployment: 4.1, previous: null, scheduledAt: "2026-11-06T13:35:00Z", releasedAt: "2026-11-06T13:30:00Z",
    sourceUpdatedAt: null, retrievedAt: null, sourceKind: "release",
    sourceUrl: "https://www.bls.gov/news.release/archives/empsit_11062026.htm",
  });
  expect(projectEconomy([{ ...nfp, id: "bls:unreviewed" }], now).us_nfp[0]).toMatchObject({
    releasedAt: null, sourceKind: "archive", sourceUrl: "https://www.bls.gov/bls/news-release/empsit.htm",
  });
  expect(projectEconomy([{ ...nfp, actual: "+165K" }], now).us_nfp[0].unemployment).toBeUndefined();
});

test("only reviewed release identities receive a dated URL and official time", () => {
  const row = { ...gdp, url: "https://untrusted.example", result_meta: { ...gdp.result_meta!, release_url: "https://untrusted.example" } };
  expect(projectEconomy([row], now).us_gdp[0]).toMatchObject({
    scheduledAt: starts, releasedAt: starts, sourceUpdatedAt: null, retrievedAt: null, sourceKind: "release",
    sourceUrl: "https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026",
  });
  expect(projectEconomy([{ ...row, release_stage: "second" }], now).us_gdp[0]).toMatchObject({
    scheduledAt: starts, releasedAt: null, sourceUpdatedAt: null, retrievedAt: null,
    sourceKind: "archive", sourceUrl: "https://www.bea.gov/news/archive",
  });
});

test("skips claims revisions as original observations and keeps GDP stages apart", () => {
  const claims: EconomyCalendarRow = { ...gdp, source: "dol", code: "us_jobless_claims",
    actual: "200K", previous: null, reference_period: "2026-11-07", release_stage: "regular",
    result_meta: { period: "2026-11-07", series: "initial-claims", unit: "thousand", adjustment: "SA", source_updated: "2026-11-12T13:30:00Z" } };
  expect(projectEconomy([claims], now).us_jobless_claims).toEqual([]);
  expect(projectEconomy([{ ...claims, id: "dol:us_jobless_claims:2026-11-12", starts_at: "2026-11-12T13:30:00Z" }], now)
    .us_jobless_claims[0]).toMatchObject({
    sourceKind: "release", sourceUrl: "https://oui.doleta.gov/press/2026/111226.pdf",
    releasedAt: "2026-11-12T13:30:00Z", sourceUpdatedAt: null, retrievedAt: null,
  });
  const rows = projectEconomy([gdp, { ...gdp, id: "bea:second", release_stage: "second" }], now).us_gdp;
  expect(rows).toHaveLength(2);
  expect(economyHistory(rows, "advance", "max", now)).toHaveLength(1);
});
