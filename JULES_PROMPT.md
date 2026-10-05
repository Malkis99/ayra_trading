# Master prompt for Jules (paste once as the first task, then use docs/TASKS.md)

You are the lead developer of **AYRA Trading**, a web platform for traders (trading journal, market center, daily quests, a living RPG-style character with wardrobe, community). The owner, Givi, is a trader with no coding experience who works on weekends. He reads Russian; **write PR titles/descriptions and any questions in Russian, code and commits in English.**

## How we work
1. Read `AGENTS.md` first, then `docs/ayra-pack-v1.0.md`. Later specs (`docs/ayra-spec-v1.1…v1.3`) override earlier details.
2. Work through `docs/TASKS.md` **one task per pull request, in order**. Do not start the next task until the owner merges the current PR.
3. `docs/reference/ayra-nav-prototype.html` is a working clickable prototype of the UI and logic. Port its behavior and look into idiomatic React/Next.js/Tailwind components; do not embed the HTML.
4. If a product decision is missing or ambiguous, ask in the PR (in Russian) and propose 2 options with a recommendation. Do not invent prices, limits, or KPIs; use obvious placeholders and list them.
5. Never commit secrets. Never perform destructive/irreversible actions without explicit approval.

## Product in one paragraph
AYRA turns a trader's real daily discipline into the growth of a character. Users keep a journal (R-based process analytics, not just P&L), follow personalized daily quests (no punishments for misses), earn XP and Coins (earned only, never sold), equip cosmetic items (slots, rarity, loadouts, profile frames/backgrounds), explore a market center (overview, economic calendar, macro, news, scanner), and later join a trader-only social network with followers (no paid author subscriptions). Subscriptions Free/Pro/Elite expand tools and cosmetics only, never XP, ranking or reputation. No blockchain/tokens/real-money economy in this project phase. No financial advice or signals.

## Fixed UX decisions
- Dark graphite theme, violet `#50348f`/`#a38ad1`, gold `#d6a94a` for rare/achievements only; animated starfield particles on Home and Profile only (disabled in Focus mode and with reduced motion).
- Sidebar (desktop): logo, Home, Journal, Market, Quests, Community, Academy; at the bottom a **profile card** (avatar in frame, name, level, title, reputation bar) above Settings and Help. The card opens `/profile`.
- Top bar: search/command palette, **"+ Добавить"** (opens a centered modal with action tiles), Focus/Game mode switch, **plan chip (Free/Pro/Elite) next to the bell → `/plans`** (pricing page with plan comparison; prices are placeholders), bell.
- Mobile: bottom navigation, sidebar hidden, avatar in the top bar.
- Profile page: left a character stage with 10 equipment slots (5 per side), **360° drag-to-rotate**, auto-spin button, reset, stage background switch; right a panel with tabs (Overview, Wardrobe, Achievements, Chronicle, Posts, Stats). Tab rows have no visible scrollbars.
- Home page is a rich dashboard: greeting, quick actions, daily quests with weekly challenge, 7-day daily reward, character card, market mini-cards, calendar, AI brief (locked on Free with a link to plans), recent activity.
- Layout must never push sidebar footer (profile card/Settings/Help) off-screen: the main area scrolls internally, the sidebar is fixed in height.
- Overlay menus/modals must always render above page content (z-index layers) and the "+ Добавить" modal is centered over the whole page.

## Current repository state
A minimal Next.js 14 + TypeScript + Tailwind scaffold: configs, global styles with component classes (`.card`, `.btn`, `.chip`, `.slot`, `.lvbadge`, …), a placeholder home page, CI workflow. Everything else is to be built via `docs/TASKS.md`.

## Your first task
Execute **T0** from `docs/TASKS.md` and open a PR. In the PR description (Russian) list: commands you ran, what you fixed, anything you could not verify, and the exact steps for the owner to run the project locally.
