"use client";

import React, { useMemo, useState } from "react";
import { Coins } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { EmptyState, Segmented } from "@/components/ui";
import { formatDate, formatNumber, formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { APP_CLOSED_QUESTS, QUEST_POOL, questReward } from "@/lib/quests";
import { listImportBatches } from "@/lib/journal/import/batches";
import { hasRecordsOfKind } from "@/lib/journal/first-actions";
import type { CoinLogEntry, FirstActionKind } from "@/lib/game";

type Filter = "all" | CoinLogEntry["source"];
const FIRST_KINDS = Object.keys(GAME_CONFIG.FIRST_ACTION_REWARDS) as FirstActionKind[];

/**
 * «Coins» (docs/economy-coins-plan.md, section 3): the balance, how coins are earned (the real rules of the app), and
 * the history of credits on this device since it started being kept. Coins live on this device until the server
 * economy (0007).
 */
export function CoinsTab() {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const { getAllRecords } = useJournal();
  const t = dict.profile.coinsTab;
  const kinds = dict.chronicleEvents.firstActionKinds;
  const [filter, setFilter] = useState<Filter>("all");

  const log = gameState.coinLog || [];
  const shown = filter === "all" ? log : log.filter((e) => e.source === filter);
  const since = gameState.coinLogSince ? formatDate(lang, new Date(gameState.coinLogSince), { day: "numeric", month: "long", year: "numeric" }) : null;

  // A first action is still possible only when this account has no record of that kind yet (deleted ones included)
  const firstStatus = useMemo(() => {
    const snapshot = getAllRecords();
    const batches = listImportBatches();
    return Object.fromEntries(
      FIRST_KINDS.map((k) => [k, gameState.firstActions?.[k] ? "got" : hasRecordsOfKind(snapshot, batches, k) ? "past" : "open"])
    ) as Record<FirstActionKind, "got" | "past" | "open">;
  }, [getAllRecords, gameState.firstActions]);

  const appQuests = QUEST_POOL.filter((q) => APP_CLOSED_QUESTS.has(q.id));
  const what = (e: CoinLogEntry) =>
    e.source === "quest"
      ? formatString(t.historyQuest, { title: e.title })
      : e.source === "dailyReward"
        ? t.historyDaily
        : formatString(t.historyFirst, { what: kinds[e.kind] });

  return (
    <div className="space-y-6">
      {/* Balance */}
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-s1/50 p-4" data-testid="coins-balance">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-pri/20 text-vi" aria-hidden="true">
          <Coins size={22} />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-mu">{t.balance}</p>
          <p className="font-serif text-3xl font-semibold tabular-nums text-tx" data-testid="coins-balance-value">
            {formatNumber(lang, gameState.coins)}
          </p>
        </div>
        <p className="basis-full text-xs text-mu sm:basis-auto sm:flex-1 sm:text-right">{t.deviceNote}</p>
      </section>

      {/* How to earn */}
      <section className="space-y-3" data-testid="coins-how">
        <h3 className="text-sm font-semibold text-tx">{t.howTitle}</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-s1/50 p-4">
            <p className="text-sm font-semibold text-tx">{t.dailyTitle}</p>
            <p className="mt-1 text-xs text-mu">{t.dailyHint}</p>
            <p className="mt-2 font-mono text-xs tabular-nums text-tx">{GAME_CONFIG.DAILY_REWARD_VALUES.map((v) => `+${v}`).join(" · ")}</p>
          </div>
          <div className="rounded-2xl border border-line bg-s1/50 p-4">
            <p className="text-sm font-semibold text-tx">{t.questsTitle}</p>
            <p className="mt-1 text-xs text-mu">{t.questsHint}</p>
            <ul className="mt-2 space-y-1 text-xs">
              {appQuests.map((q) => (
                <li key={q.id} className="flex justify-between gap-2">
                  <span className="text-tx">{lang === "ru" ? q.fallbackTitleRu : q.fallbackTitleEn}</span>
                  <span className="tabular-nums text-mu">+{questReward(q).coins}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-s1/50 p-4 lg:col-span-2">
            <p className="text-sm font-semibold text-tx">{t.firstTitle}</p>
            <p className="mt-1 text-xs text-mu">{t.firstHint}</p>
            <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2" data-testid="coins-first-actions">
              {FIRST_KINDS.map((k) => (
                <li key={k} className="flex justify-between gap-2" data-kind={k} data-status={firstStatus[k]}>
                  <span className="text-tx">{kinds[k]}</span>
                  <span className="tabular-nums text-mu">
                    {firstStatus[k] === "got" ? t.firstGot : firstStatus[k] === "past" ? t.firstPast : `+${GAME_CONFIG.FIRST_ACTION_REWARDS[k].coins}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-mu">
          <li>{formatString(t.capNote, { cap: GAME_CONFIG.DAILY_COIN_CAP })}</li>
          <li>{t.selfReportNote}</li>
          <li>{t.nothingNote}</li>
        </ul>
      </section>

      {/* History */}
      <section className="space-y-3" data-testid="coins-history">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-tx">{t.historyTitle}</h3>
          <Segmented<Filter>
            name={t.filterLabel}
            value={filter}
            onChange={setFilter}
            className="w-full sm:w-auto"
            options={[
              { value: "all", label: t.filterAll, tone: "neutral" },
              { value: "quest", label: t.filterQuests, tone: "neutral" },
              { value: "dailyReward", label: t.filterDaily, tone: "neutral" },
              { value: "firstAction", label: t.filterFirst, tone: "neutral" },
            ]}
          />
        </div>
        {since && (
          <p className="rounded-xl border border-line bg-s2/40 p-2.5 text-xs text-mu" data-testid="coins-history-since">
            {formatString(t.historySince, { date: since })}
          </p>
        )}
        {shown.length === 0 ? (
          <EmptyState icon={<Coins size={18} />} title={t.historyEmpty} description={t.historyEmptyHint} />
        ) : (
          <ul className="divide-y divide-line/60 rounded-2xl border border-line bg-s1/50">
            {shown.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" data-testid="coins-history-item" data-source={e.source}>
                <div className="min-w-0">
                  <p className="truncate text-tx">{what(e)}</p>
                  <p className="text-xs text-mu">{formatDate(lang, new Date(e.at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-tx">+{formatNumber(lang, e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
