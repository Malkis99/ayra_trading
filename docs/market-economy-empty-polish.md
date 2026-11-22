# Economy: compact empty states and card flow

UI-only follow-up to PR #207. API, source data, parsers, freshness, caches, calendar, SQL, cron and production settings are unchanged.

## Changes

- Empty CPI/Core CPI cards retain title, units and visible status in a compact layout. Empty calendar/fundamentals cards omit redundant metadata rows. Debt/GDP is a compact native disclosure: its unavailable status remains visible, the definition and reason remain in Details.
- Calendar, fundamentals, Treasury and monetary history use text-only fallbacks when fewer than two comparable observations are available. Current main already had a text-only fallback for GDP/NFP/Initial Claims; no large placeholder was reproduced there. Regression coverage now measures the fallback and excludes chart SVGs. Treasury/monetary charts also require distinct observation dates. A failed monetary history request cannot substitute a chart of latest observations.
- The Treasury-yields card spans two desktop grid rows, allowing USD directly below Fed policy. DOM order and mobile order remain policy, yields, dollar. Cards align at the top without stretching to neighbours.

## Evidence

Screenshots use deterministic test fixtures, not production observations. Before is the unchanged PR #207 build; after uses the same fixtures. Both locales have growth, labor, inflation and monetary captures at 390 and 1440 px in [empty-polish](screens/market-economy/empty-polish/).

| Measurement | Before | After |
| --- | ---: | ---: |
| Empty CPI card, desktop | 110 px | 70.5 px |
| Empty CPI card, mobile | 102 px | 70.5 px |
| Desktop Fed-to-USD gap | 104 px | 12 px |

- [Desktop before](screens/market-economy/empty-polish/before-1440-en-monetary.png) / [after](screens/market-economy/empty-polish/after-1440-en-monetary.png)
- [Mobile inflation before](screens/market-economy/empty-polish/before-390-ru-inflation.png) / [after](screens/market-economy/empty-polish/after-390-ru-inflation.png)
- [Mobile growth before](screens/market-economy/empty-polish/before-390-ru-growth.png) / [after](screens/market-economy/empty-polish/after-390-ru-growth.png)

## Verification

The targeted fake-Supabase suite covers 34 scenarios, including RU/EN at 360/390/768/1024/1440 px, no horizontal overflow, one-point histories, unavailable CPI, compact Debt/GDP, keyboard Enter/Space on native disclosures, independent error states and the existing economy regression suites. Local run passed. TypeScript, lint, build and chart unit tests were also checked; full required CI is reported in the PR.

The previously documented unrelated Journal E2E instability is not fixed or changed here: `e2e-supabase/journal-day-in-life.spec.ts:205:84`, expected `["NAS100","USDJPY"]`, received `["GBPUSDUSDJPY","NAS100"]`, `Timeout 30000ms exceeded while waiting on the predicate`.
