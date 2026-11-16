"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { questStates } from "@/lib/game";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { questById } from "@/lib/quests";
import { questShortTitle } from "@/components/quests/quest-text";
import { buttonClasses } from "@/components/ui/Button";
import type { MissionData } from "@/lib/missions";

/**
 * QH-6.6: after a journal save, an accepted quest whose record is now saved is «ready to verify». Outside Quests a quiet
 * bar says so, with «Verify» (the same verifyMission → claimMissions as on Quests: nothing is paid by the bar itself or by
 * the save) and a link back to the quest. Only once the journal is read and, for a cloud journal, its copy is in.
 */
export function QuestReadyBar() {
  const pathname = usePathname() || "/";
  const { dict, lang, showToast } = useApp();
  const { gameState, verifyMission } = useGame();
  const { ready, cloudSettled, plans, notes, trades, getAllRecords } = useJournal();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const q = dict.questsPage.q2.quest;
  const tz = gameState.profile?.timezone;

  const data = useMemo((): MissionData | null => {
    if (!ready || !cloudSettled) return null;
    const all = getAllRecords();
    return { plans: all.plans || [], notes: all.notes || [], trades: all.trades || [], timezone: tz };
    // the journal lists change after every save
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cloudSettled, getAllRecords, tz, plans, notes, trades]);
  const readyIds = useMemo(
    () => (data ? Object.entries(questStates(gameState, data, new Date())).filter(([, s]) => s === "ready").map(([id]) => id) : []),
    [data, gameState]
  );

  if (pathname.startsWith("/quests") || pathname.startsWith("/awakening") || pathname.startsWith("/login") || readyIds.length === 0) return null;
  const title = (id: string) => {
    const tpl = questById(id);
    return tpl ? questShortTitle(dict, lang, tpl) : id;
  };

  const verifyAll = async () => {
    if (busyRef.current || !data) return;
    busyRef.current = true;
    setBusy(true);
    try {
      for (const id of readyIds) {
        const res = await verifyMission(id, data);
        if (res.paid) showToast(`${q.success}: «${title(id)}» ${formatString(q.gained, { xp: GAME_CONFIG.QUEST_XP, coins: GAME_CONFIG.QUEST_COINS })}`);
        else if (res.saveFailed) showToast(q.notSaved);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    // at the top, under the header: the toasts and the phone navigation live at the bottom
    <div className="pointer-events-none fixed inset-x-0 top-[64px] z-40 flex justify-center px-4" data-testid="quest-ready-bar">
      <div role="status" className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-success/40 bg-s1/95 px-3 py-2 shadow-float backdrop-blur">
        <CheckCircle2 size={18} aria-hidden="true" className="shrink-0 text-success" />
        <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] text-sm font-semibold text-tx sm:basis-auto">
          {readyIds.length === 1 ? formatString(q.readyBar.one, { title: title(readyIds[0]) }) : formatString(q.readyBar.many, { n: readyIds.length })}
        </span>
        <button
          type="button"
          onClick={verifyAll}
          disabled={busy}
          aria-busy={busy || undefined}
          data-testid="quest-ready-verify"
          className={buttonClasses("primary", "sm", "shrink-0")}
        >
          {busy ? q.verifying : q.readyBar.verify}
        </button>
        <Link href="/quests" className={buttonClasses("ghost", "sm", "shrink-0")} data-testid="quest-ready-open">
          {q.readyBar.open}
        </Link>
      </div>
    </div>
  );
}
