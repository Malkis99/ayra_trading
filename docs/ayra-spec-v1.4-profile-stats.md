# AYRA Profile & Statistics Specification v1.4

## Overview
This specification details the profile layout, character stage, 8-characteristic model, reputation formula, titles catalog, daily activity statistics (`dailyStats`), JournalStats contract, and JSON data export format.

## 1. Character Stage & Layout
- **Desktop Grid**: 2 columns (`lg:grid-cols-12`). Left column (5/12) is the interactive Character Stage; Right column (7/12) contains the unified single profile container with inner cards.
- **Stage Alignment**: Left stage matches height of the right panel (`lg:min-h-[640px]`) and uses `lg:sticky lg:top-20` for smooth scrolling without internal stage scrollbars.
- **Mobile Responsive**: On mobile viewports, stage is stacked vertically above the overview panel with height limited to `max-h-[70vh]`.
- **Feet-anchored Shadow**: An oval shadow is drawn fixed outside the 360° rotating figure container so it stays grounded during rotation.
- **Slot Buttons**: 10 interactive slots (`head`, `top`, `outer`, `bottom`, `shoes`, `cloak`, `gloves`, `accessory`, `aura`, `companion`) with icons, tooltips, and `aria-label`. Clicking a slot switches to Wardrobe -> Items section filtered by that slot, with equipped item highlighted and listed first. Accessible via keyboard (Enter/Space) with visible focus ring.

## 2. Nicknames & Bio Rules
- **Nickname**: Strictly Latin (`A-Z`, `a-z`, `0-9`, `_`, `.`, `-`), length 3–24 characters.
- **Cyrillic Transliteration**: Automatic migration converts Cyrillic nicknames to Latin (e.g., "Алекс" -> "Aleks"). If the resulting nickname is shorter than 3 characters, it falls back to `"TraderOne"`.
- **Bio**: Stored as `bio: null` by default in state. Default bio text is rendered dynamically from the active i18n dictionary.

## 3. 8 Characteristics & Category Mapping
Daily tasks develop specific character stats based on task categories (Spec v1.1, Section A.4):

| Characteristic | Primary Task Category | Secondary Category | Developed by Quests |
|---|---|---|---|
| **Discipline** | Discipline | Lifestyle | `q_tradelog`, `q_backtest` |
| **Trading** | Trading | — | `q_bias`, `q_riskcheck`, `q_screenplan` |
| **Intelligence** | Mental | — | `q_logic_puzzle`, `q_lang_study` |
| **Focus** | Trading | Social | `q_meditate`, `q_nosocial` |
| **Psychology** | Psychology | Social | `q_reflect`, `q_review_mistake` |
| **Knowledge** | Mental | — | `q_community_post`, `q_backtest` |
| **Endurance** | Physical | Lifestyle | `q_walk`, `q_sleep_prep` |
| **Strength** | Physical | — | `q_workout`, `q_stretching` |

### Character Power & Balance Formulas
- **Character Power**: $\sum (\text{Level} \times 10 + \text{currentLevelXp})$.
- **Profile Balance**: Profile is balanced if $\max(\text{Level}) - \min(\text{Level}) \le 2$. Otherwise, the weakest stat is designated as the growth zone.

## 4. Single Reputation Model
Reputation points are calculated using pure function `getReputation(state)`:
$$\text{Points} = \min(2000, \text{Level} \times 20 + \text{HistoryCount} \times 5 + \text{Streak} \times 10)$$

Tiers:
1. **Growing**: 0 – 100 pt
2. **Reliable**: 101 – 250 pt
3. **Trusted**: 251 – 500 pt
4. **Respected**: 501 – 1000 pt
5. **Honored**: 1001+ pt

## 5. Daily Stats & JournalStats Contract
Daily activity is tracked in `dailyStats[YYYY-MM-DD]` storing:
- `questsCompleted`: record of completed task counts per category.
- `totalQuestsCompleted`, `xpGained`, `coinsGained`, `questsSkipped`, `questsReplaced`, `isRestDay`, `shieldUsed`, `rewardsClaimed`.
- Created on the first daily event (completion, skip, replacement, reward claim), up to 365 days max.

### Heatmap Cell Logic
- **Pre-`createdAt` Days**: Faint neutral empty border cell with tooltip `"данных ещё нет"` / `"no data yet"`.
- **Post-`createdAt` 0-Activity Days**: Lightest color cell with tooltip `"нет активности"` / `"no activity"`.
- **Active Days**: Level 1..3 color intensity based on quest count.

### JournalStats Contract (Placeholder for T6)
```ts
export interface JournalStats {
  totalTrades: number;
  periodTrades: number;
  planCompliancePercent: number;
  averageProcessScore: number;
  periodRResult: number;
  journalStreakDays: number;
  notesCount: number;
  frequentErrors: string[];
  dominantEmotions: string[];
}
```

## 6. Wardrobe 3-Section Structure
1. **Items**: Filterable grid (Slot chips, Status: All / Equipped / Available / Locked, Sorting by rarity). Card action buttons: Try on, Equip, Unequip.
2. **Styling**: Profile Frames & Titles selection cards with color/rarity samples.
3. **Loadouts**: Session and Community loadouts (Save & Apply with empty set confirmation).

## 7. Posts & Modal Flow
- Posts tab displays history cards with plain text rendering, type tag, pin, and inline deletion confirmation (Cancel focused, Esc cancels).
- Creation is handled by central `AddModal` on Post tab with 5 sub-types (Analysis, Trade breakdown, Education, Question, Progress), 280 character limit with counter, and disclaimer "Не является финансовой рекомендацией".

## 8. JSON Export Format
Data exports to `ayra-profile-[nickname]-[YYYY-MM-DD].json` containing:
- `app`: `"ayra"`
- `exportVersion`: `"1.0"`
- `exportedAt`: ISO Date string
- `user`: pure numeric IDs, state keys, `dailyStats`, chronicle, equipment, unlocked titles with zero localized strings.
