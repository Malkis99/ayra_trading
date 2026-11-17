"use client";

import React, { useId, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { addDaysToKey } from "@/lib/day-key";
import {
  PQ_CATEGORIES,
  PQ_FIELD_MAX,
  PQ_PERIOD_DAYS,
  activeRuns,
  canStart,
  categoryOf,
  cleanField,
  type PQCategoryId,
  type PQField,
  type PQRun,
  type PQVerification,
} from "@/lib/personal-quests";
import { Modal } from "@/components/ui/Modal";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { historyTitle } from "./quest-text";
import { formatDayKey } from "./WeekTab";
import { CategoryIcon, RewardTable, VerificationLabel, newPqId } from "./PersonalQuestParts";

// QH-8.2: the five steps of a new personal quest. The start day is the account's game day (never chosen); the run is
// saved once under the lock shared by all tabs, with ids made once per wizard (a double click saves one run).

type Step = 1 | 2 | 3 | 4 | 5;
const STEP_KEYS = ["category", "title", "action", "state", "confirm"] as const;
const STEP_FIELDS: Record<Step, PQField[]> = { 1: [], 2: ["title", "goal"], 3: ["dailyAction"], 4: ["startState", "expectedResult"], 5: [] };

export function PersonalQuestWizard({ runs, onClose, onCreated }: { runs: PQRun[]; onClose: () => void; onCreated: () => void }) {
  const { dict, lang } = useApp();
  const { gameState, gameDay, createPersonalQuest } = useGame();
  const p = dict.personalQuests;
  const w = p.path.wizard;
  const minor = !!gameState.profile?.minorMode;
  // made once for this wizard: the same quest is saved once whatever happens to the button
  const ids = useRef({ id: newPqId("pq"), questId: newPqId("pqq") });
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [category, setCategory] = useState<PQCategoryId | null>(null);
  const [verification, setVerification] = useState<PQVerification | null>(null);
  const [fields, setFields] = useState<Record<PQField, string>>({ title: "", goal: "", dailyAction: "", startState: "", expectedResult: "" });
  const [error, setError] = useState("");

  const taken = useMemo(() => new Set(activeRuns(runs, gameDay).map((r) => r.category)), [runs, gameDay]);
  const cat = category ? categoryOf(category) : undefined;
  const examples = category ? ((minor && category in p.path.examplesMinor ? p.path.examplesMinor[category as "physical" | "psychology"] : p.path.examples[category]) as Record<PQField, string>) : null;
  const input = category && verification ? { ...ids.current, category, verification, ...fields } : null;

  const stepFailure = (s: Step): string => {
    if (s === 1) return !category ? p.path.errors.unknownCategory : taken.has(category) ? p.path.errors.categoryActive : "";
    if (s === 5) {
      if (!input) return p.path.errors.verificationNotAllowed;
      const f = canStart(runs, input, gameDay);
      return f ? (p.path.errors as Record<string, string>)[f] : "";
    }
    const f = STEP_FIELDS[s];
    if (f.some((k) => !cleanField(fields[k]))) return p.path.errors.missingFields;
    if (f.some((k) => cleanField(fields[k]).length > PQ_FIELD_MAX[k])) return p.path.errors.tooLong;
    return "";
  };

  const pickCategory = (id: PQCategoryId) => {
    setCategory(id);
    // the default way of confirmation is the category's first; an unavailable one is never kept
    setVerification((v) => (v && categoryOf(id)!.verification.includes(v) ? v : categoryOf(id)!.verification[0]));
    setError("");
  };
  const next = () => {
    const f = stepFailure(step);
    if (f) return setError(f);
    setError("");
    setStep((s) => Math.min(5, s + 1) as Step);
  };
  const back = () => {
    setError("");
    setStep((s) => Math.max(1, s - 1) as Step);
  };
  const create = async () => {
    if (busy.current || !input) return;
    const f = stepFailure(5);
    if (f) return setError(f);
    busy.current = true;
    setSaving(true);
    try {
      const res = await createPersonalQuest(input);
      if (res.ok) onCreated();
      else setError((p.path.errors as Record<string, string>)[res.reason ?? "notSaved"] ?? p.path.errors.notSaved);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const fmt = (k: string) => formatDayKey(k, lang, { day: "numeric", month: "long" });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={w.title}
      subtitle={`${formatString(w.step, { n: step })} · ${w.steps[STEP_KEYS[step - 1]]}`}
      closeLabel={w.cancel}
      size="lg"
      fullOnMobile
      data-testid="pq-wizard"
      footer={
        <>
          {step > 1 ? (
            <button type="button" className={buttonClasses("secondary")} onClick={back} data-testid="pq-wizard-back">
              {w.back}
            </button>
          ) : (
            <button type="button" className={buttonClasses("secondary")} onClick={onClose}>
              {w.cancel}
            </button>
          )}
          {step < 5 ? (
            <button type="button" className={buttonClasses("primary")} onClick={next} data-testid="pq-wizard-next">
              {w.next}
            </button>
          ) : (
            <button type="button" className={buttonClasses("primary")} onClick={create} disabled={saving} data-testid="pq-wizard-create">
              {saving ? w.creating : w.create}
            </button>
          )}
        </>
      }
    >
      <ol className="mb-4 grid grid-cols-5 gap-1.5" aria-label={w.title} data-testid="pq-wizard-steps">
        {STEP_KEYS.map((k, i) => (
          <li key={k} className="min-w-0" aria-current={step === i + 1 ? "step" : undefined}>
            <div className={cn("h-1.5 rounded-full", i + 1 < step ? "bg-vi" : i + 1 === step ? "bg-vi/70" : "bg-s2")} aria-hidden="true" />
            <span className={cn("mt-1 hidden truncate text-[11px] sm:block", i + 1 === step ? "font-semibold text-tx" : "text-mu")}>{w.steps[k]}</span>
          </li>
        ))}
      </ol>

      <p className="mb-4 rounded-xl border border-vi/30 bg-vi/[0.06] px-3 py-2 text-xs text-tx" data-testid="pq-wizard-note">
        {w.note}
      </p>

      {step === 1 && (
        <fieldset>
          <legend className="sr-only">{w.steps.category}</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={w.steps.category}>
            {PQ_CATEGORIES.map((c) => {
              const busyCat = taken.has(c.id);
              const selected = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busyCat}
                  onClick={() => pickCategory(c.id)}
                  data-testid={`pq-cat-${c.id}`}
                  className={cn(
                    "flex min-h-[44px] items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                    selected ? "border-vi bg-vi/10" : "border-line bg-s2/40 hover:border-vi/50",
                    busyCat && "cursor-not-allowed opacity-50 hover:border-line"
                  )}
                >
                  <CategoryIcon category={c.id} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-tx">
                      {p.categories[c.id].name}
                      {selected && <Check size={14} aria-hidden="true" className="text-vi" />}
                    </span>
                    <span className="block text-xs text-mu">{p.categories[c.id].description}</span>
                    <span className="mt-1 block text-[11px] text-go">
                      {w.achievement}: {p.achievements[c.id].name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-mu">{c.verification.map((v) => p.verification[v]).join(" · ")}</span>
                    {busyCat && <span className="mt-0.5 block text-[11px] font-semibold text-[#e5b98a]" data-testid="pq-cat-taken">{w.categoryTaken}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {(step === 2 || step === 3 || step === 4) && (
        <div className="space-y-4">
          {cat && minor && cat.minorSafeWording && (
            <p className="rounded-xl border border-line bg-s2/50 px-3 py-2 text-xs text-mu" data-testid="pq-minor-note">
              {w.minorNote}
            </p>
          )}
          {STEP_FIELDS[step].map((k) => (
            <Field key={k} name={k} value={fields[k]} example={examples?.[k]} onChange={(v) => setFields((f) => ({ ...f, [k]: v }))} />
          ))}
        </div>
      )}

      {step === 5 && cat && category && (
        <div className="space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold text-tx">{w.verificationTitle}</legend>
            <div className="mt-2 grid gap-2" role="radiogroup" aria-label={w.verificationTitle}>
              {(["app", "self"] as PQVerification[]).map((v) => {
                const allowed = cat.verification.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={verification === v}
                    disabled={!allowed}
                    onClick={() => setVerification(v)}
                    data-testid={`pq-ver-${v}`}
                    className={cn(
                      "min-h-[44px] rounded-xl border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                      verification === v ? "border-vi bg-vi/10 text-tx" : "border-line bg-s2/40 text-tx hover:border-vi/50",
                      !allowed && "cursor-not-allowed opacity-50 hover:border-line"
                    )}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      {p.verification[v]}
                      {verification === v && <Check size={14} aria-hidden="true" className="text-vi" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-mu">{allowed ? w.verification[v] : w.notAllowed}</span>
                    {allowed && v === "app" && (
                      <span className="mt-1 block text-[11px] text-tx" data-testid="pq-ver-app-checks">
                        {formatString(w.appChecks, { checks: cat.appChecks.map((id) => historyTitle(dict, id, "")).filter(Boolean).join(", ") })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <section className="rounded-xl border border-line bg-s2/40 p-3" data-testid="pq-review">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{w.reviewTitle}</h3>
            <div className="mt-2 flex items-start gap-3">
              <CategoryIcon category={category} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-xs font-semibold text-mu">{p.categories[category].name}</div>
                <div className="break-words font-serif text-lg font-bold text-tx">{cleanField(fields.title)}</div>
                <div className="mt-1 break-words text-tx">{cleanField(fields.goal)}</div>
                <div className="mt-1 break-words text-mu">{cleanField(fields.dailyAction)}</div>
              </div>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-tx">
              <li data-testid="pq-review-start">{formatString(w.start, { day: fmt(gameDay) })}</li>
              <li data-testid="pq-review-end">{formatString(w.end, { day: fmt(addDaysToKey(gameDay, PQ_PERIOD_DAYS - 1)) })}</li>
            </ul>
            {verification && <div className="mt-2"><VerificationLabel verification={verification} /></div>}
          </section>

          {verification && (
            <section className="rounded-xl border border-line bg-s2/40 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{w.rewardsTitle}</h3>
              <div className="mt-1.5"><RewardTable verification={verification} testId="pq-wizard-rewards" /></div>
              <p className="mt-2 text-xs text-mu">{w.noCoins}</p>
            </section>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger" data-testid="pq-wizard-error">
          {error}
        </p>
      )}
    </Modal>
  );
}

function Field({ name, value, example, onChange }: { name: PQField; value: string; example?: string; onChange: (v: string) => void }) {
  const { dict } = useApp();
  const w = dict.personalQuests.path.wizard;
  const id = useId();
  const f = w.fields as Record<string, string>;
  const hint = f[`${name}Hint`];
  const max = PQ_FIELD_MAX[name];
  const long = max > 100;
  const props = {
    id,
    value,
    maxLength: max,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder: example ? formatString(f.example, { text: example }) : undefined,
    "aria-describedby": `${id}-hint`,
    "data-testid": `pq-field-${name}`,
    className: "w-full rounded-lg border border-line bg-s2 px-3 py-2.5 text-sm text-tx placeholder:text-mu/70 focus-visible:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
  };
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-tx">
        {f[name]}
      </label>
      {long ? <textarea {...props} rows={3} className={cn(props.className, "mt-1 resize-y")} /> : <input type="text" {...props} className={cn(props.className, "mt-1 min-h-[44px]")} />}
      <div id={`${id}-hint`} className="mt-1 flex justify-between gap-3 text-[11px] text-mu">
        <span>{hint ?? ""}</span>
        <span aria-hidden="true">{formatString(w.counter, { n: value.length, max })}</span>
      </div>
    </div>
  );
}
