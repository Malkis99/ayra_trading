export interface EquipmentItem {
  slot: string;
  nameKey: string; // key or fallback name
  nameRu: string;
  nameEn: string;
  rarity: 0 | 1 | 2; // 0: Common, 1: Rare, 2: Epic
  color: string;
  reqLevel: number;
}

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

export const ITEMS: EquipmentItem[] = [
  { slot: "Верх", nameKey: "item.top.graphiteShirt", nameRu: "Рубашка графит", nameEn: "Graphite Shirt", rarity: 0, color: "#3a3a48", reqLevel: 1 },
  { slot: "Верх", nameKey: "item.top.violetHoodie", nameRu: "Худи фиолет", nameEn: "Violet Hoodie", rarity: 1, color: "#50348f", reqLevel: 1 },
  { slot: "Верх", nameKey: "item.top.nightSuit", nameRu: "Костюм ночь", nameEn: "Night Suit", rarity: 2, color: "#241d6b", reqLevel: 3 },
  { slot: "Низ", nameKey: "item.bottom.darkPants", nameRu: "Брюки тёмные", nameEn: "Dark Pants", rarity: 0, color: "#2b2b36", reqLevel: 1 },
  { slot: "Низ", nameKey: "item.bottom.suitPants", nameRu: "Брюки костюм", nameEn: "Suit Pants", rarity: 1, color: "#1c1850", reqLevel: 2 },
  { slot: "Обувь", nameKey: "item.shoes.sneakers", nameRu: "Кроссовки", nameEn: "Sneakers", rarity: 0, color: "#cfcfd8", reqLevel: 1 },
  { slot: "Обувь", nameKey: "item.shoes.shoes", nameRu: "Туфли", nameEn: "Shoes", rarity: 1, color: "#111116", reqLevel: 2 },
  { slot: "Верхняя", nameKey: "item.outer.bomber", nameRu: "Бомбер", nameEn: "Bomber Jacket", rarity: 0, color: "#3b3b4a", reqLevel: 1 },
  { slot: "Верхняя", nameKey: "item.outer.blazer", nameRu: "Пиджак", nameEn: "Blazer", rarity: 1, color: "#30286e", reqLevel: 2 },
  { slot: "Голова", nameKey: "item.head.cap", nameRu: "Кепка", nameEn: "Cap", rarity: 0, color: "#50348f", reqLevel: 1 },
  { slot: "Голова", nameKey: "item.head.crown", nameRu: "Корона дисциплины", nameEn: "Crown of Discipline", rarity: 2, color: "#d6a94a", reqLevel: 4 },
  { slot: "Плащ", nameKey: "item.cloak.nightCloak", nameRu: "Плащ ночи", nameEn: "Night Cloak", rarity: 1, color: "#2a1d5c", reqLevel: 3 },
  { slot: "Перчатки", nameKey: "item.gloves.gloves", nameRu: "Перчатки", nameEn: "Gloves", rarity: 0, color: "#d6d6e0", reqLevel: 2 },
  { slot: "Аксессуар", nameKey: "item.accessory.glasses", nameRu: "Очки", nameEn: "Glasses", rarity: 0, color: "#a38ad1", reqLevel: 1 },
  { slot: "Аура", nameKey: "item.aura.focusAura", nameRu: "Аура Focus", nameEn: "Focus Aura", rarity: 1, color: "#a38ad1", reqLevel: 2 },
  { slot: "Аура", nameKey: "item.aura.goldAura", nameRu: "Золотая аура", nameEn: "Golden Aura", rarity: 2, color: "#d6a94a", reqLevel: 5 },
  { slot: "Компаньон", nameKey: "item.companion.orb", nameRu: "Орб", nameEn: "Orb", rarity: 0, color: "#a38ad1", reqLevel: 1 },
  { slot: "Компаньон", nameKey: "item.companion.drone", nameRu: "Дрон", nameEn: "Drone", rarity: 1, color: "#6ec1ff", reqLevel: 3 },
];

export interface FrameOption {
  id: number;
  nameRu: string;
  nameEn: string;
  color: string;
  reqLevel: number;
}

export const FRAMES: FrameOption[] = [
  { id: 0, nameRu: "Нет", nameEn: "None", color: "#2a2a35", reqLevel: 1 },
  { id: 1, nameRu: "Фиолетовая", nameEn: "Violet", color: "#a38ad1", reqLevel: 1 },
  { id: 2, nameRu: "Голубая", nameEn: "Blue", color: "#6ec1ff", reqLevel: 3 },
  { id: 3, nameRu: "Золотая", nameEn: "Gold", color: "#d6a94a", reqLevel: 4 },
];

export interface TitleOption {
  id: number;
  nameRu: string;
  nameEn: string;
  reqLevel: number;
}

export const TITLES: TitleOption[] = [
  { id: 0, nameRu: "—", nameEn: "—", reqLevel: 1 },
  { id: 1, nameRu: "Новичок пути", nameEn: "Way Novice", reqLevel: 1 },
  { id: 2, nameRu: "Дисциплинированный", nameEn: "Disciplined", reqLevel: 3 },
  { id: 3, nameRu: "Стратег", nameEn: "Strategist", reqLevel: 5 },
];

export const BACKGROUNDS = [
  { id: 0, nameRu: "Частицы", nameEn: "Particles" },
  { id: 1, nameRu: "Сетка", nameEn: "Grid" },
  { id: 2, nameRu: "Тишина", nameEn: "Silence" },
];
