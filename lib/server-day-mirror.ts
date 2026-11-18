/**
 * Q4.4 — the server's game day shown on the device (accounts on the server economy only).
 *
 * The device keeps no day of its own for such an account: the set, the mode, the acceptances, the put-offs and the
 * replacements are copied from the server's answer. Nothing economic is copied except «done» for the missions the
 * server itself paid — never XP, Coins or levels (those come from the server's projection, Q4.5).
 */
import { checkAndApplyDateResets, type GameState } from "./game";
import type { DayMode } from "./quest-engine";
import { QUEST_CATALOG_VERSION } from "./quest-engine";
import type { ServerDayStatus } from "./server-day-client";

export function mirrorServerDay(state: GameState, status: ServerDayStatus, now: Date = new Date()): GameState {
  const d = status.day;
  if (!d || d.status !== "open") return state;
  // the device never goes back to an earlier day than it already shows
  if (state.lastQuestDate && d.game_day < state.lastQuestDate) return state;
  // the local day change runs first (yesterday's snapshot and streak, QH-7), then the server's day is laid over it
  const s = checkAndApplyDateResets(state, now);
  const sameDay = s.lastQuestDate === d.game_day;
  const rest = d.mode === "rest";
  const offered = Array.from(new Set([...d.core, ...d.bonus, ...d.replacements.flatMap((r) => [r.from, r.to])]));
  // put-offs of the day's missions are the server's; an extra put off stays a device mark (the server keeps none)
  const passed: Record<string, boolean> = {};
  if (sameDay) for (const [id, on] of Object.entries(s.passedQuestsToday || {})) if (on && !d.core.includes(id)) passed[id] = true;
  for (const id of d.passed) passed[id] = true;
  for (const r of d.replacements) passed[r.from] = true;
  const done: Record<string, boolean> = sameDay ? { ...s.completedQuestsToday } : {};
  for (const id of d.paid) done[id] = true;
  return {
    ...s,
    lastQuestDate: d.game_day,
    isRestDay: rest,
    questDay: {
      day: d.game_day,
      mode: d.mode as DayMode,
      ...(d.mode_before_rest ? { modeBeforeRest: d.mode_before_rest as DayMode } : {}),
      catalogVersion: QUEST_CATALOG_VERSION,
      core: d.core,
      bonus: d.bonus,
      studyFirst: d.study_first,
      ...(Object.keys(d.carried || {}).length ? { carried: d.carried as Record<string, DayMode> } : {}),
      offered,
    },
    questAccepted: { day: d.game_day, at: { ...d.accepted } },
    passedQuestsToday: passed,
    questReplacements: {},
    replacementsUsedToday: d.replacements.length,
    completedQuestsToday: done,
  };
}
