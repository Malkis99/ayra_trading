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

/** Time zones offered in settings: the browser list when available, always including the current one. */
export function timeZoneOptions(current: string): string[] {
  let list: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    list = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    list = [];
  }
  if (!list.includes("UTC")) list = ["UTC", ...list];
  if (current && !list.includes(current)) list = [current, ...list];
  return list;
}

/** UTC offset of a zone right now, e.g. "UTC+4", "UTC−3:30", "UTC+0". */
export function timeZoneOffsetLabel(timeZone: string, date: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    const m = part?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return "UTC+0";
    return `UTC${m[1] === "-" ? "−" : "+"}${Number(m[2])}${m[3] && m[3] !== "00" ? `:${m[3]}` : ""}`;
  } catch {
    return "UTC";
  }
}

/** Localised zone name ("Грузия, стандартное время" / "Central European Time") with its UTC offset. */
export function timeZoneLabel(timeZone: string, lang: string, date: Date = new Date()): string {
  const offset = timeZoneOffsetLabel(timeZone, date);
  let name = "";
  try {
    name =
      new Intl.DateTimeFormat(lang, { timeZone, timeZoneName: "longGeneric" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    name = "";
  }
  // Without a localised name Intl falls back to "GMT+04:00": show the offset only
  if (!name || /^(GMT|UTC)/.test(name)) return offset;
  return `${name} · ${offset}`;
}

function offsetMinutes(label: string): number {
  const m = label.match(/UTC([+−])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const v = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "−" ? -v : v;
}

/**
 * Time zone choices with localised labels. The stored value stays the IANA id. Zones that would show the same
 * label (same region and offset, e.g. Berlin and Paris) are merged; the current zone is always kept.
 */
export function localizedTimeZoneOptions(current: string, lang: string, date: Date = new Date()): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  const currentLabel = timeZoneLabel(current, lang, date);
  seen.set(currentLabel, current);
  for (const z of timeZoneOptions(current)) {
    const label = timeZoneLabel(z, lang, date);
    if (!seen.has(label)) seen.set(label, z);
  }
  return Array.from(seen, ([label, value]) => ({ value, label })).sort(
    (a, b) => offsetMinutes(a.label) - offsetMinutes(b.label) || a.label.localeCompare(b.label, lang)
  );
}
