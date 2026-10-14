"use client";

import React from "react";
import { Check, Lock } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { cn } from "@/components/ui/cn";
import { FRAMES } from "@/lib/items";
import { TITLES_CATALOG } from "@/lib/titles";
import { formatString } from "@/lib/i18n";
import { titleName } from "./ProfileHero";

const chip = (selected: boolean) =>
  cn(
    "inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
    selected ? "border-vi bg-vi/20 text-tx" : "border-edge bg-field text-mu hover:border-vi/60 hover:text-tx"
  );
const lockedChip = "inline-flex min-h-[36px] shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-line px-3 text-xs text-mu/80";

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
      <h3 className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-mu sm:pt-2.5">{title}</h3>
      <div role="radiogroup" aria-label={title} className="flex flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  );
}

/** Title and frame: a simple choice in two rows. Locked ones show how to unlock them. Placeholder titles are hidden. */
export function StylingRows() {
  const { dict, showToast } = useApp();
  const { gameState, selectTitle, setFrame } = useGame();
  const w2 = dict.profile.wardrobeV2;
  const achNames = dict.profile.achievements as Record<string, string>;
  const frameNames = dict.frames as unknown as Record<string, string>;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-s1/70 p-4" data-testid="wardrobe-styling">
      <Row title={w2.titleRow}>
        {TITLES_CATALOG.filter((t) => !t.isPlaceholder).map((t) => {
          const name = titleName(dict, t.id);
          if (!gameState.unlockedTitles.includes(t.id)) {
            const how = t.reqLevel
              ? formatString(w2.lockedLevel, { level: t.reqLevel })
              : t.reqAchievement
              ? formatString(w2.lockedAchievement, { name: achNames[t.reqAchievement] || t.reqAchievement })
              : "";
            return (
              <span key={t.id} className={lockedChip} title={how}>
                <Lock size={12} aria-hidden="true" />
                {name}
                {how && <span className="sr-only">: {how}</span>}
              </span>
            );
          }
          const selected = gameState.selectedTitle === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (selected) return;
                selectTitle(t.id);
                showToast(formatString(w2.titleSet, { name }));
              }}
              className={chip(selected)}
            >
              {selected && <Check size={12} strokeWidth={3} className="text-vi" aria-hidden="true" />}
              {name}
            </button>
          );
        })}
      </Row>
      <Row title={w2.frameRow}>
        {FRAMES.map((f) => {
          const name = frameNames[f.nameKey.replace("frames.", "")] || f.nameKey;
          if (gameState.level < f.reqLevel) {
            const how = formatString(w2.lockedLevel, { level: f.reqLevel });
            return (
              <span key={f.id} className={lockedChip} title={how}>
                <Lock size={12} aria-hidden="true" />
                {name}
                <span className="sr-only">: {how}</span>
              </span>
            );
          }
          const selected = gameState.frame === f.id;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (selected) return;
                setFrame(f.id);
                showToast(formatString(w2.frameSet, { name }));
              }}
              className={chip(selected)}
            >
              <span className="h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: f.color }} aria-hidden="true" />
              {name}
            </button>
          );
        })}
      </Row>
    </section>
  );
}
