# AYRA Profile & Statistics Specification v1.4

## Overview
This specification details the profile layout, character stage, 8-characteristic model, reputation formula, titles catalog, daily activity statistics (`dailyStats`), and JSON data export.

## 1. Character Stage & Layout
- **Desktop Grid**: 2 columns (`lg:grid-cols-12`). Left column (5/12) is the interactive Character Stage; Right column (7/12) contains the unified single profile container with inner cards.
- **Stage Alignment**: Left stage matches height of the right panel (`lg:min-h-[640px]`) and uses `lg:sticky lg:top-20` for smooth scrolling without internal stage scrollbars.
- **Mobile Responsive**: On mobile viewports, stage is stacked vertically above the overview panel with height limited to `max-h-[70vh]`.
- **Feet-anchored Shadow**: An oval shadow is drawn fixed outside the 360° rotating figure container so it stays grounded during rotation.
- **Slot Buttons**: 10 interactive slots (`head`, `top`, `outer`, `bottom`, `shoes`, `cloak`, `gloves`, `accessory`, `aura`, `companion`) with icons, tooltips, and `aria-label`. Clicking a slot switches to the Wardrobe tab filtered by that slot.

## 2. Nicknames & Bio Rules
- **Nickname**: Strictly Latin (`A-Z`, `a-z`, `0-9`, `_`, `.`, `-`), length 3–24 characters.
- **Cyrillic Transliteration**: Automatic migration converts Cyrillic nicknames to Latin (e.g., "Алекс" -> "Aleks"). If the resulting nickname is shorter than 3 characters, it falls back to `"TraderOne"`.
- **Bio**: Stored as `bio: null` by default in state. Default bio text is rendered dynamically from the active i18n dictionary.

## 3. 8 Characteristics & Category Mapping
Daily tasks develop specific character stats based on task categories (Spec v1.1):

| Characteristic | Primary Task Category | Secondary Category |
|---|---|---|
| **Discipline** | Discipline | Lifestyle |
| **Trading** | Trading | — |
| **Intelligence** | Mental | — |
| **Focus** | Trading | Social |
| **Psychology** | Psychology | Social |
| **Knowledge** | Mental | — |
| **Endurance** | Physical | Lifestyle |
| **Strength** | Physical | — |

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

## 6. JSON Export Format
Data exports to `ayra-profile-[nickname]-[YYYY-MM-DD].json` containing pure numeric IDs and state keys with zero localized strings.
