# Economy: independent card columns and useful history

UI-only follow-up to #208, based on main `80e99a4464149fa46db4c2d6b74d9bd63ed02e06`.

## Layout

`EconomyColumns` renders two ordinary, independent stacks from contiguous children. It uses no experimental masonry, measurements, CSS ordering, duplicated cards or viewport-dependent React tree. Desktop reading order is down the left column, then the right; mobile and keyboard/screen-reader order are identical. Resizing does not move or remount card components.

- Growth: GDP and Debt/GDP in the first stack, industrial production in the second. Expanding industrial production cannot move Debt/GDP.
- Public finances: debt and debt service in the first stack, budget in the second. Budget Details/History cannot introduce a row-height gap before debt service.
- Monetary: Fed policy and USD in the first stack, yields in the second. Expanding yield history cannot push USD down. This replaces the previous row-span workaround, which still shared grid tracks.
- Labor and income/consumption use the same independent stack pattern.

Only actual content determines card height. A shorter column can naturally end before its neighbour; there are no shared rows or reserved spaces between cards within either stack.

## History

- GDP, NFP and Initial Claims omit the entire History disclosure when fewer than two comparable observations exist in the already loaded data. They retain History, chart and observation list when comparable periods are available. Stage filtering and the existing 90-day read window are unchanged.
- On-demand history remains available for fundamentals, Treasury, monetary and PCE. One monetary/Treasury observation is a real dated list entry, not an empty chart fallback. Fundamentals retain their existing observation list when no compatible chart is possible.
- Empty on-demand results do not leave empty chart messages; loading/retry controls remain functional. Errors and stale warnings are not concealed.

No source, API, parser, server cache, freshness, SQL, Supabase, cron, UK-3C or game changes.

## Screenshots and tests

[Before/after captures](screens/market-economy/layout-flow/) cover Growth, Public Finances and Monetary, with Details and available history opened, at 390/1440 px in RU/EN. They use the same deterministic fixtures before and after, not production data.

`market-economy-flow.spec.ts` covers RU/EN at 360/390/768/1024/1440 px, independent expansion in both columns, exact 12 px stack gaps, native Enter/Space, unchanged DOM order across resizing, retained on-demand history and comparable calendar history. Existing compact/empty/economy/fundamentals/monetary/fiscal suites provide regression coverage. Final CI results are linked in the PR.

### Failures during test authoring

- Baseline command: `AYRA_ECO_FLOW_BASELINE=1 AYRA_ECO_FLOW_SCREENSHOTS=docs/screens/market-economy/layout-flow SKIP_BUILD=1 npx playwright test -c playwright.supabase.config.ts e2e-supabase/market-economy-flow.spec.ts --grep '390|1440'` (PowerShell environment assignments). Four `independent economy columns` cases initially failed: `expect(locator).toBeVisible() failed`, GDP `/3[,.]4%/`, `Timeout: 5000ms`, `Error: element(s) not found`. The fixture omitted required `source_updated`; adding fixture provenance fixed the baseline (4/4). No application validation was relaxed.
- First targeted run: six desktop `independent economy columns` cases failed `expect(received).toBeCloseTo(expected, precision)`, expected/received `2065/204` (768 RU), `2009/224` (768 EN), `1933/280` (1024 and 1440 RU/EN). Focus scrolled main, invalidating viewport-based comparisons. Measurements now use section-local coordinates. A subsequent 768 RU failure `Expected: 134, Received: 162` exposed responsive shell reflow above the section; measuring within the column pair also isolates that correctly, without sleeps or relaxed limits.
- `calendar history is retained for comparable periods, not different GDP stages` initially failed `Test timeout of 30000ms exceeded`: the older GDP fixture lay outside the unchanged 90-day read window. The positive history case now uses two monthly NFP releases inside that window, while the different-stage GDP exclusion remains tested.
- The corrected new suite passed twice (22/22) before final column grouping; the final regression and complete CI are reported in the PR. No timeouts were raised, force-clicks or test skips added.

Previously documented Journal E2E instability is outside this task and is not claimed fixed: `e2e-supabase/journal-day-in-life.spec.ts:205:84`, expected `["NAS100","USDJPY"]`, received `["GBPUSDUSDJPY","NAS100"]`, `Timeout 30000ms exceeded while waiting on the predicate`.
