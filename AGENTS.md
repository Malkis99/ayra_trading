# AGENTS.md — rules for AI developers (Jules and others)

## Project
AYRA Trading is a web platform for traders: trading journal, market center, daily quests, living RPG-style character, wardrobe, community. Web is the main platform; a Telegram Mini App will reuse the same Next.js app later.
Owner: Givi (no coding experience, reads Russian). **Write PR titles/descriptions and questions in Russian. Code, identifiers and commit messages in English.**

## Sources of truth (read before any task)
1. `docs/ayra-pack-v1.0.md` — product decisions D-01…D-27 (highest priority)
2. `docs/ayra-spec-v1.1-quests-community.md`, `v1.2-economy-safety-social.md`, `v1.3-living-character-navigation.md` (later versions override earlier ones)
3. `docs/reference/ayra-nav-prototype.html` — behavior and look reference (port to React, do not copy as-is)
4. `docs/TASKS.md` — the ordered task queue. Work on ONE task per PR.

## Stack
Next.js 14 (App Router) + TypeScript (strict) + Tailwind CSS + lucide-react. Later: Supabase (Postgres/Auth/Storage/RLS). No other major dependencies without asking.

## Hard rules
- No blockchain, tokens, NFTs, crypto-wallet code, real-money payments, or real-money economy. The in-game currency (Coins) is earned only, never bought, sold, or withdrawn.
- No financial advice, trading signals, or guaranteed-profit wording. Analysis content carries the disclaimer "Не является финансовой рекомендацией".
- Do not invent business numbers (prices, limits, KPIs). Use clearly marked placeholders and list them in the PR.
- Never commit secrets (keys, tokens, `.env`). Use environment variables and `.env.example`.
- Never run destructive or irreversible operations (deleting data, force-push, production migrations, dropping tables) without explicit owner approval in the PR discussion.
- Economy/XP rules (when backend exists): server-authoritative, append-only ledger, idempotent rewards, daily caps (see v1.2 spec). Never trust client-calculated rewards.
- Age 16+. 16–17 mode restrictions are defined in the Pack (section 15.3).
- No punishments for missed quests, no body-shape changes of the character from activity, no guilt-driven mechanics (see v1.1, v1.3).

## Code & UX conventions
- All user-visible text goes through an i18n dictionary (ru/en). No hardcoded strings in components after T1.
- В состоянии не хранить переведённые строки; значения по умолчанию отображаются из словаря. Ники только латиницей.
- Design tokens (Tailwind theme / CSS variables): dark graphite surfaces, violet `#50348f` / `#a38ad1`, gold `#d6a94a` only for achievements/rare items. Serif font for names/levels. Animations only for meaningful state changes; respect `prefers-reduced-motion`.
- Navigation is fixed: Home, Journal, Market, Quests, Community, Academy; profile card in the left sidebar above Settings/Help; plan chip (Free/Pro/Elite) next to the bell opens `/plans`.
- Mobile-first responsive; sidebar becomes bottom navigation; no horizontal scroll bars inside tab rows (hide scrollbars).
- Accessibility: focus-visible states, semantic buttons/links, sufficient contrast.
- Keep components small; shared logic in `lib/`; types in TypeScript, no `any` unless justified.

## Definition of done (every PR)
- `npx tsc --noEmit` and `npm run build` pass; CI green.
- Works at 360px and 1440px widths.
- PR description (Russian): what changed, how to check (steps), screenshots if UI, open questions, placeholders used.
- If anything is ambiguous, ask in the PR instead of guessing.
