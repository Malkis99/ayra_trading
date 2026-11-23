"use client";

import { CloudCog, PauseCircle, WifiOff } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { deviceRewardsAllowed } from "@/lib/economy-mode";
import { formatString } from "@/lib/i18n";

/**
 * Q4.4: why rewards are not given and who keeps the game day (lib/economy-mode.ts). Nothing is shown for an account on
 * the device economy («local») unless a reward was refused — so today, with every account local, nothing changes.
 */
export function EconomyNotice() {
  const { dict } = useApp();
  const { economy } = useGame();
  const e = dict.questsPage.q2.quest.economy;
  const lines: Array<{ key: string; text: string; icon: "pause" | "cloud" | "offline" }> = [];
  // a move is announced: rewards go on as usual until it starts (owner decision 2026-11-18)
  if (economy.mode === "migration_scheduled") lines.push({ key: "mode", text: e.scheduled, icon: "cloud" });
  if (economy.mode === "migration_pending") lines.push({ key: "mode", text: e.pending, icon: "pause" });
  if (economy.mode === "cloud_active") lines.push({ key: "mode", text: economy.gameSync ? e.cloudOn : e.cloudPaused, icon: economy.gameSync ? "cloud" : "pause" });
  // Q4.5-4/Q4.6: until the server has recorded the achievements the transfer is not complete for the person
  if (economy.mode === "cloud_active" && !economy.achievements?.transferred) lines.push({ key: "achievements", text: e.achievementsOnDevice, icon: "cloud" });
  if (economy.notice === "rewardsPaused" && !deviceRewardsAllowed(economy.mode)) lines.push({ key: "notice", text: e.rewardsPaused, icon: "pause" });
  if (economy.notice === "offline") lines.push({ key: "notice", text: e.offline, icon: "offline" });
  // Q4.5-4: this device's progress in the transfer
  if (economy.transfer === "waiting") lines.push({ key: "transfer", text: e.transferWaiting, icon: "cloud" });
  if (economy.transfer === "sent") lines.push({ key: "transfer", text: e.transferSent, icon: "cloud" });
  if (economy.transfer === "late") lines.push({ key: "transfer", text: e.transferLate, icon: "pause" });
  if (economy.transfer === "tooLarge") lines.push({ key: "transfer", text: e.transferTooLarge, icon: "pause" });
  if (economy.transfer === "unsupported") lines.push({ key: "transfer", text: e.transferUnsupported, icon: "pause" });
  if (economy.notice === "serverRefused") lines.push({ key: "notice", text: formatString(e.serverRefused, { reason: economy.noticeReason || "" }), icon: "pause" });
  if (lines.length === 0) return null;
  return (
    <div role="status" aria-live="polite" data-testid="economy-notice" data-mode={economy.mode} className="space-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-mu">
      {lines.map((l) => (
        <p key={l.key} className="flex items-start gap-2" data-testid={`economy-line-${l.key}`}>
          {l.icon === "pause" ? <PauseCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" /> : l.icon === "cloud" ? <CloudCog size={16} aria-hidden="true" className="mt-0.5 shrink-0" /> : <WifiOff size={16} aria-hidden="true" className="mt-0.5 shrink-0" />}
          <span>{l.text}</span>
        </p>
      ))}
    </div>
  );
}
