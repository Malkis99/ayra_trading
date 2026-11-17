import { describe, expect, it } from "vitest";
import { parsePceRelease, pceReleases } from "./bea-pce";

const release = {
  period: "2026-09",
  url: "https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026",
  publishedAt: "2026-10-29T12:30:00.000Z",
};
const xml = "<rss><item><title>Personal Income and Outlays, September 2026</title><link>" + release.url +
  "</link><pubDate>Thu, 29 Oct 2026 08:30:00 EDT</pubDate></item></rss>";
const html = [
  "<h1>Personal Income and Outlays, September 2026</h1>",
  "<p>EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Thursday, October 29, 2026</p>",
  "<p><a>From the preceding month, the PCE price index for September increased 0.5 percent</a>. Excluding food and energy, the PCE price index increased 0.3 percent.</p>",
  "<p><a>From the same month one year ago, the PCE price index for September increased 3.6 percent</a>. Excluding food and energy, the PCE price index increased 3.1 percent from one year ago.</p>",
].join("\n");

describe("BEA dated PCE releases", () => {
  it("accepts the scheduled release only once the publication time has arrived", () => {
    expect(pceReleases(xml, Date.parse(release.publishedAt))).toEqual([release]);
    expect(pceReleases(xml, Date.parse(release.publishedAt) - 1)).toEqual([]);
    expect(pceReleases(xml.replace("www.bea.gov", "example.test"), Date.parse(release.publishedAt))).toEqual([]);
  });

  it("keeps published headline and core monthly and annual percentages separate", () => {
    expect(parsePceRelease(html, release)).toEqual({ ...release, values: [0.5, 3.6, 0.3, 3.1] });
    expect(parsePceRelease(html.replace("increased 0.5", "decreased 0.5"), release).values[0]).toBe(-0.5);
  });

  it("requires a matching release date and period and rejects ambiguous or revised paragraphs", () => {
    expect(() => parsePceRelease(html, { ...release, period: "2026-08" })).toThrow("pce_vintage_unverified");
    expect(() => parsePceRelease(html, { ...release, publishedAt: "2026-10-29T13:30:00Z" })).toThrow("pce_date_mismatch");
    expect(() => parsePceRelease(html + html, release)).toThrow("pce_change_unverified");
    expect(() => parsePceRelease(html + "<p>Corrected release</p>", release)).toThrow("pce_vintage_unverified");
  });
});
