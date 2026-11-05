/** Explicit attestations from official publications, not inferred release-date offsets. No network requests here.
 * Add entries only after checking the official release's region, period, units and stage.
 * Unverified future periods stay absent; UID carries an adopted attestation across rescheduling.
 */
export const EUROSTAT_PERIODS: Readonly<Record<string, { period: string; evidence: string }>> = {
  "eu_unemployment:2026-10-30": {
    period: "2026-09",
    evidence: "https://ec.europa.eu/eurostat/en/web/products-euro-indicators/w/3-30102026-bp",
  },
};
