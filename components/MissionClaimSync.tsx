"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { pendingMissionClaims } from "@/lib/game";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { questById } from "@/lib/quests";
import { questShortTitle } from "@/components/quests/quest-text";
import type { MissionData } from "@/lib/missions";

/**
 * Pays the day's verifiable missions after a journal save (QH-6.4) — on every page, not only on Quests. It reads the
 * saved journal (every record, deleted ones included, for the «new text» and «same result» checks), never what a screen
 * shows, and only once the journal is read and, for a cloud journal, the cloud copy is in. The payment itself runs in
 * the game rules under the lock shared by all tabs, so a reload, a second tab or a double save pays nothing again.
 * Renders nothing.
 */
export function MissionClaimSync() {
  const { dict, lang, showToast } = useApp();
  const { gameState, gameDay, claimMissions } = useGame();
  const { ready, cloudSettled, plans, notes, trades, getAllRecords } = useJournal();
  const busy = useRef(false);

  useEffect(() => {
    if (!ready || !cloudSettled || busy.current) return;
    const all = getAllRecords();
    const data: MissionData = { plans: all.plans || [], notes: all.notes || [], trades: all.trades || [], timezone: gameState.profile?.timezone };
    const pending = pendingMissionClaims(gameState, data, new Date());
    if (!pending || pending.fresh.length === 0) return;
    busy.current = true;
    void claimMissions(data)
      .then((res) => {
        for (const id of res.claimed) {
          const tpl = questById(id);
          if (tpl) showToast(formatString(dict.questsPage.q2.mission.claimed, { title: questShortTitle(dict, lang, tpl), xp: GAME_CONFIG.QUEST_XP, coins: GAME_CONFIG.QUEST_COINS }));
        }
      })
      .finally(() => {
        busy.current = false;
      });
    // the journal lists change after every save; the day set and the paid missions after every game change
  }, [ready, cloudSettled, plans, notes, trades, gameDay, gameState, getAllRecords, claimMissions, showToast, dict, lang]);

  return null;
}
