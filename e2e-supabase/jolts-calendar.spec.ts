import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import { joltsResults, parseJoltsRelease, JOLTS_TITLE } from "../lib/market/feeds/jolts";

for (const width of [360, 1440]) {
  test(`JOLTS initial fact and reported previous in the official calendar at ${width}px`, async ({browser, request}) => {
    const id = "bls:us_jolts:2026-11-03";
    const release = parseJoltsRelease(readFileSync("lib/market/feeds/fixtures/jolts-2026-11-03.html", "utf8"), "2026-11-03");
    const [result] = joltsResults([{id, code: "us_jolts", reference_period: release.period}], release);
    const seed = await request.post("http://127.0.0.1:54329/__test/market-events", {data: [{
      ...result, source: "bls", code: "us_jolts", country: "us", kind: "release", title: JOLTS_TITLE,
      importance: 2, starts_at: release.published, time_tbd: false, hidden: false, updated_at: release.published,
    }]});
    expect(seed.ok()).toBe(true);
    const {page} = await marketGuest(browser, width);
    await page.addInitScript(() => localStorage.setItem("ayra_guest_dismissed", "1"));
    const now = new Date("2026-11-03T16:00Z");
    await page.clock.install({time: now});
    await page.clock.pauseAt(now);
    await page.goto("/market?tab=calendar&view=own");
    const row = page.locator('[data-testid="own-calendar-event"][data-id="' + id + '"]');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("own-calendar-event-actual")).toHaveText("7.523M");
    await expect(row.getByTestId("own-calendar-event-previous")).toHaveText("7.190M");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.close();
  });
}
