"use client";

import React from "react";
import { useApp } from "@/lib/context";

/** How the streak counts — a short rule in the History rail, with the shield's description. */
export function StreakRuleCard() {
  const { dict } = useApp();
  const t = dict.questsPage.disciplineTab;
  return (
    <section className="rounded-2xl border border-line bg-s1 p-4" data-testid="streak-rule">
      <h3 className="text-sm font-bold text-tx">{dict.questsPage.q2.hub.streakTitle}</h3>
      <p className="mt-1.5 text-sm text-mu">{dict.questsPage.q1.discipline.streakRule}</p>
      <p className="mt-2 text-sm text-mu">{t.shieldDesc}</p>
    </section>
  );
}
