export type TitleRarity = "common" | "rare" | "epic" | "legendary";
export type TitleSource = "level" | "achievement" | "case" | "season" | "guild" | "event";

export interface TitleItem {
  id: string;
  nameKey: string;
  rarity: TitleRarity;
  source: TitleSource;
  reqLevel?: number;
  reqAchievement?: string;
  isComingSoon?: boolean;
}

export const TITLES_CATALOG: TitleItem[] = [
  {
    id: "novice",
    nameKey: "titles.novice",
    rarity: "common",
    source: "level",
    reqLevel: 1,
  },
  {
    id: "disciplined",
    nameKey: "titles.disciplined",
    rarity: "rare",
    source: "level",
    reqLevel: 3,
  },
  {
    id: "strategist",
    nameKey: "titles.strategist",
    rarity: "epic",
    source: "level",
    reqLevel: 5,
  },
  {
    id: "master",
    nameKey: "titles.master",
    rarity: "legendary",
    source: "level",
    reqLevel: 10,
  },
  {
    id: "first_step",
    nameKey: "titles.firstStep",
    rarity: "common",
    source: "achievement",
    reqAchievement: "first_quest",
  },
  {
    id: "style_icon",
    nameKey: "titles.styleIcon",
    rarity: "rare",
    source: "achievement",
    reqAchievement: "first_equip",
  },
  {
    id: "case_hunter",
    nameKey: "titles.caseHunter",
    rarity: "rare",
    source: "case",
    isComingSoon: true,
  },
  {
    id: "season_legend",
    nameKey: "titles.seasonLegend",
    rarity: "epic",
    source: "season",
    isComingSoon: true,
  },
];
