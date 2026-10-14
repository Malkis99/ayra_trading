"use client";

import React from "react";
import { RotateCcw, Save } from "lucide-react";
import { useApp } from "@/lib/context";
import { cn } from "@/components/ui/cn";
import { HAIR_COLORS, HAIRSTYLES, type AvatarAppearance } from "@/lib/avatar";

type Props = {
  draft: AvatarAppearance;
  onChange: (next: AvatarAppearance) => void;
  dirty: boolean;
  onSave: () => void;
  onReset: () => void;
};

/**
 * "Appearance" at the top of the Wardrobe tab: hair colour and hairstyle only. Skin tone and outfit style chosen in
 * onboarding stay in the data and are used, but are not changed here; clothes change only through equipment slots.
 * The draft shows on the stage at once; Save applies it everywhere, Reset returns the saved look.
 */
export function AppearanceSection({ draft, onChange, dirty, onSave, onReset }: Props) {
  const { dict } = useApp();
  const c = dict.profile.characterV2;
  const a3 = dict.profile.appearanceV3;
  const names = dict.avatar as unknown as Record<string, string>;
  const set = (patch: Partial<AvatarAppearance>) => onChange({ ...draft, ...patch });

  const swatch = (selected: boolean) =>
    cn(
      "h-9 w-9 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
      selected ? "scale-110 border-tx shadow-[0_0_0_3px_rgb(var(--c-vi)/0.55)]" : "border-transparent hover:scale-105"
    );
  const card = (selected: boolean) =>
    cn(
      "relative flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
      selected ? "border-vi bg-vi/15 text-tx" : "border-edge bg-field text-mu hover:border-vi/60 hover:text-tx"
    );
  const h = "mb-2 text-xs font-semibold uppercase tracking-wide text-mu";

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-s1/70 p-4" data-testid="appearance-section" aria-labelledby="appearance-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="appearance-title" className="text-sm font-semibold text-tx">
            {a3.title}
          </h2>
          <p className="mt-0.5 text-xs text-mu">{a3.hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={!dirty}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-edge px-3 text-sm font-semibold text-tx transition hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={15} aria-hidden="true" />
            {c.reset}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-pri px-3 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={15} aria-hidden="true" />
            {c.save}
          </button>
        </div>
      </div>
      <p className="text-xs text-mu" aria-live="polite">
        {dirty ? c.unsaved : c.noChanges}
      </p>

      <div>
        <h3 className={h}>{dict.avatar.hairColorLabel}</h3>
        <div className="flex flex-wrap gap-2.5">
          {HAIR_COLORS.map((hc) => (
            <button
              key={hc.id}
              type="button"
              aria-pressed={draft.hairColor === hc.id}
              aria-label={names[hc.id] || hc.id}
              title={names[hc.id] || hc.id}
              onClick={() => set({ hairColor: hc.id })}
              style={{ backgroundColor: hc.hex }}
              className={swatch(draft.hairColor === hc.id)}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className={h}>{dict.avatar.hairstyleLabel}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {HAIRSTYLES.map((hs) => (
            <button key={hs.id} type="button" aria-pressed={draft.hairstyle === hs.id} onClick={() => set({ hairstyle: hs.id })} className={cn(card(draft.hairstyle === hs.id), "justify-center text-center")}>
              {names[hs.id] || hs.id}
            </button>
          ))}
        </div>
      </div>

    </section>
  );
}
