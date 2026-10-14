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

/** Cut-corner (octagon) shape of the equipment cells, as in the reference. */
const CELL_SHAPE = "[clip-path:polygon(14px_0,calc(100%-14px)_0,100%_14px,100%_calc(100%-14px),calc(100%-14px)_100%,14px_100%,0_calc(100%-14px),0_14px)]";

type CellTone = "empty" | "item" | "rare" | "selected";
const CELL_BORDER: Record<CellTone, string> = {
  empty: "bg-gradient-to-b from-vi/35 to-pri/25",
  item: "bg-gradient-to-b from-[#7fa8ff] to-vi",
  rare: "bg-gradient-to-b from-go to-[#8a6a2a]",
  selected: "bg-gradient-to-b from-tx to-vi",
};
const CELL_GLOW: Record<CellTone, string> = {
  empty: "",
  item: "drop-shadow-[0_0_10px_rgba(127,168,255,0.35)]",
  rare: "drop-shadow-[0_0_10px_rgba(214,169,74,0.45)]",
  selected: "drop-shadow-[0_0_12px_rgba(163,138,209,0.7)]",
};

interface CharacterStageProps {
  /** What to draw: the saved appearance or the unsaved draft from the appearance editor. */
  appearance: AvatarAppearance;
  onSlotClick?: (slot: SlotName) => void;
  selectedSlot?: SlotName | null;
}

/**
 * Profile stage (layout after the owner's reference): one framed scene with the chosen background, a glowing
 * hexagon and a pedestal behind the one <Character/>, tall cut-corner equipment cells (5 + 5) along the sides
 * joined to the scene by thin lines (a scrollable row on phones), turning by drag / buttons / arrow keys
 * (front and back drawings with a CSS 3D turn — the figure is flat 2D art) and the background picker below.
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

  const frameColor = FRAMES[gameState.frame]?.color || "#a38ad1";
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
    const tone: CellTone = selected ? "selected" : !item ? "empty" : item.rarity > 0 ? "rare" : "item";
    const label = item ? formatString(st.slotFilled, { slot: slotLabel, item: itemLabel }) : formatString(st.slotEmpty, { slot: slotLabel });
    const row = side === "row";
    return (
      <li key={slot} className={cn("relative shrink-0", !row && "flex items-center", side === "right" && "flex-row-reverse")}>
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
            "group relative block rounded-[14px] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink motion-safe:hover:-translate-y-0.5",
            CELL_GLOW[tone]
          )}
        >
          {/* 1.5px gradient border made of two cut-corner layers */}
          <span className={cn("block p-[1.5px]", CELL_SHAPE, CELL_BORDER[tone], row ? "h-[78px] w-[64px]" : "h-[92px] w-[76px] xl:h-[104px] xl:w-[84px]")}>
            <span className={cn("flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[#120f1d]/95", CELL_SHAPE)}>
              {item ? (
                <span className="grid h-9 w-9 place-items-center rounded-lg shadow-inner xl:h-10 xl:w-10" style={{ backgroundColor: item.color }} aria-hidden="true">
                  <Icon size={18} className="text-white drop-shadow" />
                </span>
              ) : (
                <Icon size={22} aria-hidden="true" className="text-mu/70 transition-colors group-hover:text-tx" />
              )}
              <span className={cn("max-w-full truncate px-1 text-[10px] font-semibold leading-tight xl:text-[11px]", tone === "rare" ? "text-go" : item ? "text-tx" : "text-mu")}>
                {slotLabel}
              </span>
            </span>
          </span>
        </button>
        {/* connector towards the scene */}
        {!row && (
          <span
            aria-hidden="true"
            className={cn("h-px w-5 xl:w-8", side === "left" ? "bg-gradient-to-r from-vi/60 to-vi/0" : "bg-gradient-to-l from-vi/60 to-vi/0")}
          />
        )}
      </li>
    );
  };

  return (
    <section aria-label={st.label} className="space-y-3">
      {/* Frame: thin border in the frame colour, soft glow */}
      <div
        className="relative isolate overflow-hidden rounded-[22px] border shadow-[0_0_50px_-20px_rgba(163,138,209,0.75),inset_0_0_60px_-30px_rgba(163,138,209,0.6)]"
        style={{ borderColor: `${frameColor}66` }}
        data-testid="profile-stage"
        data-background={bgId}
      >
        <StageBackdrop id={bgId} />

        <div className="relative h-[45dvh] min-h-[300px] lg:grid lg:h-[min(80vh,700px)] lg:min-h-[600px] lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-stretch lg:px-4">
          <ul aria-label={st.slotsLabel} className="hidden flex-col justify-evenly py-4 lg:flex">
            {LEFT_SLOTS.map((s) => renderSlot(s, "left"))}
          </ul>

          {/* Scene: hexagon + pedestal behind the character */}
          <div className="relative h-full min-w-0">
            <svg aria-hidden="true" viewBox="0 0 200 230" preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-x-[8%] top-[14%] h-[66%] w-[84%]">
              <polygon
                points="100,6 192,58 192,172 100,224 8,172 8,58"
                fill="rgba(80,52,143,0.10)"
                stroke="rgba(163,138,209,0.65)"
                strokeWidth="1.6"
                style={{ filter: "drop-shadow(0 0 6px rgba(163,138,209,0.55))" }}
              />
            </svg>
            {/* pedestal */}
            <div aria-hidden="true" className="pointer-events-none absolute bottom-[5%] left-1/2 h-[9%] w-[62%] -translate-x-1/2">
              <div className="absolute inset-0 rounded-[50%] border border-vi/60 bg-pri/25 shadow-[0_0_24px_rgba(163,138,209,0.6)]" />
              <div className="absolute inset-x-[12%] inset-y-[22%] rounded-[50%] border border-vi/40 bg-vi/10" />
            </div>

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
              className="absolute inset-0 flex cursor-grab touch-pan-y select-none items-end justify-center pb-[9%] pt-[6%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi active:cursor-grabbing"
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
            <div className="absolute inset-x-0 bottom-2 flex justify-center">
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

          <ul aria-label={st.slotsLabel} className="hidden flex-col items-end justify-evenly py-4 lg:flex">
            {RIGHT_SLOTS.map((s) => renderSlot(s, "right"))}
          </ul>
        </div>
      </div>

      {/* Phones and tablets: all slots in one scrollable row under the scene */}
      <ul aria-label={st.slotsLabel} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {[...LEFT_SLOTS, ...RIGHT_SLOTS].map((s) => renderSlot(s, "row"))}
      </ul>

      {/* Background picker */}
      <div>
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
