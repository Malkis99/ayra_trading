export const SLOTS = [
  "Голова",
  "Верх",
  "Верхняя",
  "Низ",
  "Обувь",
  "Плащ",
  "Перчатки",
  "Аксессуар",
  "Аура",
  "Компаньон",
] as const;

export type SlotName = typeof SLOTS[number];

export interface EquipmentItem {
  id: number;
  slot: SlotName;
  nameKey: string;
  rarity: 0 | 1 | 2; // 0: Common, 1: Rare, 2: Epic
  color: string;
  reqLevel: number;
}

export const ITEMS: EquipmentItem[] = [
  { id: 0, slot: "Верх", nameKey: "items.graphiteShirt", rarity: 0, color: "#3a3a48", reqLevel: 1 },
  { id: 1, slot: "Верх", nameKey: "items.violetHoodie", rarity: 1, color: "#50348f", reqLevel: 1 },
  { id: 2, slot: "Верх", nameKey: "items.nightSuit", rarity: 2, color: "#241d6b", reqLevel: 3 },
  { id: 3, slot: "Низ", nameKey: "items.darkPants", rarity: 0, color: "#2b2b36", reqLevel: 1 },
  { id: 4, slot: "Низ", nameKey: "items.suitPants", rarity: 1, color: "#1c1850", reqLevel: 2 },
  { id: 5, slot: "Обувь", nameKey: "items.sneakers", rarity: 0, color: "#cfcfd8", reqLevel: 1 },
  { id: 6, slot: "Обувь", nameKey: "items.shoes", rarity: 1, color: "#111116", reqLevel: 2 },
  { id: 7, slot: "Верхняя", nameKey: "items.bomber", rarity: 0, color: "#3b3b4a", reqLevel: 1 },
  { id: 8, slot: "Верхняя", nameKey: "items.blazer", rarity: 1, color: "#30286e", reqLevel: 2 },
  { id: 9, slot: "Голова", nameKey: "items.cap", rarity: 0, color: "#50348f", reqLevel: 1 },
  { id: 10, slot: "Голова", nameKey: "items.crown", rarity: 2, color: "#d6a94a", reqLevel: 4 },
  { id: 11, slot: "Плащ", nameKey: "items.nightCloak", rarity: 1, color: "#2a1d5c", reqLevel: 3 },
  { id: 12, slot: "Перчатки", nameKey: "items.gloves", rarity: 0, color: "#d6d6e0", reqLevel: 2 },
  { id: 13, slot: "Аксессуар", nameKey: "items.glasses", rarity: 0, color: "#a38ad1", reqLevel: 1 },
  { id: 14, slot: "Аура", nameKey: "items.focusAura", rarity: 1, color: "#a38ad1", reqLevel: 2 },
  { id: 15, slot: "Аура", nameKey: "items.goldAura", rarity: 2, color: "#d6a94a", reqLevel: 5 },
  { id: 16, slot: "Компаньон", nameKey: "items.orb", rarity: 0, color: "#a38ad1", reqLevel: 1 },
  { id: 17, slot: "Компаньон", nameKey: "items.drone", rarity: 1, color: "#6ec1ff", reqLevel: 3 },
];

export interface FrameOption {
  id: number;
  nameKey: string;
  color: string;
  reqLevel: number;
}

export const FRAMES: FrameOption[] = [
  { id: 0, nameKey: "frames.none", color: "#2a2a35", reqLevel: 1 },
  { id: 1, nameKey: "frames.violet", color: "#a38ad1", reqLevel: 1 },
  { id: 2, nameKey: "frames.blue", color: "#6ec1ff", reqLevel: 3 },
  { id: 3, nameKey: "frames.gold", color: "#d6a94a", reqLevel: 4 },
];

export interface TitleOption {
  id: number;
  nameKey: string;
  reqLevel: number;
}

export const TITLES: TitleOption[] = [
  { id: 0, nameKey: "titles.none", reqLevel: 1 },
  { id: 1, nameKey: "titles.titleNovice", reqLevel: 1 },
  { id: 2, nameKey: "titles.titleDisciplined", reqLevel: 3 },
  { id: 3, nameKey: "titles.titleStrategist", reqLevel: 5 },
];

export interface BackgroundOption {
  id: number;
  nameKey: string;
}

export const BACKGROUNDS: BackgroundOption[] = [
  { id: 0, nameKey: "backgrounds.particles" },
  { id: 1, nameKey: "backgrounds.grid" },
  { id: 2, nameKey: "backgrounds.silence" },
];
