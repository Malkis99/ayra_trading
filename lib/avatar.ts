export interface SkinTonePreset {
  id: string;
  nameKey: string;
  hex: string;
  shadowHex: string;
}

export interface HairstylePreset {
  id: string;
  nameKey: string;
  category: "short" | "medium" | "long";
}

export interface HairColorPreset {
  id: string;
  nameKey: string;
  hex: string;
}

export interface OutfitPreset {
  id: string;
  nameKey: string;
  topColor: string;
  bottomColor: string;
  shoesColor: string;
}

export interface AvatarAppearance {
  skinTone: string;
  hairstyle: string;
  hairColor: string;
  outfit: string;
}

export const SKIN_TONES: SkinTonePreset[] = [
  { id: "skin_fair", nameKey: "avatar.skin_fair", hex: "#fce0d1", shadowHex: "#d9b3a0" },
  { id: "skin_light", nameKey: "avatar.skin_light", hex: "#f2cfb8", shadowHex: "#cb9d83" },
  { id: "skin_medium", nameKey: "avatar.skin_medium", hex: "#d1a886", shadowHex: "#b08b6e" },
  { id: "skin_olive", nameKey: "avatar.skin_olive", hex: "#b88e68", shadowHex: "#926845" },
  { id: "skin_tan", nameKey: "avatar.skin_tan", hex: "#9e714b", shadowHex: "#774e2d" },
  { id: "skin_dark", nameKey: "avatar.skin_dark", hex: "#6e472a", shadowHex: "#4d2e17" },
  { id: "skin_deep", nameKey: "avatar.skin_deep", hex: "#402816", shadowHex: "#2b180a" },
];

export const HAIRSTYLES: HairstylePreset[] = [
  { id: "hair_buzz", nameKey: "avatar.hair_buzz", category: "short" },
  { id: "hair_short_fade", nameKey: "avatar.hair_short_fade", category: "short" },
  { id: "hair_bob", nameKey: "avatar.hair_bob", category: "medium" },
  { id: "hair_wavy_medium", nameKey: "avatar.hair_wavy_medium", category: "medium" },
  { id: "hair_curly", nameKey: "avatar.hair_curly", category: "short" },
  { id: "hair_long_straight", nameKey: "avatar.hair_long_straight", category: "long" },
  { id: "hair_dreads", nameKey: "avatar.hair_dreads", category: "long" },
  { id: "hair_ponytail", nameKey: "avatar.hair_ponytail", category: "long" },
];

export const HAIR_COLORS: HairColorPreset[] = [
  { id: "hair_black", nameKey: "avatar.hair_black", hex: "#1b1b22" },
  { id: "hair_dark_brown", nameKey: "avatar.hair_dark_brown", hex: "#3a2518" },
  { id: "hair_brown", nameKey: "avatar.hair_brown", hex: "#634027" },
  { id: "hair_blonde", nameKey: "avatar.hair_blonde", hex: "#d6b265" },
  { id: "hair_silver", nameKey: "avatar.hair_silver", hex: "#9ea3b0" },
  { id: "hair_auburn", nameKey: "avatar.hair_auburn", hex: "#8a311d" },
  { id: "hair_violet", nameKey: "avatar.hair_violet", hex: "#6d3b9e" },
  { id: "hair_cyan", nameKey: "avatar.hair_cyan", hex: "#29859e" },
];

export const OUTFITS: OutfitPreset[] = [
  {
    id: "outfit_obsidian",
    nameKey: "avatar.outfit_obsidian",
    topColor: "#3a3a48",
    bottomColor: "#2b2b36",
    shoesColor: "#cfcfd8",
  },
  {
    id: "outfit_violet",
    nameKey: "avatar.outfit_violet",
    topColor: "#50348f",
    bottomColor: "#1e1933",
    shoesColor: "#a38ad1",
  },
  {
    id: "outfit_emerald",
    nameKey: "avatar.outfit_emerald",
    topColor: "#215c42",
    bottomColor: "#192e24",
    shoesColor: "#83c2a5",
  },
  {
    id: "outfit_crimson",
    nameKey: "avatar.outfit_crimson",
    topColor: "#872b36",
    bottomColor: "#291a1d",
    shoesColor: "#d18a93",
  },
  {
    id: "outfit_sand",
    nameKey: "avatar.outfit_sand",
    topColor: "#73614d",
    bottomColor: "#332d26",
    shoesColor: "#d4be8a",
  },
];

export const DEFAULT_AVATAR_APPEARANCE: AvatarAppearance = {
  skinTone: "skin_medium",
  hairstyle: "hair_short_fade",
  hairColor: "hair_brown",
  outfit: "outfit_obsidian",
};

export function getSkinTonePreset(id?: string): SkinTonePreset {
  return SKIN_TONES.find((s) => s.id === id) || SKIN_TONES[2];
}

export function getHairstylePreset(id?: string): HairstylePreset {
  return HAIRSTYLES.find((h) => h.id === id) || HAIRSTYLES[1];
}

export function getHairColorPreset(id?: string): HairColorPreset {
  return HAIR_COLORS.find((c) => c.id === id) || HAIR_COLORS[2];
}

export function getOutfitPreset(id?: string): OutfitPreset {
  return OUTFITS.find((o) => o.id === id) || OUTFITS[0];
}

export function validateAvatarAppearance(app?: Partial<AvatarAppearance> | null): AvatarAppearance {
  if (!app) return { ...DEFAULT_AVATAR_APPEARANCE };
  return {
    skinTone: SKIN_TONES.some((s) => s.id === app.skinTone) ? (app.skinTone as string) : DEFAULT_AVATAR_APPEARANCE.skinTone,
    hairstyle: HAIRSTYLES.some((h) => h.id === app.hairstyle) ? (app.hairstyle as string) : DEFAULT_AVATAR_APPEARANCE.hairstyle,
    hairColor: HAIR_COLORS.some((c) => c.id === app.hairColor) ? (app.hairColor as string) : DEFAULT_AVATAR_APPEARANCE.hairColor,
    outfit: OUTFITS.some((o) => o.id === app.outfit) ? (app.outfit as string) : DEFAULT_AVATAR_APPEARANCE.outfit,
  };
}
