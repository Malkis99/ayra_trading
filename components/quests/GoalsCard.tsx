"use client";

import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { GAME_CONFIG } from "@/lib/game-config";
import { normalizeGoalTitle } from "@/lib/game";
import type { QuestCategory } from "@/lib/quests";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const CATEGORIES: QuestCategory[] = ["Trading", "Discipline", "Psychology", "Physical", "Mental", "Social", "Lifestyle"];

/**
 * «My goals» (the former «Path» tab, docs/quest-hub-plan.md 1): personal goals in the progress rail — add, list,
 * delete with a confirmation. No rewards. Growth branches come later with real progress.
 */
export function GoalsCard() {
  const { dict, showToast } = useApp();
  const h = dict.questsPage.q2.hub;
  const { gameState, addCustomGoal, removeCustomGoal } = useGame();
  const p = dict.questsPage.q1.path;
  const g = dict.questsPage.goalsTab;
  const max = GAME_CONFIG.MAX_CUSTOM_GOALS;
  const maxLen = GAME_CONFIG.CUSTOM_GOAL_TITLE_MAX;

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<QuestCategory>("Trading");
  const [touched, setTouched] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);

  const full = gameState.customGoals.length >= max;
  const clean = normalizeGoalTitle(title);
  const length = title.replace(/\s+/g, " ").trim().length;
  const error = !touched ? null : length === 0 ? p.errorEmpty : length > maxLen ? formatString(p.errorLong, { max: maxLen }) : null;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!clean) return;
    if (!addCustomGoal(clean, category)) {
      showToast(full ? formatString(p.errorLimit, { max }) : dict.questsPage.q1.today.notSaved);
      return;
    }
    setTitle("");
    setTouched(false);
    setAdding(false);
    showToast(g.goalAddedToast);
  };

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-s1 p-4" data-testid="goals-card" aria-labelledby="goals-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="goals-title" className="text-sm font-bold text-tx">{h.goalsTitle}</h3>
        {!adding && (
          <Button variant="ghost" className="-mr-3 gap-1 text-vi" onClick={() => setAdding(true)} disabled={full} data-testid="goal-add" aria-label={g.addGoalBtn}>
            <Plus size={15} aria-hidden="true" />
            {h.goalsAdd}
          </Button>
        )}
      </div>
      {full && <p className="text-xs text-mu">{formatString(p.errorLimit, { max })}</p>}

      {adding && (
        <form onSubmit={save} className="space-y-3 rounded-xl bg-s2/60 p-3" noValidate>
          <div>
            <label htmlFor="goal-title" className="sr-only">
              {g.goalTitlePlaceholder}
            </label>
            <input
              id="goal-title"
              data-testid="goal-title"
              type="text"
              value={title}
              maxLength={maxLen + 20}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={g.goalTitlePlaceholder}
              aria-invalid={!!error || undefined}
              aria-describedby="goal-title-help"
              className="input w-full"
            />
            <div id="goal-title-help" className="mt-1 flex justify-between gap-2 text-xs">
              <span className={error ? "text-danger" : "text-mu"} data-testid="goal-error">{error || ""}</span>
              <span className={length > maxLen ? "text-danger" : "text-mu"}>{formatString(p.counter, { n: length, max: maxLen })}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label htmlFor="goal-category" className="text-mu">
              {g.categoryLabel}
            </label>
            <select id="goal-category" value={category} onChange={(e) => setCategory(e.target.value as QuestCategory)} className="input">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {dict.categories[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setTitle("");
                setTouched(false);
              }}
            >
              {g.cancelBtn}
            </Button>
            <Button type="submit" disabled={!clean} data-testid="goal-save">
              {g.saveBtn}
            </Button>
          </div>
        </form>
      )}

      {gameState.customGoals.length === 0 ? (
        !adding && <p className="text-sm text-mu">{p.empty}</p>
      ) : (
        <ul className="divide-y divide-line/60" data-testid="goal-list">
          {gameState.customGoals.map((goal) => (
            <li key={goal.id} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold text-tx [overflow-wrap:anywhere]">{goal.title}</div>
                <div className="mt-0.5 text-xs text-mu">{dict.categories[goal.category as QuestCategory] || goal.category}</div>
              </div>
              <button
                type="button"
                onClick={() => setDeleting({ id: goal.id, title: goal.title })}
                aria-label={`${g.deleteBtn}: ${goal.title}`}
                className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-md text-mu hover:bg-s2 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {gameState.customGoals.length > 0 && <p className="text-xs text-mu">{formatString(h.goalsCount, { n: gameState.customGoals.length, max })}</p>}

      {deleting && (
        <ConfirmDialog
          isOpen
          isDanger
          title={g.deleteBtn}
          description={deleting.title}
          confirmLabel={g.deleteBtn}
          cancelLabel={g.cancelBtn}
          onConfirm={() => {
            removeCustomGoal(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
