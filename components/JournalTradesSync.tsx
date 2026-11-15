"use client";

import { useEffect, useMemo } from "react";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { firstTradeDay } from "@/lib/missions";

/**
 * Tells the game which day the journal's earliest live trade is on (catalog 3: a new day's study mission is «Trade review»
 * when the journal had a trade before that day, «Observation» otherwise). It waits until the journal is read and, for a
 * cloud journal, the cloud copy is in — never a choice from half-loaded data. Renders nothing, gives nothing.
 */
export function JournalTradesSync() {
  const { gameState, recordJournalTrades } = useGame();
  const { trades, ready, cloudSettled } = useJournal();
  const tz = gameState.profile?.timezone;
  const first = useMemo(() => (ready && cloudSettled ? firstTradeDay(trades, tz) : undefined), [ready, cloudSettled, trades, tz]);
  const known = gameState.journalFirstTradeDay;
  const pending = !!gameState.questDay?.studyPending;

  useEffect(() => {
    if (first === undefined) return;
    if (known === first && !pending) return;
    recordJournalTrades(first);
  }, [first, known, pending, recordJournalTrades]);

  return null;
}
