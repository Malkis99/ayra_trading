export type TitleRarity = "common" | "rare" | "epic" | "legendary";
export type TitleSource = "level" | "achievement" | "case" | "season" | "guild" | "event";

export interface TitleCatalogItem {
  id: string;
  nameKey: string;
  rarity: TitleRarity;
  source: TitleSource;
  reqLevel?: number;
  reqAchievement?: string;
  isPlaceholder?: boolean;
}

export const TITLES_CATALOG: TitleCatalogItem[] = [
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
    id: "legend",
    nameKey: "titles.legend",
    rarity: "legendary",
    source: "level",
    reqLevel: 10,
  },
  {
    id: "pioneer",
    nameKey: "titles.pioneer",
    rarity: "common",
    source: "achievement",
    reqAchievement: "firstQuest",
  },
  {
    id: "stylist",
    nameKey: "titles.stylist",
    rarity: "rare",
    source: "achievement",
    reqAchievement: "stylist",
  },
  {
    id: "master_trader",
    nameKey: "titles.masterTrader",
    rarity: "epic",
    source: "achievement",
    reqAchievement: "level3",
  },
  {
    id: "case_master",
    nameKey: "titles.caseMaster",
    rarity: "epic",
    source: "case",
    isPlaceholder: true,
  },
  {
    id: "season_champion",
    nameKey: "titles.seasonChampion",
    rarity: "legendary",
    source: "season",
    isPlaceholder: true,
  },
];
