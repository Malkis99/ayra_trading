# AYRA Spec v1.4 — Profile, Titles, Reputation & Stats Architecture

## 1. Overview Block Layout
The Overview tab (`/profile`) follows a strict top-to-bottom layout rhythm inside a single right container with a clean outer border:
1. **Compact Header Card**: Level badge, Latin nickname (3–24 chars) with pencil edit button, selected Title dropdown trigger, and 2-line truncated Bio tooltip.
2. **Followers Block**: 3 interactive cards ("Followers", "Following", "Marked Useful") with count formatters, hover shimmer effect, and toast placeholders ("Coming soon").
3. **Reputation Card**: Single dark card containing shield icon, Reputation tier title, point total, segmented 5-tier bar, points-to-next label, and tooltip breakdown (Usefulness, Quality, Consistency).
4. **Full-Width Level Progress**: Level N to N+1 bar with gradient fill, XP counters, and chips ("Quests today: 0/3", "Streak: N days").
5. **Stage Styling**: Frame and background selection triggers.
6. **Characteristics Summary**: 8 stat rows with segmented bars, rank labels, weekly gains, gold indicator for strongest stat, and link to Stats tab.

## 2. Latin Nickname & Bio Rules
- **Nickname validation**: Allowed characters are Latin letters (`A-Z`, `a-z`), digits (`0-9`), underscore (`_`), dot (`.`), and hyphen (`-`). Length must be 3–24 characters.
- **Cyrillic Transliteration**: Automatic migration converts Cyrillic names (e.g., "Алекс" → "Aleks"). If the transliterated length is under 3 characters, default "TraderOne" is assigned.
- **Bio State**: Default bio is stored as `null` in `GameState`. Default localized text ("Мой путь — дисциплина и процесс." / "My path is discipline and process") displays from dictionary.

## 3. Titles System
- **Storage**: `unlockedTitles: string[]`, `selectedTitle: string`.
- **Default Title**: `novice` unlocked and selected by default.
- **Sources**: Level milestones (3, 5, 10), achievements (`firstQuest`, `stylist`, `level3`), cases, and seasons.
- **Migration**: Existing accounts silently unlock eligible titles based on current level and achievements without issuing toast popups or chronicle entries.

## 4. Reputation Formula
- Calculated dynamically via `getReputation(state)`:
  `Points = Math.min(2000, level * 20 + completedQuests * 5 + currentStreak * 10)`
- Tiers:
  - Growing (0 - 100 pt)
  - Reliable (101 - 250 pt)
  - Trusted (251 - 500 pt)
  - Respected (501 - 1000 pt)
  - Honored (1001+ pt)

## 5. 8 Stats Model & Character Power
- **Stats**: Discipline, Trading, Intelligence, Focus, Psychology, Knowledge, Endurance, Strength.
- **Ranks**: Novice (Lv 1-4), Adept (Lv 5-9), Skilled (Lv 10-14), Expert (Lv 15-19), Master (Lv 20+).
- **Character Power**: Sum of stat levels * 10 + XP.
- **Stat Balance**: Evaluated by comparing highest and lowest stat levels (diff <= 2 is Balanced).
