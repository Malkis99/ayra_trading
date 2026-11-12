"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronDown, Moon, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatNumber, formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { QUEST_POOL, type QuestTemplate } from "@/lib/quests";
import { Button, buttonClasses } from "@/components/ui/Button";
import { QuestCard } from "./QuestCard";
import { questTitle } from "./quest-text";

interface Props {
  core: QuestTemplate[];
  bonus: QuestTemplate[];
  replacedFrom: Record<string, string>;
  earned: { xp: number; coins: number };
  busyId: string | null;
  onComplete: (q: QuestTemplate) => void;
  onPass: (q: QuestTemplate) => void;
  onReplace: (q: QuestTemplate) => void;
}

export function TodayTab({ core, bonus, replacedFrom, earned, busyId, onComplete, onPass, onReplace }: Props) {
  const { dict, lang } = useApp();
  const { gameState, toggleRestDay } = useGame();
  const t = dict.questsPage.q1.today;
  const [bonusOpen, setBonusOpen] = useState(false);

  const visible = (q: QuestTemplate) => !gameState.passedQuestsToday[q.id] || !!gameState.completedQuestsToday[q.id];
  const coreShown = core.filter(visible);
  const bonusShown = bonus.filter(visible);
  const fromTitle = (id: string) => {
    const from = replacedFrom[id];
    const tpl = from ? QUEST_POOL.find((x) => x.id === from) : undefined;
    return tpl ? questTitle(dict, lang, tpl) : undefined;
  };

  const card = (q: QuestTemplate, compact = false) => (
    <QuestCard
      key={q.id}
      quest={q}
      compact={compact}
      done={!!gameState.completedQuestsToday[q.id]}
      replacedFromTitle={fromTitle(q.id)}
      busy={busyId === q.id}
      replaceUsed={gameState.replacementsUsedToday}
      replaceMax={GAME_CONFIG.QUEST_REPLACEMENTS_PER_DAY}
      onComplete={() => onComplete(q)}
      onPass={() => onPass(q)}
      onReplace={() => onReplace(q)}
    />
  );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mu" data-testid="today-earned">
            {formatString(t.earned, { xp: formatNumber(lang, earned.xp), coins: formatNumber(lang, earned.coins) })}
          </p>
          <Button variant={gameState.isRestDay ? "primary" : "secondary"} aria-pressed={gameState.isRestDay} onClick={toggleRestDay} data-testid="rest-toggle">
            <Moon size={16} aria-hidden="true" />
            {gameState.isRestDay ? t.restOff : t.restOn}
          </Button>
        </div>

        {gameState.isRestDay ? (
          <div className="rounded-lg border border-line bg-s1 px-5 py-10 text-center" data-testid="rest-panel">
            <Moon size={30} aria-hidden="true" className="mx-auto text-vi" />
            <h3 className="mt-2 font-serif text-lg font-bold text-tx">{t.restTitle}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-mu">{t.restHint}</p>
          </div>
        ) : (
          <>
            <section className="space-y-3" aria-labelledby="core-title">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="core-title" className="text-[15px] font-semibold text-tx">{dict.questsPage.todayTab.coreTitle}</h2>
                <span className="text-sm text-mu">
                  {core.filter((q) => gameState.completedQuestsToday[q.id]).length} / {core.length}
                </span>
              </div>
              {coreShown.length > 0 ? coreShown.map((q) => card(q)) : <p className="rounded-lg bg-s2/60 p-4 text-sm text-mu">{t.allClear}</p>}
            </section>

            <section className="space-y-3">
              <button
                type="button"
                aria-expanded={bonusOpen}
                onClick={() => setBonusOpen((v) => !v)}
                className="flex min-h-[44px] w-full items-center justify-between rounded-md px-1 text-left text-[15px] font-semibold text-tx hover:text-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              >
                {formatString(t.bonusToggle, { n: bonusShown.length })}
                <ChevronDown size={18} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${bonusOpen ? "rotate-180" : ""}`} />
              </button>
              {bonusOpen && bonusShown.map((q) => card(q, true))}
            </section>
          </>
        )}
      </div>

      <aside className="min-w-0 space-y-4">
        <div className="rounded-lg border border-line bg-s1 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} aria-hidden="true" className="text-vi" />
            <h2 className="text-[15px] font-semibold text-tx">{t.noTradeTitle}</h2>
          </div>
          <p className="mt-1.5 text-sm text-mu">{t.noTradeDesc}</p>
          <Link href="/journal?tab=trades" className={buttonClasses("ghost", "md", "mt-2 -ml-2")}>
            {t.noTradeCta}
          </Link>
        </div>
        <p className="rounded-lg bg-s2/60 p-3 text-xs text-mu">{t.restHint}</p>
      </aside>
    </div>
  );
}
