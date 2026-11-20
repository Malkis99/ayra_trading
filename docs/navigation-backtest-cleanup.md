# Navigation cleanup: Backtest

Owner decision, 2026-11-20: Backtest has one navigation entry, the existing Academy tab. This supersedes the duplicate Market placeholder in the earlier market plan; it does not implement a backtesting tool.

- Market has six tabs. Its Backtest entry, unused placeholder renderer/icons and unreachable `market.soon` translations are removed. Its subtitle no longer advertises Backtest.
- Canonical deep link: `/academy?tab=backtests`, using the existing Academy tab key and unchanged label/content. Courses and Progress retain their existing content.
- `/market?tab=backtest` returns a server-side permanent **308** redirect to the Academy deep link, including without JavaScript. The redirect has a fixed local destination and does not inspect or follow `returnTo`. Other Market tabs are not redirected.
- Academy derives selection from URL parameters; native history is integrated with Next's `useSearchParams`. Clicks append browser history only when the tab changes. Reload, Back/Forward, same-path Next links and locale changes retain the correct selection. Missing or unknown Academy tabs fall back to Courses.
- Academy reuses the existing shared Tabs component for arrow keys, Home/End, roving focus, selected state and tab/panel ARIA links. The shared component and other pages using TabHeader are unchanged.

## Verification

`e2e-supabase/navigation-backtest.spec.ts`: eight scenarios covering RU/EN at 360/390/1440 px, server redirects, direct links, reload, browser history, same-path Next Link navigation, keyboard access, locale changes, unknown tabs and no horizontal overflow. Local run: 8/8 passed. The existing Market sections scenario now asserts six tabs and Watchlist URL persistence in Chromium and WebKit.

[Screenshots](screens/navigation-backtest/) include Market and Academy at 360/1440 px in RU/EN. They use the local test environment. Full CI results are recorded in the Draft PR.

No APIs, sources, market data, Supabase, SQL, cron, secrets, UK-3C, Journal, Quest Hub or game economy changes. No course/progress state is written. No new dependencies, financial figures or placeholders. The Academy placeholder is its original content; the Market placeholder was not moved.

### Local verification setup notes

The supplemental local wrapper for `market-sessions.spec.ts --grep 'six Market'` initially resolved its server command relative to `work`: `Cannot find module 'C:\\Users\\malki\\Documents\\ayra_trading\\work\\e2e\\fake-supabase\\run-app.mjs'`. Setting its working directory fixed startup. Running those mock-auth scenarios against the other suite's fake-Supabase build then failed in both Chromium/WebKit: `Test timeout of 30000ms exceeded`, `locator.click: Target page, context or browser has been closed`, waiting for the Watchlist tab (WebKit also reported `element is not stable` / `element was detached from the DOM, retrying`).

The unchanged scenarios were rerun against their proper, isolated mock-auth production build: **2/2 passed**, Chromium and WebKit. No test waits, timeouts, force-clicks, skips or application behavior were changed to resolve this cross-environment run. The eight new fake-Supabase navigation scenarios passed in their own intended environment. Full CI runs each complete suite in its correct environment.
