"use client";

import React from "react";
import { Ban, Check, Clock } from "lucide-react";
import { useApp } from "@/lib/context";

/**
 * «Creators» — only an honest «soon» screen until the server economy (docs/quest-hub-plan.md 7, owner decision В6):
 * what the section will be and its rules. No quests, no buttons, no rewards, nothing to join.
 */
export function CreatorsSoon() {
  const { dict } = useApp();
  const c = dict.questsPage.q2.hub.creators;
  return (
    <section className="space-y-5 rounded-2xl border border-line bg-s1 bg-[radial-gradient(80%_140%_at_100%_0%,rgb(var(--c-pri)/0.2),transparent_60%)] p-5 sm:p-6" data-testid="creators-soon" aria-labelledby="creators-title">
      <div className="max-w-[620px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e5b98a]/40 bg-[#e5b98a]/[0.06] px-2.5 py-0.5 text-xs font-bold text-[#e5b98a]">
          <Clock size={12} aria-hidden="true" />
          {dict.questsPage.q2.hub.soon}
        </span>
        <h2 id="creators-title" className="mt-2 font-serif text-2xl font-bold text-tx">{c.title}</h2>
        <p className="mt-2 text-sm text-mu">{c.text}</p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{c.stepsTitle}</h3>
        <ol className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {c.steps.map((s, i) => (
            <li key={s.title} className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs text-mu">
              <span className="font-serif text-xs font-bold text-vi">{i + 1}</span>
              <span className="block text-sm font-semibold text-tx">{s.title}</span>
              {s.text}
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs text-mu">{c.when}</p>
    </section>
  );
}

const RULES_OK = ["moderated", "inApp", "once", "term"] as const;
const RULES_NO = ["noSocial", "noPaid"] as const;

/** The rules of the future section, in the rail. */
export function CreatorsRules() {
  const { dict } = useApp();
  const c = dict.questsPage.q2.hub.creators;
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="creators-rules">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-mu">{c.rulesTitle}</h3>
      <ul className="mt-2 divide-y divide-line/60 text-sm text-tx">
        {RULES_OK.map((k) => (
          <li key={k} className="flex gap-2.5 py-2">
            <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
            {c.rules[k]}
          </li>
        ))}
        {RULES_NO.map((k) => (
          <li key={k} className="flex gap-2.5 py-2">
            <Ban size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[#e5b98a]" />
            {c.rules[k]}
          </li>
        ))}
      </ul>
    </section>
  );
}
