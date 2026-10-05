# AYRA Spec v1.4 — Profile, Titles, Reputation, and Character Stats

## 1. Overview Tab Block Structure
1. **Compact Header:** Level badge (octagonal), nickname with edit icon (pencil), selected title with dropdown arrow, and "About me" / bio (up to 2 lines, truncated with tooltip).
2. **Followers Block:** 3 cards ("Подписчики", "Подписки", "Отмечено полезным") with thousand separator, diagonal light sheen (~600ms), reduced-motion support, placeholder counts (`0`).
3. **Reputation Block:** Single dark block with shield emblem, stage name, total points, 5-segment bar, next stage label, and breakdown tooltip (utility, quality, stability).
4. **Full-width Level Bar:** Panel progress bar ("Ур. N" -> "Ур. N+1", "N/M XP"), soft end glow, and chips below ("Задания сегодня: 0/3", "Серия: N дн.").
5. **Character Stats:** 8 stat rows (2 cols wide, 1 col mobile) with segmented gradient bars (height >= 12px), xp to next level, weekly gain, strongest stat gold marker, weakest stat hint, and link to Stats tab.

## 2. Titles Rules & Catalog (`lib/titles.ts`)
- Titles are purely cosmetic and do not affect XP, reputation, or rating.
- State fields: `unlockedTitles: string[]`, `selectedTitle: string`.
- Starting title `novice` is unlocked and selected by default.
- Selected title is displayed under nickname; clicking opens central selection modal.
- Titles unlock automatically upon meeting level or achievement conditions (triggers toast and chronicle entry).

## 3. Reputation Formula & Stages
- Calculated by pure function `getReputation(state)`.
- Formula:
  - `Utility` = total completed quests * 5
  - `Quality` = sum of all 8 stat levels * 5
  - `Stability` = current streak * 10
  - `Total Points` = Utility + Quality + Stability
- Stages:
  1. `growing` (0–99 pts)
  2. `reliable` (100–249 pts)
  3. `trusted` (250–499 pts)
  4. `respected` (500–999 pts)
  5. `honored` (1000+ pts)

## 4. Character Stats, Ranks, Power & Balance
- 8 Stats: `discipline`, `trading`, `intelligence`, `focus`, `psychology`, `knowledge`, `endurance`, `strength`.
- Stat Ranks: Novice (Lv 1), Adept (Lv 2), Skilled (Lv 3), Expert (Lv 4), Master (Lv 5+).
- Character Power: `sum(all_stat_xp) + level * 100`.
- Balance: Profile is `Balanced` if `maxXp - minXp <= 100`, otherwise `Skewed`. Weakest stat suggests relevant quest category link to `/quests`.
- Snapshots: Daily stat history stored as array of max 30 snapshots for 7/30-day mini trend line charts.

## 5. Nickname Validation & Transliteration
- Allowed characters: `A-Z a-z 0-9 _ . -`
- Length: 3–24 characters.
- Trimmed at edges. Non-Latin input displays error message under field without closing input.
- Migration: Cyrillic input is transliterated to Latin (e.g. "Алекс" -> "Aleks"). If result < 3 characters, defaults to `"TraderOne"`.
