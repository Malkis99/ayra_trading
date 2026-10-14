/**
 * Pure helpers for the profile page (no React, no storage): achievements, wardrobe filters, avatar drafts.
 */
import type { GameState } from "@/lib/game";
import type { AvatarAppearance } from "@/lib/avatar";
import { ITEMS, type EquipmentItem, type SlotName } from "@/lib/items";

/** Every achievement the game logic can unlock, in display order (texts: dict.profile.achievements[id] / [id + "Desc"]). */
export const PROFILE_ACHIEVEMENTS = [
  "firstQuest",
  "firstTrade",
  "firstNote",
  "firstPlan",
  "firstReview",
  "plans7",
  "stylist",
  "streakDay",
  "level3",
  "author",
  "consciousRefusal",
  "firstScreenshot",
  "firstPropRules",
  "propDisciplined5",
] as const;

export type ProfileAchievementId = (typeof PROFILE_ACHIEVEMENTS)[number];

export function achievementProgress(state: Pick<GameState, "achievements">): { done: number; total: number } {
  const done = PROFILE_ACHIEVEMENTS.filter((id) => state.achievements[id]).length;
  return { done, total: PROFILE_ACHIEVEMENTS.length };
}

/**
 * Most recent unlocked achievements, newest first: taken from the chronicle (newest entries come first there),
 * then topped up with other unlocked ones in catalogue order.
 */
export function recentAchievements(state: Pick<GameState, "achievements" | "chronicle">, limit = 3): ProfileAchievementId[] {
  const known = new Set<string>(PROFILE_ACHIEVEMENTS);
  const out: ProfileAchievementId[] = [];
  for (const entry of state.chronicle) {
    if (typeof entry === "string" || entry.type !== "achievementUnlocked") continue;
    const id = entry.achievementId;
    if (known.has(id) && state.achievements[id] && !out.includes(id as ProfileAchievementId)) out.push(id as ProfileAchievementId);
  }
  for (const id of PROFILE_ACHIEVEMENTS) if (state.achievements[id] && !out.includes(id)) out.push(id);
  return out.slice(0, limit);
}

export type WardrobeStatus = "all" | "equipped" | "available" | "locked";
export type ItemState = "equipped" | "available" | "locked";

export function itemState(item: EquipmentItem, state: Pick<GameState, "equipment" | "level">): ItemState {
  if (state.equipment[item.slot] === item.id) return "equipped";
  return state.level >= item.reqLevel ? "available" : "locked";
}

/** Items for the wardrobe grid: by slot and state; equipped first, then available, then locked. */
export function filterWardrobe(
  state: Pick<GameState, "equipment" | "level">,
  slot: SlotName | "all",
  status: WardrobeStatus,
  items: EquipmentItem[] = ITEMS
): EquipmentItem[] {
  const order: Record<ItemState, number> = { equipped: 0, available: 1, locked: 2 };
  return items
    .filter((it) => (slot === "all" || it.slot === slot) && (status === "all" || itemState(it, state) === status))
    .map((it, i) => ({ it, i, s: order[itemState(it, state)] }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.it);
}

/** Slots that have at least one item (only those are offered as type filters). */
export function wardrobeSlots(items: EquipmentItem[] = ITEMS): SlotName[] {
  const seen: SlotName[] = [];
  for (const it of items) if (!seen.includes(it.slot)) seen.push(it.slot);
  return seen;
}

export function sameAppearance(a: AvatarAppearance, b: AvatarAppearance): boolean {
  return a.skinTone === b.skinTone && a.hairstyle === b.hairstyle && a.hairColor === b.hairColor && a.outfit === b.outfit;
}

export const NICKNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

export type NicknameProblem = "latin" | "length" | null;

/** Nickname rule check (Latin only, 3–24 characters). */
export function nicknameProblem(nick: string): NicknameProblem {
  const v = nick.trim();
  if (v.length > 0 && !/^[A-Za-z0-9_.-]+$/.test(v)) return "latin";
  if (v.length < 3 || v.length > 24) return "length";
  return null;
}

/** PLACEHOLDER-free: the owner set the nickname change interval to 14 days. */
export const NICKNAME_COOLDOWN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days left until the nickname may be changed again (0 = allowed now). The first change after onboarding
 * is allowed at once (no previous change recorded).
 */
export function nicknameDaysLeft(lastChangedAt: string | null | undefined, now: Date = new Date()): number {
  if (!lastChangedAt) return 0;
  const t = new Date(lastChangedAt).getTime();
  if (Number.isNaN(t)) return 0;
  const left = t + NICKNAME_COOLDOWN_DAYS * DAY_MS - now.getTime();
  return left > 0 ? Math.ceil(left / DAY_MS) : 0;
}

/**
 * Date of the last nickname change to check the 14-day rule against.
 * Before migration 0003 the server has no column (undefined): the local date is used. After it, the server date
 * (null = never changed) is combined with the local one: the later of the two wins.
 */
export function lastNicknameChange(server: string | null | undefined, local: string | null | undefined): string | null {
  const s = server ? new Date(server).getTime() : NaN;
  const l = local ? new Date(local).getTime() : NaN;
  if (Number.isNaN(s) && Number.isNaN(l)) return null;
  if (Number.isNaN(s)) return local ?? null;
  if (Number.isNaN(l)) return server ?? null;
  return s >= l ? server ?? null : local ?? null;
}

export type SocialNetwork = "telegram" | "x" | "instagram" | "youtube";
export const SOCIAL_NETWORKS: SocialNetwork[] = ["telegram", "x", "instagram", "youtube"];
export type ProfileVisibility = "public" | "hidden";

/** Optional profile fields kept locally (AppStorage, in the game state) until cloud sync (T7b). */
export interface ProfileDetails {
  country?: string;
  experience?: string;
  markets?: string[];
  styles?: string[];
  socials?: Partial<Record<SocialNetwork, string>>;
  visibility?: ProfileVisibility;
  /** When the nickname was last changed after onboarding (ISO); used until the server column exists. */
  nicknameChangedAt?: string | null;
}

const SOCIAL_RULES: Record<SocialNetwork, { handle: RegExp; hosts: string[] }> = {
  telegram: { handle: /^[A-Za-z][A-Za-z0-9_]{4,31}$/, hosts: ["t.me", "telegram.me"] },
  x: { handle: /^[A-Za-z0-9_]{1,15}$/, hosts: ["x.com", "twitter.com"] },
  instagram: { handle: /^[A-Za-z0-9_.]{1,30}$/, hosts: ["instagram.com"] },
  youtube: { handle: /^[A-Za-z0-9_.-]{3,30}$/, hosts: ["youtube.com", "youtu.be"] },
};

/**
 * Normalises a social link: "@name", "name" or a profile URL of that network -> "@name" (YouTube channel URLs are
 * kept as URLs). Returns null when the value does not look like a profile of that network. Empty stays empty.
 */
export function normalizeSocial(network: SocialNetwork, raw: string): string | null {
  const v = raw.trim();
  if (!v) return "";
  const rule = SOCIAL_RULES[network];
  const isUrl = /^https?:\/\//i.test(v);
  if (isUrl || rule.hosts.some((h) => v.toLowerCase().startsWith(h) || v.toLowerCase().startsWith(`www.${h}`))) {
    let url: URL;
    try {
      url = new URL(isUrl ? v : `https://${v}`);
    } catch {
      return null;
    }
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
    if (!rule.hosts.includes(host)) return null;
    const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (network === "youtube") {
      if (first.startsWith("@") && rule.handle.test(first.slice(1))) return `@${first.slice(1)}`;
      if (["channel", "c", "user"].includes(first) || host === "youtu.be") return url.toString();
      return null;
    }
    return rule.handle.test(first) ? `@${first}` : null;
  }
  const handle = v.replace(/^@/, "");
  return rule.handle.test(handle) ? `@${handle}` : null;
}

/** ISO 3166-1 alpha-2 codes for the country picker (names come from Intl.DisplayNames). */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
  "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
  "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
  "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
  "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

export function countryOptions(lang: string): { value: string; label: string }[] {
  let names: { of: (code: string) => string | undefined } | null = null;
  try {
    names = new Intl.DisplayNames([lang], { type: "region" });
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ value: code, label: names?.of(code) || code })).sort((a, b) => a.label.localeCompare(b.label, lang));
}
