"use client";

import React, { useRef, useState } from "react";
import { Award, Check, Hourglass, Lock } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import type { MissionData } from "@/lib/missions";
import { PQ_CATEGORIES, PQ_REPORT_MAX, PQ_REPORT_MIN, cleanField, rankFor, rankXp, type PQRank, type PQResult, type PQRun } from "@/lib/personal-quests";
import type { PQJourney } from "@/lib/personal-quest-days";
import { Modal } from "@/components/ui/Modal";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { formatDayKey } from "./WeekTab";
import { CATEGORY_ICONS, RewardTable, VerificationLabel, errorText } from "./PersonalQuestParts";

// QH-8.4 / QH-8.5: completing a 30-day path — the final report, the rank, the category achievement, the saved result and
// the XP it pays once (variant C). XP is shown as given only after the change is saved; never Coins.

/** Rank colours: gold only for Gold (gold is for achievements); silver and bronze in their own calm tones. */
export const RANK_TONE: Record<PQRank, string> = {
  gold: "border-go/60 bg-go/10 text-go",
  silver: "border-[#c9d1dc]/50 bg-[#c9d1dc]/10 text-[#dfe5ec]",
  bronze: "border-[#d39a6a]/50 bg-[#d39a6a]/10 text-[#e0ab7e]",
};

export function RankChip({ rank }: { rank: PQRank | null }) {
  const { dict } = useApp();
  const p = dict.personalQuests;
  return (
    <span
      data-testid="pq-rank"
      data-rank={rank ?? "none"}
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", rank ? RANK_TONE[rank] : "border-line bg-s2 text-mu")}
    >
      {rank && <Award size={11} aria-hidden="true" />}
      {p.ranks[rank ?? "none"]}
    </span>
  );
}

/** The final report form, then the result: days, rank, achievement, the XP given (once, after it is saved). */
export function CompletionDialog({ run, journey, journal, onClose }: { run: PQRun; journey: PQJourney; journal: MissionData | null; onClose: () => void }) {
  const { dict, showToast } = useApp();
  const { gameState, completePersonalQuest } = useGame();
  const p = dict.personalQuests;
  const c = p.path.complete;
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ result: PQResult; note?: "new" | "up" | "kept"; best?: PQRank; xp: number; newLevel?: number } | null>(null);
  const busy = useRef(false);
  const own = cleanField(text).length;
  const left = Math.max(0, PQ_REPORT_MIN - own);
  const waiting = run.verification === "app" && !journal;
  const expected = rankFor(journey.confirmed);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    if (left > 0) return setError(formatString(c.tooShort, { left, min: PQ_REPORT_MIN }));
    busy.current = true;
    setSaving(true);
    // the achievement before this completion: «new», «raised» or «stays» is told against it
    const before = gameState.personalAchievements?.[run.category]?.rank;
    try {
      const res = await completePersonalQuest(run.id, text, journal);
      if (res.ok && res.result) {
        const r = res.result.rank;
        const note = !r ? undefined : res.upgraded ? (before ? "up" : "new") : "kept";
        // only a saved completion gets here: what it paid, and a new level if it brought one
        setDone({ result: res.result, note, best: res.upgraded || !before ? r ?? undefined : before, xp: res.xp ?? 0, newLevel: res.leveledUp ? res.newLevel : undefined });
        showToast(res.leveledUp && res.newLevel ? formatString(dict.chronicleEvents.levelUp, { level: res.newLevel }) : res.xp ? `${c.done} ${formatString(c.paidXp, { xp: res.xp })}` : c.done);
      } else setError(errorText(dict, res.reason));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title={done ? c.resultTitle : c.title} subtitle={`${p.categories[run.category].name} · ${run.title}`} closeLabel={c.close} size="lg" fullOnMobile data-testid="pq-complete">
      {done ? (
        <ResultBlock run={{ ...run, result: done.result, report: { at: done.result.at, text: cleanField(text) } }} result={done.result} achievementNote={done.note} bestRank={done.best} paid={{ xp: done.xp, newLevel: done.newLevel }} reveal />
      ) : (
        <form onSubmit={submit} className="space-y-4" data-testid="pq-complete-form">
          <p className="text-sm text-tx">{c.intro}</p>
          <section className="rounded-xl border border-line bg-s2/40 p-3">
            <p className="font-serif text-lg font-bold text-tx" data-testid="pq-complete-summary">
              {formatString(c.summary, { n: journey.confirmed })}
            </p>
            <p className="mt-0.5 text-xs text-mu">{c.summaryHint}</p>
            <p className="mt-2 text-sm text-tx" data-testid="pq-complete-expected" data-rank={expected ?? "none"}>
              {expected ? formatString(c.expected, { rank: p.ranks[expected] }) : c.expectedNone}
            </p>
            <p className="mt-1 text-xs text-mu" data-testid="pq-complete-willpay">
              {expected ? formatString(c.willPay, { rank: p.ranks[expected], xp: rankXp(expected, run.verification) }) : c.willPayNone}
            </p>
            <div className="mt-2"><RewardTable verification={run.verification} testId="pq-complete-rewards" /></div>
          </section>
          {waiting && (
            <p className="inline-flex items-center gap-2 text-sm text-[#e5b98a]" data-testid="pq-complete-pending">
              <Hourglass size={15} aria-hidden="true" />
              {c.pending}
            </p>
          )}
          <div>
            <label htmlFor="pq-report" className="text-sm font-semibold text-tx">
              {c.report}
            </label>
            <textarea
              id="pq-report"
              rows={6}
              maxLength={PQ_REPORT_MAX}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError("");
              }}
              aria-describedby="pq-report-hint"
              data-testid="pq-report"
              className="mt-1 w-full resize-y rounded-lg border border-line bg-s2 px-3 py-2 text-sm text-tx focus-visible:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            />
            <div id="pq-report-hint" className="mt-1 flex justify-between gap-3 text-[11px] text-mu">
              <span>{formatString(c.reportHint, { min: PQ_REPORT_MIN })}</span>
              <span data-testid="pq-report-counter" className={own >= PQ_REPORT_MIN ? "text-success" : undefined}>
                {formatString(c.counter, { n: own, min: PQ_REPORT_MIN })}
              </span>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger" data-testid="pq-complete-error">
              {error}
            </p>
          )}
          <button type="submit" className={buttonClasses("primary")} disabled={saving || waiting} data-testid="pq-complete-submit">
            <Check size={16} aria-hidden="true" />
            {saving ? c.submitting : c.submit}
          </button>
        </form>
      )}
    </Modal>
  );
}

/** A completed path: days, rank, achievement and the saved final report. */
export function ResultBlock({
  run,
  result,
  achievementNote,
  bestRank,
  paid,
  reveal,
}: {
  run: PQRun;
  result: PQResult;
  achievementNote?: "new" | "up" | "kept";
  bestRank?: PQRank;
  /** Just completed: the XP this completion paid and a new level; otherwise read from the saved ledger. */
  paid?: { xp: number; newLevel?: number };
  reveal?: boolean;
}) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  // the saved ledger says whether this completion paid XP (runs completed before QH-8.5 did not)
  const entry = (gameState.personalLedger ?? []).find((e) => e.runId === run.id);
  const paidXp = paid ? paid.xp : entry?.paid ? entry.xp : null;
  const p = dict.personalQuests;
  const c = p.path.complete;
  const name = p.achievements[run.category].name;
  const Icon = CATEGORY_ICONS[run.category];
  return (
    <section className="space-y-3" data-testid="pq-result" data-rank={result.rank ?? "none"} data-days={result.days}>
      <div className={cn("flex items-center gap-4 rounded-2xl border p-4", result.rank ? RANK_TONE[result.rank] : "border-line bg-s2/40 text-tx", reveal && "motion-safe:animate-[ayraSheetUp_320ms_ease-out]")}>
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-current/30 bg-black/20" aria-hidden="true">
          {result.rank ? <Award size={26} /> : <Icon size={24} />}
        </span>
        <div className="min-w-0">
          <p className="font-serif text-xl font-bold" data-testid="pq-result-title">
            {result.rank ? formatString(c.rank, { rank: p.ranks[result.rank] }) : c.noRank}
          </p>
          <p className="text-sm text-tx" data-testid="pq-result-days">{formatString(c.resultDays, { n: result.days })}</p>
          <p className="mt-0.5 text-xs text-mu">{formatString(c.completedOn, { date: formatDayKey(result.day, lang, { day: "numeric", month: "long" }) })}</p>
        </div>
      </div>
      {result.rank ? (
        <p className="inline-flex items-center gap-2 text-sm text-tx" data-testid="pq-result-achievement" data-note={achievementNote ?? ""}>
          <Icon size={15} aria-hidden="true" className="text-go" />
          {achievementNote === "up"
            ? formatString(c.achievementUp, { name, rank: p.ranks[result.rank] })
            : achievementNote === "kept"
              ? formatString(c.achievementKept, { name, rank: p.ranks[bestRank ?? result.rank] })
              : formatString(c.achievementNew, { name, rank: p.ranks[result.rank] })}
        </p>
      ) : (
        <p className="text-sm text-mu" data-testid="pq-result-norank">{formatString(c.noRankText, { n: result.days })}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <VerificationLabel verification={result.verification} />
        {paidXp === null ? (
          <span className="text-xs text-mu" data-testid="pq-result-unpaid">{c.unpaid}</span>
        ) : (
          <span className={cn("text-sm font-semibold", paidXp > 0 ? "text-tx" : "text-mu")} data-testid="pq-result-xp" data-xp={paidXp}>
            {paidXp > 0 ? formatString(c.paidXp, { xp: paidXp }) : c.paidNone}
          </span>
        )}
        {paid?.newLevel && (
          <span className="text-sm font-semibold text-vi" data-testid="pq-result-levelup">{formatString(c.levelUp, { level: paid.newLevel })}</span>
        )}
      </div>
      {run.report && (
        <div className="rounded-xl border border-line bg-s2/40 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{c.reportTitle}</h3>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-tx" data-testid="pq-result-report">{run.report.text}</p>
        </div>
      )}
    </section>
  );
}

/** The six category achievements with their best rank, date and way of confirmation (QH-8.4). */
export function CategoryAchievements() {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const p = dict.personalQuests;
  const b = p.path.achievementsBlock;
  const all = gameState.personalAchievements ?? {};
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="pq-achievements" aria-labelledby="pq-achievements-title">
      <h3 id="pq-achievements-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{b.title}</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {PQ_CATEGORIES.map((cat) => {
          const a = all[cat.id];
          const Icon = CATEGORY_ICONS[cat.id];
          return (
            <li
              key={cat.id}
              data-testid="pq-achievement"
              data-category={cat.id}
              data-rank={a?.rank ?? "none"}
              className={cn("flex items-start gap-2.5 rounded-xl border p-2.5", a ? RANK_TONE[a.rank] : "border-line bg-s2/30")}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", a ? "bg-black/20" : "bg-s2 text-mu")} aria-hidden="true">
                {a ? <Icon size={17} /> : <Lock size={15} />}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold", a ? "text-tx" : "text-mu")}>{p.achievements[cat.id].name}</p>
                <p className="text-[11px] text-mu">{p.categories[cat.id].name}</p>
                {a ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold">{formatString(b.earned, { rank: p.ranks[a.rank], date: formatDayKey(a.day, lang, { day: "numeric", month: "short" }) })}</span>
                    <VerificationLabel verification={a.verification} />
                  </div>
                ) : (
                  <p className="mt-0.5 text-[11px] text-mu">{b.hint}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
