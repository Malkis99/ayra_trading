"use client";

import React from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatNumber, formatString } from "@/lib/i18n";
import { cn } from "@/components/ui/cn";

type Props = {
  step: number;
  subStep: number;
  questionsInStep: number;
  /** Jump back to a finished step (only past steps are clickable). */
  onGoToStep: (step: number) => void;
  email?: string | null;
  onSignOut?: () => void;
  readOnly?: boolean;
  editMode?: boolean;
  returnLabel?: string;
};

/**
 * Onboarding header with a fixed height: logo left, 5-segment progress centred, account and language right.
 * Labels sit exactly under their segments; on phones only the active label is shown.
 */
export function AwakeningHeader({ step, subStep, questionsInStep, onGoToStep, email, onSignOut, readOnly, editMode, returnLabel }: Props) {
  const { dict, lang, setLanguage } = useApp();
  const a = dict.awakening;
  const names = a.stepNames as Record<string, string>;
  const fill = step >= 5 ? 1 : questionsInStep > 0 ? Math.min(1, (subStep + 1) / questionsInStep) : 0;

  return (
    <header className="relative z-20 h-[92px] shrink-0 border-b border-line/50 bg-ink/85 backdrop-blur-md md:h-[96px]">
      {/* Same grid as the page: logo at the left padding, account block on the right edge of the question column
          (right column = 55% of the width, the question column is --aw-col wide and centred in it) */}
      <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[40px_auto] content-center items-center gap-x-3 gap-y-1 pl-[var(--aw-pad,16px)] pr-[var(--aw-pad,16px)] md:grid-cols-[auto_minmax(0,1fr)_auto] md:grid-rows-1 md:gap-6 md:pr-[calc(var(--aw-pad)_+_max(0px,_(55%_-_2_*_var(--aw-pad)_-_var(--aw-col))_/_2))]">
        <Link href="/" className="col-start-1 row-start-1 justify-self-start font-serif text-lg font-bold tracking-[0.2em] text-tx hover:opacity-80 md:text-xl">
          AYRA
        </Link>

        <nav aria-label={formatString(a.questionProgress, { step: step, subStep: subStep + 1, totalSubSteps: questionsInStep })} className="col-span-2 row-start-2 mx-auto w-full min-w-0 max-w-[560px] md:col-span-1 md:col-start-2 md:row-start-1">
          <ol className="grid grid-cols-5 gap-1.5 md:gap-2.5">
            {[1, 2, 3, 4, 5].map((st) => {
              const past = st < step;
              const current = st === step;
              const label = names[`step${st}`];
              return (
                <li key={st} className="min-w-0">
                  <button
                    type="button"
                    disabled={!past || readOnly}
                    onClick={() => past && onGoToStep(st)}
                    aria-current={current ? "step" : undefined}
                    aria-label={past ? formatString(a.wow.goToStep, { name: label }) : label}
                    className={cn(
                      "group flex w-full flex-col items-center gap-1.5 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                      past ? "cursor-pointer" : "cursor-default"
                    )}
                  >
                    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out",
                          past ? "bg-vi group-hover:bg-tx" : "bg-gradient-to-r from-pri to-vi"
                        )}
                        style={{ width: past ? "100%" : current ? `${Math.max(8, fill * 100)}%` : "0%" }}
                      />
                    </span>
                    <span
                      className={cn(
                        "w-full truncate text-center text-xs",
                        current ? "font-semibold text-tx" : past ? "text-mu group-hover:text-tx" : "text-mu/60",
                        !current && "hidden md:block"
                      )}
                    >
                      {label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {step <= 4 && (
            <p className="mt-0.5 whitespace-nowrap text-center text-xs text-mu">
              {formatString(a.questionProgress, {
                step: formatNumber(lang, step),
                subStep: formatNumber(lang, subStep + 1),
                totalSubSteps: formatNumber(lang, questionsInStep),
              })}
            </p>
          )}
        </nav>

        <div data-testid="awakening-account" className="col-start-2 row-start-1 flex items-center justify-self-end gap-2 md:col-start-3">
          {email && (
            <div className="flex items-center gap-1 rounded-md border border-line bg-s2/70 py-1 pl-2.5 pr-1 text-xs">
              <span className="hidden max-w-[180px] truncate text-mu lg:inline" title={email}>
                {dict.auth.headerUserEmail}: <span className="text-tx">{email}</span>
              </span>
              <button
                type="button"
                onClick={onSignOut}
                title={dict.topbar.logout}
                className="grid h-8 w-8 place-items-center rounded text-mu hover:bg-s2 hover:text-short focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              >
                <LogOut size={15} aria-hidden="true" />
                <span className="sr-only">{dict.topbar.logout}</span>
              </button>
            </div>
          )}
          <div className="flex items-center rounded-md border border-line bg-s2/70 p-0.5" role="group" aria-label={a.q.language_timezone.languageLabel}>
            {(["ru", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                disabled={readOnly}
                aria-pressed={lang === l}
                onClick={() => setLanguage(l)}
                className={cn(
                  "h-8 min-w-[34px] rounded px-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-50",
                  lang === l ? "bg-pri text-white" : "text-mu hover:text-tx"
                )}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {editMode && returnLabel && (
            <Link href="/settings" className="hidden rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-tx hover:border-vi md:inline-flex">
              {returnLabel}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
