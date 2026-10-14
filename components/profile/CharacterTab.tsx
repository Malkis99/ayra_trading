"use client";

import React, { useEffect, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Character } from "@/components/Character";
import { cn } from "@/components/ui/cn";
import { HAIR_COLORS, HAIRSTYLES, OUTFITS, SKIN_TONES, type AvatarAppearance } from "@/lib/avatar";
import { sameAppearance } from "@/lib/profile";
import { CosmicStage } from "./ProfileHero";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-s1/70 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-mu">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Simple appearance editor: big preview on the left, categories on the right. Changes show in the preview at once
 * and are applied to the character everywhere only on "Save". Activity never changes the body (project rule).
 */
export function CharacterTab({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { dict, showToast } = useApp();
  const { gameState, updateAvatarAppearance } = useGame();
  const c = dict.profile.characterV2;
  const names = dict.avatar as unknown as Record<string, string>;
  const saved = gameState.profile.appearance;
  const [draft, setDraft] = useState<AvatarAppearance>(saved);
  const dirty = !sameAppearance(draft, saved);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const set = (patch: Partial<AvatarAppearance>) => setDraft((d) => ({ ...d, ...patch }));
  const save = () => {
    updateAvatarAppearance(draft);
    showToast(c.saved);
  };

  const swatch = (selected: boolean) =>
    cn(
      "relative grid h-10 w-10 place-items-center rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
      selected ? "scale-110 border-tx shadow-[0_0_0_3px_rgb(var(--c-vi)/0.55)]" : "border-transparent hover:scale-105"
    );
  const card = (selected: boolean) =>
    cn(
      "relative flex min-h-[48px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
      selected ? "border-vi bg-vi/15 text-tx" : "border-edge bg-field text-mu hover:border-vi/60 hover:text-tx"
    );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
      <div className="lg:sticky lg:top-4 lg:self-start">
        <CosmicStage>
          <div className="flex h-[300px] items-end justify-center pb-[6%] pt-4 sm:h-[380px] lg:h-[460px]" aria-label={c.preview} role="img">
            <div className="h-full" style={{ aspectRatio: "100 / 230" }}>
              <Character appearance={draft} equipment={gameState.equipment} size="fill" className="h-full w-full" />
            </div>
          </div>
        </CosmicStage>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-pri px-4 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={16} aria-hidden="true" />
            {c.save}
          </button>
          <button
            type="button"
            onClick={() => setDraft(saved)}
            disabled={!dirty}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-edge px-4 text-sm font-semibold text-tx transition hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={16} aria-hidden="true" />
            {c.reset}
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-mu" aria-live="polite">
          {dirty ? c.unsaved : c.noChanges}
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Section title={dict.avatar.skinToneLabel}>
            <div className="flex flex-wrap gap-2.5">
              {SKIN_TONES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  aria-pressed={draft.skinTone === st.id}
                  aria-label={names[st.id] || st.id}
                  title={names[st.id] || st.id}
                  onClick={() => set({ skinTone: st.id })}
                  style={{ backgroundColor: st.hex }}
                  className={swatch(draft.skinTone === st.id)}
                />
              ))}
            </div>
          </Section>
          <Section title={dict.avatar.hairColorLabel}>
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
          </Section>
        </div>

        <Section title={dict.avatar.hairstyleLabel}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {HAIRSTYLES.map((hs) => {
              const selected = draft.hairstyle === hs.id;
              return (
                <button key={hs.id} type="button" aria-pressed={selected} onClick={() => set({ hairstyle: hs.id })} className={cn(card(selected), "justify-center text-center text-xs")}>
                  {names[hs.id] || hs.id}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title={dict.avatar.outfitLabel}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {OUTFITS.map((o) => {
              const selected = draft.outfit === o.id;
              return (
                <button key={o.id} type="button" aria-pressed={selected} onClick={() => set({ outfit: o.id })} className={card(selected)}>
                  <span className="grid h-12 w-8 shrink-0 place-items-center overflow-hidden rounded bg-ink/60" aria-hidden="true">
                    <Character appearance={{ ...draft, outfit: o.id }} equipment={{}} size="avatar" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{names[o.id] || o.id}</span>
                  {selected && <Check size={16} className="shrink-0 text-vi" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </Section>

        <div className="space-y-1 rounded-xl border border-line/60 bg-s2/30 p-3 text-xs text-mu">
          <p>{c.accessoriesNote}</p>
          <p>{c.bodyNote}</p>
        </div>
      </div>
    </div>
  );
}
