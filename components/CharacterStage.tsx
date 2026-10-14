"use client";

import React, { useRef, useState } from "react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { Character } from "@/components/Character";
import { cn } from "@/components/ui/cn";
import { SlotName, ITEMS, FRAMES, SLOT_KEY_MAP, LEFT_SLOTS, RIGHT_SLOTS } from "@/lib/items";
import { formatString } from "@/lib/i18n";
import type { AvatarAppearance } from "@/lib/avatar";
import {
  DEFAULT_STAGE_BACKGROUND,
  STAGE_BACKGROUNDS,
  isStageBackgroundUnlocked,
  type StageBackground,
} from "@/lib/stage-backgrounds";
import { StageBackdrop } from "@/components/profile/StageBackdrop";
import { usePrefersReducedMotion } from "@/components/awakening/usePageVisible";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Crown,
  Footprints,
  Glasses,
  Hand,
  Layers,
  Lock,
  RotateCcw,
  Shirt,
  Sparkles,
  Wind,
  type LucideIcon,
} from "lucide-react";

/** Icon per slot type (the 10 slots of the wardrobe model, lib/items SLOTS). */
export const SLOT_ICONS: Record<string, LucideIcon> = {
  head: Crown,
  top: Shirt,
  outer: Layers,
  bottom: Shirt,
  shoes: Footprints,
  cloak: Wind,
  gloves: Hand,
  accessory: Glasses,
  aura: Sparkles,
  companion: Bot,
};

const TURN_STEP = 45;

interface CharacterStageProps {
  /** What to draw: the saved appearance or the unsaved draft from the appearance editor. */
  appearance: AvatarAppearance;
  onSlotClick?: (slot: SlotName) => void;
  selectedSlot?: SlotName | null;
}

/**
 * Profile stage: the one <Character/> large in the centre on the chosen background, turned by dragging or the
 * left/right buttons (front and back drawings with a CSS 3D turn — the figure is flat 2D art), 5 + 5 equipment
 * slots linked to the stage (a scrollable row on phones) and the background picker.
 */
export function CharacterStage({ appearance, onSlotClick, selectedSlot }: CharacterStageProps) {
  const { gameState, effectiveEquipment, updateAvatarAppearance } = useGame();
  const { dict, showToast } = useApp();
  const st = dict.profile.stage;
  const reduced = usePrefersReducedMotion();
  const slotNames = dict.slots as unknown as Record<string, string>;
  const itemNames = dict.items as unknown as Record<string, string>;
  const achNames = dict.profile.achievements as Record<string, string>;
  const bgNames = st.bgNames as Record<string, string>;

  const [ry, setRy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);

  const frameColor = FRAMES[gameState.frame]?.color || "#2a2a35";
  const saved = gameState.profile.appearance;
  const bgId = saved.stageBackground ?? DEFAULT_STAGE_BACKGROUND;

  const turn = (deg: number) => setRy((v) => v + deg);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    startX.current = e.clientX;
    setRy((v) => v + dx * 0.8);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setDragging(false);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      turn(-(e.shiftKey ? TURN_STEP : 15));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      turn(e.shiftKey ? TURN_STEP : 15);
    }
  };

  const pickBackground = (bg: StageBackground) => {
    const name = bgNames[bg.id] || bg.id;
    if (!isStageBackgroundUnlocked(bg, gameState.achievements)) {
      showToast(formatString(st.bgLocked, { name: achNames[bg.unlockAchievement ?? ""] || bg.unlockAchievement || "" }));
      return;
    }
    if (bg.id === bgId) return;
    updateAvatarAppearance({ ...saved, stageBackground: bg.id });
    showToast(formatString(st.bgSet, { name }));
  };

  const renderSlot = (slot: SlotName, side: "left" | "right" | "row") => {
    const itemIndex = effectiveEquipment[slot];
    const item = itemIndex != null ? ITEMS[itemIndex] : null;
    const key = SLOT_KEY_MAP[slot] || "top";
    const slotLabel = slotNames[key] || slot;
    const itemLabel = item ? itemNames[item.nameKey.replace("items.", "")] || item.nameKey : "";
    const Icon = SLOT_ICONS[key] || Shirt;
    const selected = selectedSlot === slot;
    const rare = !!item && item.rarity > 0;
    const label = item ? formatString(st.slotFilled, { slot: slotLabel, item: itemLabel }) : formatString(st.slotEmpty, { slot: slotLabel });
    return (
      <li key={slot} className={cn("relative shrink-0", side !== "row" && "flex items-center", side === "right" && "flex-row-reverse")}>
        <button
          type="button"
          data-testid="stage-slot"
          data-slot={slot}
          data-filled={!!item}
          onClick={() => onSlotClick?.(slot)}
          aria-label={label}
          title={label}
          aria-haspopup="dialog"
          className={cn(
            "relative grid h-12 w-12 place-items-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
            "[clip-path:polygon(8px_0,100%_0,100%_calc(100%-8px),calc(100%-8px)_100%,0_100%,0_8px)]",
            item ? (rare ? "border-go/70 bg-go/10" : "border-vi/50 bg-s2") : "border-dashed border-line bg-s1/70 text-mu hover:border-vi/60 hover:text-tx",
            selected && "border-vi bg-vi/20"
          )}
        >
          {item ? (
            <span className="grid h-7 w-7 place-items-center rounded-md shadow-inner" style={{ backgroundColor: item.color }} aria-hidden="true">
              <Icon size={15} className="text-white drop-shadow" />
            </span>
          ) : (
            <Icon size={18} aria-hidden="true" className="opacity-70" />
          )}
        </button>
        {side !== "row" && <span aria-hidden="true" className="h-px w-3 bg-gradient-to-r from-vi/50 to-vi/10" />}
      </li>
    );
  };

  return (
    <section aria-label={st.label} className="rounded-2xl border bg-s1/80 p-3 shadow-[0_0_40px_-18px_rgba(163,138,209,0.7)] lg:p-4" style={{ borderColor: `${frameColor}99` }}>
      <div className="lg:grid lg:grid-cols-[60px_minmax(0,1fr)_60px] lg:items-center">
        <ul aria-label={st.slotsLabel} className="hidden flex-col gap-3 lg:flex">
          {LEFT_SLOTS.map((s) => renderSlot(s, "left"))}
        </ul>

        {/* Scene */}
        <div
          className="relative h-[45dvh] min-h-[300px] overflow-hidden rounded-xl border border-white/5 lg:h-[min(70vh,640px)] lg:min-h-[560px]"
          data-testid="profile-stage"
          data-background={bgId}
        >
          <StageBackdrop id={bgId} />
          <div
            tabIndex={0}
            role="group"
            aria-label={st.dragHint}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={() => setDragging(false)}
            onKeyDown={onKeyDown}
            className="absolute inset-0 flex cursor-grab touch-pan-y select-none items-end justify-center pb-[7%] pt-[5%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi active:cursor-grabbing"
          >
            <div className="relative h-full" style={{ aspectRatio: "100 / 230", perspective: "1200px" }}>
              <div
                className={cn("relative h-full w-full", !dragging && !reduced && "transition-transform duration-300 ease-out")}
                style={{ transformStyle: "preserve-3d", transform: `rotateY(${ry}deg)` }}
              >
                <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
                  <Character appearance={appearance} equipment={effectiveEquipment} size="fill" className="h-full w-full" />
                </div>
                <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                  <Character appearance={appearance} equipment={effectiveEquipment} size="fill" variant="back" className="h-full w-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Turn controls */}
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/55 p-1 backdrop-blur-md">
              <button type="button" onClick={() => turn(-TURN_STEP)} aria-label={st.rotateLeft} title={st.rotateLeft} className="grid h-9 w-9 place-items-center rounded-full text-tx transition hover:bg-pri/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setRy(0)} aria-label={st.resetView} title={st.resetView} className="grid h-9 w-9 place-items-center rounded-full text-tx transition hover:bg-pri/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
                <RotateCcw size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => turn(TURN_STEP)} aria-label={st.rotateRight} title={st.rotateRight} className="grid h-9 w-9 place-items-center rounded-full text-tx transition hover:bg-pri/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <ul aria-label={st.slotsLabel} className="hidden flex-col items-end gap-3 lg:flex">
          {RIGHT_SLOTS.map((s) => renderSlot(s, "right"))}
        </ul>
      </div>

      {/* Phones and tablets: all slots in one scrollable row */}
      <ul aria-label={st.slotsLabel} className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {[...LEFT_SLOTS, ...RIGHT_SLOTS].map((s) => renderSlot(s, "row"))}
      </ul>

      {/* Background picker */}
      <div className="mt-3">
        <p id="stage-bg-label" className="mb-1.5 text-xs font-semibold text-mu">
          {st.backgrounds}
        </p>
        <div role="radiogroup" aria-labelledby="stage-bg-label" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STAGE_BACKGROUNDS.map((bg) => {
            const unlocked = isStageBackgroundUnlocked(bg, gameState.achievements);
            const selected = bg.id === bgId;
            const name = bgNames[bg.id] || bg.id;
            const how = unlocked ? "" : formatString(st.bgLocked, { name: achNames[bg.unlockAchievement ?? ""] || "" });
            return (
              <button
                key={bg.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!unlocked || undefined}
                aria-label={unlocked ? name : `${name}. ${how}`}
                title={unlocked ? name : how}
                data-testid="stage-bg-option"
                data-bg={bg.id}
                onClick={() => pickBackground(bg)}
                className={cn(
                  "relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
                  selected ? "border-vi" : bg.rare ? "border-go/60" : "border-transparent hover:border-vi/50",
                  !unlocked && "cursor-not-allowed"
                )}
              >
                <StageBackdrop id={bg.id} />
                {!unlocked && (
                  <span className="absolute inset-0 grid place-items-center bg-black/55 text-tx/80" aria-hidden="true">
                    <Lock size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
